import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
	canonicalizeExternalPath,
	createRtkRunner,
	EXPECTED_BINDINGS,
	parseArgs,
	parseAndVerifyInfo,
	runBackup,
	validateD1Config,
	verifyManifest
} from './d1-backup.mjs';

const CONFIG = JSON.stringify({
	d1_databases: EXPECTED_BINDINGS.map((binding, index) => ({
		binding,
		database_name: `db-${index + 1}`,
		database_id: `${index + 1}0000000-0000-4000-8000-00000000000${index + 1}`
	}))
});

async function sandbox() {
	const root = await mkdtemp(join(tmpdir(), 'zatiaras-backup-test-'));
	const repo = join(root, 'workspace', 'repo');
	const external = join(root, 'external');
	await mkdir(repo, { recursive: true });
	await mkdir(external, { recursive: true });
	return {
		root,
		repo,
		workspace: dirname(repo),
		external,
		async cleanup() {
			await rm(root, { recursive: true, force: true });
		}
	};
}

function fakeRunner({ mismatch = false, zeroByte = false, secrets = [] } = {}) {
	const calls = [];
	const runner = async (args, options) => {
		calls.push({ args, options });
		for (const secret of secrets) {
			assert.equal(JSON.stringify(args).includes(secret), false);
		}
		const operation = args[4];
		const name = args[5];
		if (operation === 'info') {
			const index = Number(name.slice(-1));
			return {
				status: 0,
				stderr: '',
				stdout: JSON.stringify({
					name: mismatch ? 'wrong-target' : name,
					uuid: `${index}0000000-0000-4000-8000-00000000000${index}`,
					version: 'production'
				})
			};
		}
		if (operation === 'export') {
			const output = args[args.indexOf('--output') + 1];
			await writeFile(output, zeroByte ? '' : `PRAGMA foreign_keys=OFF;\n-- ${name}\n`, 'utf8');
			return { status: 0, stderr: '', stdout: '' };
		}
		throw new Error('unexpected fake operation');
	};
	return { runner, calls };
}

test('backup CLI requires an explicit active inventory or legacy source', () => {
	assert.throws(() => parseArgs(['--output-dir', 'D:\\outside']), /active-inventory|legacy-source/);
	assert.equal(
		parseArgs(['--output-dir', 'D:\\outside', '--active-inventory', 'D:\\inventory.json'])
			.activeInventory,
		'D:\\inventory.json'
	);
	assert.throws(() =>
		parseArgs([
			'--output-dir',
			'D:\\outside',
			'--active-inventory',
			'D:\\inventory.json',
			'--env-file',
			'legacy.env'
		])
	);
});

test('accepts the pnpm argument separator only in the first position', () => {
	assert.equal(
		parseArgs(['--', '--legacy-source', '--output-dir', 'D:\\outside']).outputDir,
		'D:\\outside'
	);
	assert.throws(() => parseArgs(['--output-dir', 'D:\\outside', '--']));
});

test('rejects missing, relative, repository, and workspace destinations before runner', async () => {
	const box = await sandbox();
	try {
		for (const destination of [
			'relative/path',
			box.repo,
			join(box.repo, 'backups'),
			box.workspace
		]) {
			await assert.rejects(
				() =>
					runBackup({
						outputDir: destination,
						repoRoot: box.repo,
						workspaceRoot: box.workspace,
						configText: CONFIG,
						runner: async () => assert.fail('runner must not execute')
					}),
				/path absolut|luar repository/
			);
		}
	} finally {
		await box.cleanup();
	}
});

test('rejects symlink or junction destinations resolving into workspace', async (t) => {
	const box = await sandbox();
	try {
		const link = join(box.external, 'redirect');
		try {
			await symlink(box.repo, link, process.platform === 'win32' ? 'junction' : 'dir');
		} catch (error) {
			t.skip(`symlink/junction unavailable: ${error.code}`);
			return;
		}
		await assert.rejects(
			() =>
				canonicalizeExternalPath(link, {
					repoRoot: box.repo,
					workspaceRoot: box.workspace,
					mustExist: true
				}),
			/workspace/
		);
	} finally {
		await box.cleanup();
	}
});

