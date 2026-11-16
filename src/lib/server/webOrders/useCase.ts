/**
 * Pesanan web di Antrean POS.
 *
 * Alur: pelanggan memesan di situs lalu membayar QRIS statis dengan nominal unik. Pesanan tidak
 * masuk buku kas sampai kasir memastikan uang QRIS masuk dan menekan Terima. Saat itu
 * dijalankan checkout POS biasa (idempoten per kode web), jadi omzet, stok, struk, dan nomor
 * antrean sama seperti pesanan dari kasir dan kartunya langsung berada di tab Diproses.
 *
 * Situs pesan adalah sumber pesanan menunggu; POS tidak menyalin tabelnya. Gagal menghubungi
 * situs tidak pernah mengganggu pesanan kasir: daftar kosong dengan penanda `unavailable`.
 */
import type { BranchContext } from '../branchResolver';
import { getD1Database } from '../branchResolver';
import { executeCheckout } from '../checkout/checkoutUseCase';
import { buildPosQuote } from '../checkout/quoteUseCase';
import type { CheckoutSession } from '../checkout/types';
import { getHeaderByIdempotency } from '../orderQueue/repository';
import { listWebOrders, readWebOrdersConfig, setWebOrderState, WEB_ORDER_ID } from './client';
import {
	buildCheckoutItems,
	customerLabel,
	outletForBranch,
	webKey,
	webOrderIdFromKey
} from './mapping';
import { findCommittedKeys, loadProductIdsByName } from './repository';
import {
	WebOrderError,
	type FetchLike,
	type WebOrder,
	type WebOrderState,
	type WebOrdersConfig
} from './types';

export interface WebOrderDeps {
	fetchImpl?: FetchLike;
}

export interface WebOrderList {
	/** False bila situs pesan belum disambungkan atau cabang ini tidak menerima pesanan web. */
	enabled: boolean;
	/** True bila situs pesan tidak bisa dihubungi saat ini; daftar kosong bukan berarti tidak ada pesanan. */
	unavailable: boolean;
	orders: WebOrder[];
}

type Env = Record<string, unknown> | undefined;

function setup(
	platform: App.Platform | undefined,
	branch: BranchContext
): { config: WebOrdersConfig; outletId: string } | null {
	const config = readWebOrdersConfig(platform?.env as Env);
	const outletId = outletForBranch(branch);
	return config && outletId ? { config, outletId } : null;
}

function requireSetup(platform: App.Platform | undefined, branch: BranchContext) {
	const ready = setup(platform, branch);
	if (!ready) throw new WebOrderError(503, 'Pesanan web belum tersambung untuk cabang ini');
	return ready;
}

/** Kerja tambahan yang tidak boleh menggagalkan respons utama (sinkron status ke situs pesan). */
export function scheduleBestEffort(
	platform: App.Platform | undefined,
	label: string,
	task: () => Promise<void>
): Promise<void> {
	const run = task().catch((error: unknown) => {
		console.warn(`[web-orders] ${label} gagal (best-effort)`, error);
	});
	platform?.context?.waitUntil(run);
	return run;
}

async function pushStates(
	config: WebOrdersConfig,
	outletId: string,
	id: string,
	states: WebOrderState[],
	fetchImpl: FetchLike | undefined
): Promise<void> {
	for (const to of states) {
		// 'illegal' berarti situs pesan sudah di status itu atau lebih jauh: tidak perlu diulang.
		await setWebOrderState(config, outletId, id, to, fetchImpl);
	}
}

/** Status situs pesan yang seharusnya bagi pesanan yang sudah menjadi penjualan POS. */
function statesFromHeader(header: {
	preparation_state: string | null;
	preparation_started_at: string | null;
}): WebOrderState[] {
	if (header.preparation_state === 'done') return ['CONFIRMED', 'PREPARING', 'READY'];
	if (header.preparation_started_at) return ['CONFIRMED', 'PREPARING'];
	return ['CONFIRMED'];
}

export async function listWebOrdersForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	deps: WebOrderDeps = {}
): Promise<WebOrderList> {
	const ready = setup(platform, branch);
	if (!ready) return { enabled: false, unavailable: false, orders: [] };
	let orders: WebOrder[];
	try {
		orders = await listWebOrders(ready.config, ready.outletId, deps.fetchImpl);
	} catch (error) {
		if (error instanceof WebOrderError) return { enabled: true, unavailable: true, orders: [] };
		throw error;
	}
	const db = getD1Database(platform?.env as Env, branch);
	const committed = await findCommittedKeys(
		db,
		branch,
		orders.map((order) => webKey(order.id))
	);
	const waiting: WebOrder[] = [];
	for (const order of orders) {
		if (!committed.has(webKey(order.id))) {
			waiting.push(order);
			continue;
		}
		// Sudah jadi penjualan POS tetapi situs pesan belum tahu (sinkron saat Terima gagal): susul.
		void scheduleBestEffort(platform, `susul status ${order.id}`, async () => {
			const header = await getHeaderByIdempotency(db, branch, webKey(order.id));
			if (header) {
				await pushStates(
					ready.config,
					ready.outletId,
					order.id,
					statesFromHeader(header),
					deps.fetchImpl
				);
			}
		});
	}
	return { enabled: true, unavailable: false, orders: waiting };
}

