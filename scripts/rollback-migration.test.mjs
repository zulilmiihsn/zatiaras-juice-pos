import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRollbackArgs, resolveRollbackPlan, main } from './rollback-migration.mjs';
import { drillFixtureSql, drillFixtureBaselineOptions } from './test-fixtures/drill-dump.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';
import { captureDrillParity } from './restore-drill-local.mjs';

const node = process.execPath;
function cli(...args) {
	return spawnSync(node, ['scripts/rollback-migration.mjs', ...args], {
		encoding: 'utf8',
		stdio: 'pipe'
	});
}

await test('usage invalid nonzero (tanpa discovery repo)', () => {
	for (const args of [[], ['--shard', 'DB_SAMARINDA_GROUP'], ['--shard', 'SALAH', '--file', 'x']]) {
		const r = cli(...args);
		assert.notEqual(r.status, 0, JSON.stringify(args));
		assert.match(r.stderr + r.stdout, /Usage|--shard wajib|wajib diisi/);
	}
});

await test('parse menolak flag tak dikenal dan dua sumber', () => {
	assert.throws(
		() => parseRollbackArgs(['--shard', 'DB_SAMARINDA_GROUP', '--ngawur']),
		/tidak diizinkan/
	);
	assert.throws(
		() =>
			parseRollbackArgs(['--shard', 'DB_SAMARINDA_GROUP', '--file', 'a', '--backup-manifest', 'b']),
		/salah satu/
	);
});

const DRILL_SQL = drillFixtureSql();

async function drillFile(content = DRILL_SQL, migration, binding = 'DB_SAMARINDA_GROUP') {
	const dir = mkdtempSync(join(tmpdir(), 'rollback-test-'));
	const path = join(dir, 'sumber aman & literal.sql');
	try {
		const options = await drillFixtureBaselineOptions(content, migration, binding);
		const baselineFile = join(dir, 'approved inventory.json');
		writeFileSync(path, content);
		writeFileSync(baselineFile, options.baseline.text);
		const planOptions = { baselineFile, baselineSha256: options.baseline.approvedSha256 };
		return {
			dir,
			path,
			options,
			planOptions,
			args: [
				'--expect-baseline',
				baselineFile,
				'--expect-baseline-sha256',
				planOptions.baselineSha256
			]
		};
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}

await test('file hilang/kosong/rusak ditolak sebelum mutasi', async () => {
	await assert.rejects(
		resolveRollbackPlan({
			shard: 'DB_SAMARINDA_GROUP',
			live: false,
			file: join(tmpdir(), 'rollback-tidak-ada.sql')
		}),
		/tidak terbaca|wajib berupa path|ENOENT/i
	);
	const empty = await drillFile('   \n');
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', live: false, file: empty.path }),
			/kosong/
		);
	} finally {
		rmSync(empty.dir, { recursive: true, force: true });
	}
	const broken = await drillFile('CREATE TABLE buku_kas(id TEXT);\n');
	try {
		await assert.rejects(
			resolveRollbackPlan({
				shard: 'DB_SAMARINDA_GROUP',
				live: false,
				file: broken.path,
				...broken.planOptions
			}),
			/Drill sumber gagal/
		);
	} finally {
		rmSync(broken.dir, { recursive: true, force: true });
	}
});

