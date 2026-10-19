import type { BranchContext } from '../branchResolver';
import {
	PosPricingTokenError,
	verifyPosPricingToken,
	POS_PRICING_CLOCK_SKEW_MS
} from '../posPricingToken';
import type { PosQuoteItem, PosQuoteTokenData, PosTransactionInput } from './types';
import {
	CheckoutUseCaseError,
	OFFLINE_REPLAY_MAX_AGE_MS,
	checkoutItemCountError,
	normalizeMoney,
	normalizePaymentMethod,
	sanitizeShortText
} from './utils';

interface CatalogProductTokenData {
	id: string;
	nama: string;
	harga: number;
	harga_jumbo?: number | null;
	updated_at?: string | null;
}

interface CatalogAddOnTokenData {
	id: string;
	nama: string;
	harga: number;
	updated_at?: string | null;
}

const MAX_ITEM_QTY = 99;
// Toleransi jam perangkat yang sedikit maju terhadap jam server.
const QUEUED_AT_FUTURE_SKEW_MS = POS_PRICING_CLOCK_SKEW_MS;

function fail(status: number, message: string): never {
	throw new CheckoutUseCaseError(status, message);
}

/** Kegagalan token harga menjadi error checkout; error lain dilempar ulang apa adanya. */
function rethrowPricingError(
	error: unknown,
	messages: { unavailable: string; expired: string }
): never {
	if (error instanceof PosPricingTokenError) {
		if (error.code === 'SIGNING_KEY_UNAVAILABLE') fail(503, messages.unavailable);
		if (error.code === 'TOKEN_EXPIRED') fail(409, messages.expired);
		fail(400, error.message);
	}
	throw error;
}

async function verifyOfflineItem(
	platform: App.Platform | undefined,
	branch: BranchContext,
	item: NonNullable<PosTransactionInput['items']>[number],
	queuedAt: number
): Promise<PosQuoteItem> {
	const jumlah = Number(item.jumlah);
	if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > MAX_ITEM_QTY) {
		fail(400, 'Qty item tidak valid');
	}
	const addOnIds = (item.add_on_ids ?? []).map(String);
	const addOnTokens = item.add_on_price_tokens ?? [];
	if (addOnIds.length !== addOnTokens.length) {
		fail(400, 'Token harga tambahan tidak lengkap');
	}
	const addOns = await Promise.all(
		addOnTokens.map(async (token, index) => {
			const verified = await verifyPosPricingToken<CatalogAddOnTokenData>(platform?.env, token, {
				kind: 'catalog_add_on',
				branch,
				now: queuedAt
			});
			if (String(verified.data.id) !== addOnIds[index]) {
				fail(400, 'Token harga tambahan tidak cocok');
			}
			return {
				id: String(verified.data.id),
				nama: verified.data.nama,
				harga: normalizeMoney(verified.data.harga)
			};
		})
	);

	let productName: string;
	let productPrice: number;
	if (item.product_id) {
		const verified = await verifyPosPricingToken<CatalogProductTokenData>(
			platform?.env,
			item.product_price_token,
			{ kind: 'catalog_product', branch, now: queuedAt }
		);
		if (String(verified.data.id) !== String(item.product_id)) {
			fail(400, 'Token harga produk tidak cocok');
		}
		productName = verified.data.nama;
		const isJumbo = String(item.porsi || '').toLowerCase() === 'jumbo';
		productPrice = normalizeMoney(
			isJumbo ? (verified.data.harga_jumbo ?? verified.data.harga) : verified.data.harga
		);
	} else {
		productName = sanitizeShortText(item.nama_kustom, 80) ?? 'Item Custom';
		productPrice = normalizeMoney(item.custom_price);
		if (productPrice <= 0) fail(400, 'Harga custom item tidak valid');
	}
	return {
		source: item,
		product_name: productName,
		product_price: productPrice,
		add_ons: addOns,
		line_total: (productPrice + addOns.reduce((sum, addOn) => sum + addOn.harga, 0)) * jumlah
	};
}

/** Transaksi offline tunai tanpa quote: harga dibangun dari token katalog per item. */
async function rebuildOfflineQuote(
	platform: App.Platform | undefined,
	branch: BranchContext,
	body: PosTransactionInput,
	queuedAt: number
): Promise<PosQuoteTokenData> {
	if (normalizePaymentMethod(body.metode_bayar) !== 'tunai') {
		fail(409, 'Transaksi offline tanpa quote hanya boleh tunai');
	}
	const itemError = checkoutItemCountError(body.items);
	if (itemError) fail(400, itemError);

	const items = await Promise.all(
		body.items!.map((item) => verifyOfflineItem(platform, branch, item, queuedAt))
	);
	return {
		items,
		total_amount: items.reduce((sum, item) => sum + item.line_total, 0),
		total_qty: items.reduce((sum, item) => sum + Number(item.source.jumlah), 0)
	};
}

async function resolveOnlineQuote(
	platform: App.Platform | undefined,
	branch: BranchContext,
	body: PosTransactionInput
): Promise<PosQuoteTokenData> {
	try {
		const verified = await verifyPosPricingToken<PosQuoteTokenData>(
			platform?.env,
			body.quote_token,
			{ kind: 'checkout_quote', branch }
		);
		return verified.data;
	} catch (error) {
		return rethrowPricingError(error, {
			unavailable: 'Layanan quote POS belum dikonfigurasi',
			expired: 'Quote harga kedaluwarsa. Verifikasi ulang pembayaran.'
		});
	}
}

async function resolveOfflineQuote(
	platform: App.Platform | undefined,
	branch: BranchContext,
	body: PosTransactionInput
): Promise<PosQuoteTokenData> {
	const queuedAt = Number(body.queued_at);
	if (!Number.isFinite(queuedAt) || queuedAt > Date.now() + QUEUED_AT_FUTURE_SKEW_MS) {
		fail(409, 'Waktu antrean transaksi offline tidak valid');
	}
	if (queuedAt < Date.now() - OFFLINE_REPLAY_MAX_AGE_MS) {
		fail(409, 'Transaksi offline terlalu lama tersimpan dan perlu ditinjau pemilik');
	}
	try {
		if (!body.quote_token) return await rebuildOfflineQuote(platform, branch, body, queuedAt);
		const verified = await verifyPosPricingToken<PosQuoteTokenData>(
			platform?.env,
			body.quote_token,
			// Token diverifikasi pada jam antrean, bukan jam sekarang.
			{ kind: 'checkout_quote', branch, now: queuedAt }
		);
		return verified.data;
	} catch (error) {
		return rethrowPricingError(error, {
			unavailable: 'Layanan harga POS belum dikonfigurasi',
			expired: 'Harga offline kedaluwarsa dan perlu ditinjau pemilik'
		});
	}
}

/**
 * Harga otoritatif transaksi: quote bertanda tangan server (online), atau quote/token katalog
 * pada jam antrean perangkat (replay offline). Server tidak pernah memakai harga dari klien.
 */
export function resolveCheckoutQuote(
	platform: App.Platform | undefined,
	branch: BranchContext,
	body: PosTransactionInput,
	mode: 'online' | 'offline_replay'
): Promise<PosQuoteTokenData> {
	return mode === 'online'
		? resolveOnlineQuote(platform, branch, body)
		: resolveOfflineQuote(platform, branch, body);
}
