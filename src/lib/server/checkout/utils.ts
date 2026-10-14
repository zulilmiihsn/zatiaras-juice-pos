// Pertahankan import existing checkout; policy angka murni kanonik berada di currency.
export { normalizeMoney, normalizeCost, roundMoney } from '$lib/utils/currency';

/** Error domain checkout/quote yang membawa status HTTP; route memetakannya ke respons. */
export class CheckoutDomainError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'CheckoutDomainError';
		this.status = status;
	}
}

export const IN_QUERY_CHUNK_SIZE = 80;
export const CHECKOUT_WINDOW_MS = 60 * 1000;
export const CHECKOUT_MAX_PER_WINDOW = 30;
export const CHECKOUT_MAX_LINE_ITEMS = 100;

/**
 * Batas umur replay offline. `queued_at` berasal dari perangkat, jadi tanpa batas
 * bawah token harga katalog (TTL 1 hari) bisa dipakai ulang selamanya dengan
 * `queued_at` yang dimundurkan. Replay lebih tua dari ini ditahan untuk pemilik.
 */
export const OFFLINE_REPLAY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Toleransi jam perangkat terhadap waktu buka/tutup sesi (keduanya juga jam perangkat). */
export const OFFLINE_REPLAY_CLOCK_SKEW_MS = 15 * 60 * 1000;

export function checkoutItemCountError(items: unknown): string | null {
	if (!Array.isArray(items) || items.length === 0) return 'Item transaksi kosong';
	if (items.length > CHECKOUT_MAX_LINE_ITEMS) {
		return `Maksimal ${CHECKOUT_MAX_LINE_ITEMS} jenis item dalam satu transaksi`;
	}
	return null;
}

export function normalizePaymentMethod(value: unknown): 'tunai' | 'non-tunai' {
	if (value === 'qris' || value === 'non-tunai') return 'non-tunai';
	if (value === 'tunai') return 'tunai';
	throw new CheckoutDomainError(400, 'Metode pembayaran tidak valid');
}

/** One limit per item option: receipt snapshot and transaksi_kasir row must store identical text. */
export const ITEM_OPTION_LIMITS = { gula: 24, es: 24, catatan: 160 } as const;

export function sanitizeShortText(value: unknown, maxLength: number): string | null {
	const text = String(value ?? '').trim();
	if (!text) return null;
	return text.slice(0, maxLength);
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

export function assertActive(row: { is_active: number | boolean | null }, label: string) {
	if (row.is_active === false || row.is_active === 0) {
		throw new CheckoutDomainError(409, `${label} tidak aktif`);
	}
}

export function summarizeD1Meta(results: unknown): string | null {
	if (!Array.isArray(results)) return null;

	const summary = {
		statements: results.length,
		rows_read: 0,
		rows_written: 0,
		changes: 0,
		duration_ms: 0
	};
	let hasMeta = false;

	for (const result of results) {
		if (!result || typeof result !== 'object') continue;
		const meta = (result as { meta?: Record<string, unknown> }).meta;
		if (!meta || typeof meta !== 'object') continue;
		hasMeta = true;
		summary.rows_read += Number(meta.rows_read ?? meta.rowsRead ?? 0) || 0;
		summary.rows_written += Number(meta.rows_written ?? meta.rowsWritten ?? 0) || 0;
		summary.changes += Number(meta.changes ?? 0) || 0;
		summary.duration_ms += Number(meta.duration ?? meta.duration_ms ?? 0) || 0;
	}

	if (!hasMeta) return null;
	summary.duration_ms = Math.round(summary.duration_ms * 100) / 100;
	return JSON.stringify(summary);
}
