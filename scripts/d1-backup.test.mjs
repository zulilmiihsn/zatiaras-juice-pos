import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('accepts the pnpm argument separator only in the first position', () => {
	assert.equal(parseArgs(['--', '--output-dir', 'D:\\outside']).outputDir, 'D:\\outside');
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
	await assert.rejects(
		() =>
			runner(['pnpm', 'exec', 'wrangler', 'd1', 'execute', 'db-1', '--command', 'DELETE FROM x']),
		/allowlist/
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
