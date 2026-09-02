import type { D1Database } from '@cloudflare/workers-types';
import { error as kitError } from '@sveltejs/kit';
import type { BranchId } from '$lib/server/branchResolver';
import type {
	ProductRow,
	RecipeRow,
	AddOnRow,
	CheckoutCapabilities
} from '$lib/server/checkout/types';
import { chunks, IN_QUERY_CHUNK_SIZE, assertActive } from '$lib/server/checkout/utils';

const checkoutCapabilityCache = new Map<string, Promise<CheckoutCapabilities>>();

// [CATATAN]: ── Schema introspection ────────────────────────────────────────────────────

async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
	const { results = [] } = (await db.prepare(`PRAGMA table_info(${table})`).all()) as {
		results?: Array<{ name?: string }>;
	};
	return results.some((row) => row.name === column);
}

async function hasTable(db: D1Database, table: string): Promise<boolean> {
	const row = (await db
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
		.bind(table)
		.first()) as { name?: string } | null;
	return Boolean(row?.name);
}

// [CATATAN]: ── Capability detection ────────────────────────────────────────────────────

export async function getCheckoutCapabilities(
	db: D1Database,
	branch: BranchId
): Promise<CheckoutCapabilities> {
	const key = String(branch);
	let cached = checkoutCapabilityCache.get(key);
	if (!cached) {
		cached = (async () => {
			const [
				stockTrackingAvailable,
				trackIngredientsColumn,
				bahanTable,
				resepTable,
				mutasiTable,
				idempotencyAvailable,
				dailySalesTable,
				dailyProductSalesTable,
				transactionProductNameColumn,
				transactionHppColumn
			] = await Promise.all([
				hasColumn(db, 'produk', 'lacak_stok'),
				hasColumn(db, 'produk', 'lacak_bahan'),
				hasTable(db, 'bahan'),
				hasTable(db, 'resep_produk'),
				hasTable(db, 'bahan_mutasi'),
				hasColumn(db, 'buku_kas', 'idempotency_key'),
				hasTable(db, 'ringkasan_penjualan_harian'),
				hasTable(db, 'penjualan_produk_harian'),
				hasColumn(db, 'transaksi_kasir', 'nama_produk'),
				hasColumn(db, 'transaksi_kasir', 'nominal_hpp')
			]);

			if (!idempotencyAvailable) {
				throw kitError(500, 'Integritas database: Kolom idempotency_key tidak ditemukan');
			}
			if (!stockTrackingAvailable) {
				throw kitError(500, 'Integritas database: Kolom lacak_stok tidak ditemukan');
			}
			if (!trackIngredientsColumn || !bahanTable || !resepTable || !mutasiTable) {
				throw kitError(500, 'Integritas database: Skema resep dan bahan baku tidak lengkap');
			}
			if (!dailySalesTable || !dailyProductSalesTable) {
				throw kitError(
					500,
					'Integritas database: Tabel ringkasan penjualan harian tidak ditemukan'
				);
			}
			if (!transactionProductNameColumn || !transactionHppColumn) {
				throw kitError(500, 'Integritas database: Kolom snapshot transaksi kasir tidak lengkap');
			}

			return {
				stockTrackingAvailable: true,
				ingredientTrackingAvailable: true,
				idempotencyAvailable: true,
				salesSummaryAvailable: true,
				transactionSnapshotAvailable: true
			};
		})().catch((error) => {
			checkoutCapabilityCache.delete(key);
			throw error;
		});
		checkoutCapabilityCache.set(key, cached);
	}
	return cached;
}

// [CATATAN]: ── Session lookup ──────────────────────────────────────────────────────────

export async function getActiveSessionId(db: D1Database, branch: BranchId): Promise<string | null> {
	const row = (await db
		.prepare(
			`SELECT id
			 FROM sesi_toko
			 WHERE cabang_id = ? AND is_active = 1
			 ORDER BY waktu_buka DESC
			 LIMIT 1`
		)
		.bind(branch)
		.first()) as { id: string } | null;
	return row?.id ?? null;
}

export async function getSessionIdById(
	db: D1Database,
	branch: BranchId,
	sessionId: unknown
): Promise<string | null> {
	if (typeof sessionId !== 'string' || !sessionId.trim()) return null;
	const row = (await db
		.prepare(
			`SELECT id
			 FROM sesi_toko
			 WHERE cabang_id = ? AND id = ?
			 LIMIT 1`
		)
		.bind(branch, sessionId.trim())
		.first()) as { id: string } | null;
	return row?.id ?? null;
}

// [CATATAN]: ── Idempotency check ───────────────────────────────────────────────────────

export async function getExistingByIdempotency(
	db: D1Database,
	branch: BranchId,
	idempotencyKey: string,
	idempotencyAvailable = true
) {
	if (!idempotencyAvailable) return null;

	return (await db
		.prepare(
			`SELECT id, transaction_id, nominal, jumlah, metode_bayar, request_fingerprint, receipt_snapshot, waktu
			 FROM buku_kas
			 WHERE cabang_id = ? AND idempotency_key = ?
			 LIMIT 1`
		)
		.bind(branch, idempotencyKey)
		.first()) as {
		id: string;
		transaction_id: string;
		nominal: number;
		jumlah: number;
		metode_bayar?: string | null;
		request_fingerprint?: string | null;
		receipt_snapshot?: string | null;
		waktu?: string | null;
	} | null;
}

