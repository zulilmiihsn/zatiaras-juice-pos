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
	'ringkasan_kas_arsip_harian'
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

console.log(
	`migration-matrix-tests: Verified ${files.length}/${files.length} migrations against journal & manifest + Real SQLite PRAGMA quick_check: ok (100% integrity)`
);
