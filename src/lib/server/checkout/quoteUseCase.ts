/**
 * Quote POS use case — hitung ringkasan harga + token bertanda tangan.
 *
 * Route (`src/routes/api/pos/quote/+server.ts`) hanya: auth, parsing body,
 * panggil fungsi di sini, petakan hasil/error ke HTTP. Seluruh normalisasi,
 * rate-limit, load katalog, compute finansial, dan signing tinggal di sini.
 */
import { getD1Database, type BranchContext } from '../branchResolver';
import { consumeRateLimit } from '../rateLimit';
import { checkoutItemCountError, normalizeMoney, sanitizeShortText, uniqueStrings } from './utils';
import { getCheckoutCapabilities, loadAddOns, loadProducts } from './dataLoader';
import { computeItemFinancials } from './financials';
import type {
	IngredientDeductions,
	PosQuoteItem,
	PosQuoteTokenData,
	PosTransactionInput,
	StockDeductions
} from './types';
import { PosPricingTokenError, signPosPricingToken } from '../posPricingToken';

export const QUOTE_TTL_MS = 5 * 60 * 1000;
const QUOTE_RATE_LIMIT = 60;
const QUOTE_RATE_WINDOW_MS = 60 * 1000;

export class QuoteUseCaseError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'QuoteUseCaseError';
		this.status = status;
	}
}

export async function buildPosQuote(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: { userId: string; role: string },
	rawBody: unknown
) {
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);

	const limit = await consumeRateLimit(
		db,
		branch,
		`quote:${session.userId}`,
		QUOTE_RATE_LIMIT,
		QUOTE_RATE_WINDOW_MS,
		platform
	);
	if (!limit.available) throw new QuoteUseCaseError(503, 'Quote POS sementara tidak tersedia');
	if (!limit.allowed) throw new QuoteUseCaseError(429, 'Terlalu banyak permintaan quote POS');

	const body = rawBody as PosTransactionInput | null;
	const rawItems = body?.items;
	const itemCountError = checkoutItemCountError(rawItems);
	if (itemCountError) throw new QuoteUseCaseError(400, itemCountError);
	if (session.role !== 'pemilik' && rawItems!.some((item) => !item.product_id)) {
		throw new QuoteUseCaseError(403, 'Item custom hanya boleh dibuat pemilik');
	}

	const normalizedInputs = rawItems!.map((item) => {
		const jumlah = Number(item.jumlah);
		if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > 99) {
			throw new QuoteUseCaseError(400, 'Qty item tidak valid');
		}
		return {
			source: {
				product_id: item.product_id ? String(item.product_id) : null,
				nama_kustom: sanitizeShortText(item.nama_kustom, 80),
				custom_price: item.product_id ? null : normalizeMoney(item.custom_price),
				jumlah,
				add_on_ids: uniqueStrings((item.add_on_ids ?? []).map(String)),
				porsi: item.porsi ? sanitizeShortText(item.porsi, 20) : 'reguler',
				gula: sanitizeShortText(item.gula, 30),
				es: sanitizeShortText(item.es, 30),
				catatan: sanitizeShortText(item.catatan, 240)
			},
			productId: item.product_id ? String(item.product_id) : null,
			addOnIds: uniqueStrings((item.add_on_ids ?? []).map((id) => String(id))),
			jumlah
		};
	});
	const productIds = uniqueStrings(normalizedInputs.map((item) => item.productId));
	const addOnIds = uniqueStrings(normalizedInputs.flatMap((item) => item.addOnIds));
	const capabilities = await getCheckoutCapabilities(db, branch);
	const [productsById, addOnsById] = await Promise.all([
		loadProducts(
			db,
			branch,
			productIds,
			capabilities.stockTrackingAvailable,
			capabilities.ingredientTrackingAvailable
		),
		loadAddOns(db, branch, addOnIds)
	]);

	const stockDeductions: StockDeductions = new Map();
	const ingredientDeductions: IngredientDeductions = new Map();
	const computed = normalizedInputs.map((input) =>
		computeItemFinancials({
			input,
			addOnsById,
			productsById,
			recipesByProduct: new Map(),
			stockTrackingAvailable: false,
			ingredientTrackingAvailable: false,
			inventoryApplication: 'skip_policy_ignored',
			stockDeductions,
			ingredientDeductions,
			bukuKasId: 'quote',
			transactionId: 'quote'
		})
	);
	const quoteItems: PosQuoteItem[] = computed.map((item, index) => {
		let addOns: PosQuoteItem['add_ons'] = [];
		if (item.snapshot_tambahan) {
			try {
				addOns = JSON.parse(item.snapshot_tambahan) as PosQuoteItem['add_ons'];
			} catch {
				addOns = [];
			}
		}
		return {
			source: normalizedInputs[index].source,
			product_name: item.product_name,
			product_price: normalizeMoney(item.harga_dasar),
			add_ons: addOns,
			line_total: normalizeMoney(item.nominal)
		};
	});
	const quoteData: PosQuoteTokenData = {
		items: quoteItems,
		total_amount: computed.reduce((sum, item) => sum + normalizeMoney(item.nominal), 0),
		total_qty: computed.reduce((sum, item) => sum + item.jumlah, 0)
	};

	try {
		const quoteToken = await signPosPricingToken(platform?.env, {
			kind: 'checkout_quote',
			branch,
			data: quoteData,
			ttlMs: QUOTE_TTL_MS
		});
		return {
			ok: true,
			quote_token: quoteToken,
			expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
			...quoteData
		};
	} catch (error) {
		if (error instanceof PosPricingTokenError && error.code === 'SIGNING_KEY_UNAVAILABLE') {
			console.error(
				'[pos-quote] POS_PRICE_SIGNING_KEY hilang: checkout POS lumpuh. Isi secret di dashboard lalu redeploy.'
			);
			throw new QuoteUseCaseError(503, 'Layanan quote POS belum dikonfigurasi');
		}
		throw error;
	}
}
