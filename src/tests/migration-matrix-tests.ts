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
	const content = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
	const statements = content
		.split('--> statement-breakpoint')
		.map((s) => s.trim())
		.filter(Boolean);

	for (const stmt of statements) {
		db.exec(stmt);
	}
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
	'stock_feature_rollout'
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
assert.equal(stockPolicyTriggers.length, 5, 'stock policy must have guard and history triggers');

const bukuKasColumns = (
	db.prepare('PRAGMA table_info(buku_kas);').all() as Array<{ name: string }>
).map((column) => column.name);
for (const column of [
	'stock_policy_mode',
	'stock_policy_revision',
	'stock_replay_disposition',
	'restored_from_archive'
]) {
	assert.ok(bukuKasColumns.includes(column), `buku_kas must contain ${column}`);
}

db.exec(`
	INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok) VALUES
		('ledger-product', 'samarinda', 'Ledger Product', 10000, 1, 1),
		('ledger-product-2', 'samarinda', 'Ledger Product 2', 10000, 3, 1),
		('other-product', 'samarinda2', 'Other Product', 10000, 5, 1);
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
		) VALUES ('missing-policy', 'samarinda2', '2026-09-24', 'pos', 'in',
			'pendapatan_usaha', 1, 'missing-policy', NULL, NULL)`),
	/STOCK_POLICY_CONFLICT/
);

db.exec(`INSERT INTO stock_policy (
	cabang_id, mode, revision, disabled_at, updated_at, updated_by, updated_by_role
) VALUES ('samarinda2', 'ignored', 1, '2026-09-24', '2026-09-24', 'owner', 'pemilik')`);
assert.throws(
	() =>
		db.exec(`INSERT INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
			stock_policy_mode, stock_policy_revision
		) VALUES ('stale-policy', 'samarinda2', '2026-09-24', 'pos', 'in',
			'pendapatan_usaha', 1, 'stale-policy', 'tracked', 0)`),
	/STOCK_POLICY_CONFLICT/
);
db.exec(`INSERT INTO buku_kas (
	id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id,
	stock_policy_mode, stock_policy_revision, restored_from_archive
) VALUES ('restored-policy', 'samarinda2', '2026-09-24', 'pos', 'in',
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

const contenders = [
	`INSERT INTO produk_mutasi (id,cabang_id,produk_id,delta_jumlah,stok_setelah,sumber,referensi_id)
	 VALUES ('pm-last-a','samarinda','ledger-product',-1,0,'pos','last-a')`,
	`INSERT INTO produk_mutasi (id,cabang_id,produk_id,delta_jumlah,stok_setelah,sumber,referensi_id)
	 VALUES ('pm-last-b','samarinda','ledger-product',-1,0,'pos','last-b')`
];
let contenderSuccess = 0;
for (const statement of contenders) {
	try {
		db.exec(statement);
		contenderSuccess += 1;
	} catch {}
}
assert.equal(contenderSuccess, 1, 'only one contender may consume last tracked stock');
assert.equal(db.prepare("SELECT stok FROM produk WHERE id='ledger-product'").get()?.stok, 0);

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

const rolloutSeed = db
	.prepare("SELECT branches FROM stock_feature_rollout WHERE feature = 'stock_monitoring'")
	.get() as { branches?: string } | undefined;
assert.equal(rolloutSeed?.branches, '', 'rollout starts closed for every branch');

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
