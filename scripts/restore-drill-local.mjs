#!/usr/bin/env node
/**
 * Restore drill lokal — bukti dump backup dapat direstore.
 *
 * Memuat file .sql backup ke SQLite sekali-pakai (in-memory), lalu melaporkan
 * daftar tabel + row count. TIDAK menyentuh D1 remote maupun lokal proyek.
 * Untuk drill penuh ke D1 non-production, pakai d1:restore + CONFIRM_D1_RESTORE.
 *
 * Usage: node scripts/restore-drill-local.mjs --file <backup.sql>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const at = (name) => {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : null;
};

const file = at('--file');
if (!file) {
	console.error('Usage: node scripts/restore-drill-local.mjs --file <backup.sql>');
	process.exit(1);
}

const full = resolve(file);
let sql;
try {
	sql = readFileSync(full, 'utf8');
} catch {
	console.error(`Restore drill gagal: file tidak terbaca: ${file}`);
	process.exit(1);
}
if (!sql.trim()) {
	console.error('Restore drill gagal: file kosong.');
	process.exit(1);
}

const db = new DatabaseSync(':memory:');
try {
	db.exec('PRAGMA foreign_keys=OFF;');
	db.exec(sql);
} catch (error) {
	console.error(`Restore drill gagal saat apply: ${error.message}`);
	process.exit(1);
}

const tables = db
	.prepare(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	)
	.all();
if (!tables.length) {
	console.error('Restore drill gagal: tidak ada tabel hasil restore.');
	process.exit(1);
}

let total = 0;
for (const { name } of tables) {
	const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get();
	const n = Number(row?.n || 0);
	total += n;
	console.log(`- ${name}: ${n} rows`);
}
console.log(`PASS restore drill lokal: ${tables.length} tabel, ${total} rows dari ${file}`);
process.exit(0);
