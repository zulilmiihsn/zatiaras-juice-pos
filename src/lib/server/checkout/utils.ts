import { error as kitError } from '@sveltejs/kit';

export const IN_QUERY_CHUNK_SIZE = 80;
export const CHECKOUT_WINDOW_MS = 60 * 1000;
export const CHECKOUT_MAX_PER_WINDOW = 30;
export const CHECKOUT_MAX_LINE_ITEMS = 100;

export function checkoutItemCountError(items: unknown): string | null {
	if (!Array.isArray(items) || items.length === 0) return 'Item transaksi kosong';
	if (items.length > CHECKOUT_MAX_LINE_ITEMS) {
		return `Maksimal ${CHECKOUT_MAX_LINE_ITEMS} jenis item dalam satu transaksi`;
	}
	return null;
}

export function normalizeMoney(value: unknown): number {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount < 0) return 0;
	return Math.round(amount);
}

export function normalizeCost(value: unknown): number {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount < 0) return 0;
	return Math.round(amount * 10000) / 10000;
}

export function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

export function normalizePaymentMethod(value: unknown): 'tunai' | 'non-tunai' {
	if (value === 'qris' || value === 'non-tunai') return 'non-tunai';
	if (value === 'tunai') return 'tunai';
	throw kitError(400, 'Metode pembayaran tidak valid');
}

export function sanitizeShortText(value: unknown, maxLength: number): string | null {
	const text = String(value ?? '').trim();
	if (!text) return null;
	return text.slice(0, maxLength);
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function getWitaSalesDate(value: string): string {
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Makassar',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(value));
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
		throw kitError(409, `${label} tidak aktif`);
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
	summary.duration_ms = roundMoney(summary.duration_ms);
	return JSON.stringify(summary);
}
