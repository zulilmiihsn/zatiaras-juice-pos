import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
	captureDrillParity,
	drillDatabaseIdentity,
	loadDrillContract
} from '../restore-drill-local.mjs';

/** Synthetic trusted inventory is captured BEFORE corrupting a candidate. Never used to bless real backup files. */
export async function drillFixtureBaselineOptions(
	sql,
	migration,
	binding = 'DB_SAMARINDA_GROUP',
	referenceAdapter
) {
	const db = referenceAdapter ? null : new DatabaseSync(':memory:');
	try {
		if (db)
			db.exec(
				drillFixtureSql(migration).replaceAll(
					'samarinda',
					binding === 'DB_BERAU_GROUP'
						? 'berau'
						: binding === 'DB_BALIKPAPAN_GROUP'
							? 'balikpapan'
							: 'samarinda'
				)
			);
		const adapter = referenceAdapter ?? { all: (query) => db.prepare(query).all() };
		const identity = drillDatabaseIdentity(binding);
		const source = {
			bytes: Buffer.byteLength(sql),
			sha256: createHash('sha256').update(sql).digest('hex')
		};
		const baseline = {
			schema: 'zatiaraspos-drill-baseline-v1',
			database: identity,
			source,
			migration: loadDrillContract(migration).target,
			tables: await captureDrillParity(adapter)
		};
		const text = JSON.stringify(baseline);
		return {
			baseline: { text, approvedSha256: createHash('sha256').update(text).digest('hex') },
			databaseIdentity: identity,
			sourceIdentity: source
		};
	} finally {
		if (db) db.close();
	}
}

/** Fully migrated synthetic dump; no credentials or production rows. */
export function drillFixtureSql(lastMigration) {
	const directory = new URL('../../drizzle/', import.meta.url);
	const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', directory), 'utf8'));
	const files = journal.entries.map((entry) => `${entry.tag}.sql`);
	const end = lastMigration ? files.indexOf(lastMigration) + 1 : files.length;
	if (!end) throw new Error('Unknown fixture migration');
	const selected = files.slice(0, end);
	const receipt = JSON.stringify({
		schema_version: 1,
		items: [
			{
				product_id: null,
				nama: 'Fixture',
				jumlah: 2,
				harga: 10000,
				nominal: 20000,
				harga_dasar: 10000,
				total_tambahan: 0,
				tambahan: [],
				gula: null,
				es: null,
				catatan: null
			}
		],
		total_amount: 20000,
		total_qty: 2,
		cash_received: 50000,
		change: 30000,
		metode_bayar: 'tunai',
		committed_at: '2025-01-02T00:00:00.000Z',
		customer_name: null,
		settings: null
	}).replaceAll("'", "''");
	return [
		'PRAGMA foreign_keys=OFF;',
		...selected.map((file) => readFileSync(new URL(file, directory), 'utf8')),
		'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);',
		...selected.map(
			(file, i) => `INSERT INTO d1_migrations VALUES(${i + 1},'${file}','2025-01-01T00:00:00Z');`
		),
		`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,metode_bayar,created_at,updated_at) VALUES('bk1','samarinda','2025-01-01T00:00:00Z','catat','in','pendapatan_usaha',100000,'tunai','2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');`,
		`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,harga,harga_dasar,total_tambahan,nominal,created_at,updated_at) VALUES('tk1','samarinda','bk1',2,50000,50000,0,100000,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');`,
		`INSERT INTO bahan(id,cabang_id,nama,stok_saat_ini,created_at,updated_at) VALUES('b1','samarinda','Fixture',10,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z');`,
		`INSERT INTO bahan_mutasi(id,cabang_id,bahan_id,delta_jumlah,stok_setelah,created_at) VALUES('m1','samarinda','b1',10,10,'2025-01-01T00:00:00Z');`,
		`INSERT INTO pos_nomor_harian(cabang_id,tanggal,terakhir) VALUES('samarinda','2025-01-02',7);`,
		`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,jumlah,metode_bayar,receipt_snapshot,nomor_harian,tanggal_nomor,idempotency_key,request_fingerprint,stock_policy_mode,stock_policy_revision,created_at,updated_at) VALUES('bk2','samarinda','2025-01-02T00:00:00Z','pos','in','pendapatan_usaha',20000,2,'tunai','${receipt}',7,'2025-01-02','fixture-sale','fixture-fingerprint','tracked',0,'2025-01-02T00:00:00Z','2025-01-02T00:00:00Z');`,
		`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,nama_produk,jumlah,harga,harga_dasar,total_tambahan,nominal,created_at,updated_at) VALUES('tk2','samarinda','bk2','Fixture',2,10000,10000,0,20000,'2025-01-02T00:00:00Z','2025-01-02T00:00:00Z');`
	].join('\n');
}
