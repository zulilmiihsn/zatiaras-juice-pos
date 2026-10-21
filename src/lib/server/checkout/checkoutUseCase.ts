/**
 * Checkout use case — orkestrasi transaksi POS otoritatif server.
 *
 * Route (`src/routes/api/pos/transaction/+server.ts`) hanya: auth cabang,
 * role, ambil DB, parsing body, panggil executeCheckout, petakan hasil/error
 * ke HTTP. Seluruh validasi, quote offline/online, idempotency, stok/HPP,
 * batch atomik, audit, dan realtime publish tinggal di sini.
 *
 * Tidak import SvelteKit runtime. Error domain memakai CheckoutDomainError
 * yang membawa status HTTP; route memetakan ke kitError/json.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { formatDateYmdWita } from '$lib/utils/dateTime';
import { isOwnerRole } from '$lib/utils/roles';
import { validateCheckoutPayload } from '$lib/utils/validation';
import { getD1Database, type BranchContext } from '../branchResolver';
import {
	publishBranchEvent,
	type BranchEventPayload,
	type RealtimeAction,
	type RealtimeTable
} from '../realtimePublisher';
import { settlePostCommitEffects } from '../postCommit';
import { auditIntentStatement, type AuditLogInput } from '../auditLog';
import { consumeRateLimit } from '../rateLimit';
import { buildOrderCreatedStatement } from '../orderNotifications/repository';
import { resolveCheckoutNotificationOrigin } from '../orderNotifications/useCase';
import { kickOrderNotifications } from '../orderNotifications/delivery';
import { loadStockPolicy } from '../stockPolicy';
import type {
	CheckoutCapabilities,
	CheckoutResult,
	CheckoutSession,
	IngredientDeductions,
	PosTransactionInput,
	StockDeductions
} from './types';
import {
	CheckoutUseCaseError,
	CHECKOUT_MAX_PER_WINDOW,
	CHECKOUT_WINDOW_MS,
	checkoutItemCountError,
	normalizeMoney,
	normalizePaymentMethod,
	sanitizeShortText,
	summarizeD1Meta,
	uniqueStrings
} from './utils';
import {
	getActiveSessionId,
	getCheckoutCapabilities,
	getExistingByIdempotency,
	getReplaySessionId,
	loadAddOns,
	loadProducts,
	loadReceiptSettingsSnapshot,
	loadRecipesByProduct
} from './dataLoader';
import { buildCommittedResult, buildReceiptFromQuote } from './checkoutReceipt';
import { failCheckoutCommit } from './commitFailure';
import { computeItemFinancials } from './financials';
import { computeTransactionFingerprint } from './fingerprint';
import { catalogFallbacks, currentCatalogTotal, normalizeCheckoutItems } from './itemInputs';
import { allocateNomorHarian } from './nomorHarian';
import { resolveCheckoutQuote } from './quoteResolution';
import { buildCheckoutStatements } from './statementBuilder';
import { resolveStockReplay } from './stockReplayPolicy';

// Tes dan pemanggil lain mengimpor tipe dan error use case dari modul ini.
export { CheckoutUseCaseError } from './utils';
export type { CheckoutResult, CheckoutResultData, CheckoutSession } from './types';

export interface CheckoutInput {
	db: D1Database;
	branch: BranchContext;
	session: CheckoutSession;
	platform: App.Platform | undefined;
	rawBody: unknown;
}

function fail(status: number, message: string): never {
	throw new CheckoutUseCaseError(status, message);
}

/** Skema nomor antrean wajib ada, dan satu kasir dibatasi jumlah checkout per jendela waktu. */
async function assertCheckoutAvailable(
	db: D1Database,
	branch: BranchContext,
	session: CheckoutSession,
	platform: App.Platform | undefined
): Promise<CheckoutCapabilities> {
	const capabilities = await getCheckoutCapabilities(db, branch);
	if (!capabilities.nomorHarianAvailable) {
		fail(
			503,
			'Skema nomor antrean belum tersedia di cabang ini. Minta pemilik menerapkan migrasi 0036.'
		);
	}

	const limit = await consumeRateLimit(
		db,
		branch,
		`checkout:${session.userId}`,
		CHECKOUT_MAX_PER_WINDOW,
		CHECKOUT_WINDOW_MS,
		platform
	);
	if (!limit.available) fail(503, 'Checkout sementara tidak tersedia. Coba lagi beberapa saat.');
	if (!limit.allowed) {
		fail(429, `Terlalu banyak transaksi. Coba lagi ${limit.retryAfterSeconds} detik lagi`);
	}
	return capabilities;
}

function parseCheckoutBody(rawBody: unknown): {
	body: PosTransactionInput;
	mode: 'online' | 'offline_replay';
} {
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
	return { body, mode: rawMode || 'online' };
}

