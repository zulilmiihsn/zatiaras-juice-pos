import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseRestoreArgs,
	sha256Hex,
	validateArchive,
	buildRestoreSql
} from './restore-archive-lib.mjs';

/**
 * Validasi dan restore data arsip JSON ZatiarasPOS (ARC-002)
 *
 * Usage:
 *   node scripts/restore-archive.mjs --file <arsip.json> [--dry-run]
 *   node scripts/restore-archive.mjs --file <arsip.json> --apply [--local|--remote] [--binding DB_SAMARINDA_GROUP]
 */

function argValue(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

const args = parseRestoreArgs(process.argv);
const isDryRun = !args.apply;
const archiveFile = args.file;
const isRemote = args.remote;

if (!archiveFile) {
	console.error(
		'Usage: node scripts/restore-archive.mjs --file <path-to-archive.json> [--dry-run|--apply] [--remote|--local] [--binding <DB_BINDING>]'
	);
	process.exit(1);
}

if (!existsSync(archiveFile)) {
	console.error(`File arsip tidak ditemukan: ${archiveFile}`);
	process.exit(1);
}

const rawContent = readFileSync(archiveFile, 'utf8');
const sha256 = sha256Hex(rawContent);

let archive;
try {
	archive = JSON.parse(rawContent);
} catch (err) {
	console.error(`Format JSON tidak valid: ${err.message}`);
	process.exit(1);
}

if (args.expectSha256 && args.expectSha256 !== sha256) {
	console.error(`CHECKSUM MISMATCH: file ${sha256} != expected ${args.expectSha256}`);
	process.exit(1);
}

const validation = validateArchive(archive);
if (!validation.ok) {
	for (const e of validation.errors) console.error(`ERROR: ${e}`);
	process.exit(1);
}

const { meta, buku_kas, transaksi_kasir = [] } = archive;
const schemaVersion = Number(meta.schema_version || 1);
if (![1, 2].includes(schemaVersion)) {
	console.error(`ERROR: Versi skema arsip tidak didukung: ${meta.schema_version} (didukung: 1, 2)`);
	process.exit(1);
}

const archiveId = meta.archive_id || meta.id || 'unknown';
const branch = meta.branch || 'samarinda';

const BRANCH_TO_BINDING = {
	samarinda: 'DB_SAMARINDA_GROUP',
	samarinda2: 'DB_SAMARINDA_GROUP',
	balikpapan: 'DB_BALIKPAPAN_GROUP',
	balikpapan2: 'DB_BALIKPAPAN_GROUP',
	berau: 'DB_BERAU_GROUP'
};
const resolvedBinding = argValue('--binding') || BRANCH_TO_BINDING[branch] || 'DB_SAMARINDA_GROUP';

console.log('=== ZatiarasPOS Archive Validation ===');
console.log(`Archive ID    : ${archiveId}`);
console.log(`Schema Version: ${schemaVersion}`);
console.log(`Branch        : ${branch}`);
console.log(`Target Binding: ${resolvedBinding}`);
console.log(`Before Year   : ${meta.before_year || 'unknown'}`);
console.log(`Cutoff WITA   : ${meta.cutoff_wita || 'unknown'}`);
console.log(`Exported At   : ${meta.exported_at || 'unknown'}`);
console.log(`SHA-256       : ${sha256}`);
console.log(`Buku Kas Rows : ${buku_kas.length} (expected: ${meta.counts?.buku_kas ?? '?'})`);
console.log(
	`Transaksi Qty : ${transaksi_kasir.length} (expected: ${meta.counts?.transaksi_kasir ?? '?'})`
);

if (meta.counts) {
	if (meta.counts.buku_kas !== buku_kas.length) {
		console.error(
			`MISMATCH: Buku kas count (${buku_kas.length}) != metadata (${meta.counts.buku_kas})`
		);
		process.exit(1);
	}
	if (transaksi_kasir && meta.counts.transaksi_kasir !== transaksi_kasir.length) {
		console.error(
			`MISMATCH: Transaksi kasir count (${transaksi_kasir.length}) != metadata (${meta.counts.transaksi_kasir})`
		);
		process.exit(1);
	}
}

// 1. Verify Unique IDs
const bkIdSet = new Set();
for (const r of buku_kas) {
	if (!r.id || bkIdSet.has(r.id)) {
		console.error(`ERROR: Duplikat atau ID tidak valid di buku_kas: ${r.id}`);
		process.exit(1);
	}
	bkIdSet.add(r.id);
}

// 2. Verify Foreign Keys
for (const t of transaksi_kasir) {
	if (t.buku_kas_id && !bkIdSet.has(t.buku_kas_id)) {
		console.error(
			`ERROR: Orphan transaksi_kasir ${t.id} references missing buku_kas ${t.buku_kas_id}`
		);
		process.exit(1);
	}
}

console.log('Integrity Check: PASSED (No duplicates, valid references, branch cocok)');

if (isDryRun) {
	console.log(
		'\n[DRY RUN]: Validation complete. 0 database mutations made. Pass --apply to restore.'
	);
	process.exit(0);
}

console.log('\n[RESTORE]: Generating SQL transaction statements...');
console.log(
	'Preflight: pastikan target masih punya agregat POS periode arsip; bila agregat hilang, hentikan dan rebuild dulu (laporan tidak diklaim lengkap).'
);

const built = buildRestoreSql(archive, { sha256 });
const sqlText = built.sql;
const sqlLines = sqlText.split('\n');

const tempSqlFile = join(tmpdir(), `restore-${built.archiveId.slice(0, 8)}-${Date.now()}.sql`);
writeFileSync(tempSqlFile, sqlText, 'utf8');

console.log(`Generated restore SQL (${sqlLines.length} statements) at: ${tempSqlFile}`);

const wranglerArgs = [
	'wrangler',
	'd1',
	'execute',
	resolvedBinding,
	isRemote ? '--remote' : '--local',
	'--config=wrangler.pages.jsonc',
	`--file=${tempSqlFile}`,
	'--yes'
];

console.log(`Executing: npx ${wranglerArgs.join(' ')}`);

const result = spawnSync('npx', wranglerArgs, {
	stdio: 'pipe',
	encoding: 'utf8',
	shell: process.platform === 'win32'
});

try {
	unlinkSync(tempSqlFile);
} catch {}

if (result.status !== 0) {
	console.error(`RESTORE EXECUTION FAILED (exit code ${result.status}):`);
	console.error(result.stderr || result.stdout);
	process.exit(1);
}

console.log('✅ RESTORE COMPLETED SUCCESSFULLY!');
console.log(`- Restored ${buku_kas.length} buku_kas rows`);
console.log(`- Restored ${transaksi_kasir.length} transaksi_kasir rows`);
console.log(`- Cleaned up archive summary markers for ${archiveId}`);
