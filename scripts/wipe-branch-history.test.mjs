import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import {
	parseArgs,
	WIPE_TABLES,
	assertBackupCoversBranch,
	buildWipeSql,
	wipeBranchHistory,
	WIPE_MAX_SQL_BYTES
} from './wipe-branch-history.mjs';
import { drillFixtureSql, drillFixtureBaselineOptions } from './test-fixtures/drill-dump.mjs';
import {
	drillDatabaseIdentity,
	captureDrillParity,
	copyToD1,
	loadDrillContract
} from './restore-drill-local.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const SQL = drillFixtureSql();
async function backupFixture(toy = false) {
	const dir = mkdtempSync(join(tmpdir(), 'wipe trusted & fixture '));
	try {
		const bindings = ['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'];
		const shards = bindings.map((binding, index) => {
			const identity = drillDatabaseIdentity(binding);
			const branch = ['samarinda', 'balikpapan', 'berau'][index];
			const content = toy ? `CREATE TABLE t${index}(x);\n` : SQL.replaceAll('samarinda', branch);
			const file = `db_${index}.sql`;
			writeFileSync(join(dir, file), content);
			return {
				binding,
				name: identity.name,
				database_id: identity.id,
				version: 'production',
				file,
				bytes: Buffer.byteLength(content),
				sha256: hash(content)
			};
		});
		const path = join(dir, 'manifest.json');
		writeFileSync(path, JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards }));
		writeFileSync(join(dir, 'COMPLETE'), 'verified\n');
		const options = await drillFixtureBaselineOptions(readFileSync(join(dir, 'db_0.sql'), 'utf8'));
		const baselineFile = join(dir, 'approved.json');
		writeFileSync(baselineFile, options.baseline.text);
		const db = new DatabaseSync(':memory:');
		try {
			db.exec(SQL);
			return {
				dir,
				path,
				baselineFile,
				baselineSha256: options.baseline.approvedSha256,
				source: expectedState(db),
				counts: Object.fromEntries(
					WIPE_TABLES.map((table) => [
						table,
						db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
					])
				)
			};
		} finally {
			db.close();
		}
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}
function expectedState(db) {
	return Object.fromEntries(
		WIPE_TABLES.map((table) => [
			table,
			{
				columns: db
					.prepare(`PRAGMA table_info(${table})`)
					.all()
					.map((c) => c.name),
				rows: db
					.prepare(`SELECT * FROM ${table} WHERE cabang_id='samarinda'`)
					.all()
					.map((row) => ({ ...row }))
			}
		])
	);
}
const argsFor = (f, apply = false) => ({
	branch: 'samarinda',
	backupManifest: f.path,
	baselineFile: f.baselineFile,
	baselineSha256: f.baselineSha256,
	apply,
	confirm: apply ? 'samarinda' : undefined
});
function fakeExecutor(counts, seen = []) {
	return (_binding, sql) => {
		seen.push(sql);
		return { n: counts[sql.match(/FROM (\w+)/)?.[1]] ?? 0 };
	};
}
await test('parseArgs rejects invalid/ambiguous branch, source, confirmation and modes', () => {
	assert.throws(() => parseArgs(['--ngawur']), /tidak diizinkan/);
	assert.throws(() => parseArgs([]), /--branch wajib/);
	for (const branch of ['jakarta', '__proto__', 'toString'])
		assert.throws(() => parseArgs(['--branch', branch]), /--branch wajib/);
	assert.throws(() => parseArgs(['--branch', 'samarinda']), /backup-manifest wajib/);
	const base = ['--branch', 'samarinda', '--backup-manifest', 'm'];
	assert.throws(() => parseArgs([...base, '--apply']), /confirm/);
	assert.throws(() => parseArgs([...base, '--apply', '--confirm', 'balikpapan']), /confirm/);
	assert.throws(
		() => parseArgs([...base, '--dry-run', '--apply', '--confirm', 'samarinda']),
		/bertentangan/
	);
	assert.throws(() => parseArgs([...base, '--branch', 'berau']), /duplikat/);
	assert.throws(() => parseArgs([...base, '--live', '--persist-to', 'owned']), /bertentangan/);
	assert.equal(parseArgs([...base, '--apply', '--confirm', 'samarinda']).apply, true);
	assert.equal(parseArgs(base).live, false);
});
await test('delete children precedes parents', () => {
	for (const [a, b] of [
		['transaksi_kasir', 'buku_kas'],
		['produk_mutasi', 'buku_kas'],
		['bahan_mutasi', 'buku_kas']
	])
		assert.ok(WIPE_TABLES.indexOf(a) < WIPE_TABLES.indexOf(b));
});
await test('no wiped table is protected by a DELETE trigger in the migrations', () => {
	// Live wipe 14 Okt 2026 failed atomically on STOCK_RECONCILIATION_ITEMS_IMMUTABLE (0032).
	// BEFORE dan AFTER DELETE sama-sama bisa RAISE(ABORT); nama tabel boleh berprefiks main.
	const guarded = loadDrillContract()
		.objects.filter((object) => object.key.startsWith('trigger:'))
		.map((object) =>
			/(?:before|after) delete on [`"]?(?:main\.)?[`"]?(\w+)/i.exec(object.sql)?.[1]?.toLowerCase()
		)
		.filter(Boolean);
	assert.ok(guarded.includes('stock_reconciliation_items'), 'contract exposes delete guards');
	for (const table of WIPE_TABLES) assert.ok(!guarded.includes(table), table);
});
await test('full verified backup needs COMPLETE and exact branch identity', async () => {
	const f = await backupFixture();
	try {
		assert.equal(
			(await assertBackupCoversBranch(f.path, 'samarinda', f)).binding,
			'DB_SAMARINDA_GROUP'
		);
		await assert.rejects(assertBackupCoversBranch(f.path, 'jakarta', f), /branch wajib/);
		unlinkSync(join(f.dir, 'COMPLETE'));
		await assert.rejects(assertBackupCoversBranch(f.path, 'samarinda', f), /COMPLETE/);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('fabricated/partial/missing/tampered backup rejects before any target access', async () => {
	const f = await backupFixture();
	let calls = 0;
	try {
		const source = readFileSync(f.path, 'utf8');
		writeFileSync(f.path, JSON.stringify({ schema: 'zatiaraspos-d1-backup-v1', shards: [] }));
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), () => {
				calls++;
			}),
			/tepat tiga shard/
		);
		writeFileSync(f.path, 'not-json');
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), () => {
				calls++;
			})
		);
		writeFileSync(f.path, source);
		writeFileSync(join(f.dir, 'db_0.sql'), 'CREATE TABLE tampered(x);');
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), () => {
				calls++;
			}),
			/Hash\/readback/
		);
		await assert.rejects(
			assertBackupCoversBranch(join(f.dir, 'missing.json'), 'samarinda', f),
			/ENOENT/
		);
		assert.equal(calls, 0);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('healthy checksum/COMPLETE toy SQL cannot authorize actual wipe before any target call', async () => {
	const f = await backupFixture(true);
	let calls = 0;
	try {
		await assert.rejects(
			wipeBranchHistory(
				argsFor(f, true),
				() => {
					calls++;
					return { n: 0 };
				},
				() => {
					calls++;
				}
			),
			/schema|drill/i
		);
		assert.equal(calls, 0);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('actual API apply without confirmation cannot bypass CLI safety', async () => {
	const f = await backupFixture();
	let calls = 0;
	try {
		const args = argsFor(f, true);
		delete args.confirm;
		await assert.rejects(
			wipeBranchHistory(
				args,
				() => {
					calls++;
					return { n: 0 };
				},
				() => {
					calls++;
				}
			),
			/confirm/
		);
		assert.equal(calls, 0);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('baseline pin/identity and missing legacy inventory must veto destructive source', async () => {
	const f = await backupFixture();
	let calls = 0;
	try {
		await assert.rejects(
			wipeBranchHistory({ ...argsFor(f, true), baselineFile: null }, () => {
				calls++;
			}),
			/baseline.*wajib/
		);
		await assert.rejects(
			wipeBranchHistory({ ...argsFor(f, true), baselineSha256: '0'.repeat(64) }, () => {
				calls++;
			}),
			/SHA-256 baseline/
		);
		await assert.rejects(assertBackupCoversBranch(f.path, 'berau', f), /identity/);
		assert.equal(calls, 0);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('async read/dry-run are awaited, malformed counts fail closed, no apply calls', async () => {
	const f = await backupFixture();
	try {
		const seen = [];
		const result = await wipeBranchHistory(
			argsFor(f),
			async (...args) => fakeExecutor(f.counts, seen)(...args),
			() => assert.fail('must not apply')
		);
		assert.equal(result.report.find((r) => r.table === 'buku_kas').before, 2);
		assert.ok(seen.every((sql) => sql.startsWith('SELECT')));
		await assert.rejects(
			wipeBranchHistory(
				argsFor(f, true),
				async () => undefined,
				() => assert.fail('must not apply')
			),
			/count tidak valid/
		);
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), fakeExecutor({ ...f.counts, buku_kas: 3 }), () =>
				assert.fail('must not apply')
			),
			/Target berbeda/
		);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('archive/restore intent blocks BEFORE apply', async () => {
	const f = await backupFixture();
	try {
		for (const table of ['archive_jobs', 'archive_job_items', 'archive_restore_jobs'])
			await assert.rejects(
				wipeBranchHistory(argsFor(f, true), fakeExecutor({ ...f.counts, [table]: 1 }), () =>
					assert.fail('must not apply')
				),
				/arsip harus ditangani/
			);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('apply one awaited file, all deletes scoped, late failure never claims success', async () => {
	const f = await backupFixture();
	try {
		const applied = [];
		const target = { ...f.counts };
		const result = await wipeBranchHistory(
			argsFor(f, true),
			fakeExecutor(target),
			async (binding, sql) => {
				applied.push({ binding, sql });
				for (const table of WIPE_TABLES) target[table] = 0;
			}
		);
		assert.equal(applied.length, 1);
		assert.equal(applied[0].binding, 'DB_SAMARINDA_GROUP');
		// D1 remote rejects explicit transactions in --file (live 14 Okt 2026).
		assert.doesNotMatch(applied[0].sql, /\bBEGIN\b|\bCOMMIT\b|\bSAVEPOINT\b/i);
		assert.deepEqual(
			[...applied[0].sql.matchAll(/DELETE FROM (\w+) WHERE cabang_id = 'samarinda';/g)].map(
				(m) => m[1]
			),
			[...WIPE_TABLES]
		);
		assert.ok(!/DELETE FROM \w+;/.test(applied[0].sql));
		for (const table of WIPE_TABLES) assert.ok(applied[0].sql.includes(`WIPE_REMAIN:${table}`));
		assert.ok(result.report.every((r) => r.after === 0));
		// A file that "succeeds" but leaves rows (non-atomic remote execution) is read back and refused.
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), fakeExecutor({ ...f.counts }), async () => {}),
			/Wipe tak konsisten/
		);
		await assert.rejects(
			wipeBranchHistory(argsFor(f, true), fakeExecutor(f.counts), async () => {
				throw new Error('injected apply failure');
			}),
			/injected/
		);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
await test('source caps fail closed rather than partial wipe', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec(SQL);
		const s = expectedState(db);
		s.buku_kas.rows[0].deskripsi = 'x'.repeat(WIPE_MAX_SQL_BYTES);
		assert.throws(() => buildWipeSql('samarinda', s), /WIPE_BUDGET_BLOCKED/);
		assert.throws(() => buildWipeSql('jakarta', s), /branch wajib/);
		assert.throws(() => buildWipeSql('samarinda'), /source inventory wajib/);
	} finally {
		db.close();
	}
});
await test('actual SQL guards archive created AFTER preflight inside transaction', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec(SQL);
		const plan = buildWipeSql('samarinda', expectedState(db));
		db.exec(
			"INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,created_at,updated_at) VALUES('race-archive','samarinda',2025,'2025-01-01','claimed','owner',9999999999999,'2026-01-01','2026-01-01')"
		);
		const before = JSON.stringify(expectedState(db));
		assert.throws(() => db.exec(plan.sql), /malformed JSON/);
		if (db.isTransaction) db.exec('ROLLBACK');
		assert.equal(JSON.stringify(expectedState(db)), before);
	} finally {
		db.close();
	}
});
await test('same-count field change after backup cannot be wiped as backed up', () => {
	const db = new DatabaseSync(':memory:');
	try {
		db.exec(SQL);
		const plan = buildWipeSql('samarinda', expectedState(db));
		db.exec("UPDATE buku_kas SET deskripsi='NEW_UNBACKED_VALUE' WHERE id='bk1'");
		const before = JSON.stringify(expectedState(db));
		assert.throws(() => db.exec(plan.sql), /malformed JSON/);
		if (db.isTransaction) db.exec('ROLLBACK');
		assert.equal(JSON.stringify(expectedState(db)), before);
	} finally {
		db.close();
	}
});
await test('actual SQLite/D1 middle/end rollback, full-field guards, sibling and protected catalog preserved', async () => {
	const { getPlatformProxy } = await import('wrangler');
	for (const backend of ['SQLite', 'D1']) {
		const mem = new DatabaseSync(':memory:');
		let proxy;
		try {
			mem.exec(SQL);
			mem.exec(
				"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,created_at,updated_at) VALUES('sibling','samarinda2','2025-01-01','catat','in','pendapatan_usaha',4321,'2025-01-01','2025-01-01');"
			);
			let adapter, batch;
			if (backend === 'D1') {
				proxy = await getPlatformProxy({
					configPath: 'wrangler.pages.jsonc',
					persist: false,
					remoteBindings: false
				});
				const db = proxy.env.DB_SAMARINDA_GROUP;
				await copyToD1(mem, db);
				adapter = { all: async (sql) => (await db.prepare(sql).all()).results };
				batch = (sql) => db.batch(sql.map((query) => db.prepare(query)));
			} else {
				adapter = { all: (sql) => mem.prepare(sql).all() };
				batch = async (sql) => {
					mem.exec('BEGIN');
					try {
						for (const query of sql) mem.prepare(query).all();
						mem.exec('COMMIT');
					} catch (error) {
						mem.exec('ROLLBACK');
						throw error;
					}
				};
			}
			const plan = buildWipeSql('samarinda', expectedState(mem));
			const before = await captureDrillParity(adapter);
			for (const position of [
				plan.statements.findIndex((sql) => sql.startsWith('DELETE')) + 4,
				plan.statements.length
			]) {
				const bad = [...plan.statements];
				bad.splice(position, 0, "SELECT json('INJECTED_WIPE_FAILURE')");
				await assert.rejects(batch(bad), /malformed JSON|D1_ERROR/);
				assert.deepEqual(await captureDrillParity(adapter), before, backend);
			}
			await batch(["UPDATE buku_kas SET deskripsi='NEW_UNBACKED_VALUE' WHERE id='bk1'"]);
			const changed = await captureDrillParity(adapter);
			await assert.rejects(batch(plan.statements), /malformed JSON|D1_ERROR/);
			assert.deepEqual(
				await captureDrillParity(adapter),
				changed,
				'same count/all-field race must not delete'
			);
			await batch(["UPDATE buku_kas SET deskripsi=NULL WHERE id='bk1'"]);
			const outcomes = await Promise.allSettled([batch(plan.statements), batch(plan.statements)]);
			assert.equal(
				outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
				1,
				'Only one concurrent intent can delete'
			);
			assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
			for (const table of WIPE_TABLES)
				assert.equal(
					(await adapter.all(`SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id='samarinda'`))[0]
						.n,
					0
				);
			assert.equal(
				(await adapter.all("SELECT nominal FROM buku_kas WHERE id='sibling'"))[0].nominal,
				4321
			);
			const after = await captureDrillParity(adapter);
			for (const table of Object.keys(before).filter((table) => !WIPE_TABLES.includes(table)))
				assert.deepEqual(after[table], before[table], `${backend} preserved ${table}`);
			await assert.rejects(batch(plan.statements), /malformed JSON|D1_ERROR/);
			assert.deepEqual(
				await captureDrillParity(adapter),
				after,
				'Stale second/concurrent intent fails without deleting future rows'
			);
		} finally {
			if (proxy) await proxy.dispose();
			mem.close();
		}
	}
});
await test('actual owned local CLI dry-run and immutable atomic wipe with literal paths', async () => {
	const f = await backupFixture();
	try {
		const persist = join(f.dir, 'owned state & local');
		const setup = wranglerInvocation([
			'd1',
			'execute',
			'DB_SAMARINDA_GROUP',
			'--local',
			'--persist-to',
			persist,
			'--config',
			'wrangler.pages.jsonc',
			`--file=${join(f.dir, 'db_0.sql')}`,
			'--yes'
		]);
		const seeded = spawnSync(setup.command, setup.args, { ...setup.options, timeout: 120000 });
		assert.equal(seeded.status, 0, seeded.stderr);
		const args = [
			'scripts/wipe-branch-history.mjs',
			'--branch',
			'samarinda',
			'--backup-manifest',
			f.path,
			'--expect-baseline',
			f.baselineFile,
			'--expect-baseline-sha256',
			f.baselineSha256,
			'--local',
			'--persist-to',
			persist
		];
		const dry = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120000 });
		assert.equal(dry.status, 0, dry.stderr);
		assert.match(dry.stdout, /DRY-RUN selesai/);
		const command = (sql) => {
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
		command(
			"CREATE TRIGGER fail_owned_late_wipe AFTER DELETE ON buku_kas BEGIN SELECT RAISE(ABORT,'OWNED_LATE_WIPE'); END;"
		);
		const failed = spawnSync(process.execPath, [...args, '--apply', '--confirm', 'samarinda'], {
			encoding: 'utf8',
			timeout: 120000
		});
		assert.equal(failed.status, 1);
		assert.ok(!failed.stdout.includes('SELESAI'));
		assert.deepEqual(
			command(
				'SELECT (SELECT COUNT(*) FROM buku_kas) AS bk,(SELECT COUNT(*) FROM transaksi_kasir) AS tk,(SELECT COUNT(*) FROM bahan_mutasi) AS bm'
			),
			[{ bk: 2, tk: 2, bm: 1 }],
			'Actual Wrangler file must roll earlier deletions back'
		);
		command('DROP TRIGGER fail_owned_late_wipe');
		const applied = spawnSync(process.execPath, [...args, '--apply', '--confirm', 'samarinda'], {
			encoding: 'utf8',
			timeout: 120000
		});
		assert.equal(applied.status, 0, applied.stderr);
		assert.match(applied.stdout, /SELESAI: semua tabel target terbaca ulang 0/);
		const query = wranglerInvocation([
			'd1',
			'execute',
			'DB_SAMARINDA_GROUP',
			'--local',
			'--persist-to',
			persist,
			'--config',
			'wrangler.pages.jsonc',
			'--command',
			'SELECT COUNT(*) AS n FROM buku_kas',
			'--json'
		]);
		const result = spawnSync(query.command, query.args, query.options);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(JSON.parse(result.stdout)[0].results[0].n, 0);
	} finally {
		rmSync(f.dir, { recursive: true, force: true });
	}
});
