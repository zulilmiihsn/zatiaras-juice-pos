import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Migration Matrix & Schema Verification Tests (DB-002 / QA-002)
 */

const MIGRATIONS_DIR = resolve('drizzle');
const JOURNAL_FILE = resolve('drizzle/meta/_journal.json');
const MANIFEST_FILE = resolve('drizzle/meta/manifest.json');

assert.equal(existsSync(JOURNAL_FILE), true, 'Journal file must exist');
assert.equal(existsSync(MANIFEST_FILE), true, 'Manifest file must exist');

const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8'));
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

const journalEntries = journal.entries || [];
assert.equal(journalEntries.length >= 24, true, 'Journal must contain at least 24 entries');

const files = readdirSync(MIGRATIONS_DIR)
	.filter((f) => f.endsWith('.sql'))
	.sort();
assert.equal(files.length, journalEntries.length, 'File count must match journal entries count');

// Check each migration file against journal and manifest
for (let i = 0; i < journalEntries.length; i++) {
	const entry = journalEntries[i];
	const expectedFile = `${entry.tag}.sql`;
	assert.equal(files[i], expectedFile, `Migration file index ${i} tag must match`);

	const filePath = join(MIGRATIONS_DIR, expectedFile);
	const sqlText = readFileSync(filePath, 'utf8');
	const normalizedSql = sqlText.replace(/\r\n/g, '\n');
	const sha = createHash('sha256').update(normalizedSql).digest('hex');

	assert.equal(
		sha,
		manifest[expectedFile],
		`SHA-256 for ${expectedFile} must match recorded manifest hash`
	);

	// Verify basic SQL sanity
	assert.equal(sqlText.length > 0, true, `${expectedFile} must not be empty`);
}

import { DatabaseSync } from 'node:sqlite';

// Verify latest migrations define required idempotency, receipt, archive, and key-value columns
const migration0023 = readFileSync(
	join(MIGRATIONS_DIR, '0023_idempotency_receipt_and_archive_summary.sql'),
	'utf8'
);
assert.match(migration0023, /request_fingerprint/);
assert.match(migration0023, /receipt_snapshot/);
assert.match(migration0023, /ringkasan_kas_arsip_harian/);

const migration0024 = readFileSync(
	join(MIGRATIONS_DIR, '0024_pengaturan_kunci_nilai_key_value.sql'),
	'utf8'
);
assert.match(migration0024, /kunci/);
assert.match(migration0024, /nilai/);

// Real SQLite In-Memory Database Playback & PRAGMA quick_check (DB-002)
const db = new DatabaseSync(':memory:');

