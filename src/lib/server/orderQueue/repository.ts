import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from '$lib/server/branchResolver';
import { addDaysYmd, formatDateYmdWita, witaToUtcRange } from '$lib/utils/dateTime';
import type { OrderQueueCursor, OrderQueueItemDetail, PreparationState } from './types';

/**
 * Tab Selesai hanya menampilkan 7 hari WITA terakhir agar daftar tak
 * menumpuk. Tab Belum selesai TANPA batas tanggal: pesanan menginap wajib
 * tetap terlihat sampai diselesaikan. Data lama tetap utuh di database.
 */
export const DONE_WINDOW_DAYS = 7;

export function doneWindowCutoff(now: Date = new Date()): string {
	const startDay = addDaysYmd(formatDateYmdWita(now), -(DONE_WINDOW_DAYS - 1));
	return witaToUtcRange(startDay).startUtc;
}

export interface OrderHeaderRow {
	id: string;
	transaction_id: string;
	idempotency_key: string;
	nama_pelanggan: string | null;
	waktu: string;
	metode_bayar: string | null;
	nominal: number;
	jumlah: number;
	nomor_harian: number | null;
	tanggal_nomor: string | null;
	preparation_state: PreparationState | null;
	preparation_revision: number;
	preparation_completed_at: string | null;
	preparation_completed_by: string | null;
	revision: number;
}

interface DetailRow {
	id: string;
	buku_kas_id: string;
	produk_id: string | null;
	nama_kustom: string | null;
	jumlah: number;
	nominal: number;
	harga: number | null;
	nama_produk: string | null;
	snapshot_tambahan: string | null;
	gula: string | null;
	es: string | null;
	catatan: string | null;
}

export function encodeCursor(cursor: OrderQueueCursor): string {
	return Buffer.from(JSON.stringify({ s: cursor.sortValue, i: cursor.id })).toString('base64url');
}

export function decodeCursor(raw: string): OrderQueueCursor {
	const parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8')) as {
		s?: unknown;
		i?: unknown;
	};
	if (typeof parsed.s !== 'string' || !parsed.s || typeof parsed.i !== 'string' || !parsed.i) {
		throw new Error('Cursor antrean tidak valid');
	}
	return { sortValue: parsed.s, id: parsed.i };
}

export async function getHeaderByIdempotency(
	db: D1Database,
	branch: BranchId,
	idempotencyKey: string
): Promise<OrderHeaderRow | null> {
	return (await db
		.prepare(
			`SELECT id, transaction_id, idempotency_key, nama_pelanggan, waktu, metode_bayar,
				nominal, jumlah, nomor_harian, tanggal_nomor, preparation_state, preparation_revision,
				preparation_completed_at, preparation_completed_by, revision
			 FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND idempotency_key = ?
			 LIMIT 1`
		)
		.bind(branch, idempotencyKey)
		.first()) as OrderHeaderRow | null;
}

export async function countPendingOrders(db: D1Database, branch: BranchId): Promise<number> {
	const row = (await db
		.prepare(
			`SELECT COUNT(*) AS n FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending'`
		)
		.bind(branch)
		.first()) as { n?: number } | null;
	return Number(row?.n ?? 0);
}

export async function countPendingOrdersBefore(
	db: D1Database,
	branch: BranchId,
	cutoff: string
): Promise<number> {
	const row = (await db
		.prepare(
			`SELECT COUNT(*) AS n FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending' AND waktu < ?`
		)
		.bind(branch, cutoff)
		.first()) as { n?: number } | null;
	return Number(row?.n ?? 0);
}

