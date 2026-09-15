import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	parseRestoreArgs,
	sha256Hex,
	validateArchive,
	buildRestoreSql,
	diffAgainstExisting,
	BK_FIELDS,
	TK_FIELDS
} from './restore-archive-lib.mjs';

/** Query baca target via wrangler (bentuk eksekusi D1 proyek). Gagal -> null. */
function queryTarget(sql) {
	const out = spawnSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			resolvedBinding,
			isRemote ? '--remote' : '--local',
			'--config=wrangler.pages.jsonc',
			`--command=${sql}`,
			'--json',
			'--yes'
		],
		{ stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' }
	);
	if (out.status !== 0) return null;
	try {
		const parsed = JSON.parse(out.stdout);
		const first = Array.isArray(parsed) ? parsed[0] : parsed;
		return first?.results ?? null;
	} catch {
		return null;
	}
}

function chunked(rows, size) {
	const out = [];
	for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
	return out;
}

function witaDate(waktu) {
	try {
		return new Date(new Date(waktu).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
	} catch {
		return String(waktu || '').slice(0, 10);
	}
}

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

console.log('\n[RESTORE]: Preflight target (konflik + agregat POS)...');

const existingBk = new Map();
const existingTk = new Map();
for (const chunk of chunked(buku_kas, 50)) {
	const ids = chunk.map((r) => `'${String(r.id).replace(/'/g, "''")}'`).join(',');
	const rows = queryTarget(
		`SELECT id, cabang_id, waktu, sumber, tipe, jenis, nominal, transaction_id FROM buku_kas WHERE id IN (${ids})`
	);
	if (!rows) {
		console.error('Preflight gagal membaca target buku_kas. Hentikan apply.');
		process.exit(1);
	}
	for (const r of rows) existingBk.set(String(r.id), r);
}
for (const chunk of chunked(transaksi_kasir, 50)) {
	const ids = chunk.map((r) => `'${String(r.id).replace(/'/g, "''")}'`).join(',');
	const rows = queryTarget(
		`SELECT id, cabang_id, buku_kas_id, jumlah, nominal, transaction_id FROM transaksi_kasir WHERE id IN (${ids})`
	);
	if (!rows) {
		console.error('Preflight gagal membaca target transaksi_kasir. Hentikan apply.');
		process.exit(1);
	}
	for (const r of rows) existingTk.set(String(r.id), r);
}

const bkDiff = diffAgainstExisting(buku_kas, existingBk, BK_FIELDS);
const tkDiff = diffAgainstExisting(transaksi_kasir, existingTk, TK_FIELDS);
if (bkDiff.conflict.length > 0 || tkDiff.conflict.length > 0) {
	console.error(
		`CONFLICT: ${bkDiff.conflict.length} buku_kas + ${tkDiff.conflict.length} transaksi_kasir memiliki ID sama dengan data berbeda. Apply dihentikan; tidak ada row ditimpa.`
	);
	for (const c of [...bkDiff.conflict, ...tkDiff.conflict].slice(0, 10))
		console.error(` - ${c.id}`);
	process.exit(1);
}
console.log(
	`Preflight konflik: ${bkDiff.skip.length} identik dilewati, ${bkDiff.insert.length + tkDiff.insert.length} baru akan dimasukkan.`
);

// Preflight agregat nyata: snapshot POS butuh agregat harian target, bila hilang hentikan.
const posDates = [
	...new Set(buku_kas.filter((r) => String(r.sumber || '') === 'pos').map((r) => witaDate(r.waktu)))
].filter(Boolean);
if (posDates.length > 0) {
	const inList = posDates.map((d) => `'${d}'`).join(',');
	const aggRows = queryTarget(
		`SELECT tanggal_penjualan FROM ringkasan_penjualan_harian WHERE cabang_id = '${branch.replace(/'/g, "''")}' AND tanggal_penjualan IN (${inList})`
	);
	if (!aggRows) {
		console.error('Preflight agregat gagal dibaca. Hentikan apply.');
		process.exit(1);
	}
	const have = new Set(aggRows.map((r) => String(r.tanggal_penjualan)));
	const missing = posDates.filter((d) => !have.has(d));
	if (missing.length > 0) {
		console.error(
			`Preflight agregat: target kehilangan agregat POS tanggal ${missing.slice(0, 10).join(', ')}. Hentikan apply sampai jalur rebuild teruji; laporan tak diklaim lengkap.`
		);
		process.exit(1);
	}
	console.log(`Preflight agregat: ${posDates.length} tanggal POS tercakup.`);
}

console.log('\n[RESTORE]: Generating SQL transaction statements...');

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
console.log(
	`- Dimasukkan ${bkDiff.insert.length} buku_kas + ${tkDiff.insert.length} transaksi_kasir`
);
console.log(
	`- Dilewati identik ${bkDiff.skip.length + tkDiff.skip.length} (idempoten, apply kedua no-op)`
);
console.log(`- Marker archive_restore_${built.archiveId} tercatat; sumber POS dipertahankan`);
