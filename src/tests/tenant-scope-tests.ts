import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tenant-scope guard (DATA-01/04).
 * Setiap raw SQL di server yang menyentuh tabel tenant WAJIB memuat
 * predicate `cabang_id`. Pengecualian terdokumentasi di ALLOWLIST.
 */
const ROOT = process.cwd();
const SCAN_DIRS = [join(ROOT, 'src', 'lib', 'server'), join(ROOT, 'src', 'routes')];

const TENANT_TABLES = new Set([
	'buku_kas',
	'transaksi_kasir',
	'produk',
	'bahan',
	'resep_produk',
	'kategori',
	'tambahan',
	'bahan_mutasi',
	'produk_mutasi',
	'pengaturan',
	'pengaturan_hpp',
	'sesi_toko',
	'archive_jobs',
	'archive_job_items',
	'ringkasan_kas_arsip_harian',
	'ringkasan_penjualan_harian',
	'penjualan_produk_harian',
	'auth_sessions',
	'antrean_offline',
	'audit_logs',
	'audit_log_outbox',
	'audit_log_quarantine',
	'rate_limits',
	'pos_void_markers',
	'error_events',
	'request_metrics',
	'profil',
	'stock_policy',
	'stock_policy_transitions',
	'stock_reconciliations',
	'stock_reconciliation_items',
	'offline_stock_reviews'
]);

/** Pencarian id acak (UUID) tanpa cabang: aman karena tidak dapat ditebak/enumerasi. */
const ALLOWLIST: Array<{ file: string; snippet: string; reason: string }> = [
	{
		file: 'lib/server/archiveService.ts',
		snippet: 'SELECT * FROM archive_jobs WHERE id = ?',
		reason:
			'read-own-write tepat setelah INSERT job UUID milik sendiri (acquireArchiveJob); ' +
			'tidak ada enumerasi lintas tenant karena id 128-bit acak'
	}
];

function walk(dir: string): string[] {
	const out: string[] = [];
	const go = (current: string): void => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) go(full);
			else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) out.push(full);
		}
	};
	go(dir);
	return out;
}

/** Ambil isi template literal prepare(`...`) — dukung ${...} bersarang sederhana. */
function extractPrepares(text: string): string[] {
	const out = [];
	const re = /\.prepare\(`/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		let i = m.index + m[0].length;
		let depth = 0;
		let sql = '';
		while (i < text.length) {
			const ch = text[i];
			if (ch === '\\') {
				sql += ch + text[i + 1];
				i += 2;
				continue;
			}
			if (ch === '`') {
				if (depth === 0) break;
				depth--;
				sql += ch;
				i++;
				continue;
			}
			if (ch === '$' && text[i + 1] === '{') {
				// Lewati interpolasi; catat jika berisi cabang_id agar guard lolos.
				let j = i + 2;
				let braces = 1;
				let interp = '';
				while (j < text.length && braces > 0) {
					if (text[j] === '{') braces++;
					if (text[j] === '}') braces--;
					interp += text[j];
					j++;
				}
				if (interp.includes('cabang_id')) sql += ' cabang_id ';
				i = j;
				continue;
			}
			sql += ch;
			i++;
		}
		out.push(sql);
	}
	return out;
}

function tablesIn(sql: string): string[] {
	const found = new Set<string>();
	for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-z_][a-z0-9_]*)/gi)) {
		if (TENANT_TABLES.has(m[1].toLowerCase())) found.add(m[1].toLowerCase());
	}
	return [...found];
}

const violations: string[] = [];
for (const dir of SCAN_DIRS) {
	for (const file of walk(dir)) {
		const rel = file.replace(/\\/g, '/').split('src/')[1];
		const text = readFileSync(file, 'utf8');
		for (const sql of extractPrepares(text)) {
			const tables = tablesIn(sql);
			if (!tables.length) continue;
			if (/cabang_id/.test(sql)) continue;
			const short = sql.replace(/\s+/g, ' ').trim().slice(0, 120);
			const exempt = ALLOWLIST.find((a) => a.file === rel && short.includes(a.snippet));
			if (!exempt) violations.push(`${rel} :: [${tables.join(',')}] :: ${short}`);
		}
	}
}

assert.deepEqual(
	violations,
	[],
	`query tenant tanpa predicate cabang_id:\n${violations.join('\n')}`
);
console.log('tenant-scope-tests: semua raw SQL tenant ter-scope cabang_id');
process.exit(0);
