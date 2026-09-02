import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const isDryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const archiveFile = argValue('--file');
const isRemote = process.argv.includes('--remote');

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
const sha256 = createHash('sha256').update(rawContent).digest('hex');

let archive;
try {
	archive = JSON.parse(rawContent);
} catch (err) {
	console.error(`Format JSON tidak valid: ${err.message}`);
	process.exit(1);
}

if (!archive || typeof archive !== 'object' || !archive.meta || !Array.isArray(archive.buku_kas)) {
	console.error('Struktur arsip tidak memenuhi spesifikasi ZatiarasPOS (missing meta / buku_kas)');
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

console.log('Integrity Check: PASSED (No duplicates, valid references)');

if (isDryRun) {
	console.log(
		'\n[DRY RUN]: Validation complete. 0 database mutations made. Pass --apply to restore.'
	);
	process.exit(0);
}

console.log('\n[RESTORE]: Generating SQL transaction statements...');

function sqlVal(val) {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
	if (typeof val === 'boolean') return val ? '1' : '0';
	return `'${String(val).replace(/'/g, "''")}'`;
}

const sqlLines = ['-- ZatiarasPOS Archive Restore Transaction', 'BEGIN TRANSACTION;'];

// 1. Remove corresponding manual archive summaries to prevent double-counting
if (archiveId && archiveId !== 'unknown') {
	sqlLines.push(
		`DELETE FROM ringkasan_kas_arsip_harian WHERE cabang_id = ${sqlVal(branch)} AND archive_id = ${sqlVal(archiveId)};`
	);
}

// 2. Insert buku_kas rows with historical-restored marking
for (const b of buku_kas) {
	const restoredDeskripsi = b.deskripsi ? `[ARSIP RESTORED] ${b.deskripsi}` : '[ARSIP RESTORED]';
	sqlLines.push(
		`INSERT OR REPLACE INTO buku_kas (
			id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, deskripsi,
			nama_pelanggan, metode_bayar, transaction_id, idempotency_key,
			request_fingerprint, receipt_snapshot, id_sesi_toko, created_at, updated_at
		) VALUES (
			${sqlVal(b.id)}, ${sqlVal(b.cabang_id || branch)}, ${sqlVal(b.waktu)},
			'arsip_restored', ${sqlVal(b.tipe)}, ${sqlVal(b.jenis)},
			${sqlVal(b.nominal)}, ${sqlVal(b.jumlah)}, ${sqlVal(restoredDeskripsi)},
			${sqlVal(b.nama_pelanggan)}, ${sqlVal(b.metode_bayar)}, ${sqlVal(b.transaction_id)},
			${sqlVal(b.idempotency_key)}, ${sqlVal(b.request_fingerprint)}, ${sqlVal(b.receipt_snapshot)},
			${sqlVal(b.id_sesi_toko)}, ${sqlVal(b.created_at)}, ${sqlVal(b.updated_at || new Date().toISOString())}
		);`
	);
}

// 3. Insert transaksi_kasir rows
for (const t of transaksi_kasir) {
	sqlLines.push(
		`INSERT OR REPLACE INTO transaksi_kasir (
			id, cabang_id, buku_kas_id, produk_id, nama_kustom, jumlah, nominal,
			harga, nama_produk, harga_dasar, total_tambahan, snapshot_tambahan,
			gula, es, catatan, snapshot_hpp, nominal_hpp, transaction_id, created_at, updated_at
		) VALUES (
			${sqlVal(t.id)}, ${sqlVal(t.cabang_id || branch)}, ${sqlVal(t.buku_kas_id)},
			${sqlVal(t.produk_id)}, ${sqlVal(t.nama_kustom)}, ${sqlVal(t.jumlah)},
			${sqlVal(t.nominal)}, ${sqlVal(t.harga)}, ${sqlVal(t.nama_produk)},
			${sqlVal(t.harga_dasar)}, ${sqlVal(t.total_tambahan || 0)}, ${sqlVal(t.snapshot_tambahan)},
			${sqlVal(t.gula)}, ${sqlVal(t.es)}, ${sqlVal(t.catatan)}, ${sqlVal(t.snapshot_hpp)},
			${sqlVal(t.nominal_hpp || 0)}, ${sqlVal(t.transaction_id)}, ${sqlVal(t.created_at)},
			${sqlVal(t.updated_at || new Date().toISOString())}
		);`
	);
}

// 4. Audit Log restore di pengaturan
sqlLines.push(
	`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
	 VALUES (${sqlVal(randomUUID())}, ${sqlVal(branch)}, ${sqlVal('archive_restore_' + archiveId)}, ${sqlVal(JSON.stringify({ restored_at: new Date().toISOString(), archive_id: archiveId, sha256 }))}, ${sqlVal(new Date().toISOString())})
	 ON CONFLICT(cabang_id, kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = excluded.updated_at;`
);

sqlLines.push('COMMIT;');

const tempSqlFile = join(tmpdir(), `restore-${archiveId.slice(0, 8)}-${Date.now()}.sql`);
writeFileSync(tempSqlFile, sqlLines.join('\n'), 'utf8');

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
