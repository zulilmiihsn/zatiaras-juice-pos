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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Manifest backup harus ada dan memuat binding cabang target. */
export function assertBackupCoversBranch(manifestPath, branch) {
	const full = resolve(manifestPath);
	if (!existsSync(full)) throw new Error(`Manifest backup tidak ditemukan: ${manifestPath}`);
	const manifest = JSON.parse(readFileSync(full, 'utf8'));
	const binding = BRANCH_BINDINGS[branch];
	const covered = (manifest.shards ?? []).some((s) => s.binding === binding);
	if (!covered) throw new Error(`Manifest tidak memuat ${binding}. Backup dulu cabang ${branch}.`);
	return { manifestPath: full, binding };
}

export function countSql(table, branch) {
	return { sql: `SELECT COUNT(*) AS n FROM ${table} WHERE cabang_id = ?`, params: [branch] };
}

export function deleteSql(table, branch) {
	return { sql: `DELETE FROM ${table} WHERE cabang_id = ?`, params: [branch] };
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
	execute = wranglerExecute
) {
	const { binding } = assertBackupCoversBranch(backupManifest, branch);
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
	// Fase 2: hapus + verifikasi nol per tabel.
	const report = [];
	for (const table of WIPE_TABLES) {
		const before = counts.get(table) ?? 0;
		let after = before;
		if (apply && before > 0) {
			execute(binding, deleteSql(table, branch).sql, [branch]);
			after = Number(execute(binding, countSql(table, branch).sql, [branch])?.n ?? 0);
			if (after !== 0) throw new Error(`Gagal mengosongkan ${table}: sisa ${after}. Hentikan.`);
		}
		report.push({ table, before, after });
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
