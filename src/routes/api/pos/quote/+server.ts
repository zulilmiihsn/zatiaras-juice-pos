import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { getD1Database } from '$lib/server/branchResolver';
import { consumeRateLimit } from '$lib/server/rateLimit';
import {
	checkoutItemCountError,
	normalizeMoney,
	sanitizeShortText,
	uniqueStrings
} from '$lib/server/checkout/utils';
import { getCheckoutCapabilities, loadAddOns, loadProducts } from '$lib/server/checkout/dataLoader';
import { computeItemFinancials } from '$lib/server/checkout/financials';
import type {
	IngredientDeductions,
	PosQuoteItem,
	PosQuoteTokenData,
	PosTransactionInput,
	StockDeductions
} from '$lib/server/checkout/types';
import { PosPricingTokenError, signPosPricingToken } from '$lib/server/posPricingToken';
import type { RequestHandler } from './$types';

const QUOTE_TTL_MS = 5 * 60 * 1000;
const QUOTE_RATE_LIMIT = 60;
const QUOTE_RATE_WINDOW_MS = 60 * 1000;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);

	const limit = await consumeRateLimit(
		db,
		branch,
		`quote:${session.userId}`,
		QUOTE_RATE_LIMIT,
		QUOTE_RATE_WINDOW_MS,
		platform
	);
	if (!limit.available) throw kitError(503, 'Quote POS sementara tidak tersedia');
	if (!limit.allowed) throw kitError(429, 'Terlalu banyak permintaan quote POS');

	const body = (await request.json().catch(() => null)) as PosTransactionInput | null;
	const rawItems = body?.items;
	const itemCountError = checkoutItemCountError(rawItems);
	if (itemCountError) throw kitError(400, itemCountError);
	if (session.role !== 'pemilik' && rawItems!.some((item) => !item.product_id)) {
		throw kitError(403, 'Item custom hanya boleh dibuat pemilik');
	}

	const normalizedInputs = rawItems!.map((item) => {
		const jumlah = Number(item.jumlah);
		if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > 99) {
			throw kitError(400, 'Qty item tidak valid');
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
		return json({
			ok: true,
			quote_token: quoteToken,
			expires_at: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
			...quoteData
		});
	} catch (error) {
		if (error instanceof PosPricingTokenError && error.code === 'SIGNING_KEY_UNAVAILABLE') {
			throw kitError(503, 'Layanan quote POS belum dikonfigurasi');
		}
		throw error;
	}
};