async function hasVoidMarker(
	db: D1Database,
	branch: BranchContext,
	idempotencyKey: string
): Promise<boolean> {
	const marker = await db
		.prepare(
			`SELECT transaction_id FROM pos_void_markers WHERE cabang_id = ? AND idempotency_key = ? LIMIT 1`
		)
		.bind(branch, idempotencyKey)
		.first();
	return Boolean(marker);
}

/** Realtime publish sesudah commit. Gagal publish tidak membatalkan transaksi. */
async function publishCheckoutEvents(
	platform: App.Platform | undefined,
	branch: BranchContext,
	ids: { bukuKasId: string; transactionId: string; ingredientIds: string[] }
): Promise<void> {
	const env = platform?.env as Record<string, unknown> | undefined;
	const publish =
		(table: RealtimeTable, action: RealtimeAction, payload: Partial<BranchEventPayload>) =>
		(signal: AbortSignal) =>
			publishBranchEvent(env, branch, table, action, payload, undefined, signal);

	await settlePostCommitEffects(
		[
			publish('buku_kas', 'insert', { id: ids.bukuKasId, transaction_id: ids.transactionId }),
			publish('transaksi_kasir', 'insert', { transaction_id: ids.transactionId }),
			...ids.ingredientIds.map((bahanId) => publish('bahan', 'update', { id: bahanId }))
		],
		undefined,
		platform?.context
	);
}