await test('dry-run sukses uraikan target, nol mutasi', async () => {
	const { dir, path, args } = await drillFile();
	const codeBefore = process.exitCode;
	try {
		await main(['--shard', 'DB_SAMARINDA_GROUP', '--file', path, ...args, '--dry-run'], {
			spawn: () => {
				throw new Error('spawn tak boleh dipanggil saat dry-run');
			}
		});
		assert.equal(process.exitCode ?? 0, 0);
	} finally {
		process.exitCode = codeBefore;
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('apply memakai satu spawn; gagal = exit 1', async () => {
	const { dir, path, args } = await drillFile(
		DRILL_SQL.replaceAll('samarinda', 'berau'),
		undefined,
		'DB_BERAU_GROUP'
	);
	const codeBefore = process.exitCode;
	try {
		const calls = [];
		await main(['--shard', 'DB_BERAU_GROUP', '--file', path, ...args, '--apply'], {
			spawn: (...a) => {
				calls.push(a);
				const snapshot = a[1].find((arg) => arg.startsWith('--file=')).slice(7);
				assert.notEqual(snapshot, path);
				assert.equal(readFileSync(snapshot, 'utf8'), DRILL_SQL.replaceAll('samarinda', 'berau'));
				return { status: 0, stdout: '', stderr: '' };
			}
		});
		assert.equal(calls.length, 1);
		assert.equal(calls[0][0], process.execPath);
		assert.match(calls[0][1][0], /wrangler[\\/]bin[\\/]wrangler\.js$/);
		assert.equal(calls[0][2].shell, false);
		assert.equal(
			existsSync(calls[0][1].find((arg) => arg.startsWith('--file=')).slice(7)),
			false,
			'Run-owned snapshot cleaned after success'
		);
		assert.ok(calls[0][1].includes('DB_BERAU_GROUP'));
		assert.ok(calls[0][1].some((x) => String(x).startsWith('--file=')));
		assert.equal(process.exitCode ?? 0, 0);
		process.exitCode = codeBefore;
		await main(['--shard', 'DB_BERAU_GROUP', '--file', path, ...args, '--apply'], {
			spawn: (...call) => {
				const file = call[1].find((arg) => arg.startsWith('--file=')).slice(7);
				calls.push(file);
				return { status: 1, stdout: '', stderr: 'boom' };
			}
		});
		assert.equal(process.exitCode, 1);
		assert.equal(existsSync(calls[1]), false, 'Owned snapshot cleaned after nonzero child');
		let thrownFile;
		await assert.rejects(
			main(['--shard', 'DB_BERAU_GROUP', '--file', path, ...args, '--apply'], {
				spawn: (_command, argv) => {
					thrownFile = argv.find((arg) => arg.startsWith('--file=')).slice(7);
					throw new Error('INJECTED_SPAWN_FAILURE');
				}
			}),
			/INJECTED_SPAWN_FAILURE/
		);
		assert.equal(existsSync(thrownFile), false, 'Owned snapshot cleaned after spawn throws');
	} finally {
		process.exitCode = codeBefore;
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('apply reads immutable validated bytes even if original source changes before child starts', async () => {
	const fixture = await drillFile();
	const previous = process.exitCode;
	let consumedFile;
	try {
		await main(
			['--shard', 'DB_SAMARINDA_GROUP', '--file', fixture.path, ...fixture.args, '--apply'],
			{
				spawn: (_command, args) => {
					writeFileSync(fixture.path, 'CREATE TABLE UNVERIFIED_SOURCE(x);');
					consumedFile = args.find((arg) => arg.startsWith('--file=')).slice(7);
					assert.equal(
						readFileSync(consumedFile, 'utf8'),
						DRILL_SQL,
						'Child must never reopen the mutable original source'
					);
					return { status: 0, stdout: '', stderr: '' };
				}
			}
		);
		assert.ok(consumedFile);
		assert.equal(existsSync(consumedFile), false, 'Owned immutable snapshot is cleaned');
	} finally {
		process.exitCode = previous;
		rmSync(fixture.dir, { recursive: true, force: true });
	}
});

await test('financial source corruption rejects rollback --apply before spawn', async () => {
	const { dir, path, args, planOptions } = await drillFile(
		DRILL_SQL + `\nUPDATE transaksi_kasir SET jumlah=3,nominal=30000 WHERE id='tk2';`
	);
	const codeBefore = process.exitCode;
	let calls = 0;
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', live: false, file: path, ...planOptions }),
			/relationships.*tidak cocok/
		);
		await main(['--shard', 'DB_SAMARINDA_GROUP', '--file', path, ...args, '--apply'], {
			spawn: () => {
				calls++;
				throw new Error('must-not-mutate');
			}
		});
		assert.equal(process.exitCode, 1);
		assert.equal(calls, 0);
	} finally {
		process.exitCode = codeBefore;
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('rollback valid dump without approved baseline must reject before spawn', async () => {
	const { dir, path } = await drillFile();
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', file: path, live: false }),
			/baseline.*wajib/
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('missing legacy inventory/altered trust anchors/wrong shard reject actual rollback consumer before spawn', async () => {
	const source = await drillFile(DRILL_SQL + "\nDELETE FROM transaksi_kasir WHERE id='tk1';");
	const codeBefore = process.exitCode;
	let spawns = 0;
	try {
		await assert.rejects(
			resolveRollbackPlan({
				shard: 'DB_SAMARINDA_GROUP',
				file: source.path,
				...source.planOptions
			}),
			/baseline.*counts\/field hashes/
		);
		await main(
			['--shard', 'DB_SAMARINDA_GROUP', '--file', source.path, ...source.args, '--apply'],
			{
				spawn: () => {
					spawns++;
					throw new Error('must-not-spawn');
				}
			}
		);
		assert.equal(process.exitCode, 1);
		assert.equal(spawns, 0);
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_BERAU_GROUP', file: source.path, ...source.planOptions }),
			/baseline.*identity/
		);
		writeFileSync(source.planOptions.baselineFile, source.options.baseline.text + '\n');
		await assert.rejects(
			resolveRollbackPlan({
				shard: 'DB_SAMARINDA_GROUP',
				file: source.path,
				...source.planOptions
			}),
			/SHA-256 baseline/
		);
	} finally {
		process.exitCode = codeBefore;
		rmSync(source.dir, { recursive: true, force: true });
	}
});
await test('actual rollback CLI requires pin and accepts verified dry-run literal paths', async () => {
	const source = await drillFile();
	try {
		const result = cli(
			'--shard',
			'DB_SAMARINDA_GROUP',
			'--file',
			source.path,
			...source.args,
			'--dry-run'
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /DRY-RUN selesai tanpa mutasi/);
		const absent = cli('--shard', 'DB_SAMARINDA_GROUP', '--file', source.path, '--dry-run');
		assert.equal(absent.status, 1);
		assert.match(absent.stderr, /baseline.*wajib/);
	} finally {
		rmSync(source.dir, { recursive: true, force: true });
	}
});

await test('Wrangler package bin sungguhan dapat dijalankan tanpa shell/npx', () => {
	const invocation = wranglerInvocation(['--version']);
	const result = spawnSync(invocation.command, invocation.args, {
		...invocation.options,
		timeout: 30000
	});
	assert.equal(result.status, 0, result.stderr + result.stdout);
	assert.match(result.stdout, /\d+\.\d+\.\d+/);
});

await test('historical schema perlu expected migration eksplisit', async () => {
	const { dir, path, planOptions } = await drillFile(
		drillFixtureSql('0040_profil_unique_username.sql'),
		'0040_profil_unique_username.sql'
	);
	try {
		await assert.rejects(
			resolveRollbackPlan({ shard: 'DB_SAMARINDA_GROUP', live: false, file: path, ...planOptions }),
			/migration baseline tidak cocok/
		);
		const plan = await resolveRollbackPlan({
			shard: 'DB_SAMARINDA_GROUP',
			live: false,
			file: path,
			expectedMigration: '0040_profil_unique_username.sql',
			...planOptions
		});
		assert.ok(plan.tables > 20);
		assert.throws(
			() =>
				parseRollbackArgs(['--shard', 'DB_SAMARINDA_GROUP', '--file', path, '--expect-migration']),
			/wajib bernilai/
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await test('actual owned Windows CLI rollback file is atomic on late target-only failure and passes local field parity', async () => {
	const source =
		DRILL_SQL +
		"\nSELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE name='owned_late_guard')=0 THEN 1 ELSE json('OWNED_LATE_ROLLBACK_FAILURE') END;";
	const f = await drillFile(source);
	const persist = join(f.dir, 'owned state & rollback');
	const query = (sql) => {
		const invocation = wranglerInvocation([
			'd1',
			'execute',
			'DB_SAMARINDA_GROUP',
			'--local',
			'--persist-to',
			persist,
			'--config',
			'wrangler.pages.jsonc',
			'--command',
			sql,
			'--json'
		]);
		const result = spawnSync(invocation.command, invocation.args, invocation.options);
		assert.equal(result.status, 0, result.stderr);
		return JSON.parse(result.stdout)[0].results;
	};
	try {
		query('CREATE TABLE owned_late_guard(x);');
		const argv = [
			'scripts/rollback-migration.mjs',
			'--shard',
			'DB_SAMARINDA_GROUP',
			'--file',
			f.path,
			...f.args,
			'--local',
			'--persist-to',
			persist,
			'--apply'
		];
		const failed = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 120000 });
		assert.equal(failed.status, 1);
		assert.match(failed.stderr, /ROLLBACK FAILED/);
		assert.ok(!failed.stdout.includes('Rollback/restore selesai'));
		assert.deepEqual(
			query(
				"SELECT (SELECT COUNT(*) FROM sqlite_master WHERE name='buku_kas') AS business,(SELECT COUNT(*) FROM sqlite_master WHERE name='owned_late_guard') AS retained"
			),
			[{ business: 0, retained: 1 }],
			'Actual file rolls back schema and data written before late failure'
		);
		query('DROP TABLE owned_late_guard');
		const passed = spawnSync(process.execPath, argv, { encoding: 'utf8', timeout: 120000 });
		assert.equal(passed.status, 0, passed.stderr);
		assert.match(passed.stdout, /Rollback\/restore selesai/);
		const { getPlatformProxy } = await import('wrangler');
		const proxy = await getPlatformProxy({
			configPath: 'wrangler.pages.jsonc',
			remoteBindings: false,
			persist: { path: join(persist, 'v3') }
		});
		try {
			const db = proxy.env.DB_SAMARINDA_GROUP;
			const actual = await captureDrillParity({
				all: async (sql) => (await db.prepare(sql).all()).results
			});
			const expected = JSON.parse(readFileSync(f.planOptions.baselineFile, 'utf8')).tables;
			assert.deepEqual(actual, expected, 'All-table/all-field parity of actual applied owned D1');
		} finally {
			await proxy.dispose();
		}
		assert.equal(readFileSync(f.path, 'utf8'), source, 'Original source retained byte-identically');
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});

await test('manifest salah-shard/rusak fail-closed', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'rollback-test-'));
	try {
		const bad = join(dir, 'manifest.json');
		writeFileSync(bad, JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards: [] }));
		writeFileSync(join(dir, 'COMPLETE'), 'verified');
		await assert.rejects(
			resolveRollbackPlan({
				shard: 'DB_SAMARINDA_GROUP',
				live: false,
				backupManifest: bad
			}),
			/tepat tiga shard/
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
