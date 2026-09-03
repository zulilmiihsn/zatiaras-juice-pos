import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from '$lib/server/branchResolver';

// [CATATAN]: ── Input types ─────────────────────────────────────────────────────────────

export interface PosTransactionItemInput {
	product_id?: string | null;
	nama_kustom?: string | null;
	custom_price?: number | string | null;
	jumlah: number;
	add_on_ids?: Array<string | number>;
	porsi?: string | null;
	gula?: string | null;
	es?: string | null;
	catatan?: string | null;
	product_price_token?: string | null;
	add_on_price_tokens?: string[];
}

export interface PosTransactionInput {
	idempotency_key?: string;
	nama_pelanggan?: string | null;
	metode_bayar?: string;
	cash_received?: number | string | null;
	items?: PosTransactionItemInput[];
	quote_token?: string;
	mode?: 'online' | 'offline_replay';
	queued_at?: number;
	store_session_id?: string | null;
}

// [CATATAN]: ── DB row types ────────────────────────────────────────────────────────────

export interface ProductRow {
	id: string;
	nama: string;
	harga: number;
	harga_jumbo?: number | null;
	stok: number | null;
	lacak_stok?: number | boolean | null;
	lacak_bahan?: number | boolean | null;
	is_active: number | boolean | null;
}

export interface RecipeRow {
	produk_id: string;
	bahan_id: string;
	bahan_name: string;
	satuan: string;
	porsi?: string | null;
	jumlah_per_item: number;
	satuan_resep?: string | null;
	jumlah_dasar_per_item?: number | null;
	biaya_per_satuan: number;
}

export interface AddOnRow {
	id: string;
	nama: string;
	harga: number;
	is_active: number | boolean | null;
	bahan_id?: string | null;
	jumlah_bahan?: number | null;
	satuan_resep?: string | null;
	jumlah_dasar_per_item?: number | null;
	bahan_nama?: string | null;
	bahan_satuan?: string | null;
	bahan_biaya_per_satuan?: number | null;
}

// [CATATAN]: ── Capability detection ────────────────────────────────────────────────────

export interface CheckoutCapabilities {
	stockTrackingAvailable: boolean;
	ingredientTrackingAvailable: boolean;
	idempotencyAvailable: boolean;
	salesSummaryAvailable: boolean;
	transactionSnapshotAvailable: boolean;
}

// [CATATAN]: ── Intermediate computation types ──────────────────────────────────────────

export interface NormalizedItemInput {
	source: PosTransactionItemInput;
	productId: string | null;
	addOnIds: string[];
	jumlah: number;
	pricingSnapshot?: {
		product_name: string;
		product_price: number;
		addOns: Array<{ id: string; nama: string; harga: number }>;
	};
}

export interface PosQuoteItem {
	source: PosTransactionItemInput;
	product_name: string;
	product_price: number;
	add_ons: Array<{ id: string; nama: string; harga: number }>;
	line_total: number;
}

export interface PosQuoteTokenData {
	items: PosQuoteItem[];
	total_amount: number;
	total_qty: number;
}

export interface ComputedTransactionItem {
	id: string;
	buku_kas_id: string;
	produk_id: string | null;
	nama_kustom: string | null;
	jumlah: number;
	nominal: number;
	harga: number;
	product_name: string;
	harga_dasar: number;
	total_tambahan: number;
	snapshot_tambahan: string | null;
	gula: string | null;
	es: string | null;
	catatan: string | null;
	snapshot_hpp: string | null;
	nominal_hpp: number;
	transaction_id: string;
}

export type StockDeductions = Map<string, { nama: string; jumlah: number }>;
export type IngredientDeductions = Map<
	string,
	{ nama: string; satuan: string; jumlah: number; products: string[] }
>;

// [CATATAN]: ── Context passed through the checkout pipeline ────────────────────────────

export interface CheckoutContext {
	db: D1Database;
	branch: BranchId;
	capabilities: CheckoutCapabilities;
	session: { userId: string; username?: string; role: string };
	platform: App.Platform | undefined;
}