for (const file of files) {
	if (file === '0041_purchase_request_fingerprint.sql') {
		// Upgrade nyata dari schema 0040: histori/unique key tidak dibackfill atau ditulis ulang.
		db.exec(`INSERT INTO bahan(id, cabang_id, nama, satuan, stok_saat_ini) VALUES
			('upgrade-purchase-bahan', 'berau', 'Fixture', 'gram', 77);
			INSERT INTO bahan_mutasi(id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber, operation_key)
			VALUES ('upgrade-purchase-ledger', 'berau', 'upgrade-purchase-bahan', 7, 77, 'manual', 'upgrade-legacy-key');`);
	}
	if (file === '0042_archive_restore_staging.sql')
		db.exec(
			"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,created_at,updated_at) VALUES('upgrade-staging-history','berau','2025-01-01T00:00:00Z','catat','in','pendapatan_usaha',9450,'2025-01-01T00:00:00Z','2025-01-01T00:00:00Z')"
		);
	const beforeStaging =
		file === '0042_archive_restore_staging.sql'
			? JSON.stringify(db.prepare('SELECT * FROM buku_kas ORDER BY id').all())
			: null;
	const metricsUpgrade = file === '0052_drop_request_metrics_branch_path_index.sql';
	if (metricsUpgrade)
		db.exec(`INSERT INTO request_metrics (id, cabang_id, method, path, status, duration_ms, created_at)
			VALUES ('metrics-a','samarinda','GET','/api/produk',200,2,'2026-11-01T00:00:00.000Z'),
			       ('metrics-b','berau','POST','/api/pos',503,51,'2026-11-01T00:00:01.000Z');`);
	const beforeMetrics = metricsUpgrade
		? db.prepare('SELECT * FROM request_metrics ORDER BY id').all()
		: null;
	const summaryUpgrade = file === '0053_drop_duplicate_daily_sales_index.sql';
	if (summaryUpgrade)
		db.exec(`INSERT INTO ringkasan_penjualan_harian (id,cabang_id,tanggal_penjualan,penjualan_kotor)
			VALUES ('summary-a','samarinda','2026-11-01',3000),('summary-b','berau','2026-11-01',7000);`);
	const reportRange = `SELECT id, penjualan_kotor FROM ringkasan_penjualan_harian
		WHERE cabang_id='samarinda' AND tanggal_penjualan BETWEEN '2026-11-01' AND '2026-11-30' ORDER BY tanggal_penjualan`;
	const beforeSummary = summaryUpgrade ? db.prepare(reportRange).all() : null;
	const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
	const statements = content
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);

	for (const stmt of statements) {
		db.exec(stmt);
	}
	if (beforeStaging !== null) {
		assert.equal(
			JSON.stringify(db.prepare('SELECT * FROM buku_kas ORDER BY id').all()),
			beforeStaging,
			'0042 is additive, no ledger rewrite'
		);
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM archive_restore_jobs').get()?.n, 0);
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM archive_restore_rows').get()?.n, 0);
		db.exec("DELETE FROM buku_kas WHERE id='upgrade-staging-history'");
	}
	if (beforeMetrics) {
		assert.deepEqual(db.prepare('SELECT * FROM request_metrics ORDER BY id').all(), beforeMetrics);
		const indexes = db
			.prepare('PRAGMA index_list(request_metrics)')
			.all()
			.map((row) => row.name);
		assert.ok(indexes.includes('idx_request_metrics_branch_created'));
		assert.ok(!indexes.includes('idx_request_metrics_branch_path'));
		db.exec("DELETE FROM request_metrics WHERE id IN ('metrics-a','metrics-b')");
	}
	if (beforeSummary) {
		assert.deepEqual(db.prepare(reportRange).all(), beforeSummary);
		const indexes = db.prepare('PRAGMA index_list(ringkasan_penjualan_harian)').all();
		assert.ok(
			indexes.some((row) => row.name === 'idx_daily_sales_branch_date' && row.unique === 1)
		);
		assert.ok(!indexes.some((row) => row.name === 'idx_daily_sales_branch_date_range'));
		db.exec(`INSERT INTO ringkasan_penjualan_harian (id,cabang_id,tanggal_penjualan,penjualan_kotor)
			VALUES ('summary-retry','samarinda','2026-11-01',2000)
			ON CONFLICT(cabang_id,tanggal_penjualan) DO UPDATE SET penjualan_kotor=penjualan_kotor+excluded.penjualan_kotor;`);
		assert.deepEqual(
			db
				.prepare(reportRange)
				.all()
				.map((row) => ({ ...row })),
			[{ id: 'summary-a', penjualan_kotor: 5000 }]
		);
		assert.equal(
			db
				.prepare("SELECT penjualan_kotor FROM ringkasan_penjualan_harian WHERE id='summary-b'")
				.get()?.penjualan_kotor,
			7000
		);
		db.exec("DELETE FROM ringkasan_penjualan_harian WHERE id IN ('summary-a','summary-b')");
	}
}

assert.deepEqual(
	db
		.prepare('PRAGMA table_info(archive_restore_rows)')
		.all()
		.map(({ name }) => name),
	['job_id', 'kind', 'row_id', 'data_json'],
	'Ownership of restore staging rows is derived from the job'
);

const legacyPurchase = db
	.prepare(
		`SELECT request_fingerprint, delta_jumlah, stok_setelah, operation_key
	FROM bahan_mutasi WHERE cabang_id = 'berau' AND id = 'upgrade-purchase-ledger'`
	)
	.get();
