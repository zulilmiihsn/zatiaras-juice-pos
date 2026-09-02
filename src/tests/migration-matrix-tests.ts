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
	const content = readFileSync(filePath);
	const sha = createHash('sha256').update(content).digest('hex');

	assert.equal(
		sha,
		manifest[expectedFile],
		`SHA-256 for ${expectedFile} must match recorded manifest hash`
	);

	// Verify basic SQL sanity
	const sqlText = content.toString('utf8');
	assert.equal(sqlText.length > 0, true, `${expectedFile} must not be empty`);
}

// Verify latest migration 0023 defines required idempotency, receipt, and archive tables/columns
const migration0023 = readFileSync(join(MIGRATIONS_DIR, files[files.length - 1]), 'utf8');
assert.match(migration0023, /request_fingerprint/);
assert.match(migration0023, /receipt_snapshot/);
assert.match(migration0023, /ringkasan_kas_arsip_harian/);

console.log(
	`migration-matrix-tests: Verified ${files.length}/${files.length} migrations against journal and manifest (100% integrity)`
);
