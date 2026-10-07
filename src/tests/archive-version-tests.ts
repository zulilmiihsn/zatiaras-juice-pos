import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	ARCHIVE_BUKU_KAS_FIELDS,
	ARCHIVE_SCHEMA_VERSION,
	ARCHIVE_TRANSAKSI_KASIR_FIELDS,
	buildArchiveSnapshot
} from '../lib/server/archiveUseCase';
import {
	ARCHIVE_VERSION_CONTRACT,
	BK_FIELDS,
	SUPPORTED_ARCHIVE_VERSIONS,
	TK_FIELDS,
	buildRestoreSql,
	validateArchive
} from '../../scripts/restore-archive-lib.mjs';
import { createTestD1 } from './helpers/testD1';
import { buildLaporanAggregate } from '../lib/server/reportQueries';

// AUD-041: kontrak versi snapshot + decoder.
assert.equal(ARCHIVE_SCHEMA_VERSION, 3);
assert.deepEqual(SUPPORTED_ARCHIVE_VERSIONS, [1, 2, 3]);
assert.ok(
	ARCHIVE_VERSION_CONTRACT[1] && ARCHIVE_VERSION_CONTRACT[2] && ARCHIVE_VERSION_CONTRACT[3]
);
// Daftar kolom exporter sama dengan kontrak restore (sumber tunggal via tes).
assert.deepEqual([...ARCHIVE_BUKU_KAS_FIELDS.slice(1)], BK_FIELDS);
assert.deepEqual([...ARCHIVE_TRANSAKSI_KASIR_FIELDS.slice(1)], TK_FIELDS);

const fullBk = {
	id: 'bk-full',
	cabang_id: 'samarinda',
	waktu: '2024-06-15T02:00:00.000Z',
	sumber: 'pos',
	tipe: 'in',
	jenis: 'pendapatan_usaha',
	nominal: 40000,
	jumlah: 2,
	deskripsi: 'Jual jus',
	nama_pelanggan: 'Pelanggan',
	metode_bayar: 'tunai',
	transaction_id: 'tx-full',
	idempotency_key: 'key-full',
	request_fingerprint: 'fp-full',
	receipt_snapshot: '{"total":40000}',
	nomor_harian: 7,
	tanggal_nomor: '2024-06-15',
	stock_policy_mode: 'tracked',
	stock_policy_revision: 0,
	stock_replay_disposition: 'normal',
	preparation_state: 'done',
	preparation_revision: 3,
	preparation_completed_at: '2024-06-15T02:05:00.000Z',
	preparation_completed_by: 'kasir',
	id_sesi_toko: 'sesi-1',
	created_at: '2024-06-15T02:00:00.000Z',
	// Kolom luar kontrak tak boleh masuk snapshot.
	revision: 5,
	mutation_token: 'tok-opaque',
	updated_at: '2024-06-16T00:00:00.000Z',
	kolom_masa_depan: 'x'
};
const fullTk = {
	id: 'tk-full',
	cabang_id: 'samarinda',
	buku_kas_id: 'bk-full',
	produk_id: 'jus-1',
	nama_kustom: null,
	jumlah: 2,
	nominal: 40000,
	harga: 20000,
	nama_produk: 'Jus',
	harga_dasar: 20000,
	total_tambahan: 0,
	snapshot_tambahan: '[]',
	gula: 'normal',
	es: 'normal',
	catatan: null,
	snapshot_hpp: '{"total":12000}',
	nominal_hpp: 12000,
	transaction_id: 'tx-full',
	created_at: '2024-06-15T02:00:00.000Z',
	updated_at: '2024-06-16T00:00:00.000Z'
};

const snapshot = buildArchiveSnapshot({
	branch: 'samarinda',
	year: 2025,
	cutoffWita: new Date('2025-01-01T00:00:00+08:00'),
	archiveJobId: 'job-v3-test-1234',
	bukuKas: [fullBk],
	transaksiKasir: [fullTk],
	now: new Date('2026-09-16T00:00:00.000Z')
});
const parsed = JSON.parse(snapshot.content) as {
	meta: { schema_version: number; counts: { buku_kas: number; transaksi_kasir: number } };
	items: Array<{ revision: number }>;
	buku_kas: Array<Record<string, unknown>>;
	transaksi_kasir: Array<Record<string, unknown>>;
};
assert.equal(parsed.meta.schema_version, 3);
// Kunci baris tepat = kontrak (tanpa revision/token/updated_at/masa depan).
assert.deepEqual(Object.keys(parsed.buku_kas[0]).sort(), [...ARCHIVE_BUKU_KAS_FIELDS].sort());
assert.deepEqual(
	Object.keys(parsed.transaksi_kasir[0]).sort(),
	[...ARCHIVE_TRANSAKSI_KASIR_FIELDS].sort()
);
// Manifest tetap bawa revision operasional.
assert.deepEqual(parsed.items, [{ id: 'bk-full', transaction_id: 'tx-full', revision: 5 }]);
assert.equal(snapshot.checksum, createHash('sha256').update(snapshot.content).digest('hex'));