assert.deepEqual(
	{ ...legacyPurchase },
	{
		request_fingerprint: null,
		delta_jumlah: 7,
		stok_setelah: 77,
		operation_key: 'upgrade-legacy-key'
	}
);
assert.equal(
	db
		.prepare(
			"SELECT stok_saat_ini FROM bahan WHERE cabang_id = 'berau' AND id = 'upgrade-purchase-bahan'"
		)
		.get()?.stok_saat_ini,
	77
);
assert.throws(
	() =>
		db.exec(`INSERT INTO bahan_mutasi(id, cabang_id, bahan_id, delta_jumlah, sumber, operation_key)
	VALUES ('upgrade-key-collision', 'berau', 'upgrade-purchase-bahan', 1, 'manual', 'upgrade-legacy-key')`),
	/UNIQUE constraint failed/
);

// 0045: FK transaksi_kasir -> buku_kas lewat rebuild tabel. Kontraknya: tidak ada baris yang
// berubah atau hilang, dan data tidak konsisten menggagalkan migrasi, bukan dibuang diam-diam.
const FK_MIGRATION = '0045_transaksi_kasir_fk_buku_kas.sql';
const statementsOf = (file: string) =>
	readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
const plain = (rows: unknown[]) => JSON.parse(JSON.stringify(rows));
function playBefore(stopBefore: string) {
	const target = new DatabaseSync(':memory:');
	for (const file of files) {
		if (file === stopBefore) break;
		for (const stmt of statementsOf(file)) target.exec(stmt);
	}
	return target;
}
const snapshotKasir = (target: DatabaseSync) => ({
	rows: plain(target.prepare('SELECT * FROM transaksi_kasir ORDER BY id').all()),
	columns: plain(target.prepare('PRAGMA table_info(transaksi_kasir)').all()),
	indexes: (
		target
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='transaksi_kasir' AND sql IS NOT NULL"
			)
			.all() as Array<{ name: string }>
	)
		.map((r) => r.name)
		.sort(),
	foreignKeys: plain(target.prepare('PRAGMA foreign_key_list(transaksi_kasir)').all())
});
const seedKas = (target: DatabaseSync) => {
	for (const [id, cabang] of [
		['bk-a', 'samarinda'],
		['bk-b', 'balikpapan'],
		['bk-c', 'berau']
	])
		target.exec(
			`INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,created_at,updated_at) VALUES('${id}','${cabang}','2026-10-01T00:00:00Z','catat','in','pendapatan_usaha',15000,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`
		);
};
const seedDetails = (target: DatabaseSync) => {
	target.exec(`INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,produk_id,nama_produk,jumlah,nominal,harga,harga_dasar,total_tambahan,snapshot_tambahan,gula,es,catatan,snapshot_hpp,nominal_hpp,transaction_id,created_at,updated_at)
		VALUES ('tk-full','samarinda','bk-a','p1','Jus Mangga',2,15000,7500,7000,500,'[{"id":"e1","nama":"Boba"}]','less','no','tanpa gula ''asli''','{"bahan":[]}',3333.3333,'trx-1','2026-10-01T00:00:01Z','2026-10-01T00:00:02Z')`);
	target.exec(
		"INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal,created_at,updated_at) VALUES ('tk-minimal','samarinda','bk-a',1,500,NULL,NULL)"
	);
	target.exec(
		"INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,nama_kustom,jumlah,nominal) VALUES ('tk-kustom','balikpapan','bk-b','Item bebas',3,45000)"
	);
};

