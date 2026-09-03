import { productService } from '$lib/services/productService';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { reportCacheMetrics } from '$lib/utils/cacheMetrics';
import { throttle } from '$lib/utils/performance';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { browser } from '$app/environment';
import type { AddOn, Category, Product, Ingredient } from '$lib/types/product';
import type { PosCatalogSource, PosRecipeItem } from '$lib/types/posCatalog';

export type PosProduct = Product;
export type PosCategory = Category;
export type PosAddOn = AddOn;

export function createPosState() {
	let produkData = $state<PosProduct[]>([]);
	let kategoriData = $state<PosCategory[]>([]);
	let tambahanData = $state<PosAddOn[]>([]);
	let bahanData = $state<Ingredient[]>([]);
	let resepData = $state<PosRecipeItem[]>([]);
	let isLoadingProducts = $state(true);
	let posLoadError = $state('');
	let catalogSource = $state<PosCatalogSource>('unavailable');
	let catalogFetchedAt = $state('');
	let catalogExpiresAt = $state('');
	let catalogStatusMessage = $state('');

	let posRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let posRefreshInFlight = false;
	let lastPOSPayloadFingerprint = '';
	let isInitialLoad = true;

	async function loadPOSData() {
		try {
			const catalog = await productService.getPosCatalog();
			const nextProducts = catalog.products;
			const nextCategories = catalog.categories;
			const nextAddons = catalog.addOns;
			const nextIngredients = catalog.ingredients || [];
			const nextRecipes = catalog.recipes || [];

			catalogSource = catalog.source;
			catalogFetchedAt = catalog.fetched_at;
			catalogExpiresAt = catalog.expires_at;
			catalogStatusMessage = catalog.error || '';
			if (browser && catalog.expires_at) {
				localStorage.setItem('pos_catalog_expires_at', catalog.expires_at);
			}
			if (catalog.source === 'unavailable') {
				posLoadError = catalog.error || 'Katalog POS belum tersedia. Coba muat ulang.';
				return;
			}

			const nextFingerprint = [
				(nextProducts || []).length,
				(nextProducts || [])
					.map(
						(item) =>
							`${item?.id || ''}:${item?.harga ?? 0}:${item?.harga_jumbo ?? ''}:${item?.stok ?? ''}`
					)
					.join(','),
				(nextCategories || []).length,
				(nextCategories || []).map((item) => item?.id || '').join(','),
				(nextAddons || []).length,
				(nextAddons || []).map((item) => `${item?.id || ''}:${item?.harga ?? 0}`).join(','),
				(nextIngredients || []).length,
				(nextIngredients || [])
					.map((item) => `${item?.id || ''}:${item?.stok_saat_ini ?? 0}`)
					.join(','),
				(nextRecipes || []).length
			].join('|');

			if (nextFingerprint === lastPOSPayloadFingerprint) {
				posLoadError = '';
				await reportCacheMetrics('pos');
				return;
			}

			lastPOSPayloadFingerprint = nextFingerprint;
			produkData = nextProducts || [];
			kategoriData = nextCategories || [];
			tambahanData = nextAddons || [];
			bahanData = nextIngredients || [];
			resepData = nextRecipes || [];
			posLoadError = '';
			await reportCacheMetrics('pos');
		} catch (error) {
			posLoadError = 'Koneksi atau data POS bermasalah. Coba muat ulang daftar menu.';
		}
	}

	async function retryLoadPOSData() {
		isLoadingProducts = true;
		await loadPOSData();
		isLoadingProducts = false;
	}

	function schedulePOSRefresh(delayMs = 180) {
		if (posRefreshTimer) {
			clearTimeout(posRefreshTimer);
		}

		posRefreshTimer = setTimeout(async () => {
			posRefreshTimer = null;
			if (posRefreshInFlight) return;

			posRefreshInFlight = true;
			try {
				await loadPOSData();
			} finally {
				posRefreshInFlight = false;
			}
		}, delayMs);
	}

	let realtimeDisposers: Array<() => void> = [];

	function setupRealtimeSubscriptions() {
		realtimeDisposers.forEach((d) => d());
		realtimeDisposers = [
			realtimeManager.subscribe('produk', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('kategori', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('tambahan', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('bahan', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('bahan_mutasi', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('resep_produk', async () => {
				schedulePOSRefresh();
			}),
			realtimeManager.subscribe('transaksi_kasir', async () => {
				schedulePOSRefresh();
			})
		];
	}

	$effect(() => {
		let throttledSync: (() => void) | null = null;

		(async () => {
			await loadPOSData();
			setupRealtimeSubscriptions();
			isLoadingProducts = false;

			if (browser) {
				throttledSync = throttle(async () => {
					await loadPOSData();
				}, 1000);
				window.addEventListener('online', throttledSync);
			}
		})();

		return () => {
			realtimeDisposers.forEach((d) => d());
			realtimeDisposers = [];
			if (posRefreshTimer) {
				clearTimeout(posRefreshTimer);
				posRefreshTimer = null;
			}
			if (browser && throttledSync) {
				window.removeEventListener('online', throttledSync);
			}
		};
	});

	$effect(() => {
		const branch = selectedBranch.value;
		if (!isInitialLoad && branch) {
			loadPOSData();
		}
		isInitialLoad = false;
	});

	return {
		get produkData() {
			return produkData;
		},
		get kategoriData() {
			return kategoriData;
		},
		get tambahanData() {
			return tambahanData;
		},
		get bahanData() {
			return bahanData;
		},
		get resepData() {
			return resepData;
		},
		get isLoadingProducts() {
			return isLoadingProducts;
		},
		get posLoadError() {
			return posLoadError;
		},
		get catalogSource() {
			return catalogSource;
		},
		get catalogFetchedAt() {
			return catalogFetchedAt;
		},
		get catalogExpiresAt() {
			return catalogExpiresAt;
		},
		get catalogStatusMessage() {
			return catalogStatusMessage;
		},
		get isCatalogExpired() {
			const expiresAt = Date.parse(catalogExpiresAt);
			return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
		},
		retryLoadPOSData
	};
}
