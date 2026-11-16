import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '../branchResolver';
import { productKey } from './mapping';

/**
 * Peta nama menu (ternormalisasi) ke id produk aktif di cabang. Nama yang dipakai dua produk
 * aktif diberi null: ambigu = tidak boleh dipilih diam-diam.
 */
export async function loadProductIdsByName(
	db: D1Database,
	branch: BranchContext
): Promise<Map<string, string | null>> {
	const { results } = await db
		.prepare(`SELECT id, nama FROM produk WHERE cabang_id = ? AND is_active = 1`)
		.bind(branch)
		.all<{ id: string; nama: string }>();
	const byName = new Map<string, string | null>();
	for (const row of results ?? []) {
		const key = productKey(String(row.nama));
		byName.set(key, byName.has(key) ? null : String(row.id));
	}
	return byName;
}

const MAX_KEYS = 90;

/** Subset idempotency key yang sudah menjadi penjualan POS di cabang ini. */
export async function findCommittedKeys(
	db: D1Database,
	branch: BranchContext,
	keys: string[]
): Promise<Set<string>> {
	const unique = [...new Set(keys)].slice(0, MAX_KEYS);
	if (unique.length === 0) return new Set();
	const marks = unique.map(() => '?').join(',');
	const { results } = await db
		.prepare(
			`SELECT idempotency_key FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND idempotency_key IN (${marks})`
		)
		.bind(branch, ...unique)
		.all<{ idempotency_key: string }>();
	return new Set((results ?? []).map((row) => String(row.idempotency_key)));
}