// [CATATAN]: ── Product loading ─────────────────────────────────────────────────────────

export async function loadProducts(
	db: D1Database,
	branch: BranchId,
	productIds: string[],
	stockTrackingAvailable: boolean,
	ingredientTrackingAvailable: boolean,
	options: {
		allowInactive?: boolean;
		fallbackProducts?: Map<string, ProductRow>;
	} = {}
): Promise<Map<string, ProductRow>> {
	const rows: ProductRow[] = [];
	for (const part of chunks(productIds, IN_QUERY_CHUNK_SIZE)) {
		if (!part.length) continue;
		const placeholders = part.map(() => '?').join(',');
		const { results = [] } = (await db
			.prepare(
				`SELECT id, nama, harga, harga_jumbo, stok,
				 ${stockTrackingAvailable ? 'lacak_stok,' : ''}
				 ${ingredientTrackingAvailable ? 'lacak_bahan,' : ''}
				 is_active
				 FROM produk
				 WHERE cabang_id = ? AND id IN (${placeholders})`
			)
			.bind(branch, ...part)
			.all()) as { results?: ProductRow[] };
		rows.push(...results);
	}

	const products = new Map(rows.map((product) => [String(product.id), product]));
	for (const productId of productIds) {
		const product = products.get(productId) ?? options.fallbackProducts?.get(productId);
		if (!product) throw kitError(404, `Produk tidak ditemukan: ${productId}`);
		products.set(productId, product);
		if (!options.allowInactive) assertActive(product, product.nama);
	}
	return products;
}

// [CATATAN]: ── Recipe loading ──────────────────────────────────────────────────────────

export async function loadRecipesByProduct(
	db: D1Database,
	branch: BranchId,
	productIds: string[]
): Promise<Map<string, RecipeRow[]>> {
	const grouped = new Map<string, RecipeRow[]>();
	for (const part of chunks(productIds, IN_QUERY_CHUNK_SIZE)) {
		if (!part.length) continue;
		const placeholders = part.map(() => '?').join(',');
		const { results = [] } = (await db
			.prepare(
				`SELECT rp.produk_id, rp.bahan_id, b.nama AS bahan_name, b.satuan, rp.porsi, rp.jumlah_per_item,
				        rp.satuan_resep, rp.jumlah_dasar_per_item,
				        COALESCE(b.biaya_per_satuan, 0) AS biaya_per_satuan
				 FROM resep_produk rp
				 INNER JOIN bahan b ON b.cabang_id = rp.cabang_id AND b.id = rp.bahan_id
				 WHERE rp.cabang_id = ? AND rp.produk_id IN (${placeholders}) AND b.is_active = 1
				 ORDER BY rp.produk_id ASC, b.nama ASC`
			)
			.bind(branch, ...part)
			.all()) as { results?: RecipeRow[] };

		for (const row of results) {
			const rows = grouped.get(row.produk_id) || [];
			rows.push(row);
			grouped.set(row.produk_id, rows);
		}
	}
	return grouped;
}

// [CATATAN]: ── Add-on loading ──────────────────────────────────────────────────────────

export async function loadAddOns(
	db: D1Database,
	branch: BranchId,
	ids: string[],
	options: {
		allowInactive?: boolean;
		fallbackAddOns?: Map<string, AddOnRow>;
	} = {}
): Promise<Map<string, AddOnRow>> {
	if (!ids.length) return new Map();
	const rows: AddOnRow[] = [];
	for (const part of chunks(ids, IN_QUERY_CHUNK_SIZE)) {
		if (!part.length) continue;
		const placeholders = part.map(() => '?').join(',');
		const { results = [] } = (await db
			.prepare(
				`SELECT t.id, t.nama, t.harga, t.is_active,
				        t.bahan_id, t.jumlah_bahan, t.satuan_resep, t.jumlah_dasar_per_item,
				        b.nama AS bahan_nama, b.satuan AS bahan_satuan,
				        COALESCE(b.biaya_per_satuan, 0) AS bahan_biaya_per_satuan
				 FROM tambahan t
				 LEFT JOIN bahan b ON b.cabang_id = t.cabang_id AND b.id = t.bahan_id
				 WHERE t.cabang_id = ? AND t.id IN (${placeholders})`
			)
			.bind(branch, ...part)
			.all()) as { results?: AddOnRow[] };
		rows.push(...results);
	}

	const addOns = new Map(rows.map((addOn) => [String(addOn.id), addOn]));
	for (const id of ids) {
		const addOn = addOns.get(id) ?? options.fallbackAddOns?.get(id);
		if (!addOn) throw kitError(404, 'Tambahan tidak ditemukan');
		addOns.set(id, addOn);
		if (!options.allowInactive) assertActive(addOn, addOn.nama);
	}
	return addOns;
}
