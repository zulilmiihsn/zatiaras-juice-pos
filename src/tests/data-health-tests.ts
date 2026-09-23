import assert from 'node:assert/strict';
import {
	checkDataHealth,
	findNegativeStock,
	findOrphanBahanMutasi,
	findOrphanTransaksiKasir
} from '$lib/server/dataHealth';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
try {
	// Database fresh hasil 30 migrasi: bersih.
	assert.deepEqual(await checkDataHealth(db, 'samarinda'), {
		orphanTransaksiKasir: [],
		orphanBahanMutasi: [],
		negativeStock: [],
		clean: true
	});

	// Seed temuan: detail orphan, mutasi orphan, stok negatif.
	await db.batch(
		[
			`INSERT INTO transaksi_kasir (id, cabang_id, buku_kas_id, jumlah, nominal) VALUES ('orphan-tk', 'samarinda', 'hilang', 1, 5000)`,
			`INSERT INTO bahan_mutasi (id, cabang_id, bahan_id, delta_jumlah) VALUES ('orphan-m', 'samarinda', 'hilang', -5)`,
			`INSERT INTO produk (id, cabang_id, nama, harga, stok) VALUES ('neg-p', 'samarinda', 'Rusak', 1000, -2)`,
			`INSERT INTO bahan (id, cabang_id, nama, stok_saat_ini) VALUES ('neg-b', 'samarinda', 'Gula', -1)`,
			// Cabang lain tidak ikut terdeteksi.
			`INSERT INTO transaksi_kasir (id, cabang_id, buku_kas_id, jumlah, nominal) VALUES ('orphan-tk2', 'balikpapan', 'hilang', 1, 5000)`
		].map((q) => db.prepare(q))
	);

	assert.deepEqual(await findOrphanTransaksiKasir(db, 'samarinda'), [
		{ id: 'orphan-tk', buku_kas_id: 'hilang' }
	]);
	assert.deepEqual(await findOrphanBahanMutasi(db, 'samarinda'), [
		{ id: 'orphan-m', bahan_id: 'hilang' }
	]);
	const negatives = await findNegativeStock(db, 'samarinda');
	assert.equal(negatives.length, 2);
	assert.ok(negatives.some((r) => r.id === 'neg-p' && r.kind === 'produk'));
	assert.ok(negatives.some((r) => r.id === 'neg-b' && r.kind === 'bahan'));

	const report = await checkDataHealth(db, 'samarinda');
	assert.equal(report.clean, false);
	assert.equal(report.orphanTransaksiKasir.length, 1);

	// Scope cabang: temuan balikpapan tidak bocor ke samarinda dan sebaliknya.
	assert.deepEqual(await findNegativeStock(db, 'balikpapan'), []);
	assert.deepEqual(await findOrphanBahanMutasi(db, 'balikpapan'), []);
	console.log('data-health-tests: orphan/negative detectors passed (SQLite)');
} finally {
	await close();
}
process.exit(0);
