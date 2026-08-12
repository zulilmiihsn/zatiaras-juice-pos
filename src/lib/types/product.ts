/**
 * 🏷️ PRODUCT TYPE DEFINITIONS
 *
 * Type definitions untuk semua entity yang berkaitan dengan produk
 */

// ============================================================================
// 🍹 PRODUCT INTERFACES
// ============================================================================

export interface Product {
	id: string | number;
	nama: string;
	harga: number;
	stok?: number | null;
	lacak_stok?: boolean | number | null;
	lacak_bahan?: boolean | number | null;
	kategori_id?: string | number | null;
	tipe: 'minuman' | 'makanan' | 'snack';
	gambar?: string;
	deskripsi?: string;
	ekstra_ids: Array<string | number>;
	is_active: boolean;
	created_at?: string;
	updated_at?: string;
}

export interface Category {
	id: string | number;
	nama: string;
	deskripsi?: string;
	is_active: boolean;
	created_at?: string;
	updated_at?: string;
	price_token?: string;
}

export interface AddOn {
	id: string | number;
	nama: string;
	harga: number;
	is_active: boolean;
	created_at?: string;
	updated_at?: string;
	price_token?: string;
}

export interface Ingredient {
	id: string | number;
	nama: string;
	satuan: string;
	stok_saat_ini: number;
	ambang_stok?: number;
	yield_persen?: number;
	biaya_per_satuan?: number;
	jumlah_beli_terakhir?: number;
	biaya_beli_terakhir?: number;
	is_active: boolean;
	created_at?: string;
	updated_at?: string;
}

export interface HppSettings {
	id: string;
	cabang_id: string;
	sewa_bulanan: number;
	listrik_bulanan: number;
	air_bulanan: number;
	gaji_bulanan: number;
	lainnya_bulanan: number;
	target_item_bulanan: number;
	created_at?: string;
	updated_at?: string;
}

export interface ProductRecipe {
	id: string | number;
	produk_id: string | number;
	bahan_id: string | number;
	jumlah_per_item: number;
	created_at?: string;
	updated_at?: string;
}
