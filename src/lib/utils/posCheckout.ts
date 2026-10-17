/**
 * Kontrak klien checkout POS: payload item, validasi respons quote/transaksi,
 * dan penerapan harga quote ke keranjang. Murni: tanpa fetch, storage, atau state.
 */
import type { CartItem } from '../types/cart.js';
import type { CommittedReceipt } from './saleReceipt.js';

export interface QuoteLine {
	source: Record<string, unknown>;
	product_name: string;
	product_price: number;
	add_ons: Array<{ id: string; nama: string; harga: number }>;
	line_total: number;
}

export interface QuoteResponse {
	ok: boolean;
	quote_token: string;
	expires_at: string;
	items: QuoteLine[];
	total_amount: number;
	total_qty: number;
}

export interface CheckoutResult {
	buku_kas_id: string;
	transaction_id: string;
	nomor_harian?: number | null;
	tanggal_nomor?: string | null;
	total_amount: number;
	total_qty: number;
	change: number;
	receipt: CommittedReceipt;
}

/** Item kustom kasir (id `custom-*`) tidak punya produk katalog maupun token harga. */
export function isCustomCartItem(item: CartItem): boolean {
	return item.product.id.toString().startsWith('custom-');
}

/** Item untuk /api/pos/quote dan /api/pos/transaction; harga dibuktikan oleh token, bukan angka klien. */
export function buildCheckoutItems(cart: CartItem[]) {
	return cart.map((item) => {
		const isCustom = isCustomCartItem(item);
		return {
			product_id: isCustom ? null : item.product.id,
			nama_kustom: isCustom ? item.product.nama : null,
			custom_price: isCustom ? (item.product.harga ?? 0) : null,
			jumlah: item.jumlah,
			add_on_ids: (item.addOns || []).map((addOn) => addOn.id),
			porsi: item.porsi || 'reguler',
			gula: item.gula || null,
			es: item.es || null,
			catatan: item.catatan || null,
			product_price_token: isCustom ? null : item.product.price_token || null,
			add_on_price_tokens: (item.addOns || [])
				.map((addOn) => addOn.price_token)
				.filter((token): token is string => Boolean(token))
		};
	});
}

/** Checkout offline hanya sah bila katalog belum kedaluwarsa dan setiap harga membawa token. */
export function hasOfflinePriceTokens(
	cart: CartItem[],
	catalogExpiresAt: string | null,
	now: number = Date.now()
): boolean {
	const expiresAt = Date.parse(catalogExpiresAt || '');
	if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
	return cart.every(
		(item) =>
			(isCustomCartItem(item) || Boolean(item.product.price_token)) &&
			(item.addOns || []).every((addOn) => Boolean(addOn.price_token))
	);
}

/** Tolak quote yang tidak lengkap atau tidak sebaris dengan keranjang. */
export function parseQuoteResponse(value: unknown, lineCount: number): QuoteResponse {
	const quote = value as Partial<QuoteResponse> | null;
	if (
		!quote?.ok ||
		!quote.quote_token ||
		!Array.isArray(quote.items) ||
		!Number.isFinite(quote.total_amount) ||
		quote.items.length !== lineCount
	) {
		throw new Error('Respons quote POS tidak valid');
	}
	return quote as QuoteResponse;
}

export function parseCheckoutResponse(value: unknown): CheckoutResult {
	const result = value as { ok?: boolean; data?: Partial<CheckoutResult> } | null;
	const data = result?.data;
	if (!result?.ok || !data || !Number.isFinite(data.total_amount) || !data.receipt) {
		throw new Error('Respons transaksi POS tidak valid');
	}
	return data as CheckoutResult;
}

/** Nama dan harga keranjang mengikuti quote server; atribut lokal topping dipertahankan. */
export function applyQuoteToCart(cart: CartItem[], quote: QuoteResponse): CartItem[] {
	return cart.map((item, index) => {
		const quoted = quote.items[index];
		return {
			...item,
			product: {
				...item.product,
				nama: quoted.product_name,
				harga: quoted.product_price
			},
			addOns: quoted.add_ons.map((addOn) => ({
				...item.addOns.find((existing) => String(existing.id) === String(addOn.id)),
				...addOn,
				is_active: true
			}))
		};
	});
}
