/**
 * Checkout use case — orkestrasi transaksi POS otoritatif server.
 *
 * Route (`src/routes/api/pos/transaction/+server.ts`) hanya: auth cabang,
 * role, ambil DB, parsing body, panggil executeCheckout, petakan hasil/error
 * ke HTTP. Seluruh validasi, quote offline/online, idempotency, stok/HPP,
 * batch atomik, audit, dan realtime publish tinggal di sini.
 *
 * Tidak import SvelteKit runtime. Error domain memakai CheckoutUseCaseError
 * yang membawa status HTTP; route memetakan ke kitError/json.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from '../branchResolver';
import { publishBranchEvent } from '../realtimePublisher';
import { appendAuditLog } from '../auditLog';
import { consumeRateLimit } from '../rateLimit';
import { recordErrorEvent } from '../observability';
import type { AddOnRow, PosQuoteTokenData, PosTransactionInput, ProductRow } from './types';
import {
	normalizePaymentMethod,
	sanitizeShortText,
	uniqueStrings,
	getWitaSalesDate,
	normalizeMoney,
	summarizeD1Meta,
	CHECKOUT_WINDOW_MS,
	CHECKOUT_MAX_PER_WINDOW,
	checkoutItemCountError
} from './utils';
import {
	getCheckoutCapabilities,
	getActiveSessionId,
	getSessionIdById,
	getExistingByIdempotency,
	loadProducts,
	loadRecipesByProduct,
	loadAddOns
} from './dataLoader';
import { computeItemFinancials } from './financials';
import { buildCheckoutStatements } from './statementBuilder';
import { computeTransactionFingerprint } from './fingerprint';
import type { StockDeductions, IngredientDeductions } from './types';
import { PosPricingTokenError, verifyPosPricingToken } from '../posPricingToken';
import { validateCheckoutPayload } from '$lib/utils/validation';

export class CheckoutUseCaseError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'CheckoutUseCaseError';
		this.status = status;
	}
}

export interface CheckoutSession {
	userId: string;
	username?: string;
	role: string;
}

export interface CheckoutResultData {
	buku_kas_id: string;
	transaction_id: string;
	committed_at: string;
	total_amount: number;
	total_qty: number;
	change: number;
	receipt: unknown;
}

export type CheckoutResult =
	| { idempotent: true; d1Meta: null; data: CheckoutResultData }
	| { idempotent: false; d1Meta: string | null; data: CheckoutResultData };

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

interface RawCheckoutItem {
	custom_price?: number;
	jumlah?: number;
}

function buildReceiptFromQuote(
	quote: PosQuoteTokenData,
	input: {
		totalAmount: number;
		cashReceived: number;
		paymentMethod: 'tunai' | 'non-tunai';
		committedAt: string;
	}
) {
	return {
		items: quote.items.map((item) => {
			const unitPrice =
				normalizeMoney(item.product_price) +
				item.add_ons.reduce((sum, addOn) => sum + normalizeMoney(addOn.harga), 0);
			return {
				product_id: item.source.product_id ? String(item.source.product_id) : null,
				nama: item.product_name,
				jumlah: Number(item.source.jumlah),
				harga: unitPrice,
				nominal: normalizeMoney(item.line_total),
				harga_dasar: normalizeMoney(item.product_price),
				total_tambahan: unitPrice - normalizeMoney(item.product_price),
				tambahan: item.add_ons,
				gula: item.source.gula || null,
				es: item.source.es || null,
				catatan: item.source.catatan || null
			};
		}),
		total_amount: input.totalAmount,
		total_qty: quote.total_qty,
		cash_received: input.cashReceived,
		change:
			input.paymentMethod === 'tunai' && input.cashReceived > 0
				? input.cashReceived - input.totalAmount
				: 0,
		metode_bayar: input.paymentMethod,
		committed_at: input.committedAt
	};
}

export interface CheckoutInput {
	db: D1Database;
	branch: BranchId;
	session: CheckoutSession;
	platform: App.Platform | undefined;
	rawBody: unknown;
}

/** Orkestrasi checkout penuh. Melempar CheckoutUseCaseError untuk 4xx/5xx terkontrol. */
export async function executeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
	const { db, branch, session, platform, rawBody } = input;
	const fail = (status: number, message: string): never => {
		throw new CheckoutUseCaseError(status, message);
	};

	const capabilities = await getCheckoutCapabilities(db, branch);
	const { stockTrackingAvailable, ingredientTrackingAvailable, idempotencyAvailable } =
		capabilities;

	const checkoutLimit = await consumeRateLimit(
		db,
		branch,
		`checkout:${session.userId}`,
		CHECKOUT_MAX_PER_WINDOW,
		CHECKOUT_WINDOW_MS,
		platform
	);
	if (!checkoutLimit.available)
		fail(503, 'Checkout sementara tidak tersedia. Coba lagi beberapa saat.');
	if (!checkoutLimit.allowed)
		fail(429, `Terlalu banyak transaksi. Coba lagi ${checkoutLimit.retryAfterSeconds} detik lagi`);

	if (!rawBody) fail(400, 'Item transaksi kosong');
	const validation = validateCheckoutPayload(rawBody);
	if (!validation.success) {
		fail(400, validation.error || 'Payload transaksi tidak valid');
	}
	const body = rawBody as PosTransactionInput;
	const rawMode = body.mode;
	if (
		rawMode !== undefined &&
		rawMode !== null &&
		rawMode !== 'online' &&
		rawMode !== 'offline_replay'
	) {
		fail(400, 'Mode transaksi POS tidak valid (harus online atau offline_replay)');
	}
	const mode = rawMode || 'online';
	let quoteData: PosQuoteTokenData | null = null;
	if (mode === 'online') {
		try {
			quoteData = (
				await verifyPosPricingToken<PosQuoteTokenData>(platform?.env, body.quote_token, {
					kind: 'checkout_quote',
					branch
				})
			).data;
		} catch (error) {
			if (error instanceof PosPricingTokenError) {
				if (error.code === 'SIGNING_KEY_UNAVAILABLE') {
					fail(503, 'Layanan quote POS belum dikonfigurasi');
				}
				if (error.code === 'TOKEN_EXPIRED') {
					fail(409, 'Quote harga kedaluwarsa. Verifikasi ulang pembayaran.');
				}
				fail(400, error.message);
			}
			throw error;
		}
	} else {
		const queuedAt = Number(body.queued_at);
		if (!Number.isFinite(queuedAt) || queuedAt > Date.now() + 30_000) {
			fail(409, 'Waktu antrean transaksi offline tidak valid');
		}
		try {
			if (body.quote_token) {
				quoteData = (
					await verifyPosPricingToken<PosQuoteTokenData>(platform?.env, body.quote_token, {
						kind: 'checkout_quote',
						branch,
						now: queuedAt
					})
				).data;
			} else {
				if (normalizePaymentMethod(body.metode_bayar) !== 'tunai') {
					fail(409, 'Transaksi offline tanpa quote hanya boleh tunai');
				}
				const offlineItems = body.items;
				const offlineItemError = checkoutItemCountError(offlineItems);
				if (offlineItemError) fail(400, offlineItemError);
				const verifiedItems = await Promise.all(
					offlineItems!.map(async (item) => {
						const jumlah = Number(item.jumlah);
						if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > 99) {
							fail(400, 'Qty item tidak valid');
						}
						const addOnIds = (item.add_on_ids ?? []).map(String);
						const addOnTokens = item.add_on_price_tokens ?? [];
						if (addOnIds.length !== addOnTokens.length) {
							fail(400, 'Token harga tambahan tidak lengkap');
						}
						const addOns = await Promise.all(
							addOnTokens.map(async (token, index) => {
								const verified = await verifyPosPricingToken<CatalogAddOnTokenData>(
									platform?.env,
									token,
									{ kind: 'catalog_add_on', branch, now: queuedAt }
								);
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
							line_total:
								(productPrice + addOns.reduce((sum, addOn) => sum + addOn.harga, 0)) * jumlah
						};
					})
				);
				quoteData = {
					items: verifiedItems,
					total_amount: verifiedItems.reduce((sum, item) => sum + item.line_total, 0),
					total_qty: verifiedItems.reduce((sum, item) => sum + Number(item.source.jumlah), 0)
				};
			}
		} catch (error) {
			if (error instanceof PosPricingTokenError) {
				if (error.code === 'SIGNING_KEY_UNAVAILABLE') {
					fail(503, 'Layanan harga POS belum dikonfigurasi');
				}
				if (error.code === 'TOKEN_EXPIRED') {
					fail(409, 'Harga offline kedaluwarsa dan perlu ditinjau pemilik');
				}
				fail(400, error.message);
			}
			throw error;
		}
	}
	const rawItems = quoteData?.items.map((item) => item.source) ?? body.items;
	if (!Array.isArray(rawItems)) fail(400, 'Item transaksi kosong');
	const itemCountError = checkoutItemCountError(rawItems);
	if (itemCountError) fail(400, itemCountError);
	if (session.role !== 'pemilik' && rawItems.some((item) => !item.product_id)) {
		fail(403, 'Item custom hanya boleh dibuat pemilik');
	}

	const idempotencyKey = sanitizeShortText(body.idempotency_key, 120);
	if (!idempotencyKey || idempotencyKey.length < 8)
		throw new CheckoutUseCaseError(400, 'idempotency_key tidak valid');

	const paymentMethod = normalizePaymentMethod(body.metode_bayar);
	const customerName = sanitizeShortText(body.nama_pelanggan, 60);

	const requestFingerprint = computeTransactionFingerprint({
		branch,
		storeSessionId: body.store_session_id,
		cashReceived: body.cash_received,
		items: rawItems,
		totalAmount: quoteData
			? quoteData.total_amount
			: (rawItems as RawCheckoutItem[]).reduce(
					(s: number, i) => s + normalizeMoney(i.custom_price) * Number(i.jumlah || 0),
					0
				),
		totalQty: quoteData
			? quoteData.total_qty
			: (rawItems as RawCheckoutItem[]).reduce((s: number, i) => s + Number(i.jumlah || 0), 0),
		paymentMethod,
		customerName
	});

	const existing = await getExistingByIdempotency(db, branch, idempotencyKey, idempotencyAvailable);
	if (idempotencyAvailable && idempotencyKey) {
		const voided = (await db
			.prepare(
				`SELECT transaction_id FROM pos_void_markers WHERE cabang_id = ? AND idempotency_key = ? LIMIT 1`
			)
			.bind(branch, idempotencyKey)
			.first()) as { transaction_id?: string } | null;
		if (voided && !existing) fail(409, 'Transaksi sudah dibatalkan (void). Buat transaksi baru.');
	}
	if (existing) {
		if (existing.request_fingerprint !== requestFingerprint) {
			fail(409, 'Idempotency key sudah dipakai untuk transaksi berbeda');
		}

		let receipt = null;
		if (existing.receipt_snapshot) {
			try {
				receipt = JSON.parse(existing.receipt_snapshot);
			} catch {}
		}
		const existingCashReceived = normalizeMoney(body.cash_received);
		return {
			idempotent: true,
			d1Meta: null,
			data: {
				buku_kas_id: existing.id,
				transaction_id: existing.transaction_id,
				committed_at: existing.waktu || new Date().toISOString(),
				total_amount: existing.nominal,
				total_qty: existing.jumlah,
				change:
					paymentMethod === 'tunai' && existingCashReceived > 0
						? existingCashReceived - existing.nominal
						: 0,
				receipt
			}
		};
	}

	const normalizedInputs = rawItems.map((item, index) => {
		const jumlah = Number(item.jumlah);
		if (!Number.isInteger(jumlah) || jumlah <= 0 || jumlah > 99) fail(400, 'Qty item tidak valid');
		const quoteItem = quoteData?.items[index];
		return {
			source: item,
			productId: item.product_id ? String(item.product_id) : null,
			addOnIds: uniqueStrings((item.add_on_ids ?? []).map((id) => String(id))),
			jumlah,
			pricingSnapshot: quoteItem
				? {
						product_name: quoteItem.product_name,
						product_price: quoteItem.product_price,
						addOns: quoteItem.add_ons
					}
				: undefined
		};
	});

	const productIds = uniqueStrings(normalizedInputs.map((item) => item.productId));
	const addOnIds = uniqueStrings(normalizedInputs.flatMap((item) => item.addOnIds));
	const fallbackProducts = new Map<string, ProductRow>();
	const fallbackAddOns = new Map<string, AddOnRow>();
	if (mode === 'offline_replay') {
		for (const item of normalizedInputs) {
			if (item.productId && item.pricingSnapshot) {
				fallbackProducts.set(item.productId, {
					id: item.productId,
					nama: item.pricingSnapshot.product_name,
					harga: item.pricingSnapshot.product_price,
					stok: null,
					lacak_stok: false,
					lacak_bahan: false,
					is_active: false
				});
			}
			for (const addOn of item.pricingSnapshot?.addOns ?? []) {
				fallbackAddOns.set(addOn.id, {
					id: addOn.id,
					nama: addOn.nama,
					harga: addOn.harga,
					is_active: false
				});
			}
		}
	}

	// Fase baca paralel: sesi toko, produk, dan add-on saling independen.
	const isOfflineReplay = mode === 'offline_replay';
	const [idSesiToko, productsById, addOnsById] = await Promise.all([
		isOfflineReplay
			? getSessionIdById(db, branch, body.store_session_id)
			: getActiveSessionId(db, branch),
		loadProducts(db, branch, productIds, stockTrackingAvailable, ingredientTrackingAvailable, {
			allowInactive: isOfflineReplay,
			fallbackProducts
		}),
		loadAddOns(db, branch, addOnIds, {
			allowInactive: isOfflineReplay,
			fallbackAddOns
		})
	]);
	if (!idSesiToko && session.role === 'kasir') {
		fail(
			409,
			isOfflineReplay
				? 'Sesi toko transaksi offline tidak valid'
				: 'Kasir tidak boleh transaksi saat toko tutup'
		);
	}

	// Resep butuh hasil produk (flag lacak_bahan), jadi wave kedua.
	const recipeProductIds = ingredientTrackingAvailable
		? productIds.filter((id) => {
				const p = productsById.get(id);
				return p?.lacak_bahan === true || p?.lacak_bahan === 1;
			})
		: [];
	const recipesByProduct = await loadRecipesByProduct(db, branch, recipeProductIds);

	const transactionId = crypto.randomUUID();
	const bukuKasId = crypto.randomUUID();
	const createdAt = new Date().toISOString();
	const stockDeductions: StockDeductions = new Map();
	const ingredientDeductions: IngredientDeductions = new Map();

	const items = normalizedInputs.map((input) =>
		computeItemFinancials({
			input,
			addOnsById,
			productsById,
			recipesByProduct,
			stockTrackingAvailable,
			ingredientTrackingAvailable,
			stockDeductions,
			ingredientDeductions,
			bukuKasId,
			transactionId
		})
	);
	if (!items.length) fail(400, 'Item transaksi kosong');

	const totalAmount = items.reduce((sum, item) => sum + item.nominal, 0);
	const totalQty = items.reduce((sum, item) => sum + item.jumlah, 0);
	const totalHpp = items.reduce((sum, item) => sum + (item.nominal_hpp || 0), 0);
	if (
		quoteData &&
		(totalAmount !== normalizeMoney(quoteData.total_amount) || totalQty !== quoteData.total_qty)
	) {
		fail(409, 'Total quote berubah. Verifikasi ulang pembayaran.');
	}
	const cashReceived = normalizeMoney(body.cash_received);
	if (paymentMethod === 'tunai' && cashReceived < totalAmount)
		fail(400, 'Nominal tunai kurang dari total');
	if (paymentMethod === 'non-tunai' && cashReceived > 0 && cashReceived !== totalAmount) {
		fail(409, 'Nominal pembayaran non-tunai tidak sama dengan total quote');
	}

	const receiptSnapshot = quoteData
		? buildReceiptFromQuote(quoteData, {
				totalAmount,
				cashReceived,
				paymentMethod,
				committedAt: createdAt
			})
		: null;

	const statements = buildCheckoutStatements({
		db,
		branch,
		items,
		stockDeductions,
		ingredientDeductions,
		totalAmount,
		totalQty,
		totalHpp,
		paymentMethod,
		customerName,
		salesDate: getWitaSalesDate(createdAt),
		bukuKasId,
		transactionId,
		createdAt,
		idSesiToko,
		idempotencyKey,
		requestFingerprint,
		receiptSnapshot,
		session,
		capabilities
	});

	let d1Meta: string | null = null;
	try {
		d1Meta = summarizeD1Meta(await db.batch(statements));
	} catch (error) {
		const duplicate = await getExistingByIdempotency(
			db,
			branch,
			idempotencyKey,
			idempotencyAvailable
		);
		if (duplicate) {
			if (!duplicate.request_fingerprint || duplicate.request_fingerprint !== requestFingerprint) {
				fail(409, 'Idempotency key sudah dipakai untuk transaksi berbeda');
			}

			let receipt = null;
			if (duplicate.receipt_snapshot) {
				try {
					receipt = JSON.parse(duplicate.receipt_snapshot);
				} catch {}
			}
			if (!receipt && quoteData) {
				receipt = buildReceiptFromQuote(quoteData, {
					totalAmount: duplicate.nominal,
					cashReceived,
					paymentMethod,
					committedAt: createdAt
				});
			}

			return {
				idempotent: true,
				d1Meta: null,
				data: {
					buku_kas_id: duplicate.id,
					transaction_id: duplicate.transaction_id,
					total_amount: duplicate.nominal,
					total_qty: duplicate.jumlah,
					change:
						paymentMethod === 'tunai' && cashReceived > 0 ? cashReceived - duplicate.nominal : 0,
					receipt,
					committed_at: duplicate.waktu || new Date().toISOString()
				}
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('TRANSACTION_VOIDED')) {
			fail(409, 'Transaksi sudah dibatalkan (void). Buat transaksi baru.');
		}
		if (message.includes('INSUFFICIENT_STOCK')) {
			await recordErrorEvent(platform, branch, {
				source: 'POST /api/pos/transaction',
				error,
				status: 409,
				session,
				context: { idempotencyKey, stockDeductions: Object.fromEntries(stockDeductions) }
			});
			fail(409, 'Stok tidak cukup untuk salah satu item');
		}
		if (message.includes('INSUFFICIENT_INGREDIENT')) {
			await recordErrorEvent(platform, branch, {
				source: 'POST /api/pos/transaction',
				error,
				status: 409,
				session,
				context: { idempotencyKey, ingredientDeductions: Object.fromEntries(ingredientDeductions) }
			});
			fail(409, 'Stok bahan tidak cukup untuk salah satu menu');
		}
		await recordErrorEvent(platform, branch, {
			source: 'POST /api/pos/transaction',
			error,
			status: 500,
			session,
			context: { idempotencyKey, totalAmount, totalQty }
		});
		throw error;
	}

	// Audit + realtime publish paralel sesudah batch commit.
	const normalizedForAudit = normalizedInputs;
	const currentCatalogTotal = normalizedForAudit.reduce((sum, item) => {
		const productPrice = item.productId
			? normalizeMoney(productsById.get(item.productId)?.harga)
			: normalizeMoney(item.source.custom_price);
		const addOnTotal = item.addOnIds.reduce(
			(addOnSum, id) => addOnSum + normalizeMoney(addOnsById.get(id)?.harga),
			0
		);
		return sum + (productPrice + addOnTotal) * item.jumlah;
	}, 0);
	await Promise.all([
		appendAuditLog(db, branch, {
			action: isOfflineReplay
				? 'pos_transaction.offline_reconciliation_required'
				: 'pos_transaction.created',
			entityType: 'buku_kas',
			entityId: bukuKasId,
			transactionId,
			amount: totalAmount,
			session,
			metadata: {
				customerName,
				paymentMethod,
				totalQty,
				itemCount: items.length,
				pricingSource: isOfflineReplay ? 'offline_signed_catalog' : 'online_quote',
				queuedAt: isOfflineReplay ? Number(body.queued_at) : null,
				currentCatalogTotal,
				priceVariance: totalAmount - currentCatalogTotal,
				inventoryReconciliationRequired: isOfflineReplay,
				stockDeductions: Object.fromEntries(stockDeductions),
				ingredientDeductions: Object.fromEntries(ingredientDeductions)
			}
		}),
		publishBranchEvent(
			platform?.env as Record<string, unknown> | undefined,
			branch,
			'buku_kas',
			'insert',
			{ id: bukuKasId, transaction_id: transactionId }
		),
		publishBranchEvent(
			platform?.env as Record<string, unknown> | undefined,
			branch,
			'transaksi_kasir',
			'insert',
			{ transaction_id: transactionId }
		),
		...Array.from(ingredientDeductions.keys()).map((bahanId) =>
			publishBranchEvent(
				platform?.env as Record<string, unknown> | undefined,
				branch,
				'bahan',
				'update',
				{ id: bahanId }
			)
		)
	]);

	return {
		idempotent: false,
		d1Meta,
		data: {
			buku_kas_id: bukuKasId,
			transaction_id: transactionId,
			committed_at: createdAt,
			total_amount: totalAmount,
			total_qty: totalQty,
			change: paymentMethod === 'tunai' && cashReceived > 0 ? cashReceived - totalAmount : 0,
			receipt: {
				items: items.map((item) => {
					let tambahan: unknown = [];
					if (item.snapshot_tambahan) {
						try {
							tambahan = JSON.parse(item.snapshot_tambahan);
						} catch {
							tambahan = [];
						}
					}
					return {
						product_id: item.produk_id,
						nama: item.product_name,
						jumlah: item.jumlah,
						harga: item.harga,
						nominal: item.nominal,
						harga_dasar: item.harga_dasar,
						total_tambahan: item.total_tambahan,
						tambahan,
						gula: item.gula,
						es: item.es,
						catatan: item.catatan
					};
				}),
				total_amount: totalAmount,
				total_qty: totalQty,
				cash_received: cashReceived,
				change: paymentMethod === 'tunai' && cashReceived > 0 ? cashReceived - totalAmount : 0,
				metode_bayar: paymentMethod,
				committed_at: createdAt
			}
		}
	};
}
