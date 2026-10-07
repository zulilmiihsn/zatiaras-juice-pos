import assert from 'node:assert/strict';
import {
	buildRestoreChunks,
	buildRestoreSql,
	DEFAULT_RESTORE_CHUNK_ROWS
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { buildLaporanAggregate } from '../lib/server/reportQueries';

// AUD-043: apply terbagi chunk transaksi bounded + resumable.
const { db, close } = await createTestD1();
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
	const buku_kas = Array.from({ length: count }, (_, i) => header(`chunk-bk-${i}`, nominal));
	return {
		meta: {
			schema_version: 3,
			archive_id: 'chunk-arc',
			branch: 'samarinda',
			counts: { buku_kas: count, transaksi_kasir: 0 }
		},
		buku_kas,
		transaksi_kasir: []
	};
}
async function applyStatements(statements: string[]) {
	await db.batch(statements.map((q) => db.prepare(q)));
}
async function reset() {
	await db.batch(
		[
			...[
				'transaksi_kasir',
				'buku_kas',
				'pengaturan',
				'archive_jobs',
				'pos_nomor_harian',
				'ringkasan_kas_arsip_harian',
				'ringkasan_penjualan_harian',
				'penjualan_produk_harian'
			].map((t) => `DELETE FROM ${t}`)
		].map((q) => db.prepare(q))
	);
}
try {
	// Arsip kecil = satu chunk; statement identik single-shot (now dibekukan).
	const small = archiveOf(3, 5000);
	const fixedNow = '2026-10-07T00:00:00.000Z';
	const single = buildRestoreChunks(small, { now: fixedNow }, 100);
	assert.equal(single.chunks.length, 1);
	assert.equal(single.totalRows, 3);
	const full = buildRestoreSql(small, { now: fixedNow });
	const withoutMarker = (statements: string[]) =>
		statements.filter((s) => !s.startsWith('INSERT INTO pengaturan'));
	assert.deepEqual(withoutMarker(single.chunks[0].statements), withoutMarker(full.statements));
	assert.equal(
		single.chunks[0].statements.filter((s) => s.startsWith('INSERT INTO pengaturan')).length,
		1
	);
	assert.ok(single.chunks[0].sql.includes('BEGIN TRANSACTION;'));
	assert.ok(single.chunks[0].sql.includes('COMMIT;'));

	// 250 baris -> 100/100/50; tiap chunk transaksi sendiri.
	const big = archiveOf(250, 1000);
	const planned = buildRestoreChunks(big, { now: fixedNow }, 100);
	assert.equal(planned.chunks.length, 3);
	assert.deepEqual(
		planned.chunks.map((c) => c.rows),
		[100, 100, 50]
	);
	for (const c of planned.chunks) {
		assert.ok(c.sql.startsWith('-- ZatiarasPOS Archive Restore Chunk\nBEGIN TRANSACTION;'));
		assert.ok(c.sql.endsWith('COMMIT;'));
	}
	const insertedIds = planned.chunks.flatMap((c) =>
		c.statements.filter((s) => s.startsWith('INSERT INTO buku_kas')).map((s) => s.slice(0, 60))
	);
	assert.equal(insertedIds.length, 250);

	// Preflight tetap dulu: arsip invalid tak hasilkan chunk.
	assert.throws(() => buildRestoreChunks({ ...big, buku_kas: [{ id: 'bad' }] }, {}, 100));

	// Apply berurutan -> counts + paritas laporan.
	await reset();
	for (const c of planned.chunks) await applyStatements(c.statements);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 250);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-11-01', '2025-11-01')).summary.pendapatan,
		250000
	);

	// Crash sesudah chunk 0 -> ulangi semua (resume) -> lengkap + paritas.
	await reset();
	await applyStatements(planned.chunks[0].statements);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 100);
	for (const c of planned.chunks) await applyStatements(c.statements);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 250);
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2025-11-01', '2025-11-01')).summary.pendapatan,
		250000
	);

	// Default chunk 100 terdokumentasi.
	assert.equal(DEFAULT_RESTORE_CHUNK_ROWS, 100);

	console.log(
		'restore-chunk-tests: single-parity/multi-chunk/preflight/sequential/crash-resume passed',
		process.argv.includes('--d1') ? '(workerd D1)' : '(SQLite)'
	);
} finally {
	await close();
}