{
	const upgrade = playBefore(FK_MIGRATION);
	seedKas(upgrade);
	seedDetails(upgrade);
	const before = snapshotKasir(upgrade);
	assert.equal(before.rows.length, 3);
	assert.deepEqual(before.foreignKeys, [], 'sebelum 0045 tidak ada FK');

	for (const stmt of statementsOf(FK_MIGRATION)) upgrade.exec(stmt);
	const after = snapshotKasir(upgrade);

	assert.deepEqual(after.rows, before.rows, '0045 tidak mengubah/menghapus satu pun baris');
	assert.deepEqual(after.columns, before.columns, 'urutan, tipe, default, dan NOT NULL kolom sama');
	assert.deepEqual(after.indexes, before.indexes, 'semua indeks dibuat ulang');
	assert.deepEqual(
		after.foreignKeys.map((r: Record<string, unknown>) => [r.table, r.from, r.to, r.on_delete]),
		[
			['buku_kas', 'cabang_id', 'cabang_id', 'NO ACTION'],
			['buku_kas', 'buku_kas_id', 'id', 'NO ACTION']
		],
		'FK komposit tanpa cascade'
	);
	assert.deepEqual(upgrade.prepare('PRAGMA foreign_key_check').all(), []);
	const leftovers = upgrade
		.prepare(
			"SELECT name FROM sqlite_master WHERE name IN ('transaksi_kasir__new', '_fk_copy_guard')"
		)
		.all();
	assert.deepEqual(leftovers, [], 'tabel sementara tidak tersisa');

	// Penegakan: yatim dan lintas cabang ditolak; induk dengan anak tidak bisa dihapus diam-diam.
	assert.throws(
		() =>
			upgrade.exec(
				"INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal) VALUES ('x','samarinda','hilang',1,1)"
			),
		/FOREIGN KEY constraint failed/
	);
	assert.throws(
		() =>
			upgrade.exec(
				"INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal) VALUES ('x','balikpapan','bk-a',1,1)"
			),
		/FOREIGN KEY constraint failed/,
		'cabang berbeda dengan header ditolak'
	);
	assert.throws(
		() => upgrade.exec("DELETE FROM buku_kas WHERE cabang_id='samarinda' AND id='bk-a'"),
		/FOREIGN KEY constraint failed/
	);
	// Urutan arsip/void: anak dulu, baru induk.
	upgrade.exec("DELETE FROM transaksi_kasir WHERE cabang_id='samarinda' AND buku_kas_id='bk-a'");
	upgrade.exec("DELETE FROM buku_kas WHERE cabang_id='samarinda' AND id='bk-a'");
	upgrade.close();
}

{
	// Data yatim: migrasi berhenti tanpa membuang apa pun, lalu aman diulang setelah dikoreksi.
	const blocked = playBefore(FK_MIGRATION);
	seedKas(blocked);
	seedDetails(blocked);
	blocked.exec(
		"INSERT INTO transaksi_kasir(id,cabang_id,buku_kas_id,jumlah,nominal) VALUES ('tk-yatim','samarinda','hilang',1,9000)"
	);
	const before = snapshotKasir(blocked);
	assert.equal(before.rows.length, 4);

	assert.throws(() => {
		for (const stmt of statementsOf(FK_MIGRATION)) blocked.exec(stmt);
	}, /FOREIGN KEY constraint failed/);
	const afterFailure = snapshotKasir(blocked);
	assert.deepEqual(afterFailure.rows, before.rows, 'baris yatim ikut utuh, tidak ada yang dibuang');
	assert.deepEqual(afterFailure.foreignKeys, [], 'tabel lama tetap yang asli');
	assert.deepEqual(afterFailure.columns, before.columns);

	// Koreksi manual yang bersifat menambah (header yang hilang dipulihkan), lalu ulangi.
	blocked.exec(
		"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,jenis,nominal,created_at,updated_at) VALUES('hilang','samarinda','2026-10-01T00:00:00Z','catat','in','pendapatan_usaha',9000,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')"
	);
	for (const stmt of statementsOf(FK_MIGRATION)) blocked.exec(stmt);
	const retried = snapshotKasir(blocked);
	assert.deepEqual(retried.rows, before.rows, 'percobaan ulang menghasilkan data yang sama');
	assert.equal(retried.foreignKeys.length, 2);
	assert.deepEqual(blocked.prepare('PRAGMA foreign_key_check').all(), []);
	blocked.close();
}

