import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { CACHE_TTL_MS } from '$lib/constants/cache';
import type { Product, Category, AddOn } from '$lib/types/product';
import { smartCache, CACHE_KEYS } from '$lib/utils/cache';
import { get as idbGet, update as idbUpdate } from 'idb-keyval';
import {
	dbGet,
	dbGetStrict,
	type DataRecord,
	type ReadResource
} from '$lib/services/dataApiClient';
import { catalogStore } from '$lib/utils/idbStores';
import { bestEffortCache } from '$lib/utils/cachePersistence';
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

	// Generasi per key. Hanya flight terkini boleh commit;
	// commit gugur bila cabang pindah atau flight baru susul.
	private tableFlight = new Map<string, number>();

	private beginTableFlight(key: string): number {
		const next = (this.tableFlight.get(key) ?? 0) + 1;
		this.tableFlight.set(key, next);
		return next;
	}

	private tableFlightAlive(
		key: string,
		generation: number,
		branch: string,
		contextEpoch: number
	): boolean {
		return (
			this.tableFlight.get(key) === generation &&
			selectedBranch.contextEpoch === contextEpoch &&
			(selectedBranch.value || 'default') === branch
		);
	}

	private async getCachedTable(table: ReadResource, cacheKey: string, offlineKeyPrefix: string) {
		// Capture cabang sekali; fetch pakai cabang itu,
		// namespace cache + request sama, commit tolak bila konteks pindah.
		const branch = selectedBranch.value || 'default';
		const contextEpoch = selectedBranch.contextEpoch;
		const namespacedKey = `${cacheKey}_${branch}`;
		const generation = this.beginTableFlight(namespacedKey);
		const guard = smartCache.createCommitGuard(namespacedKey, () =>
			this.tableFlightAlive(namespacedKey, generation, branch, contextEpoch)
		);
		const offlineKey = `table:${offlineKeyPrefix}:${branch}`;
		// IDB best-effort: gagal buka/baca tak boleh melumpuhkan pemuatan
		// produk (jatuh ke network, bukan reject diam-diam).
		const stored = await bestEffortCache(() => idbGet<unknown>(offlineKey, catalogStore));
		const offlineData = isTableSnapshot(stored) ? stored.data : [];
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			return offlineData;
		}
		try {
			const data = await smartCache.get(namespacedKey, async () => dbGetStrict(table, {}, branch), {
				ttl: 180000,
				backgroundRefresh: true,
				guard
			});
			if (!guard()) return data || [];
			const snapshot: TableSnapshot = {
				version: 1,
				data: data || [],
				updated_at: new Date().toISOString()
			};
			// Guard dibaca di transaksi IDB juga: branch/invalidate bisa berubah saat membuka store.
			await bestEffortCache(() =>
				idbUpdate<unknown>(offlineKey, (current) => (guard() ? snapshot : current), catalogStore)
			);
			return data || [];
		} catch {
			return offlineData;
		}
	}

	async getPosCatalog(): Promise<PosCatalogLoadResult> {
		const branch = selectedBranch.value || 'default';
		const key = `pos-catalog:v2:${branch}`;
		const epoch = selectedBranch.contextEpoch;
		const guard = smartCache.createCommitGuard(
			key,
			() => selectedBranch.value === branch && selectedBranch.contextEpoch === epoch
		);
		const stored = await bestEffortCache(() => idbGet<unknown>(key, catalogStore));
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
			await bestEffortCache(() =>
				idbUpdate<unknown>(key, (current) => (guard() ? snapshot : current), catalogStore)
			);
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

	async getIngredients(forceRefresh = false) {
		const branch = selectedBranch.value || 'default';
		const contextEpoch = selectedBranch.contextEpoch;
		const key = `ingredients_${branch}`;
		if (forceRefresh) {
			await smartCache.invalidate(key);
		}
		const generation = this.beginTableFlight(key);
		const guard = smartCache.createCommitGuard(key, () =>
			this.tableFlightAlive(key, generation, branch, contextEpoch)
		);
		return smartCache.get(key, async () => dbGet('bahan', {}, branch), {
			ttl: CACHE_TTL_MS.SHORT,
			backgroundRefresh: true,
			guard
		});
	}

	async getProductRecipes(productId?: string | number) {
		const params: Record<string, string> = productId ? { produk_id: String(productId) } : {};
		return dbGet('resep_produk', params);
	}

	async getHppSettings() {
		const branch = selectedBranch.value || 'default';
		const contextEpoch = selectedBranch.contextEpoch;
		const key = `hpp_settings_${branch}`;
		const generation = this.beginTableFlight(key);
		const guard = smartCache.createCommitGuard(key, () =>
			this.tableFlightAlive(key, generation, branch, contextEpoch)
		);
		const rows = await smartCache.get(key, async () => dbGet('hpp_settings', {}, branch), {
			ttl: 180000,
			backgroundRefresh: true,
			guard
		});
		return rows?.[0] || null;
	}
}

export const productService = ProductService.getInstance();
