import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { wranglerInvocation } from '../../scripts/wrangler-cli.mjs';
import {
	buildRestoreChunks,
	buildRestoreSql,
	DEFAULT_RESTORE_CHUNK_ROWS,
	MAX_RESTORE_SQL_BYTES
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { buildLaporanAggregate } from '../lib/server/reportQueries';

const { db, close } = await createTestD1();
const fixedNow = '2026-10-07T00:00:00.000Z';
function header(id: string, nominal: number) {
	return {
		id,
		cabang_id: 'samarinda',
		waktu: '2025-11-01T01:00:00Z',
		sumber: 'catat',
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		nominal,
		metode_bayar: 'tunai'
	};
}
function archiveOf(count: number, nominal: number) {
	return {
		meta: {
			schema_version: 3,
			archive_id: 'chunk-arc',
			branch: 'samarinda',
			counts: { buku_kas: count, transaksi_kasir: 0 }
		},
		buku_kas: Array.from({ length: count }, (_, i) => header(`chunk-bk-${i}`, nominal)),
		transaksi_kasir: []
	};
}
async function applyStatements(statements: string[]) {
	await db.batch(statements.map((q) => db.prepare(q)));
}
const liveTables = [
	'transaksi_kasir',
	'buku_kas',
	'pengaturan',
	'archive_jobs',
	'pos_nomor_harian',
	'ringkasan_kas_arsip_harian',
	'ringkasan_penjualan_harian',
	'penjualan_produk_harian'
];
async function reset() {
	await applyStatements([
		'DELETE FROM archive_restore_rows',
		'DELETE FROM archive_restore_jobs',
		...liveTables.map((t) => `DELETE FROM ${t}`)
	]);
}
async function snapshot(tables = liveTables) {
	return Object.fromEntries(
		await Promise.all(
			tables.map(async (table) => [
				table,
				(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results.map((row) => ({
					...row
				}))
			])
		)
	);
}
async function count(table = 'buku_kas') {
	return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
}
async function representativeBudgetRegression(sales: number) {
	await reset();
	const receipt = JSON.stringify({
		schema_version: 1,
		items: [
			{
				product_id: 'budget-product',
				nama: 'Budget',
				jumlah: 2,
				harga: 20000,
				nominal: 40000,
				harga_dasar: 20000,
				total_tambahan: 0,
				tambahan: [],
				gula: null,
				es: null,
				catatan: null
			}
		],
		total_amount: 40000,
		total_qty: 2,
		cash_received: null,
		change: null,
		metode_bayar: 'tunai',
		committed_at: '2025-11-01T01:00:00Z',
		customer_name: null,
		settings: null
	});
	const hpp = '{"total":12000.125}';
	const archive = {
		meta: {
			schema_version: 3,
			archive_id: `budget-${sales}`,
			branch: 'samarinda',
			counts: { buku_kas: sales, transaksi_kasir: sales }
		},
		buku_kas: Array.from({ length: sales }, (_, i) => ({
			...header(`budget-bk-${i}`, 40000),
			sumber: 'pos',
			jumlah: 2,
			transaction_id: `budget-tx-${i}`,
			idempotency_key: `budget-key-${i}`,
			request_fingerprint: 'a'.repeat(64),
			nomor_harian: i + 1,
			tanggal_nomor: '2025-11-01',
			receipt_snapshot: receipt,
			stock_policy_mode: 'tracked',
			stock_policy_revision: 0,
			deskripsi: 'Riwayat synthetic ü 🧾 '.repeat(12)
		})),
		transaksi_kasir: Array.from({ length: sales }, (_, i) => ({
			id: `budget-tk-${i}`,
			cabang_id: 'samarinda',
			buku_kas_id: `budget-bk-${i}`,
			transaction_id: `budget-tx-${i}`,
			produk_id: 'budget-product',
			nama_produk: 'Budget',
			jumlah: 2,
			harga: 20000,
			harga_dasar: 20000,
			total_tambahan: 0,
			nominal: 40000,
			nominal_hpp: 12000.125,
			snapshot_hpp: hpp,
			snapshot_tambahan: '[]',
			created_at: '2025-11-01T01:00:00Z'
		}))
	};
	await db.batch([
		db
			.prepare(
				"INSERT INTO ringkasan_penjualan_harian(id,cabang_id,tanggal_penjualan,jumlah_transaksi,jumlah_item,penjualan_kotor,penjualan_tunai,total_hpp,created_at,updated_at) VALUES('budget-summary','samarinda','2025-11-01',?,?,?,?,?,'2025-11-01','2025-11-01')"
			)
			.bind(sales, sales * 2, sales * 40000, sales * 40000, sales * 12000.125),
		db
			.prepare(
				"INSERT INTO penjualan_produk_harian(id,cabang_id,tanggal_penjualan,produk_id,nama_produk,jumlah_transaksi,jumlah,penjualan_kotor,penjualan_tunai,created_at,updated_at) VALUES('budget-product-summary','samarinda','2025-11-01','budget-product','Budget',?,?,?,?,'2025-11-01','2025-11-01')"
			)
			.bind(sales, sales * 2, sales * 40000, sales * 40000)
	]);
	const start = performance.now();
	const plan = buildRestoreChunks(archive, { now: fixedNow });
	const plannedMs = performance.now() - start;
	assert.ok(plan.final.statements.length <= 20);
	assert.ok(plan.final.statements.every((sql) => Buffer.byteLength(sql) <= MAX_RESTORE_SQL_BYTES));
	console.log('RESTORE_SYNTHETIC_STAGING_START', sales * 2, plan.chunks.length, plannedMs);
	for (const chunk of plan.chunks) {
		await applyStatements(chunk.statements);
	}
	assert.equal(await count(), 0, 'Representative target staging still has zero live headers');
	console.log('RESTORE_SYNTHETIC_FINAL_START', sales * 2, performance.now() - start);
	const finalStart = performance.now();
	await applyStatements(plan.final.statements);
	const finalMs = performance.now() - finalStart;
	assert.equal(await count(), sales);
	assert.equal(await count('transaksi_kasir'), sales);
	assert.equal(await db.prepare('SELECT terakhir FROM pos_nomor_harian').first('terakhir'), sales);
	assert.equal(
		await db.prepare('SELECT snapshot_hpp FROM transaksi_kasir LIMIT 1').first('snapshot_hpp'),
		hpp
	);
	assert.equal(
		await db.prepare('SELECT receipt_snapshot FROM buku_kas LIMIT 1').first('receipt_snapshot'),
		receipt
	);
	console.log(
		'RESTORE_SYNTHETIC_BUDGET',
		JSON.stringify({
			runtime: process.version,
			backend: process.argv.includes('--d1') ? 'workerd' : 'SQLite',
			rows: sales * 2,
			stages: plan.chunks.length,
			finalStatements: plan.final.statements.length,
			largestFinalSqlBytes: Math.max(...plan.final.statements.map((sql) => Buffer.byteLength(sql))),
			plannedMs,
			finalMs,
			totalMs: performance.now() - start,
			nodeRssBytes: process.memoryUsage().rss,
			nodeMaxRssKiB: process.resourceUsage().maxRSS,
			scope: 'synthetic local, not approved largest/staging/compiled Worker peak memory'
		})
	);
}

function actualCliRegression() {
	const directory = mkdtempSync(join(tmpdir(), 'zatiaras restore & cli '));
	const state = join(directory, 'owned-state');
	const input = join(directory, 'source archive.json');
	const bootstrap = join(directory, 'bootstrap.sql');
	const cliArchive = archiveOf(3, 1000);
	const raw = JSON.stringify(cliArchive);
	const digest = createHash('sha256').update(raw).digest('hex');
	const wrangler = (...args: string[]) => {
		const invocation = wranglerInvocation([
			'd1',
			'execute',
			'DB_SAMARINDA_GROUP',
			'--local',
			'--persist-to',
			state,
			'--config',
			'wrangler.pages.jsonc',
			...args
		]);
		return spawnSync(invocation.command, invocation.args, {
			...invocation.options,
			timeout: 120000
		});
	};
	const cli = () =>
		spawnSync(
			process.execPath,
			[
				'scripts/restore-archive.mjs',
				'--file',
				input,
				'--apply',
				'--expect-sha256',
				digest,
				'--local',
				'--persist-to',
				state,
				'--chunk-rows',
				'2'
			],
			{ encoding: 'utf8', timeout: 120000 }
		);
	try {
		writeFileSync(input, raw);
		writeFileSync(
			bootstrap,
			readdirSync('drizzle')
				.filter((file) => file.endsWith('.sql'))
				.sort()
				.map((file) => readFileSync(join('drizzle', file), 'utf8'))
				.join('\n') +
				"\nINSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar) VALUES('chunk-bk-2','samarinda','2025-11-01T01:00:00Z','catat','in','pendapatan_usaha',9999,'tunai');"
		);
		const setup = wrangler('--file', bootstrap, '--yes');
		assert.equal(setup.status, 0, setup.stderr + setup.stdout);
		const failed = cli();
		assert.equal(failed.status, 1, failed.stdout + failed.stderr);
		assert.match(failed.stderr, /final-atomic gagal/);
		const readCounts = () => {
			const result = wrangler(
				'--command',
				"SELECT (SELECT COUNT(*) FROM buku_kas WHERE id LIKE 'chunk-bk-%') AS live,(SELECT COUNT(*) FROM archive_restore_rows) AS staged",
				'--json'
			);
			assert.equal(result.status, 0, result.stderr + result.stdout);
			return JSON.parse(result.stdout)[0].results[0] as { live: number; staged: number };
		};
		assert.deepEqual(
			readCounts(),
			{ live: 1, staged: 3 },
			'Actual CLI failed final must leave only the pre-existing conflicting row'
		);
		const repair = wrangler('--command', "DELETE FROM buku_kas WHERE id='chunk-bk-2'", '--yes');
		assert.equal(repair.status, 0, repair.stderr + repair.stdout);
		const injectLate = wrangler(
			'--command',
			"CREATE TRIGGER fail_cli_late_restore BEFORE INSERT ON pengaturan BEGIN SELECT RAISE(ABORT,'CLI_LATE_MARKER_FAILURE'); END",
			'--yes'
		);
		assert.equal(injectLate.status, 0, injectLate.stderr + injectLate.stdout);
		const late = cli();
		assert.equal(late.status, 1, late.stdout + late.stderr);
		assert.deepEqual(
			readCounts(),
			{ live: 0, staged: 3 },
			'Actual Wrangler file transaction rolls back inserts when a later marker statement fails'
		);
		const removeOwnedGuard = wrangler('--command', 'DROP TRIGGER fail_cli_late_restore', '--yes');
		assert.equal(removeOwnedGuard.status, 0, removeOwnedGuard.stderr + removeOwnedGuard.stdout);
		const success = cli();
		assert.equal(success.status, 0, success.stdout + success.stderr);
		assert.deepEqual(readCounts(), { live: 3, staged: 0 });
		assert.equal(cli().status, 0, 'Same source/target/digest CLI retry succeeds');
		assert.deepEqual(readCounts(), { live: 3, staged: 0 });
		assert.equal(readFileSync(input, 'utf8'), raw, 'Source file is never deleted/rewritten');
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

try {
	actualCliRegression();
	const small = archiveOf(3, 5000);
	const direct = buildRestoreSql(small, { now: fixedNow });
	await applyStatements(direct.statements);
	const before = (await snapshot()).buku_kas;
	await reset();
	const single = buildRestoreChunks(small, { now: fixedNow }, 100);
	assert.equal(single.chunks.length, 1);
	assert.equal(single.totalRows, 3);
	await applyStatements(single.chunks[0].statements);
	assert.equal(await count(), 0, 'Staging never commits a live row');
	await applyStatements(single.final.statements);
	assert.deepEqual(
		(await snapshot()).buku_kas,
		before,
		'Staged final preserves all single-shot business fields'
	);

	const big = archiveOf(250, 1000);
	const planned = buildRestoreChunks(big, { now: fixedNow }, 100);
	assert.deepEqual(
		planned.chunks.map((c) => c.rows),
		[100, 100, 50]
	);
	assert.ok(
		planned.final.statements.length <= 20,
		'Final statement count is independent of archive rows'
	);
	for (const stage of planned.chunks) {
		assert.ok(
			stage.statements.every(
				(sql) =>
					!/^(INSERT INTO buku_kas|INSERT INTO transaksi_kasir|DELETE FROM ringkasan|INSERT INTO pengaturan|UPDATE archive_jobs)/.test(
						sql
					)
			)
		);
		assert.ok(stage.statements.every((sql) => Buffer.byteLength(sql) <= MAX_RESTORE_SQL_BYTES));
	}
	assert.ok(
		planned.final.statements.every((sql) => Buffer.byteLength(sql) <= MAX_RESTORE_SQL_BYTES)
	);
	assert.throws(
		() => buildRestoreChunks({ ...big, buku_kas: [{ id: 'bad' }] }),
		/tidak valid|Counts/
	);
	assert.throws(
		() =>
			buildRestoreChunks({
				...small,
				buku_kas: [{ ...small.buku_kas[0], deskripsi: 'x'.repeat(100000) }],
				meta: { ...small.meta, counts: { buku_kas: 1, transaksi_kasir: 0 } }
			}),
		/RESTORE_BUDGET_BLOCKED/
	);

	await reset();
	const original = await snapshot();
	await applyStatements(planned.chunks[0].statements);
	assert.deepEqual(
		await snapshot(),
		original,
		'Crash after stage 0 leaves the entire live state intact'
	);
	await assert.rejects(applyStatements(planned.final.statements), /malformed JSON|D1_ERROR/);
	assert.deepEqual(await snapshot(), original, 'Incomplete staging cannot finalize');
	for (const stage of planned.chunks) {
		await applyStatements(stage.statements);
		assert.deepEqual(await snapshot(), original);
	}
	assert.equal(await count('archive_restore_rows'), 250);
	await applyStatements(planned.final.statements);
	assert.equal(await count(), 250);
	assert.equal(
		await count('archive_restore_rows'),
		0,
		'Final cleanup belongs to the atomic commit'
	);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-11-01', '2025-11-01')).summary.pendapatan,
		250000
	);
	const committed = await snapshot();
	for (const stage of planned.chunks) await applyStatements(stage.statements);
	await applyStatements(planned.final.statements);
	assert.deepEqual(
		await snapshot(),
		committed,
		'Lost final response/retry neither duplicates nor rewrites commit'
	);
	const changedSource = buildRestoreChunks(archiveOf(250, 1001), { now: fixedNow });
	await assert.rejects(
		applyStatements(changedSource.chunks[0].statements),
		/malformed JSON|D1_ERROR/
	);
	assert.deepEqual(await snapshot(), committed);

	// A target row changes AFTER all stages. Final must roll back every earlier proposed live mutation.
	await reset();
	for (const stage of planned.chunks) await applyStatements(stage.statements);
	await db
		.prepare(
			"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar) VALUES('chunk-bk-249','samarinda','2025-11-01T01:00:00Z','catat','in','pendapatan_usaha',9999,'tunai')"
		)
		.run();
	const conflictBefore = await snapshot();
	await assert.rejects(applyStatements(planned.final.statements), /malformed JSON|D1_ERROR/);
	assert.deepEqual(await snapshot(), conflictBefore);

	// Deliberately fail AFTER inserts, marker, checkpoint and cleanup. The batch must undo all of them.
	await reset();
	for (const stage of planned.chunks) await applyStatements(stage.statements);
	const lateBefore = await snapshot([
		...liveTables,
		'archive_restore_jobs',
		'archive_restore_rows'
	]);
	await assert.rejects(
		applyStatements([
			...planned.final.statements,
			"SELECT json('injected-final-statement-failure');"
		]),
		/malformed JSON|D1_ERROR/
	);
	assert.deepEqual(
		await snapshot([...liveTables, 'archive_restore_jobs', 'archive_restore_rows']),
		lateBefore
	);
	await Promise.all([
		applyStatements(planned.final.statements),
		applyStatements(planned.final.statements)
	]);
	assert.equal(await count(), 250);
	assert.equal(await count('archive_restore_jobs'), 1);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-11-01', '2025-11-01')).summary.pendapatan,
		250000
	);
	assert.equal(DEFAULT_RESTORE_CHUNK_ROWS, 100);
	await representativeBudgetRegression(11000);
	await representativeBudgetRegression(22000);
	console.log(
		'restore-chunk-tests: staging/atomic-final/legacy-parity/zero-live-crash/late-conflict/late-rollback/retry/concurrency/budget passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