// Decoder v3 penuh: valid + restore utuh.
assert.equal(validateArchive(parsed).ok, true);

// Versi lebih baru ditolak sebelum apply (tak ada omit diam-diam).
const newer = structuredClone(parsed) as typeof parsed & { meta: { schema_version: number } };
newer.meta.schema_version = 4;
assert.equal(validateArchive(newer).ok, false);
assert.throws(() => buildRestoreSql(newer), /Versi arsip tidak didukung/);
// Gerbang era v2 menolak v3 (kontrak upgrade eksplisit).
assert.ok(![1, 2].includes(Number(parsed.meta.schema_version)));

// Legacy v1 jarang (tanpa preparation/nomor/receipt) tetap restorabel
// dengan default, tanpa mengarang histori.
const legacyV1 = {
	meta: {
		schema_version: 1,
		archive_id: 'arc-v1',
		branch: 'samarinda',
		counts: { buku_kas: 1, transaksi_kasir: 0 }
	},
	buku_kas: [
		{
			id: 'bk-v1',
			cabang_id: 'samarinda',
			waktu: '2024-05-01T02:00:00.000Z',
			sumber: 'catat',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 15000
		}
	],
	transaksi_kasir: []
};
assert.equal(validateArchive(legacyV1).ok, true);

const { db, close } = await createTestD1();
try {
	// Round-trip v3: counts + semua field bisnis + paritas laporan.
	await db.batch(
		[
			`INSERT INTO archive_jobs(id,cabang_id,before_year,cutoff,status,owner_token,lease_expires_at,created_at,updated_at) VALUES('job-v3-test-1234','samarinda',2025,'2025-01-01','completed','t',0,'2026-09-16','2026-09-16')`,
			`INSERT INTO ringkasan_penjualan_harian(id,cabang_id,tanggal_penjualan,jumlah_transaksi,jumlah_item,penjualan_kotor,penjualan_tunai,penjualan_nontunai,total_hpp) VALUES('day','samarinda','2024-06-15',1,2,40000,40000,0,12000)`,
			`INSERT INTO penjualan_produk_harian(id,cabang_id,tanggal_penjualan,produk_id,nama_produk,jumlah,penjualan_kotor,penjualan_tunai,penjualan_nontunai,jumlah_transaksi) VALUES('pday','samarinda','2024-06-15','jus-1','Jus',2,40000,40000,0,1)`
		].map((q) => db.prepare(q))
	);
	const built = buildRestoreSql(parsed);
	await db.batch(built.statements.map((q) => db.prepare(q)));
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM buku_kas').first('n'), 1);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transaksi_kasir').first('n'), 1);
	const restored = (await db.prepare('SELECT * FROM buku_kas').first()) as Record<string, unknown>;
	for (const field of [
		'nominal',
		'jumlah',
		'deskripsi',
		'metode_bayar',
		'nomor_harian',
		'tanggal_nomor',
		'preparation_state',
		'preparation_revision',
		'receipt_snapshot',
		'idempotency_key'
	]) {
		assert.deepEqual(restored[field], fullBk[field as keyof typeof fullBk], field);
	}
	const detail = (await db.prepare('SELECT * FROM transaksi_kasir').first()) as Record<
		string,
		unknown
	>;
	assert.deepEqual(detail['nominal_hpp'], 12000);
	assert.deepEqual(detail['gula'], 'normal');
	assert.equal(
		(await buildLaporanAggregate(db, 'samarinda', '2024-06-15', '2024-06-15')).summary.pendapatan,
		40000
	);

	// Legacy v1 terapkan dengan default (tanpa mengarang nomor/preparation).
	const legacyBuilt = buildRestoreSql(legacyV1);
	await db.batch(legacyBuilt.statements.map((q) => db.prepare(q)));
	const legacyRow = {
		...((await db
			.prepare(
				"SELECT nomor_harian,tanggal_nomor,preparation_state,nominal FROM buku_kas WHERE id='bk-v1'"
			)
			.first()) as Record<string, unknown>)
	};
	assert.deepEqual(legacyRow, {
		nomor_harian: null,
		tanggal_nomor: null,
		preparation_state: null,
		nominal: 15000
	});
	console.log('archive-version-tests: v3 kontrak, round-trip, legacy, tolak-v4 passed');
} finally {
	await close();
}