{
	// Rollback 0045: FK terlepas, data dan bentuk tabel kembali persis seperti sebelum 0045.
	const rollbackSql = readFileSync(resolve('scripts/rollback-0045-transaksi-kasir-fk.sql'), 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
	const target = playBefore(FK_MIGRATION);
	seedKas(target);
	seedDetails(target);
	const original = snapshotKasir(target);
	for (const stmt of statementsOf(FK_MIGRATION)) target.exec(stmt);
	assert.equal(snapshotKasir(target).foreignKeys.length, 2);

	for (const stmt of rollbackSql) target.exec(stmt);
	assert.deepEqual(snapshotKasir(target), original, 'rollback memulihkan data dan bentuk tabel');
	// Aman diulang, dan migrasi maju tetap bisa diterapkan lagi sesudahnya.
	for (const stmt of rollbackSql) target.exec(stmt);
	for (const stmt of statementsOf(FK_MIGRATION)) target.exec(stmt);
	assert.equal(snapshotKasir(target).foreignKeys.length, 2);
	assert.deepEqual(snapshotKasir(target).rows, original.rows);
	target.close();
}

// 1. Execute real PRAGMA quick_check on SQLite C-engine
const quickCheckRows = db.prepare('PRAGMA quick_check;').all() as Array<{ quick_check?: string }>;
assert.equal(quickCheckRows.length, 1, 'PRAGMA quick_check must return 1 row');
assert.equal(quickCheckRows[0].quick_check, 'ok', 'Real SQLite PRAGMA quick_check must return ok');

// 2. Verify all core tables exist in schema
const tables = (
	db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
).map((t) => t.name);
const expectedTables = [
	'produk',
	'buku_kas',
	'transaksi_kasir',
	'resep_produk',
	'bahan',
	'kategori',
	'pengaturan',
	'sesi_toko',
	'ringkasan_penjualan_harian',
	'ringkasan_kas_arsip_harian',
	'stock_policy',
	'stock_policy_transitions',
	'produk_mutasi',
	'stock_reconciliations',
	'stock_reconciliation_items',
	'offline_stock_reviews',
	'pos_nomor_harian'
];
for (const expected of expectedTables) {
	assert.equal(
		tables.includes(expected),
		true,
		`Table ${expected} must exist after all migrations`
	);
}

// 3. Verify pengaturan has kunci and nilai columns
const pengaturanCols = (
	db.prepare('PRAGMA table_info(pengaturan);').all() as Array<{ name: string }>
).map((c) => c.name);
assert.equal(pengaturanCols.includes('kunci'), true, 'pengaturan table must contain kunci column');
assert.equal(pengaturanCols.includes('nilai'), true, 'pengaturan table must contain nilai column');

const stockPolicyTriggers = (
	db
		.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='stock_policy'")
		.all() as Array<{ name: string }>
).map((row) => row.name);
assert.deepEqual(stockPolicyTriggers.sort(), [
	'kiosk_inventory_stock_policy_delete',
	'kiosk_inventory_stock_policy_insert',
	'kiosk_inventory_stock_policy_update',
	'trg_stock_policy_insert_guard',
	'trg_stock_policy_reconciliation_job_guard',
	'trg_stock_policy_transition_insert',
	'trg_stock_policy_transition_update',
	'trg_stock_policy_update_guard'
]);

const bukuKasColumns = (
	db.prepare('PRAGMA table_info(buku_kas);').all() as Array<{ name: string }>
).map((column) => column.name);
for (const column of [
	'stock_policy_mode',
	'stock_policy_revision',
	'stock_replay_disposition',
	'preparation_state',
	'preparation_revision',
	'preparation_completed_at',
	'preparation_completed_by',
	'restored_from_archive',
	'nomor_harian',
	'tanggal_nomor'
]) {
	assert.ok(bukuKasColumns.includes(column), `buku_kas must contain ${column}`);
}
// 0036: counter harian atomik + guard pasangan nomor/tanggal.
const first = db
	.prepare(
		`INSERT INTO pos_nomor_harian (cabang_id, tanggal, terakhir) VALUES ('samarinda', '2026-09-29', 1)
		 ON CONFLICT(cabang_id, tanggal) DO UPDATE SET terakhir = terakhir + 1
		 RETURNING terakhir`
	)
	.get() as { terakhir?: number };
assert.equal(first?.terakhir, 1);
const second = db
	.prepare(
		`INSERT INTO pos_nomor_harian (cabang_id, tanggal, terakhir) VALUES ('samarinda', '2026-09-29', 1)
		 ON CONFLICT(cabang_id, tanggal) DO UPDATE SET terakhir = terakhir + 1
		 RETURNING terakhir`
	)
	.get() as { terakhir?: number };
assert.equal(second?.terakhir, 2);
const otherDay = db
	.prepare(
		`INSERT INTO pos_nomor_harian (cabang_id, tanggal, terakhir) VALUES ('samarinda', '2026-09-30', 1)
		 ON CONFLICT(cabang_id, tanggal) DO UPDATE SET terakhir = terakhir + 1
		 RETURNING terakhir`
	)
	.get() as { terakhir?: number };
assert.equal(otherDay?.terakhir, 1, 'tanggal baru reset ke 1');
assert.throws(
	() =>
		db.exec(`INSERT INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
			nomor_harian, tanggal_nomor
		) VALUES ('bad-nomor', 'samarinda', '2026-09-29', 'pos', 'in',
			'pendapatan_usaha', 1, 'bad-nomor', 1, NULL)`),
	/INVALID_NOMOR_HARIAN/
);
assert.throws(
	() =>
		db.exec(`INSERT INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
			stock_policy_mode, stock_policy_revision, preparation_state
		) VALUES ('bad-prep', 'samarinda', '2026-09-24', 'pos', 'in',
			'pendapatan_usaha', 1, 'bad-prep', 'tracked', 0, 'cooking')`),
	/(?:INVALID_PREPARATION_STATE|CHECK constraint failed)/
);

db.exec(`
	INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok) VALUES
		('ledger-product', 'samarinda', 'Ledger Product', 10000, 1, 1),
		('ledger-product-2', 'samarinda', 'Ledger Product 2', 10000, 3, 1),
		('other-product', 'balikpapan', 'Other Product', 10000, 5, 1);
	INSERT INTO buku_kas (
		id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id,
		stock_policy_mode, stock_policy_revision, stock_replay_disposition
	) VALUES (
		'ledger-header', 'samarinda', '2026-09-24T00:00:00.000Z', 'pos', 'in',
		'pendapatan_usaha', 10000, 1, 'ledger-transaction', 'tracked', 0, 'normal'
	);
`);

assert.throws(
	() =>
		db.exec(`INSERT INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
			stock_policy_mode, stock_policy_revision
		) VALUES ('missing-policy', 'balikpapan', '2026-09-24', 'pos', 'in',
			'pendapatan_usaha', 1, 'missing-policy', NULL, NULL)`),
	/STOCK_POLICY_CONFLICT/
);

db.exec(`INSERT INTO stock_policy (
	cabang_id, mode, revision, disabled_at, updated_at, updated_by, updated_by_role
) VALUES ('balikpapan', 'ignored', 1, '2026-09-24', '2026-09-24', 'owner', 'pemilik')`);
assert.throws(
	() =>
		db.exec(`INSERT INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
			stock_policy_mode, stock_policy_revision
		) VALUES ('stale-policy', 'balikpapan', '2026-09-24', 'pos', 'in',
			'pendapatan_usaha', 1, 'stale-policy', 'tracked', 0)`),
	/STOCK_POLICY_CONFLICT/
);
db.exec(`INSERT INTO buku_kas (
	id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
	stock_policy_mode, stock_policy_revision, restored_from_archive
) VALUES ('restored-policy', 'balikpapan', '2026-09-24', 'pos', 'in',
	'pendapatan_usaha', 1, 'restored-policy', NULL, NULL, 1)`);

db.exec(`INSERT INTO produk_mutasi (
	id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id, dibuat_oleh
) VALUES ('pm-pos', 'samarinda', 'ledger-product', -1, 0, 'pos', 'ledger-transaction', 'kasir')`);
assert.equal(db.prepare("SELECT stok FROM produk WHERE id='ledger-product'").get()?.stok, 0);
assert.throws(
	() =>
		db.exec(`INSERT INTO produk_mutasi (
			id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id
		) VALUES ('pm-cross-branch', 'samarinda', 'other-product', -1, 4, 'pos', 'cross')`),
	/(?:PRODUCT_MUTATION_PRODUCT_MISMATCH|INVALID_PRODUCT_POS_MUTATION)/
);
assert.throws(
	() =>
		db.exec(`INSERT INTO produk_mutasi (
			id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id
		) VALUES ('pm-partial', 'samarinda', 'ledger-product', 2, 2, 'void', 'ledger-transaction')`),
	/PRODUCT_VOID_MISMATCH/
);
db.exec(`INSERT INTO produk_mutasi (
	id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id, dibuat_oleh
) VALUES ('pm-void', 'samarinda', 'ledger-product', 1, 1, 'void', 'ledger-transaction', 'owner')`);
assert.equal(db.prepare("SELECT stok FROM produk WHERE id='ledger-product'").get()?.stok, 1);

db.exec(`INSERT INTO produk_mutasi (
	id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id
) VALUES ('pm-pos-two', 'samarinda', 'ledger-product-2', -2, 1, 'pos', 'ledger-transaction-2')`);
for (const [id, delta, stock] of [
	['pm-void-partial', 1, 2],
	['pm-void-excess', 3, 4]
] as const) {
	assert.throws(
		() =>
			db
				.prepare(
					`INSERT INTO produk_mutasi (
						id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id
					) VALUES (?, 'samarinda', 'ledger-product-2', ?, ?, 'void', 'ledger-transaction-2')`
				)
				.run(id, delta, stock),
		/PRODUCT_VOID_MISMATCH/
	);
}

db.exec(
	`INSERT INTO produk_mutasi (id,cabang_id,produk_id,delta_jumlah,stok_setelah,sumber,referensi_id)
	 VALUES ('pm-last-a','samarinda','ledger-product',-1,0,'pos','last-a')`
);
assert.throws(
	() =>
		db.exec(
			`INSERT INTO produk_mutasi (id,cabang_id,produk_id,delta_jumlah,stok_setelah,sumber,referensi_id)
			 VALUES ('pm-last-b','samarinda','ledger-product',-1,0,'pos','last-b')`
		),
	/PRODUCT_STOCK_MISMATCH/,
	'next contender must fail specifically on stock balance guard'
);
assert.equal(db.prepare("SELECT stok FROM produk WHERE id='ledger-product'").get()?.stok, 0);

{
	const before = playBefore('0046_bahan_mutasi_fk_bahan.sql');
	before.exec(
		"INSERT INTO bahan(id,cabang_id,nama,satuan) VALUES ('fk-bahan','samarinda','Fixture','gram'); INSERT INTO bahan_mutasi(id,cabang_id,bahan_id,delta_jumlah,stok_setelah,sumber,catatan,operation_key,request_fingerprint) VALUES ('fk-history','samarinda','fk-bahan',2,2,'manual','preserve','key','fingerprint')"
	);
	const rows = plain(before.prepare('SELECT * FROM bahan_mutasi ORDER BY id').all());
	const triggers = plain(
		before
			.prepare(
				"SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='bahan_mutasi' ORDER BY name"
			)
			.all()
	);
	for (const statement of statementsOf('0046_bahan_mutasi_fk_bahan.sql')) before.exec(statement);
	assert.deepEqual(plain(before.prepare('SELECT * FROM bahan_mutasi ORDER BY id').all()), rows);
	assert.deepEqual(
		plain(
			before
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='bahan_mutasi' ORDER BY name"
				)
				.all()
		),
		triggers.map((row: { name: string }) => ({ name: row.name }))
	);
	assert.throws(
		() =>
			before.exec(
				"INSERT INTO bahan_mutasi(id,cabang_id,bahan_id,delta_jumlah) VALUES ('fk-other','balikpapan','fk-bahan',1)"
			),
		/FOREIGN KEY constraint failed/
	);
	const rollback = readFileSync(resolve('scripts/rollback-0046-bahan-mutasi-fk.sql'), 'utf8')
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const statement of rollback) before.exec(statement);
	assert.deepEqual(plain(before.prepare('SELECT * FROM bahan_mutasi ORDER BY id').all()), rows);
	assert.equal(before.prepare('PRAGMA foreign_key_list(bahan_mutasi)').all().length, 0);
	assert.equal(
		before
			.prepare(
				"SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND tbl_name='bahan_mutasi'"
			)
			.get()?.n,
		triggers.length
	);
	before.close();

	const orphan = playBefore('0046_bahan_mutasi_fk_bahan.sql');
	orphan.exec(
		"INSERT INTO bahan_mutasi(id,cabang_id,bahan_id,delta_jumlah) VALUES ('legacy-orphan','samarinda','missing',1)"
	);
	const original = plain(orphan.prepare('SELECT * FROM bahan_mutasi').all());
	orphan.exec('BEGIN');
	assert.throws(() => {
		for (const statement of statementsOf('0046_bahan_mutasi_fk_bahan.sql')) orphan.exec(statement);
	}, /CHECK constraint failed/);
	orphan.exec('ROLLBACK');
	assert.deepEqual(plain(orphan.prepare('SELECT * FROM bahan_mutasi').all()), original);
	assert.equal(orphan.prepare('PRAGMA foreign_key_list(bahan_mutasi)').all().length, 0);
	orphan.close();
}