async function activeFixture(box) {
	const branches = ['samarinda', 'balikpapan', 'berau'];
	const inventory = { schema: 'zatiaraspos-d1-active-inventory-v1', branches: {} };
	const tokens = [];
	for (const [i, branch] of branches.entries()) {
		const token = `fixture-credential-${branch}`;
		tokens.push(token);
		const account = String(i + 1).repeat(32);
		const id = `${i + 4}0000000-0000-4000-8000-00000000000${i + 1}`;
		const key = `BRANCH_CF_TOKEN_${branch.toUpperCase()}`;
		const file = join(box.external, `${branch}.env`);
		await writeFile(file, `${key}=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\n`);
		inventory.branches[branch] = {
			account_id: account,
			database_id: id,
			token_env_file: file,
			token_env_key: key
		};
	}
	const activeInventory = join(box.external, 'active.json');
	const save = () => writeFile(activeInventory, JSON.stringify(inventory));
	await save();
	return {
		branches,
		inventory,
		tokens,
		save,
		options: { activeInventory, repoRoot: box.repo, workspaceRoot: box.workspace },
		outputDir: join(box.external, 'backups')
	};
}

function activeRunner(fixture, mismatch) {
	const operations = [];
	const runner = async (args, { env }) => {
		const [operation, name] = args.slice(4, 6);
		operations.push(operation);
		const branch = fixture.branches.find((b) => name === `zatiaraspos-${b}`);
		assert.ok(branch);
		const i = fixture.branches.indexOf(branch);
		assert.equal(JSON.stringify(args).includes(fixture.tokens[i]), false);
		const expected = fixture.inventory.branches[branch];
		assert.deepEqual(env, {
			CLOUDFLARE_ACCOUNT_ID: expected.account_id,
			CLOUDFLARE_API_TOKEN: fixture.tokens[i]
		});
		const config = JSON.parse(await readFile(args[args.indexOf('--config') + 1], 'utf8'));
		assert.deepEqual(config, {
			account_id: expected.account_id,
			d1_databases: [
				{ binding: EXPECTED_BINDINGS[i], database_name: name, database_id: expected.database_id }
			]
		});
		if (operation === 'info')
			return {
				stdout: JSON.stringify({
					name,
					uuid:
						branch === mismatch
							? fixture.inventory.branches.samarinda.database_id
							: expected.database_id
				})
			};
		assert.equal(operation, 'export');
		await writeFile(args[args.indexOf('--output') + 1], 'PRAGMA foreign_keys=OFF;\n');
		return { stdout: '' };
	};
	return { operations, runner };
}

test('active backup pins all account/database identities and never mixes credentials', async () => {
	const box = await sandbox();
	try {
		const fx = await activeFixture(box);
		const fake = activeRunner(fx);
		const result = await runBackup({
			...fx.options,
			outputDir: fx.outputDir,
			processEnv: {},
			runner: fake.runner
		});
		assert.deepEqual(fake.operations, ['info', 'info', 'info', 'export', 'export', 'export']);
		const verified = await verifyManifest(result.manifestPath, {
			...fx.options,
			requireComplete: true
		});
		assert.equal(verified.manifest.schema, 'zatiaraspos-d1-backup-v2');
		assert.deepEqual(
			verified.manifest.shards.map(({ account_id }) => account_id),
			fx.branches.map((b) => fx.inventory.branches[b].account_id)
		);
		assert.ok(!JSON.stringify(verified.manifest).includes('fixture-credential-'));
		assert.ok(!(await readdir(result.runDir)).includes('.targets'));
		await assert.rejects(
			verifyManifest(result.manifestPath, { repoRoot: box.repo, workspaceRoot: box.workspace }),
			/--active-inventory/
		);
		verified.manifest.shards[2].account_id = verified.manifest.shards[1].account_id;
		await writeFile(result.manifestPath, JSON.stringify(verified.manifest));
		await assert.rejects(
			verifyManifest(result.manifestPath, fx.options),
			/Entry manifest tidak valid/
		);
	} finally {
		await box.cleanup();
	}
});

