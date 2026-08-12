import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import type { Product, Category, AddOn } from '$lib/types/product';
import { smartCache, CACHE_KEYS } from '$lib/utils/cache';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
	dbGet,
	dbGetStrict,
	type DataRecord,
	type ReadResource
} from '$lib/services/dataApiClient';
import { catalogStore } from '$lib/utils/idbStores';
import {
	isPosCatalogSnapshot,
	type PosCatalogLoadResult,
	type PosCatalogSnapshot
} from '$lib/types/posCatalog';

interface TableSnapshot {
	version: 1;
	data: DataRecord[];
	updated_at: string;
}

function isTableSnapshot(value: unknown): value is TableSnapshot {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const snapshot = value as Partial<TableSnapshot>;
	return snapshot.version === 1 && Array.isArray(snapshot.data);
}

export class ProductService {
	private static instance: ProductService;

	static getInstance(): ProductService {
		if (!ProductService.instance) ProductService.instance = new ProductService();
		return ProductService.instance;
	}

	private async getCachedTable(table: ReadResource, cacheKey: string, offlineKeyPrefix: string) {
		const branch = selectedBranch.value || 'default';
		const offlineKey = `table:${offlineKeyPrefix}:${branch}`;
		const stored = await idbGet<unknown>(offlineKey, catalogStore);
		const offlineData = isTableSnapshot(stored) ? stored.data : [];
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			return offlineData;
		}
		try {
			const data = await smartCache.get(`${cacheKey}_${branch}`, async () => dbGetStrict(table), {
				ttl: 180000,
				backgroundRefresh: true
			});
			await idbSet(
				offlineKey,
				{
					version: 1,
					data: data || [],
					updated_at: new Date().toISOString()
				} satisfies TableSnapshot,
				catalogStore
			);
			return data || [];
		} catch {
			return offlineData;
		}
	}

	async getPosCatalog(): Promise<PosCatalogLoadResult> {
		const branch = selectedBranch.value || 'default';
		const key = `pos-catalog:v2:${branch}`;
		const stored = await idbGet<unknown>(key, catalogStore);
		const cached = isPosCatalogSnapshot(stored) && stored.branch === branch ? stored : null;
		const fallback = (message?: string): PosCatalogLoadResult =>
			cached
				? { ...cached, source: 'cache', error: message }
				: {
						version: 2,
						branch,
						products: [],
						categories: [],
						addOns: [],
						fetched_at: '',
						expires_at: '',
						signing_key_id: '',
						source: 'unavailable',
						error: message || 'Katalog POS belum tersedia di perangkat'
					};

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			return fallback('Perangkat offline');
		}

		try {
			const response = await fetch('/api/pos/catalog', {
				headers: { Accept: 'application/json' },
				cache: 'no-store'
			});
			if (!response.ok) throw new Error(`Katalog POS gagal dimuat: HTTP ${response.status}`);
			const payload = (await response.json()) as unknown;
			if (!isPosCatalogSnapshot(payload) || payload.branch !== branch) {
				throw new Error('Format katalog POS tidak valid');
			}
			const snapshot = payload as PosCatalogSnapshot;
			await idbSet(key, snapshot, catalogStore);
			return { ...snapshot, source: 'network' };
		} catch (error) {
			return fallback(error instanceof Error ? error.message : 'Katalog POS gagal dimuat');
		}
	}

	async getProducts(): Promise<Product[]> {
		return this.getCachedTable('produk', CACHE_KEYS.PRODUCTS, 'products') as unknown as Product[];
	}

	async getCategories(): Promise<Category[]> {
		return this.getCachedTable(
			'kategori',
			CACHE_KEYS.CATEGORIES,
			'categories'
		) as unknown as Category[];
	}

	async getAddOns(): Promise<AddOn[]> {
		return this.getCachedTable('tambahan', CACHE_KEYS.ADDONS, 'addons') as unknown as AddOn[];
	}

	async getIngredients() {
		const branch = selectedBranch.value || 'default';
		return smartCache.get(`ingredients_${branch}`, async () => dbGet('bahan'), {
			ttl: 180000,
			backgroundRefresh: true
		});
	}

	async getProductRecipes(productId?: string | number) {
		const params: Record<string, string> = productId ? { produk_id: String(productId) } : {};
		return dbGet('resep_produk', params);
	}

	async getHppSettings() {
		const branch = selectedBranch.value || 'default';
		const rows = await smartCache.get(`hpp_settings_${branch}`, async () => dbGet('hpp_settings'), {
			ttl: 180000,
			backgroundRefresh: true
		});
		return rows?.[0] || null;
	}
}

export const productService = ProductService.getInstance();
