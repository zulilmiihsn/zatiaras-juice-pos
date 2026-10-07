#!/usr/bin/env node
/**
 * Hapus riwayat transaksi pra-operasional per cabang (Samarinda/Balikpapan/Berau).
 *
 * BUKAN migrasi, BUKAN void: membersihkan data uji agar operasional mulai
 * dari nol. Wajib backup dulu (rollback = restore dari backup).
 *
 * Yang dihapus (per cabang): transaksi_kasir, produk_mutasi, bahan_mutasi,
 * buku_kas, ringkasan harian/arsip, void markers, counter nomor harian,
 * sesi toko, review/rekonsiliasi offline, transisi policy.
 * Yang DIPERTAHANKAN: katalog (produk/bahan/kategori/tambahan/resep),
 * pengaturan, profil, policy aktif, audit/logs, state migrasi.
 * Wajib follow-up manual: hitung fisik stok + rekonsiliasi finalisasi
 * (level stok tidak bisa direkonstruksi otomatis dari mutasi yang dihapus).
 *
 * Rel keamanan:
 * - Default DRY-RUN: hanya hitung + tampilkan, tanpa menghapus.
 * - --apply wajib --confirm <branch> yang sama persis.
 * - --backup-manifest wajib menunjuk manifest backup yang memuat cabang itu.
 * - Berhenti bila archive_jobs berisi (arsip ditangani deliberatif).
 *
 * Contoh:
 *   node scripts/wipe-branch-history.mjs --branch samarinda --backup-manifest <manifest>
 *   node scripts/wipe-branch-history.mjs --branch samarinda --backup-manifest <manifest> --apply --confirm samarinda
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyManifest } from './d1-backup.mjs';

export const CONFIG_FILE = 'wrangler.pages.jsonc';
export const BRANCH_BINDINGS = Object.freeze({
	samarinda: 'DB_SAMARINDA_GROUP',
	balikpapan: 'DB_BALIKPAPAN_GROUP',
	berau: 'DB_BERAU_GROUP'
});

// Anak dulu, induk kemudian (FK implisit + verifikasi nol).
export const WIPE_TABLES = Object.freeze([
	'transaksi_kasir',
	'produk_mutasi',
	'bahan_mutasi',
	'buku_kas',
	'ringkasan_penjualan_harian',
	'penjualan_produk_harian',
	'ringkasan_kas_arsip_harian',
	'archive_job_items',
	'pos_void_markers',
	'pos_nomor_harian',
	'sesi_toko',
	'offline_stock_reviews',
	'stock_reconciliation_items',
	'stock_reconciliations',
	'stock_policy_transitions'
]);

// Arsip tidak pernah dihapus script ini; bila ada isi, wipe dibatalkan total.
export const ARCHIVE_GUARD_TABLES = Object.freeze(['archive_jobs', 'archive_job_items']);

export function parseArgs(argv) {
	const args = { branch: null, backupManifest: null, apply: false, confirm: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--branch') args.branch = argv[++i];
		else if (arg === '--backup-manifest') args.backupManifest = argv[++i];
		else if (arg === '--apply') args.apply = true;
		else if (arg === '--confirm') args.confirm = argv[++i];
		else throw new Error(`Argumen tidak diizinkan: ${arg}`);
	}
	if (!args.branch || !BRANCH_BINDINGS[args.branch]) {
		throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	}
	if (!args.backupManifest) throw new Error('--backup-manifest wajib diisi');
	if (args.apply && args.confirm !== args.branch) {
		throw new Error('--apply wajib disertai --confirm <branch> yang sama persis');
	}
	return args;
}

/**
 * Manifest backup HARUS nyata dan terverifikasi penuh (AUD-044):
 * satu verifier kanonik `verifyManifest` dari d1-backup.mjs —
 * path absolut di luar repo/workspace (tolak traversal/symlink),
 * schema + tepat 3 shard + id database produksi + readback SHA per file —
 * ditambah penanda COMPLETE dan cakupan binding cabang target.
 * Manifest palsu/parsial/rusak DITOLAK sebelum DELETE pertama.
 */
export async function assertBackupCoversBranch(manifestPath, branch) {
	const binding = BRANCH_BINDINGS[branch];
	if (!binding) throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	const { manifestPath: canonical } = await verifyManifest(manifestPath, {});
	if (!existsSync(join(dirname(canonical), 'COMPLETE')))
		throw new Error('Backup belum COMPLETE: verifikasi + penanda COMPLETE wajib sebelum wipe.');
	const manifest = JSON.parse(readFileSync(canonical, 'utf8'));
	const covered = (manifest.shards ?? []).some((s) => s.binding === binding);
	if (!covered) throw new Error(`Manifest tidak memuat ${binding}. Backup dulu cabang ${branch}.`);
	return { manifestPath: canonical, binding };
}

export function countSql(table, branch) {
	return { sql: `SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id = ?`, params: [branch] };
}

export function deleteSql(table, branch) {
	return { sql: `DELETE FROM ${table} WHERE cabang_id = ?`, params: [branch] };
}

/**
 * Satu operasi hapus atomik bounded per cabang (AUD-045): 15 DELETE anak-dulu
 * + guard nol per tabel dalam SATU transaksi. Gagal statement tengah/akhir
 * = seluruh batch rollback, tanpa state parsial. Semua statement ter-scope
 * cabang_id — sibling dalam shard sama tak tersentuh.
 */
