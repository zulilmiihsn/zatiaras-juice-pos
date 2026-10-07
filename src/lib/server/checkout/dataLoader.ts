import type { D1Database } from '@cloudflare/workers-types';
import { error as kitError } from '@sveltejs/kit';
import type { BranchContext, BranchId } from '$lib/server/branchResolver';
import type {
	ProductRow,
	RecipeRow,
	AddOnRow,
	CheckoutCapabilities
} from '$lib/server/checkout/types';
import { chunks, IN_QUERY_CHUNK_SIZE, assertActive } from '$lib/server/checkout/utils';
import type { ReceiptSnapshotSettings } from '$lib/utils/receiptSnapshot';

// [CATATAN]: ── Capability detection ────────────────────────────────────────────────────

async function tableNames(db: D1Database, names: string[]): Promise<Set<string>> {
	const placeholders = names.map(() => '?').join(',');
	const rows = (await db
		.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
		.bind(...names)
		.all()) as { results?: Array<{ name?: string }> };
	return new Set((rows.results ?? []).map((r) => String(r?.name)));
}

async function columnNames(db: D1Database, table: string): Promise<Set<string>> {
	const rows = (await db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all()) as {
		results?: Array<{ name?: string }>;
	};
	return new Set((rows.results ?? []).map((r) => String(r?.name)));
}

export async function getCheckoutCapabilities(
	db: D1Database,
	_branch: BranchId
): Promise<CheckoutCapabilities> {
	// Sengaja tanpa fallback: metadata gagal = DB tidak sehat = gagal tertutup
	// di route (tanpa commit), bukan degradasi diam-diam atas data uang.
	const [tables, bukuKas, produk, transaksiKasir] = await Promise.all([
		tableNames(db, [
			'pos_nomor_harian',
			'resep_produk',
			'ringkasan_penjualan_harian',
			'penjualan_produk_harian'
		]),
		columnNames(db, 'buku_kas'),
		columnNames(db, 'produk'),
		columnNames(db, 'transaksi_kasir')
	]);
	return {
		stockTrackingAvailable: produk.has('lacak_stok'),
		ingredientTrackingAvailable: produk.has('lacak_bahan') && tables.has('resep_produk'),
		idempotencyAvailable: bukuKas.has('idempotency_key'),
		salesSummaryAvailable:
			tables.has('ringkasan_penjualan_harian') && tables.has('penjualan_produk_harian'),
		transactionSnapshotAvailable: transaksiKasir.has('nama_produk'),
		nomorHarianAvailable:
			tables.has('pos_nomor_harian') && bukuKas.has('nomor_harian') && bukuKas.has('tanggal_nomor')
	};
}

export async function loadReceiptSettingsSnapshot(
	db: D1Database,
	branch: BranchContext
): Promise<ReceiptSnapshotSettings | null> {
	try {
		const row = await db
			.prepare(
				'SELECT nama_toko, alamat, telepon, instagram, ucapan FROM pengaturan WHERE cabang_id = ? AND kunci IS NULL LIMIT 1'
			)
			.bind(branch)
			.first<{
				nama_toko?: string | null;
				alamat?: string | null;
				telepon?: string | null;
				instagram?: string | null;
				ucapan?: string | null;
			}>();
		const namaToko = row?.nama_toko?.trim();
		if (!namaToko) return null;
		return {
			nama_toko: namaToko,
			alamat: row?.alamat || undefined,
			telepon: row?.telepon || undefined,
			instagram: row?.instagram || undefined,
			ucapan: row?.ucapan || undefined
		};
	} catch {
		// Receipt branding is optional; a sale still commits and reprint marks the missing header.
		return null;
	}
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
			`SELECT id, transaction_id, nominal, jumlah, metode_bayar, request_fingerprint, receipt_snapshot, waktu,
				nomor_harian, tanggal_nomor
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
		nomor_harian?: number | null;
		tanggal_nomor?: string | null;
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