test('active backup checks all identities before exporting and rejects a duplicate account', async () => {
	const box = await sandbox();
	try {
		const fx = await activeFixture(box);
		const fake = activeRunner(fx, 'berau');
		await assert.rejects(
			runBackup({ ...fx.options, outputDir: fx.outputDir, processEnv: {}, runner: fake.runner }),
			/Identitas D1 DB_BERAU_GROUP/
		);
		assert.deepEqual(fake.operations, ['info', 'info', 'info']);
		const [failedId] = await readdir(fx.outputDir);
		assert.deepEqual(await readdir(join(fx.outputDir, failedId)), ['FAILED.json']);
		fx.inventory.branches.berau.account_id = fx.inventory.branches.balikpapan.account_id;
		await fx.save();
		await assert.rejects(
			runBackup({
				...fx.options,
				outputDir: fx.outputDir,
				runner: async () => assert.fail('runner must not execute')
			}),
			/tiga akun/
		);
	} finally {
		await box.cleanup();
	}
});

test('requires exact three configured bindings with unique names and IDs', () => {
	assert.equal(validateD1Config(CONFIG).length, 3);
	const parsed = JSON.parse(CONFIG);
	assert.throws(() => validateD1Config({ d1_databases: parsed.d1_databases.slice(0, 2) }));
	assert.throws(() =>
		validateD1Config({
			d1_databases: parsed.d1_databases.map((item, index) => ({
				...item,
				binding: index === 2 ? 'DB_OTHER' : item.binding
			}))
		})
	);
	assert.throws(() =>
		validateD1Config({
			d1_databases: parsed.d1_databases.map((item) => ({ ...item, database_name: 'duplicate' }))
		})
	);
	assert.throws(() =>
		validateD1Config({
			d1_databases: parsed.d1_databases.map((item) => ({ ...item, database_id: '' }))
		})
	);
});

test('accepts Wrangler production info without a version field and rejects explicit non-production', () => {
	const expected = validateD1Config(CONFIG)[0];
	assert.equal(
		parseAndVerifyInfo(JSON.stringify({ name: expected.name, uuid: expected.id }), expected)
			.version,
		'production'
	);
	assert.throws(() =>
		parseAndVerifyInfo(
			JSON.stringify({ name: expected.name, uuid: expected.id, version: 'preview' }),
			expected
		)
	);
});

test('default child runner always uses RTK, shell false, and rejects unsafe D1 operations', async () => {
	const spawned = [];
	const runner = createRtkRunner({
		spawn(command, args, options) {
			spawned.push({ command, args, options });
			return { status: 0, stdout: '{}', stderr: '' };
		}
	});
	await runner(['pnpm', 'exec', 'wrangler', 'd1', 'info', 'db-1', '--config', 'x', '--json']);
	assert.equal(spawned[0].command, 'rtk');
	assert.equal(spawned[0].options.shell, false);
	assert.equal(
		spawned[0].options.env.WRANGLER_WRITE_LOGS,
		'false',
		'Wrangler disk logs must not persist presigned full-database download URLs'
	);
	await runner(
		[
			'pnpm',
			'exec',
			'wrangler',
			'd1',
			'export',
			'db-1',
			'--remote',
			'--skip-confirmation',
			'--output',
			'private.sql'
		],
		{ env: { WRANGLER_WRITE_LOGS: 'true' } }
	);
	assert.equal(spawned[1].options.env.WRANGLER_WRITE_LOGS, 'false');
	assert.equal(spawned[1].options.shell, false);
	assert.equal(spawned[1].command, 'rtk');
	await assert.rejects(
		() =>
			runner(['pnpm', 'exec', 'wrangler', 'd1', 'execute', 'db-1', '--command', 'DELETE FROM x']),
		/allowlist/
	);
});

test('Wrangler failures cannot disclose an export URL or API token', async () => {
	const token = 'fixture-token';
	const runner = createRtkRunner({
		spawn: () => ({
			status: 1,
			stdout: '',
			stderr: `Download failed https://export.invalid/secret?signature=fixture ${token}`
		})
	});
	await assert.rejects(
		() =>
			runner(
				[
					'pnpm',
					'exec',
					'wrangler',
					'd1',
					'export',
					'db-1',
					'--remote',
					'--skip-confirmation',
					'--output',
					'private.sql'
				],
				{ secrets: { token } }
			),
		(error) => {
			assert.match(error.message, /Download failed \[URL\] \[REDACTED\]/);
			assert.doesNotMatch(error.message, /signature=|fixture-token/);
			return true;
		}
	);
});

