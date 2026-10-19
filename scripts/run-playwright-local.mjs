import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createE2eEnvironment, resolveE2eSelections } from './e2e-environment.mjs';
import { ensureE2eApplicationReady } from './e2e-readiness.mjs';

const require = createRequire(import.meta.url);

function waitForPort(child) {
	return new Promise((resolvePort, reject) => {
		const finish = (error, port) => {
			clearTimeout(timer);
			child.removeListener('error', onError);
			child.removeListener('exit', onExit);
			child.removeListener('message', onMessage);
			if (error) reject(error);
			else resolvePort(port);
		};
		const onError = (error) => finish(error);
		const onExit = (code) => finish(new Error(`E2E server exited during startup (${code})`));
		const onMessage = (message) => {
			if (
				!message ||
				typeof message !== 'object' ||
				!('port' in message) ||
				typeof message.port !== 'number' ||
				!Number.isInteger(message.port) ||
				message.port < 1 ||
				message.port > 65535
			) {
				finish(new Error('Invalid E2E server ready message'));
				return;
			}
			finish(undefined, message.port);
		};
		const timer = setTimeout(() => finish(new Error('E2E server startup timed out')), 120000);
		child.once('error', onError);
		child.once('exit', onExit);
		child.once('message', onMessage);
	});
}

async function runSelection(selection, dependencies, artifactId) {
	let environment;
	let server;
	let tests;
	let exitCode = 1;
	let stopped = true;
	try {
		// Windows menerima casing cwd berbeda, tetapi Vite membedakan identitas URL modul.
		const projectRoot = (dependencies.resolveRoot || (() => realpathSync.native(process.cwd())))();
		environment = (dependencies.createEnvironment || createE2eEnvironment)();
		const initialized = await environment.initialize();
		console.log(
			`[e2e:${selection.name}] ${initialized.migrations} migrations x ${initialized.databases} isolated D1 databases ready`
		);
		const env = {
			...process.env,
			ZATIARAS_E2E_CONFIG: environment.configPath,
			ZATIARAS_E2E_STATE: environment.persistPath,
			// Invalid fixture only; never credentials from the workstation or a paid provider.
			OPENROUTER_API_KEY: 'e2e-dummy-key-tidak-valid-untuk-upstream'
		};
		const startupStarted = performance.now();
		server = (dependencies.fork || fork)(new URL('./e2e-server.mjs', import.meta.url), [], {
			cwd: projectRoot,
			env,
			execArgv: [],
			stdio: ['ignore', 'inherit', 'inherit', 'ipc']
		});
		stopped = false;
		const port = await waitForPort(server);
		const baseURL = `http://127.0.0.1:${port}`;
		// Listening alone does not prove the cold SSR graph and emulator are ready.
		await (dependencies.ensureReady || ensureE2eApplicationReady)(
			baseURL,
			Math.floor(120000 - (performance.now() - startupStarted))
		);
		console.log(
			`[e2e:${selection.name}] Anonymous application ready in ${Math.round(performance.now() - startupStarted)}ms (original 120000ms startup budget)`
		);
		console.log(`[e2e:${selection.name}] ${baseURL}; persistence ${environment.persistPath}`);
		exitCode = await new Promise((resolveExit, reject) => {
			tests = (dependencies.spawn || spawn)(
				process.execPath,
				[require.resolve('@playwright/test/cli'), 'test', ...selection.args],
				{
					cwd: projectRoot,
					stdio: 'inherit',
					shell: false,
					env: {
						...env,
						E2E_PORT: String(port),
						E2E_BASE_URL: baseURL,
						E2E_EXTERNAL_SERVER: '1',
						// Later Playwright invocations must not erase an earlier cohort's failure evidence.
						E2E_OUTPUT_DIR: join('test-results', artifactId, selection.name),
						PLAYWRIGHT_HTML_OUTPUT_DIR: join('playwright-report', artifactId, selection.name),
						UAT_PASSWORD: environment.password
					}
				}
			);
			tests.once('error', reject);
			tests.once('exit', (code) => resolveExit(code ?? 1));
		});
	} catch (error) {
		console.error('[e2e]', error instanceof Error ? error.message : String(error));
	} finally {
		if (tests && tests.exitCode === null && tests.signalCode === null) {
			tests.kill();
			try {
				await once(tests, 'exit');
			} catch (error) {
				// An unconfirmed child stop cannot authorize removing its persistence.
				console.error('[e2e] Browser stop unconfirmed:', error);
			}
		}
		if (server) {
			let timer;
			try {
				if (server.exitCode === null && server.signalCode === null) {
					const exit = once(server, 'exit');
					if (server.connected) server.send('shutdown');
					else server.kill();
					await Promise.race([
						exit,
						new Promise((_, reject) => {
							timer = setTimeout(() => reject(new Error('E2E server shutdown timed out')), 20000);
						})
					]);
				}
				stopped = tests == null || tests.exitCode !== null || tests.signalCode !== null;
			} catch (error) {
				exitCode = 1;
				console.error(
					'[e2e] Shutdown failed; isolated run retained:',
					environment.directory,
					error
				);
			} finally {
				clearTimeout(timer);
			}
		}
		if (stopped && environment) {
			try {
				environment.cleanup();
				console.log('[e2e] Owned temporary state removed; dev state untouched.');
			} catch (error) {
				exitCode = 1;
				console.error('[e2e] Cleanup failed; run retained:', environment.directory, error);
			}
		} else if (!stopped) {
			exitCode = 1;
		}
	}
	return exitCode;
}

export async function runE2e(argv = process.argv.slice(2), dependencies = {}) {
	// Validate the entire coverage plan before creating any environment or child.
	const selections = resolveE2eSelections(argv);
	const artifactId = `isolated-${randomUUID()}`;
	console.log(
		`[e2e] Artifacts retained under test-results/${artifactId}/ and playwright-report/${artifactId}/`
	);
	let exitCode = 0;
	for (const selection of selections) {
		const result = await runSelection(selection, dependencies, artifactId);
		console.log(`[e2e:${selection.name}] exit ${result}`);
		if (result !== 0) exitCode = 1;
	}
	return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	process.exit(await runE2e());
}
