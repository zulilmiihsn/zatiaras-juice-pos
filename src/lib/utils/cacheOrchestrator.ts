import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { smartCache, CacheUtils, CACHE_KEYS } from '$lib/utils/cache';
import { dashboardService } from '$lib/services/dashboardService';
import { REPORT_CACHE_VERSION } from '$lib/constants/cache';

class CacheOrchestrator {
	async preloadCommonDateRanges() {
		await Promise.allSettled([
			dashboardService.getDashboardStats(),
			dashboardService.getBestSellers(),
			dashboardService.getWeeklyIncome()
		]);
	}

	private async invalidateDashboardCachesForBranch(branch: string) {
		await Promise.all([
			smartCache.invalidate(`${CACHE_KEYS.DASHBOARD_STATS}_${branch}`),
			smartCache.invalidate(`${CACHE_KEYS.BEST_SELLERS}_${branch}`),
			smartCache.invalidate(`${CACHE_KEYS.WEEKLY_INCOME}_${branch}`)
		]);
	}

	async invalidateDashboardCaches(branch?: string) {
		const b = branch || selectedBranch.value || 'default';
		await this.invalidateDashboardCachesForBranch(b);
	}

	async invalidateCacheOnChange(table: string) {
		const branch = selectedBranch.value || 'default';
		switch (table) {
			case 'produk':
			case 'kategori':
			case 'tambahan':
			case 'bahan':
			case 'resep_produk':
			case 'bahan_mutasi':
			case 'hpp_settings':
				await Promise.all([
					smartCache.invalidate(`${CACHE_KEYS.PRODUCTS}_${branch}`),
					smartCache.invalidate(`${CACHE_KEYS.CATEGORIES}_${branch}`),
					smartCache.invalidate(`${CACHE_KEYS.ADDONS}_${branch}`),
					smartCache.invalidate(`ingredients_${branch}`),
					smartCache.invalidate(`hpp_settings_${branch}`)
				]);
				break;
			case 'buku_kas':
			case 'transaksi_kasir':
				await this.invalidateDashboardCaches(branch);
				await CacheUtils.invalidateReportData();
				await this.invalidateAllReportCaches();
				break;
			case 'profil':
				await smartCache.invalidate(CACHE_KEYS.USER_PROFILE);
				await smartCache.invalidate(CACHE_KEYS.USER_ROLE);
				break;
		}
	}

	async invalidateAllReportCaches() {
		await Promise.allSettled(
			['daily', 'weekly', 'monthly', 'yearly'].map((type) => this.invalidateReportCache(type))
		);
	}

	async invalidateReportCache(type: string, dateRange?: string) {
		const branch = selectedBranch.value || 'default';
		if (dateRange) {
			const normalized = dashboardService.generateSmartCacheKey(type, dateRange, branch);
			await smartCache.invalidate(normalized);
		} else {
			await smartCache.invalidate(`smart_${type}_${REPORT_CACHE_VERSION}_${branch}_*`);
		}
	}

	getCacheStats() {
		return smartCache.getStats();
	}

	async clearAllCaches() {
		await smartCache.clear();
	}
}

export const cacheOrchestrator = new CacheOrchestrator();