export async function listHeaders(
	db: D1Database,
	branch: BranchId,
	state: PreparationState,
	limit: number,
	cursor: OrderQueueCursor | null
): Promise<OrderHeaderRow[]> {
	if (state === 'pending') {
		const { results = [] } = (await db
			.prepare(
				`SELECT id, transaction_id, idempotency_key, nama_pelanggan, waktu, metode_bayar,
					nominal, jumlah, nomor_harian, tanggal_nomor, preparation_state, preparation_revision,
					preparation_completed_at, preparation_completed_by, revision
				 FROM buku_kas
				 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'pending'
				 ${cursor ? 'AND (waktu > ? OR (waktu = ? AND id > ?))' : ''}
				 ORDER BY waktu ASC, id ASC
				 LIMIT ?`
			)
			.bind(branch, ...(cursor ? [cursor.sortValue, cursor.sortValue, cursor.id] : []), limit)
			.all()) as { results?: OrderHeaderRow[] };
		return results;
	}
	const cutoff = doneWindowCutoff();
	const { results = [] } = (await db
		.prepare(
			`SELECT id, transaction_id, idempotency_key, nama_pelanggan, waktu, metode_bayar,
				nominal, jumlah, nomor_harian, tanggal_nomor, preparation_state, preparation_revision,
				preparation_completed_at, preparation_completed_by, revision
			 FROM buku_kas
			 WHERE cabang_id = ? AND sumber = 'pos' AND preparation_state = 'done'
			 AND preparation_completed_at >= ?
			 ${cursor ? 'AND (preparation_completed_at < ? OR (preparation_completed_at = ? AND id < ?))' : ''}
			 ORDER BY preparation_completed_at DESC, id DESC
			 LIMIT ?`
		)
		.bind(branch, cutoff, ...(cursor ? [cursor.sortValue, cursor.sortValue, cursor.id] : []), limit)
		.all()) as { results?: OrderHeaderRow[] };
	return results;
}

function parseAddOns(raw: string | null): Array<{ id: string; nama: string; harga: number }> {
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(item): item is Record<string, unknown> =>
					!!item && typeof item === 'object' && !Array.isArray(item)
			)
			.map((item) => ({
				id: String(item.id ?? ''),
				nama: String(item.nama ?? ''),
				harga: Number(item.harga ?? 0)
			}))
			.filter((item) => item.id && item.nama);
	} catch {
		return [];
	}
}

export function toDetail(row: DetailRow): OrderQueueItemDetail {
	return {
		id: String(row.id),
		produk_id: row.produk_id ? String(row.produk_id) : null,
		nama: String(row.nama_produk || row.nama_kustom || 'Item'),
		jumlah: Number(row.jumlah || 0),
		harga: Number(row.harga ?? 0),
		nominal: Number(row.nominal || 0),
		gula: row.gula ? String(row.gula) : null,
		es: row.es ? String(row.es) : null,
		catatan: row.catatan ? String(row.catatan) : null,
		tambahan: parseAddOns(row.snapshot_tambahan)
	};
}

export async function listDetailsByBukuKasIds(
	db: D1Database,
	branch: BranchId,
	bukuKasIds: string[]
): Promise<Map<string, OrderQueueItemDetail[]>> {
	const grouped = new Map<string, OrderQueueItemDetail[]>();
	if (!bukuKasIds.length) return grouped;
	const chunkSize = 50;
	for (let i = 0; i < bukuKasIds.length; i += chunkSize) {
		const chunk = bukuKasIds.slice(i, i + chunkSize);
		const placeholders = chunk.map(() => '?').join(',');
		const { results = [] } = (await db
			.prepare(
				`SELECT id, buku_kas_id, produk_id, nama_kustom, jumlah, nominal, harga,
					nama_produk, snapshot_tambahan, gula, es, catatan
				 FROM transaksi_kasir
				 WHERE cabang_id = ? AND buku_kas_id IN (${placeholders})
				 ORDER BY created_at ASC, id ASC`
			)
			.bind(branch, ...chunk)
			.all()) as { results?: DetailRow[] };
		for (const row of results) {
			const key = String(row.buku_kas_id);
			const list = grouped.get(key) ?? [];
			list.push(toDetail(row));
			grouped.set(key, list);
		}
	}
	return grouped;
}

export function singleChange(result: unknown): number {
	const r = result as { changes?: number; meta?: { changes?: number } } | null;
	if (!r || typeof r !== 'object') return 0;
	if (typeof r.changes === 'number') return r.changes;
	return typeof r.meta?.changes === 'number' ? r.meta.changes : 0;
}
