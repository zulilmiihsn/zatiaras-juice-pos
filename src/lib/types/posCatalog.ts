import type { AddOn, Category, Product, Ingredient } from '$lib/types/product';

export type PosCatalogSource = 'network' | 'cache' | 'unavailable';

export interface PosRecipeItem {
	id: string;
	produk_id: string;
	bahan_id: string;
	porsi?: string | null;
	jumlah_per_item: number;
	satuan_resep?: string | null;
	jumlah_dasar_per_item?: number | null;
}

export interface PosCatalogSnapshot {
	version: 2;
	branch: string;
	products: Product[];
	categories: Category[];
	addOns: AddOn[];
	ingredients?: Ingredient[];
	recipes?: PosRecipeItem[];
	fetched_at: string;
	expires_at: string;
	signing_key_id: string;
}

export interface PosCatalogLoadResult extends PosCatalogSnapshot {
	source: PosCatalogSource;
	error?: string;
}

export function isPosCatalogSnapshot(value: unknown): value is PosCatalogSnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const snapshot = value as Partial<PosCatalogSnapshot>;
	return (
		snapshot.version === 2 &&
		typeof snapshot.branch === 'string' &&
		Array.isArray(snapshot.products) &&
		Array.isArray(snapshot.categories) &&
		Array.isArray(snapshot.addOns) &&
		typeof snapshot.fetched_at === 'string' &&
		typeof snapshot.expires_at === 'string' &&
		typeof snapshot.signing_key_id === 'string'
	);
}
