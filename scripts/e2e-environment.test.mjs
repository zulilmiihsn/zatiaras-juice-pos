import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mkdtempSync,
	writeFileSync,
	readFileSync,
	existsSync,
	rmSync,
	readdirSync,
	realpathSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { fork, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { ensureE2eApplicationReady } from './e2e-readiness.mjs';
import { createE2eEnvironment, resolveE2eSelections } from './e2e-environment.mjs';
import { runE2e } from './run-playwright-local.mjs';

test('parallel E2E environments own different state and cleanup preserves neighbours', () => {
	const parent = mkdtempSync(
		join(process.env.ZATIARAS_TEST_TMPDIR || tmpdir(), 'zatiaras-isolation-test-')
	);
	try {
		const sentinel = join(parent, 'dev-state-sentinel');
		writeFileSync(sentinel, 'keep');
		const a = createE2eEnvironment(parent);
		const b = createE2eEnvironment(parent);
		assert.notEqual(a.persistPath, b.persistPath);
		assert.notEqual(a.password, b.password);
		const config = JSON.parse(readFileSync(a.configPath, 'utf8'));
		assert.equal(config.d1_databases.length, 3);
		assert.ok(!a.persistPath.includes('.wrangler'));
		a.cleanup();
		a.cleanup();
		assert.equal(existsSync(a.directory), false);
		assert.equal(existsSync(b.configPath), true);
		assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
		b.cleanup();
		assert.deepEqual(readdirSync(parent), ['dev-state-sentinel']);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

function controlledChild() {
	const child = new EventEmitter();
	child.exitCode = null;
	child.signalCode = null;
	child.connected = true;
	child.finish = (code) => {
		child.exitCode = code;
		child.emit('exit', code);
	};
	child.send = () => queueMicrotask(() => child.finish(0));
	child.kill = () => queueMicrotask(() => child.finish(1));
	return child;
}

function controlledRunner(statuses = [0, 0, 0]) {
	const created = [],
		initialized = [],
		cleaned = [],
		invocations = [];
	return {
		created,
		initialized,
		cleaned,
		invocations,
		dependencies: {
			ensureReady: async () => {},
			createEnvironment() {
				const id = created.length;
				created.push(id);
				return {
					directory: `owned-${id}`,
					configPath: `config-${id}`,
					persistPath: `state-${id}`,
					password: 'synthetic-fixture-not-a-secret',
					async initialize() {
						initialized.push(id);
						return { migrations: 43, databases: 3 };
					},
					cleanup() {
						cleaned.push(id);
					}
				};
			},
			fork() {
				const child = controlledChild();
				queueMicrotask(() => child.emit('message', { port: 17000 + created.length }));
				return child;
			},
			spawn(command, args, options) {
				const index = invocations.length;
				invocations.push({ command, args: args.slice(2), options });
				const child = controlledChild();
				queueMicrotask(() => child.finish(statuses[index] ?? 0));
				return child;
			}
		}
	};
}

test('application readiness precedes browser spawn, shares the existing startup budget and fails closed', async () => {
	for (const failed of [false, true]) {
		const controlled = controlledRunner();
		const order = [];
		controlled.dependencies.ensureReady = async (baseURL, remainingMs) => {
			assert.match(baseURL, /^http:\/\/127\.0\.0\.1:\d+$/);
			assert.ok(remainingMs > 0 && remainingMs <= 120000);
			order.push('ready');
			if (failed) throw new Error('OWNED_READINESS_FAILURE');
		};
		const spawn = controlled.dependencies.spawn;
		controlled.dependencies.spawn = (...args) => {
			order.push('browser');
			return spawn(...args);
		};
		assert.equal(await runE2e(['e2e/auth.spec.ts'], controlled.dependencies), failed ? 1 : 0);
		assert.deepEqual(order, failed ? ['ready'] : ['ready', 'browser']);
		assert.deepEqual(controlled.cleaned, [0]);
	}
});

async function withOwnedHttp(handler, run) {
	const server = createServer(handler);
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		await run(`http://127.0.0.1:${address.port}`);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}

test('actual owned HTTP login readiness is anonymous, local, rendered and bounded', async () => {
	await withOwnedHttp(
		(req, res) => {
			assert.equal(req.url, '/login');
			assert.equal(req.headers.cookie, undefined);
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end('<html><form data-hydrated="false"></form></html>');
		},
		(origin) => ensureE2eApplicationReady(origin, 1000)
	);
	await assert.rejects(
		ensureE2eApplicationReady('https://example.invalid', 1000),
		/owned loopback/
	);
	await assert.rejects(ensureE2eApplicationReady('http://127.0.0.1:1234', 0), /budget/);
});

test('actual owned HTTP readiness rejects redirects, bad status, malformed and oversized HTML', async () => {
	for (const [status, body] of [
		[302, ''],
		[503, '<form></form>'],
		[200, '<html>not ready</html>'],
		[200, 'x'.repeat(512 * 1024 + 1)]
	]) {
		await withOwnedHttp(
			(req, res) => {
				res.writeHead(status, {
					'content-type': 'text/html',
					...(status === 302 ? { Location: 'https://example.invalid' } : {})
				});
				res.end(body);
			},
			async (origin) => {
				await assert.rejects(ensureE2eApplicationReady(origin, 1000));
			}
		);
	}
});

test('actual owned HTTP stalled response body is aborted rather than announcing readiness', async () => {
	await withOwnedHttp(
		(req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' });
			res.write('<form>');
		},
		async (origin) => {
			await assert.rejects(
				ensureE2eApplicationReady(origin, 30),
				(error) => error.name === 'TimeoutError' || error.name === 'AbortError'
			);
		}
	);
});

test('default full runner owns fresh state per canonical CI cohort with exact whole-spec coverage', async () => {
	const controlled = controlledRunner();
	assert.equal(await runE2e([], controlled.dependencies), 0);
	assert.equal(
		controlled.created.length,
		3,
		'One shared limiter environment must not serve the whole suite'
	);
	assert.deepEqual(controlled.initialized, [0, 1, 2]);
	assert.deepEqual(controlled.cleaned, [0, 1, 2]);
	const selected = controlled.invocations.flatMap(({ args }) => args).sort();
	const inventory = readdirSync('e2e')
		.filter((file) => file.endsWith('.spec.ts'))
		.map((file) => `e2e/${file}`)
		.sort();
	assert.deepEqual(selected, inventory);
	assert.equal(new Set(selected).size, selected.length);
	for (const key of ['ZATIARAS_E2E_STATE', 'E2E_OUTPUT_DIR', 'PLAYWRIGHT_HTML_OUTPUT_DIR']) {
		assert.equal(new Set(controlled.invocations.map(({ options }) => options.env[key])).size, 3);
	}
	assert.ok(
		controlled.invocations.every(({ options }) =>
			options.env.E2E_OUTPUT_DIR.startsWith('test-results')
		)
	);
});

test('failed cohort cannot be hidden by later passes and all remaining cohorts still run', async () => {
	const controlled = controlledRunner([1, 0, 0]);
	assert.equal(await runE2e([], controlled.dependencies), 1);
	assert.deepEqual(controlled.initialized, [0, 1, 2]);
	assert.deepEqual(controlled.cleaned, [0, 1, 2]);
	assert.equal(controlled.invocations.length, 3);
	assert.notEqual(
		controlled.invocations[0].options.env.E2E_OUTPUT_DIR,
		controlled.invocations[1].options.env.E2E_OUTPUT_DIR
	);
});

test('explicit CLI selection stays literal and has one isolated environment', async () => {
	const argv = ['e2e/catat-recent.spec.ts', '--grep', 'failure & recovery'];
	const controlled = controlledRunner();
	assert.equal(await runE2e(argv, controlled.dependencies), 0);
	assert.equal(controlled.invocations.length, 1);
	assert.deepEqual(controlled.invocations[0].args, argv);
	assert.equal(controlled.invocations[0].options.shell, false);
	assert.deepEqual(controlled.cleaned, [0]);
	assert.deepEqual(resolveE2eSelections(argv)[0].args, argv);
});

test('canonical project directory is shared by server and browser children', async () => {
	const controlled = controlledRunner();
	const expected = realpathSync.native(process.cwd());
	const forkChild = controlled.dependencies.fork;
	let serverDirectory;
	controlled.dependencies.fork = (file, args, options) => {
		serverDirectory = options.cwd;
		return forkChild(file, args, options);
	};
	assert.equal(await runE2e(['e2e/cache-branch.spec.ts'], controlled.dependencies), 0);
	assert.equal(serverDirectory, expected);
	assert.equal(controlled.invocations[0].options.cwd, expected);
	assert.deepEqual(controlled.cleaned, [0]);
});

test('canonical root resolution failure stops before creating owned state or children', async () => {
	const controlled = controlledRunner();
	controlled.dependencies.resolveRoot = () => {
		throw new Error('OWNED_ROOT_FAILURE');
	};
	assert.equal(await runE2e(['e2e/cache-branch.spec.ts'], controlled.dependencies), 1);
	assert.deepEqual(controlled.created, []);
	assert.deepEqual(controlled.invocations, []);
	assert.deepEqual(controlled.cleaned, []);
});

test('full coverage rejects a missing, duplicate, unknown or invalid canonical spec inventory', () => {
	const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
	const specFiles = readdirSync('e2e')
		.filter((file) => file.endsWith('.spec.ts'))
		.map((file) => `e2e/${file}`);
	for (const transform of [
		(copy) => {
			delete copy['test:e2e:ci-b'];
		},
		(copy) => {
			copy['test:e2e:ci-a'] += ' e2e/not-present.spec.ts';
		},
		(copy) => {
			copy['test:e2e:ci-b'] += ' e2e/pos.spec.ts';
		},
		(copy) => {
			copy['test:e2e:ci-c'] = copy['test:e2e:ci-c'].replace(' e2e/pos.spec.ts', '');
		},
		(copy) => {
			copy['test:e2e:ci-c'] += ' && echo bypass';
		}
	]) {
		const copy = { ...scripts };
		transform(copy);
		assert.throws(() => resolveE2eSelections([], { scripts: copy, specFiles }), /E2E coverage/);
	}
	assert.throws(
		() => resolveE2eSelections([], { scripts, specFiles: [...specFiles, 'e2e/new.spec.ts'] }),
		/missing\/duplicate/
	);
});

test('owned initialization failure and thrown spawn clean state and retain nonzero status', async () => {
	for (const failure of ['initialize', 'spawn']) {
		const controlled = controlledRunner();
		if (failure === 'initialize') {
			const create = controlled.dependencies.createEnvironment;
			controlled.dependencies.createEnvironment = () => ({
				...create(),
				initialize: async () => {
					throw new Error('OWNED_INIT_FAILURE');
				}
			});
		} else {
			controlled.dependencies.spawn = () => {
				throw new Error('OWNED_SPAWN_FAILURE');
			};
		}
		assert.equal(await runE2e(['e2e/pos.spec.ts'], controlled.dependencies), 1);
		assert.deepEqual(controlled.cleaned, [0]);
		assert.equal(controlled.invocations.length, 0);
	}
});

test('startup listener/timer cleanup rejects invalid ready messages without leaking listeners', async () => {
	const controlled = controlledRunner();
	const child = controlledChild();
	controlled.dependencies.fork = () => {
		queueMicrotask(() => child.emit('message', { port: 'invalid' }));
		return child;
	};
	assert.equal(await runE2e(['e2e/pos.spec.ts'], controlled.dependencies), 1);
	assert.equal(child.exitCode, 0);
	assert.deepEqual(controlled.cleaned, [0]);
	assert.equal(child.listenerCount('message'), 0);
	assert.equal(child.listenerCount('error'), 0);
	assert.equal(child.listenerCount('exit'), 0);
});

test('unconfirmed server stop retains owned state and fails rather than reporting cleanup success', async () => {
	const controlled = controlledRunner();
	const child = controlledChild();
	child.send = () => queueMicrotask(() => child.emit('error', new Error('OWNED_STOP_UNCONFIRMED')));
	controlled.dependencies.fork = () => {
		queueMicrotask(() => child.emit('message', { port: 17555 }));
		return child;
	};
	assert.equal(await runE2e(['e2e/pos.spec.ts'], controlled.dependencies), 1);
	assert.deepEqual(controlled.cleaned, []);
});

test('actual owned Node children stop before filesystem cleanup on success, test failure and startup failure', async () => {
	const parent = mkdtempSync(
		join(process.env.ZATIARAS_TEST_TMPDIR || tmpdir(), 'zatiaras launcher & literal ')
	);
	try {
		const sentinel = join(parent, 'dev-sentinel');
		writeFileSync(sentinel, 'keep');
		const serverFile = join(parent, 'server & literal.cjs'),
			testsFile = join(parent, 'tests & literal.cjs');
		writeFileSync(
			serverFile,
			"if(process.env.OWNED_STARTUP_FAILURE==='1')process.exit(3);process.send({port:17555});process.on('message',m=>{if(m==='shutdown')process.exit(0)});"
		);
		writeFileSync(testsFile, 'process.exit(Number(process.env.OWNED_TEST_STATUS));');
		for (const [startupFailure, testStatus] of [
			[false, 0],
			[false, 1],
			[true, 0]
		]) {
			const children = [],
				environments = [];
			const exit = await runE2e(['e2e/pos.spec.ts'], {
				ensureReady: async () => {},
				createEnvironment() {
					const environment = createE2eEnvironment(parent);
					environments.push(environment);
					return {
						...environment,
						initialize: async () => ({ migrations: 0, databases: 0 }),
						cleanup() {
							assert.ok(
								children.every((child) => child.exitCode !== null || child.signalCode !== null)
							);
							environment.cleanup();
						}
					};
				},
				fork(_file, args, options) {
					const child = fork(serverFile, args, {
						...options,
						env: { ...options.env, OWNED_STARTUP_FAILURE: startupFailure ? '1' : '0' }
					});
					children.push(child);
					return child;
				},
				spawn(command, _args, options) {
					const child = spawn(command, [testsFile], {
						...options,
						env: { ...options.env, OWNED_TEST_STATUS: String(testStatus) }
					});
					children.push(child);
					return child;
				}
			});
			assert.equal(exit, startupFailure || testStatus ? 1 : 0);
			assert.ok(environments.every((environment) => !existsSync(environment.directory)));
			assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
		}
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});

test('configuration initialization failure does not touch project state', () => {
	assert.throws(
		() => createE2eEnvironment(join(tmpdir(), 'nonexistent-e2e-parent', 'nested')),
		/ENOENT/
	);
});
