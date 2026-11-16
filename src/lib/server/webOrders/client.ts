import {
	WebOrderError,
	type FetchLike,
	type WebOrder,
	type WebOrderItem,
	type WebOrderState,
	type WebOrdersConfig
} from './types';

const REQUEST_TIMEOUT_MS = 4000;
const MIN_TOKEN_LENGTH = 24;
export const WEB_ORDER_ID = /^ZT-[A-Z2-9]{6}$/;

/**
 * Konfigurasi sambungan ke situs pesan. Tertutup bila salah satu hilang atau URL bukan HTTPS
 * (kecuali localhost untuk pengembangan): token tidak boleh lewat jaringan tanpa enkripsi.
 */
export function readWebOrdersConfig(
	env: Record<string, unknown> | undefined
): WebOrdersConfig | null {
	const rawUrl = typeof env?.WEB_ORDERS_URL === 'string' ? env.WEB_ORDERS_URL.trim() : '';
	const token = typeof env?.WEB_ORDERS_TOKEN === 'string' ? env.WEB_ORDERS_TOKEN.trim() : '';
	if (!rawUrl || token.length < MIN_TOKEN_LENGTH) return null;
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return null;
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
	return { baseUrl: url.origin, token };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseItem(raw: unknown): WebOrderItem | null {
	if (!isRecord(raw)) return null;
	const qty = Number(raw.qty);
	const unitPrice = Number(raw.unitPrice);
	if (typeof raw.menuItemId !== 'string' || !raw.menuItemId) return null;
	if (!Number.isInteger(qty) || qty < 1 || qty > 99) return null;
	if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
	const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
		allowed.includes(value as T) ? (value as T) : undefined;
	return {
		menuItemId: raw.menuItemId,
		name: typeof raw.name === 'string' ? raw.name : undefined,
		qty,
		unitPrice,
		size: pick(raw.size, ['REG', 'JUMBO'] as const),
		sweet: pick(raw.sweet, ['NORMAL', 'LESS', 'NONE'] as const),
		ice: pick(raw.ice, ['NORMAL', 'LESS', 'NONE'] as const)
	};
}

/** Satu pesanan dari API web. Bentuk yang tidak sah dibuang, bukan ditebak. */
export function parseWebOrder(raw: unknown): WebOrder | null {
	if (!isRecord(raw)) return null;
	const { id, outletId, state, name } = raw;
	if (typeof id !== 'string' || !WEB_ORDER_ID.test(id)) return null;
	if (typeof outletId !== 'string' || typeof state !== 'string' || typeof name !== 'string') {
		return null;
	}
	const total = Number(raw.total);
	const uniqueCode = Number(raw.uniqueCode);
	const payTotal = Number(raw.payTotal);
	if (!Number.isInteger(total) || total <= 0) return null;
	if (!Number.isInteger(uniqueCode) || uniqueCode < 1 || uniqueCode > 99) return null;
	if (payTotal !== total + uniqueCode) return null;
	if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 30) return null;
	const items = raw.items.map(parseItem);
	if (items.some((item) => item === null)) return null;
	return {
		id,
		outletId,
		state,
		name,
		pickupNote: typeof raw.pickupNote === 'string' ? raw.pickupNote : null,
		note: typeof raw.note === 'string' ? raw.note : null,
		total,
		uniqueCode,
		payTotal,
		items: items as WebOrderItem[],
		createdAt: Number(raw.createdAt) || 0
	};
}

function authHeaders(config: WebOrdersConfig): Record<string, string> {
	return { authorization: `Bearer ${config.token}`, accept: 'application/json' };
}

export async function listWebOrders(
	config: WebOrdersConfig,
	outletId: string,
	fetchImpl: FetchLike = fetch
): Promise<WebOrder[]> {
	let response: Response;
	try {
		response = await fetchImpl(
			`${config.baseUrl}/api/pos/orders?outlet=${encodeURIComponent(outletId)}`,
			{ headers: authHeaders(config), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
		);
	} catch (error) {
		console.warn('[web-orders] gagal menghubungi situs pesan', error);
		throw new WebOrderError(502, 'Situs pesan tidak merespons');
	}
	if (!response.ok) throw new WebOrderError(502, 'Situs pesan menolak permintaan antrean');
	const payload: unknown = await response.json().catch(() => null);
	if (!isRecord(payload) || !Array.isArray(payload.orders)) {
		throw new WebOrderError(502, 'Respons situs pesan tidak valid');
	}
	return payload.orders.map(parseWebOrder).filter((order): order is WebOrder => order !== null);
}

/** 'illegal' = situs pesan menolak perpindahan (sudah di status itu atau tidak boleh dari status sekarang). */
export async function setWebOrderState(
	config: WebOrdersConfig,
	outletId: string,
	id: string,
	to: WebOrderState,
	fetchImpl: FetchLike = fetch
): Promise<'ok' | 'illegal' | 'not_found'> {
	if (!WEB_ORDER_ID.test(id)) throw new WebOrderError(400, 'Kode pesanan web tidak valid');
	let response: Response;
	try {
		response = await fetchImpl(`${config.baseUrl}/api/pos/orders/${id}/state`, {
			method: 'POST',
			headers: { ...authHeaders(config), 'content-type': 'application/json' },
			body: JSON.stringify({ outletId, to }),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
		});
	} catch (error) {
		console.warn('[web-orders] gagal mengubah status di situs pesan', error);
		throw new WebOrderError(502, 'Situs pesan tidak merespons');
	}
	if (response.ok) return 'ok';
	if (response.status === 409) return 'illegal';
	if (response.status === 404) return 'not_found';
	throw new WebOrderError(502, 'Situs pesan menolak perubahan status');
}