export function buildWipeSql(branch) {
	if (!BRANCH_BINDINGS[branch])
		throw new Error('--branch wajib salah satu: samarinda, balikpapan, berau');
	const safe = branch.replace(/'/g, "''");
	const lines = ['-- ZatiarasPOS Wipe Branch History (atomic)', 'BEGIN TRANSACTION;'];
	for (const table of WIPE_TABLES) {
		lines.push(`DELETE FROM ${table} WHERE cabang_id = '${safe}';`);
		lines.push(
			`SELECT CASE WHEN ((SELECT COUNT(*) FROM ${table} WHERE cabang_id = '${safe}') = 0) THEN 1 ELSE json('WIPE_REMAIN:${table}') END;`
		);
	}
	lines.push('COMMIT;');
	return {
		sql: lines.join('\n'),
		statements: lines.slice(1, -1),
		branch,
		tables: [...WIPE_TABLES]
	};
}

/** Tulis SQL ke file sementara lalu eksekusi satu --file (satu transaksi D1). */
function applySqlFile(binding, sqlText) {
	const tempFile = join(tmpdir(), `wipe-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sql`);
	writeFileSync(tempFile, sqlText, 'utf8');
	try {
		const result = spawnSync(
			'npx',
			[
				'wrangler',
				'd1',
				'execute',
				binding,
				'--remote',
				'--config',
				CONFIG_FILE,
				`--file=${tempFile}`,
				'--yes'
			],
			{ encoding: 'utf8', stdio: 'pipe' }
		);
		if (result.status !== 0) {
			throw new Error(`wipe apply gagal: ${(result.stderr || result.stdout || '').slice(0, 500)}`);
		}
	} finally {
		try {
			unlinkSync(tempFile);
		} catch {
			// best-effort: file tmp tanpa secret; kegagalan hapus dilaporkan non-fatal.
		}
	}
}

function wranglerExecute(binding, sql, params) {
	const quoted = params.map((p) => `'${String(p).replace(/'/g, "''")}'`);
	let finalSql = sql;
	for (const q of quoted) finalSql = finalSql.replace('?', q);
	const result = spawnSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			binding,
			'--remote',
			'--config',
			CONFIG_FILE,
			'--command',
			finalSql,
			'--json'
		],
		{ encoding: 'utf8', stdio: 'pipe' }
	);
	if (result.status !== 0) {
		throw new Error(`wrangler gagal: ${(result.stderr || result.stdout || '').slice(0, 500)}`);
	}
	const parsed = JSON.parse(result.stdout);
	const first = parsed?.[0]?.results?.[0] ?? null;
	return first;
}

export async function wipeBranchHistory(
	{ branch, backupManifest, apply },
	execute = wranglerExecute,
	applyFile = applySqlFile
) {
	const { binding } = await assertBackupCoversBranch(backupManifest, branch);
	// Fase 1: hitung semua + guard arsip SEBELUM menghapus apa pun.
	const counts = new Map();
	for (const table of [...ARCHIVE_GUARD_TABLES, ...WIPE_TABLES]) {
		if (counts.has(table)) continue;
		counts.set(table, Number(execute(binding, countSql(table, branch).sql, [branch])?.n ?? 0));
	}
	for (const table of ARCHIVE_GUARD_TABLES) {
		if ((counts.get(table) ?? 0) > 0) {
			throw new Error(
				`${table} berisi ${counts.get(table)} baris: arsip harus ditangani deliberatif dulu. Hentikan wipe.`
			);
		}
	}
	// Fase 2: satu transaksi atomik (bukan 15 remote call). Gagal di tengah
	// = rollback utuh; verifikasi nol sudah di dalam transaksi via guard.
	const report = [];
	if (apply) {
		applyFile(binding, buildWipeSql(branch).sql);
		for (const table of WIPE_TABLES) {
			const after = Number(execute(binding, countSql(table, branch).sql, [branch])?.n ?? 0);
			report.push({ table, before: counts.get(table) ?? 0, after });
		}
		const remain = report.filter((r) => r.after !== 0);
		if (remain.length > 0)
			throw new Error(
				`Wipe tak konsisten: ${remain.map((r) => `${r.table}:${r.after}`).join(', ')}. Pulihkan dari backup.`
			);
	} else {
		for (const table of WIPE_TABLES) {
			report.push({ table, before: counts.get(table) ?? 0, after: counts.get(table) ?? 0 });
		}
	}
	return { branch, binding, apply, report };
}

export function formatReport({ branch, apply, report }) {
	const lines = report.map((r) => `  - ${r.table}: ${r.before} -> ${r.after}`);
	return [
		`${apply ? 'WIPE' : 'DRY-RUN'} cabang ${branch}:`,
		...lines,
		apply
			? 'SELESAI. Wajib lanjutan manual: hitung fisik stok + rekonsiliasi finalisasi, verifikasi katalog, smoke checkout.'
			: 'DRY-RUN selesai tanpa menghapus. Tambahkan --apply --confirm untuk eksekusi.'
	].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	const result = await wipeBranchHistory(args);
	console.log(formatReport(result));
}

const isCli =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isCli) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