const bahanForeignKeys = db.prepare('PRAGMA foreign_key_list(bahan_mutasi)').all();
assert.equal(
	bahanForeignKeys.length,
	2,
	'bahan_mutasi must reference bahan within the same branch'
);
assert.throws(
	() =>
		db.exec(
			"INSERT INTO bahan_mutasi(id,cabang_id,bahan_id,delta_jumlah) VALUES ('fk-orphan','samarinda','missing-bahan',1)"
		),
	/FOREIGN KEY constraint failed/
);
assert.throws(
	() => db.exec("DELETE FROM bahan WHERE id='upgrade-purchase-bahan' AND cabang_id='berau'"),
	/FOREIGN KEY constraint failed/
);
assert.equal(
	db.prepare("SELECT count(*) AS n FROM bahan_mutasi WHERE id='upgrade-purchase-ledger'").get()?.n,
	1
);

const reviewTriggers = (
	db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='offline_stock_reviews'"
		)
		.all() as Array<{ name: string }>
).map((row) => row.name);
assert.ok(
	reviewTriggers.includes('trg_offline_stock_review_transition_guard'),
	'offline reviews must have transition guard'
);

assert.equal(
	tables.includes('stock_feature_rollout'),
	false,
	'gate pilot stock_feature_rollout dihapus oleh migrasi 0047'
);

db.exec(`INSERT INTO offline_stock_reviews (
	cabang_id, idempotency_key, request_fingerprint, queued_at,
	policy_revision_at_queue, current_policy_revision, revision, status
) VALUES ('samarinda', 'matrix-review', 'matrix-fp', 1, 0, 1, 0, 'pending')`);
assert.throws(
	() =>
		db.exec(`UPDATE offline_stock_reviews SET status = 'consumed', revision = revision + 1, consumed_at = '2026-09-24'
			WHERE cabang_id = 'samarinda' AND idempotency_key = 'matrix-review'`),
	/INVALID_OFFLINE_STOCK_REVIEW_TRANSITION/
);

console.log(
	`migration-matrix-tests: Verified ${files.length}/${files.length} migrations against journal & manifest + Real SQLite PRAGMA quick_check: ok (100% integrity)`
);