export interface AcceptWebOrderResult {
	nomor_harian: number | null;
	idempotent: boolean;
	/** False bila checkout berhasil tetapi situs pesan belum bisa diberi tahu; disusul otomatis. */
	webSynced: boolean;
}

export async function acceptWebOrder(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: CheckoutSession,
	orderId: string,
	deps: WebOrderDeps = {}
): Promise<AcceptWebOrderResult> {
	if (!WEB_ORDER_ID.test(orderId)) throw new WebOrderError(400, 'Kode pesanan web tidak valid');
	const { config, outletId } = requireSetup(platform, branch);

	let orders: WebOrder[];
	try {
		orders = await listWebOrders(config, outletId, deps.fetchImpl);
	} catch (error) {
		if (error instanceof WebOrderError) {
			throw new WebOrderError(502, 'Situs pesan tidak merespons. Coba lagi sebentar.');
		}
		throw error;
	}
	const order = orders.find((candidate) => candidate.id === orderId);
	const key = webKey(orderId);
	const db = getD1Database(platform?.env as Env, branch);
	if (!order) {
		// Sudah diterima di perangkat lain: jawab idempoten lewat checkout yang sama bila datanya ada.
		const committed = await findCommittedKeys(db, branch, [key]);
		if (committed.has(key)) return { nomor_harian: null, idempotent: true, webSynced: true };
		throw new WebOrderError(404, 'Pesanan web tidak ditemukan atau sudah kedaluwarsa');
	}

	const { items, missing } = buildCheckoutItems(order, await loadProductIdsByName(db, branch));
	if (missing.length > 0) {
		throw new WebOrderError(
			422,
			`Menu belum cocok dengan POS: ${missing.join(', ')}. Samakan nama menu atau tolak pesanan ini`
		);
	}

	// Harga selalu dihitung ulang dari katalog POS. Beda dengan harga web ditolak, bukan diam-diam dipilih.
	const quote = await buildPosQuote(platform, branch, session, { items });
	if (quote.total_amount !== order.total) {
		throw new WebOrderError(
			409,
			`Harga di POS (Rp${quote.total_amount.toLocaleString('id-ID')}) berbeda dari harga di web (Rp${order.total.toLocaleString('id-ID')}). Tolak pesanan ini atau samakan harga menu`
		);
	}

	const result = await executeCheckout({
		db,
		branch,
		session,
		platform,
		rawBody: {
			idempotency_key: key,
			metode_bayar: 'qris',
			nama_pelanggan: customerLabel(order),
			items,
			quote_token: quote.quote_token
		}
	});

	let webSynced = true;
	try {
		await pushStates(config, outletId, orderId, ['CONFIRMED', 'PREPARING'], deps.fetchImpl);
	} catch (error) {
		if (!(error instanceof WebOrderError)) throw error;
		webSynced = false; // penjualan sudah sah; daftar berikutnya menyusul status di situs pesan
	}
	return { nomor_harian: result.data.nomor_harian, idempotent: result.idempotent, webSynced };
}

export async function rejectWebOrder(
	platform: App.Platform | undefined,
	branch: BranchContext,
	orderId: string,
	deps: WebOrderDeps = {}
): Promise<void> {
	if (!WEB_ORDER_ID.test(orderId)) throw new WebOrderError(400, 'Kode pesanan web tidak valid');
	const { config, outletId } = requireSetup(platform, branch);
	const db = getD1Database(platform?.env as Env, branch);
	if ((await findCommittedKeys(db, branch, [webKey(orderId)])).size > 0) {
		throw new WebOrderError(409, 'Pesanan ini sudah diterima dan masuk penjualan');
	}
	const result = await setWebOrderState(config, outletId, orderId, 'CANCELLED', deps.fetchImpl);
	if (result === 'not_found') throw new WebOrderError(404, 'Pesanan web tidak ditemukan');
	if (result === 'illegal') {
		throw new WebOrderError(409, 'Pesanan sudah diproses atau kedaluwarsa, tidak bisa ditolak');
	}
}

/**
 * Teruskan kemajuan antrean POS ke situs pesan agar pelanggan melihat Diproses dan Siap diambil.
 * Hanya untuk penjualan yang berasal dari pesanan web (kunci `web-ZT-xxxxxx`); lainnya diabaikan.
 */
export async function syncWebOrderProgress(
	platform: App.Platform | undefined,
	branch: BranchContext,
	idempotencyKey: string,
	target: 'pending' | 'processing' | 'done',
	deps: WebOrderDeps = {}
): Promise<void> {
	const orderId = webOrderIdFromKey(idempotencyKey);
	const ready = orderId ? setup(platform, branch) : null;
	if (!orderId || !ready) return;
	const states: WebOrderState[] =
		target === 'processing' ? ['PREPARING'] : target === 'done' ? ['READY'] : [];
	await pushStates(ready.config, ready.outletId, orderId, states, deps.fetchImpl);
}