/** Orkestrasi checkout penuh. Melempar CheckoutUseCaseError untuk 4xx/5xx terkontrol. */
export async function executeCheckout(input: CheckoutInput): Promise<CheckoutResult> {
	const { db, branch, session, platform, rawBody } = input;

	const capabilities = await assertCheckoutAvailable(db, branch, session, platform);
	const { stockTrackingAvailable, ingredientTrackingAvailable, idempotencyAvailable } =
		capabilities;

	const { body, mode } = parseCheckoutBody(rawBody);
	const isOfflineReplay = mode === 'offline_replay';
	const quote = await resolveCheckoutQuote(platform, branch, body, mode);

	const rawItems = quote.items.map((item) => item.source);
	const itemCountError = checkoutItemCountError(rawItems);
	if (itemCountError) fail(400, itemCountError);
	if (!isOwnerRole(session.role) && rawItems.some((item) => !item.product_id)) {
		fail(403, 'Item custom hanya boleh dibuat pemilik');
	}

	const idempotencyKey = sanitizeShortText(body.idempotency_key, 120);
	if (!idempotencyKey || idempotencyKey.length < 8) fail(400, 'idempotency_key tidak valid');

	const paymentMethod = normalizePaymentMethod(body.metode_bayar);
	const customerName = sanitizeShortText(body.nama_pelanggan, 60);
	const cashReceived = normalizeMoney(body.cash_received);

	const requestFingerprint = computeTransactionFingerprint({
		branch,
		storeSessionId: body.store_session_id,
		cashReceived: body.cash_received,
		items: rawItems,
		totalAmount: quote.total_amount,
		totalQty: quote.total_qty,
		paymentMethod,
		customerName
	});

	const existing = await getExistingByIdempotency(db, branch, idempotencyKey, idempotencyAvailable);
	const voided = idempotencyAvailable && (await hasVoidMarker(db, branch, idempotencyKey));
	if (voided && !existing) fail(409, 'Transaksi sudah dibatalkan (void). Buat transaksi baru.');
	if (existing) {
		return buildCommittedResult(existing, {
			platform,
			branch,
			requestFingerprint,
			paymentMethod,
			cashReceived
		});
	}

	const stockPolicy = await loadStockPolicy(db, branch);
	const { inventoryApplication, replayDisposition } = await resolveStockReplay({
		db,
		branch,
		platform,
		body,
		mode,
		stockPolicy,
		idempotencyKey,
		requestFingerprint
	});

	const normalizedInputs = normalizeCheckoutItems(rawItems, quote);
	const productIds = uniqueStrings(normalizedInputs.map((item) => item.productId));
	const addOnIds = uniqueStrings(normalizedInputs.flatMap((item) => item.addOnIds));
	const { fallbackProducts, fallbackAddOns } = catalogFallbacks(normalizedInputs, mode);

	// Fase baca paralel: sesi toko, produk, dan add-on saling independen.
	const [idSesiToko, productsById, addOnsById] = await Promise.all([
		isOfflineReplay
			? getReplaySessionId(db, branch, body.store_session_id, Number(body.queued_at))
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
				? 'Sesi toko transaksi offline tidak valid atau waktu transaksi di luar jam sesi'
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
	// Jam bisnis transaksi. Replay offline memakai queued_at yang sudah dibatasi umur
	// maksimal dan jendela sesi, agar penjualan 23.50 tetap masuk laporan hari itu.
	const soldAt = isOfflineReplay ? new Date(Number(body.queued_at)).toISOString() : createdAt;
	const stockDeductions: StockDeductions = new Map();
	const ingredientDeductions: IngredientDeductions = new Map();

	const items = normalizedInputs.map((normalized) =>
		computeItemFinancials({
			input: normalized,
			addOnsById,
			productsById,
			recipesByProduct,
			stockTrackingAvailable,
			ingredientTrackingAvailable,
			inventoryApplication,
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
	if (totalAmount !== normalizeMoney(quote.total_amount) || totalQty !== quote.total_qty) {
		fail(409, 'Total quote berubah. Verifikasi ulang pembayaran.');
	}
	if (paymentMethod === 'tunai' && cashReceived < totalAmount) {
		fail(400, 'Nominal tunai kurang dari total');
	}
	if (paymentMethod === 'non-tunai' && cashReceived > 0 && cashReceived !== totalAmount) {
		fail(409, 'Nominal pembayaran non-tunai tidak sama dengan total quote');
	}

	const receiptSnapshot = buildReceiptFromQuote(quote, {
		totalAmount,
		cashReceived,
		paymentMethod,
		committedAt: soldAt,
		customerName,
		settings: await loadReceiptSettingsSnapshot(db, branch)
	});

	// Nomor antrean harian dialokasi paling akhir sebelum commit: request yang
	// gagal validasi di atas tidak menghabiskan nomor.
	const salesDate = formatDateYmdWita(soldAt);
	const nomorHarian = await allocateNomorHarian(db, branch, salesDate);

	const catalogTotal = currentCatalogTotal(normalizedInputs, productsById, addOnsById);
	const auditInput: AuditLogInput = {
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
			nomorHarian,
			tanggalNomor: salesDate,
			pricingSource: isOfflineReplay ? 'offline_signed_catalog' : 'online_quote',
			queuedAt: isOfflineReplay ? Number(body.queued_at) : null,
			currentCatalogTotal: catalogTotal,
			priceVariance: totalAmount - catalogTotal,
			stockPolicyMode: stockPolicy.mode,
			stockPolicyRevision: stockPolicy.revision,
			inventoryApplication,
			stockReplayDisposition: replayDisposition,
			inventoryReconciliationRequired: isOfflineReplay,
			stockDeductions: Object.fromEntries(stockDeductions),
			ingredientDeductions: Object.fromEntries(ingredientDeductions)
		}
	};

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
		salesDate,
		bukuKasId,
		transactionId,
		createdAt,
		soldAt,
		idSesiToko,
		idempotencyKey,
		nomorHarian,
		tanggalNomor: salesDate,
		requestFingerprint,
		receiptSnapshot,
		session,
		capabilities,
		stockPolicy,
		inventoryApplication,
		replayDisposition
	});
	const notificationOrigin = await resolveCheckoutNotificationOrigin(
		platform?.env as Record<string, unknown> | undefined,
		branch,
		session,
		body.origin_device_id,
		body.origin_device_token
	);
	statements.push(
		auditIntentStatement(db, branch, auditInput, `checkout:${branch}:${bukuKasId}`, createdAt),
		buildOrderCreatedStatement(db, branch, {
			bukuKasId,
			idempotencyKey,
			...notificationOrigin,
			createdAt
		})
	);

	let d1Meta: string | null = null;
	try {
		d1Meta = summarizeD1Meta(await db.batch(statements));
	} catch (error) {
		// Request paralel dengan key yang sama bisa menang lebih dulu: hasilnya dikembalikan, bukan error.
		const duplicate = await getExistingByIdempotency(
			db,
			branch,
			idempotencyKey,
			idempotencyAvailable
		);
		if (duplicate) {
			return buildCommittedResult(duplicate, {
				platform,
				branch,
				requestFingerprint,
				paymentMethod,
				cashReceived,
				receiptFallback: (row) =>
					buildReceiptFromQuote(quote, {
						totalAmount: row.nominal,
						cashReceived,
						paymentMethod,
						committedAt: createdAt,
						customerName,
						settings: null
					})
			});
		}
		return await failCheckoutCommit(error, {
			platform,
			branch,
			session,
			idempotencyKey,
			totalAmount,
			totalQty,
			stockDeductions,
			ingredientDeductions
		});
	}

	// Intent is already durable. Audit delivery is owned by the scheduled drain, not request lifetime.
	await publishCheckoutEvents(platform, branch, {
		bukuKasId,
		transactionId,
		ingredientIds: Array.from(ingredientDeductions.keys())
	});
	// Pengiriman berjalan setelah commit; kegagalan provider tidak mengubah hasil checkout.
	void kickOrderNotifications(platform, branch);

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
			nomor_harian: nomorHarian,
			tanggal_nomor: salesDate,
			receipt: receiptSnapshot
		}
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function executeCheckoutForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: CheckoutSession,
	rawBody: unknown
) {
	return executeCheckout({
		db: getD1Database(platform?.env as Record<string, unknown> | undefined, branch),
		branch,
		session,
		platform,
		rawBody
	});
}
