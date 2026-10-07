import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { checkDrillDatabase, POS_REQUIRED_COLUMNS } from './restore-drill-local.mjs';

function memAdapter() {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys=OFF;');
	return {
		db,
		all: (sql) => db.prepare(sql).all(),
		get: (sql) => db.prepare(sql).get(),
		close: () => db.close()
	};
}

function seedValid(a) {
	a.db.exec(`
		CREATE TABLE buku_kas(id TEXT PRIMARY KEY, cabang_id TEXT, waktu TEXT, sumber TEXT, tipe TEXT, jenis TEXT, nominal REAL, metode_bayar TEXT, receipt_snapshot TEXT, nomor_harian INTEGER, tanggal_nomor TEXT);
		CREATE TABLE transaksi_kasir(id TEXT PRIMARY KEY, cabang_id TEXT, buku_kas_id TEXT, jumlah INTEGER, nominal REAL);
		CREATE TABLE bahan(id TEXT PRIMARY KEY, stok_saat_ini REAL);
		CREATE TABLE bahan_mutasi(id TEXT PRIMARY KEY, bahan_id TEXT);
		CREATE TABLE pos_nomor_harian(cabang_id TEXT, tanggal TEXT, terakhir INTEGER, PRIMARY KEY(cabang_id, tanggal));
		INSERT INTO buku_kas VALUES('bk1','samarinda','2025-01-01T00:00:00Z','catat','in','pendapatan_usaha',100000,'tunai',NULL,NULL,NULL);
		INSERT INTO transaksi_kasir VALUES('tk1','samarinda','bk1',2,100000);
		INSERT INTO bahan VALUES('b1',10);
		INSERT INTO bahan_mutasi VALUES('m1','b1');
		INSERT INTO pos_nomor_harian VALUES('samarinda','2025-01-02',7);
		INSERT INTO buku_kas VALUES('bk2','samarinda','2025-01-02T00:00:00Z','pos','in','pendapatan_usaha',20000,'tunai','{}',7,'2025-01-02');
	`);
}

await test('backup lengkap PASS dengan seluruh cek', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		const report = checkDrillDatabase(a);
		assert.ok(report.tables.includes('buku_kas'));
		assert.ok(report.checks.some((c) => c.name === 'integrity_check'));
		assert.ok(report.checks.some((c) => c.name === 'counter'));
	} finally {
		a.close();
	}
});

await test('dump mainan satu tabel GAGAL', () => {
	const a = memAdapter();
	try {
		a.db.exec(`CREATE TABLE buku_kas(id TEXT); INSERT INTO buku_kas VALUES('x');`);
		assert.throws(() => checkDrillDatabase(a), /tabel POS hilang|kolom hilang/);
	} finally {
		a.close();
	}
});

await test('kolom POS hilang GAGAL', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		a.db.exec(
			`CREATE TABLE bk_new AS SELECT id, cabang_id FROM buku_kas; DROP TABLE buku_kas; ALTER TABLE bk_new RENAME TO buku_kas;`
		);
		assert.throws(() => checkDrillDatabase(a), /kolom hilang/);
	} finally {
		a.close();
	}
});

await test('detail yatim GAGAL', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		a.db.exec(`INSERT INTO transaksi_kasir VALUES('tk-yatim','samarinda','tidak-ada',1,5000);`);
		assert.throws(() => checkDrillDatabase(a), /yatim/);
	} finally {
		a.close();
	}
});

await test('stok negatif GAGAL', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		a.db.exec(`UPDATE bahan SET stok_saat_ini = -1 WHERE id = 'b1';`);
		assert.throws(() => checkDrillDatabase(a), /negatif/);
	} finally {
		a.close();
	}
});

await test('pasangan nomor tak lengkap GAGAL', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		a.db.exec(
			`INSERT INTO buku_kas VALUES('bk3','samarinda','2025-01-03T00:00:00Z','pos','in','pendapatan_usaha',5000,'tunai',NULL,9,NULL);`
		);
		assert.throws(() => checkDrillDatabase(a), /pasangan nomor|nomor-pair/);
	} finally {
		a.close();
	}
});

await test('counter tertinggal GAGAL', () => {
	const a = memAdapter();
	try {
		seedValid(a);
		a.db.exec(`UPDATE pos_nomor_harian SET terakhir = 1;`);
		assert.throws(() => checkDrillDatabase(a), /counter tertinggal/);
	} finally {
		a.close();
	}
});

await test('kontrak kolom POS terdokumentasi', () => {
	assert.ok(POS_REQUIRED_COLUMNS.buku_kas.includes('receipt_snapshot'));
	assert.ok(POS_REQUIRED_COLUMNS.transaksi_kasir.includes('buku_kas_id'));
});

await test('jalur workerd D1: data-scope lulus pada D1 nyata', async () => {
	const { getPlatformProxy } = await import('wrangler');
	const proxy = await getPlatformProxy({ configPath: 'wrangler.pages.jsonc', persist: false });
	try {
		const db = proxy.env.DB_SAMARINDA_GROUP;
		await db.batch([
			db.prepare(`DROP TABLE IF EXISTS drill_bk`),
			db.prepare(
				`CREATE TABLE drill_bk(id TEXT PRIMARY KEY, cabang_id TEXT, waktu TEXT, sumber TEXT, tipe TEXT, jenis TEXT, nominal REAL, metode_bayar TEXT, receipt_snapshot TEXT, nomor_harian INTEGER, tanggal_nomor TEXT)`
			),
			db.prepare(
				`CREATE TABLE drill_tk(id TEXT PRIMARY KEY, cabang_id TEXT, buku_kas_id TEXT, jumlah INTEGER, nominal REAL)`
			),
			db.prepare(
				`INSERT INTO drill_bk VALUES('bk1','samarinda','2025-01-01T00:00:00Z','catat','in','pendapatan_usaha',100000,'tunai',NULL,NULL,NULL)`
			),
			db.prepare(`INSERT INTO drill_tk VALUES('tk1','samarinda','bk1',2,100000)`)
		]);
		const orphanSql = `SELECT COUNT(*) AS n FROM drill_tk t LEFT JOIN drill_bk b ON b.id = t.buku_kas_id WHERE b.id IS NULL`;
		// Orphan check nyata di D1: 0 yatim; lalu tanam yatim -> FAIL.
		const clean = await db.prepare(orphanSql).first();
		assert.equal(Number(clean?.n ?? -1), 0);
		await db.batch([
			db.prepare(`INSERT INTO drill_tk VALUES('tk-yatim','samarinda','tidak-ada',1,5000)`)
		]);
		const dirty = await db.prepare(orphanSql).first();
		assert.equal(Number(dirty?.n ?? 0), 1);
		assert.ok(
			(
				(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()).results ??
				[]
			).length > 0
		);
	} finally {
		await proxy.dispose();
	}
});