test('identity mismatch and zero-byte export fail without COMPLETE', async () => {
	for (const options of [{ mismatch: true }, { zeroByte: true }]) {
		const box = await sandbox();
		try {
			const fake = fakeRunner(options);
			await assert.rejects(() =>
				runBackup({
					outputDir: box.external,
					repoRoot: box.repo,
					workspaceRoot: box.workspace,
					configText: CONFIG,
					runner: fake.runner
				})
			);
			assert.equal(
				fake.calls.some((call) => call.args.includes('execute')),
				false
			);
		} finally {
			await box.cleanup();
		}
	}
});

test('loaded secret values are absent from child argv and sanitized failures', async () => {
	const box = await sandbox();
	try {
		const envFile = join(box.root, '.env');
		const token = 'secret-token-for-test';
		const account = 'secret-account-for-test';
		await writeFile(
			envFile,
			`CLOUDFLARE_API_TOKEN=${token}\nCLOUDFLARE_ACCOUNT_ID=${account}\nIGNORED=value\n`
		);
		const fake = fakeRunner({ secrets: [token, account] });
		const result = await runBackup({
			outputDir: box.external,
			envFile,
			repoRoot: box.repo,
			workspaceRoot: box.workspace,
			configText: CONFIG,
			runner: fake.runner,
			processEnv: {}
		});
		assert.equal(result.shardCount, 3);
		for (const call of fake.calls) {
			assert.deepEqual(Object.keys(call.options.env).sort(), [
				'CLOUDFLARE_ACCOUNT_ID',
				'CLOUDFLARE_API_TOKEN'
			]);
		}
	} finally {
		await box.cleanup();
	}
});

test('recovery COMPLETE must be a regular file and FAILED marker must veto it', async () => {
	const box = await sandbox();
	try {
		const result = await runBackup({
			outputDir: box.external,
			repoRoot: box.repo,
			workspaceRoot: box.workspace,
			configText: CONFIG,
			runner: fakeRunner().runner
		});
		const options = {
			repoRoot: box.repo,
			workspaceRoot: box.workspace,
			configText: CONFIG,
			requireComplete: true
		};
		await writeFile(join(result.runDir, 'FAILED.json'), '{"status":"FAILED"}');
		await assert.rejects(verifyManifest(result.manifestPath, options), /FAILED/);
		await rm(join(result.runDir, 'FAILED.json'));
		await rm(join(result.runDir, 'COMPLETE'));
		await mkdir(join(result.runDir, 'COMPLETE'));
		await assert.rejects(verifyManifest(result.manifestPath, options), /COMPLETE.*reguler/);
	} finally {
		await box.cleanup();
	}
});

test('exact-three backup succeeds and tampered hash is rejected', async () => {
	const box = await sandbox();
	try {
		const fake = fakeRunner();
		const result = await runBackup({
			outputDir: box.external,
			repoRoot: box.repo,
			workspaceRoot: box.workspace,
			configText: CONFIG,
			runner: fake.runner
		});
		assert.equal(result.shardCount, 3);
		assert.equal(fake.calls.filter((call) => call.args[4] === 'info').length, 3);
		assert.equal(fake.calls.filter((call) => call.args[4] === 'export').length, 3);
		assert.equal(
			fake.calls.some((call) =>
				call.args.some((arg) =>
					['execute', 'migrations', 'restore', 'delete', '--command'].includes(arg)
				)
			),
			false
		);
		const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
		assert.equal(manifest.shards.length, 3);
		await verifyManifest(result.manifestPath, {
			repoRoot: box.repo,
			workspaceRoot: box.workspace,
			configText: CONFIG
		});
		const shardPath = join(dirname(result.manifestPath), manifest.shards[0].file);
		await writeFile(shardPath, 'PRAGMA tampered=TRUE;\n');
		await assert.rejects(
			() =>
				verifyManifest(result.manifestPath, {
					repoRoot: box.repo,
					workspaceRoot: box.workspace,
					configText: CONFIG
				}),
			/Hash\/readback/
		);
	} finally {
		await box.cleanup();
	}
});
