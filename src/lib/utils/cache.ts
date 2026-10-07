import { browser } from '$app/environment';
import { clear as clearCache, get as getCache, set as setCache, del as delCache } from 'idb-keyval';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { cacheStore } from '$lib/utils/idbStores';
import { CACHE_TTL_MS } from '$lib/constants/cache';

// [CATATAN]: Cache configuration
const CACHE_CONFIG = {
	// [CATATAN]: Memory cache TTL (in milliseconds)
	MEMORY_TTL: CACHE_TTL_MS.SHORT,
	// [CATATAN]: IndexedDB cache TTL (in milliseconds)
	INDEXEDDB_TTL: CACHE_TTL_MS.STANDARD,
	// [CATATAN]: Background refresh interval (in milliseconds)
	BACKGROUND_REFRESH: CACHE_TTL_MS.BACKGROUND_REFRESH,
	// [CATATAN]: Stale-while-revalidate window (in milliseconds)
	STALE_WHILE_REVALIDATE: CACHE_TTL_MS.STALE_WHILE_REVALIDATE,
	// [CATATAN]: Cache size limits
	MAX_MEMORY_ENTRIES: 100,
	MAX_INDEXEDDB_ENTRIES: 1000
};

// [CATATAN]: Cache entry interface
interface CacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
	version?: string;
	etag?: string;
}

// [CATATAN]: Memory cache (fastest access)
class MemoryCache {
	private cache = new Map<string, CacheEntry<unknown>>();
	private cleanupTimeout: number | null = null;

	constructor() {
		// [CATATAN]: Schedule cleanup only when needed
		this.scheduleCleanup();
	}

	set<T>(key: string, data: T, ttl: number = CACHE_CONFIG.MEMORY_TTL): void {
		// [CATATAN]: Remove oldest entries if cache is full
		if (this.cache.size >= CACHE_CONFIG.MAX_MEMORY_ENTRIES) {
			const oldestKey = this.cache.keys().next().value || '';
			this.cache.delete(oldestKey);
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			ttl
		});

		// [CATATAN]: Schedule cleanup if not already scheduled
		if (!this.cleanupTimeout) {
			this.scheduleCleanup();
		}
	}

	get<T>(key: string): T | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		// [CATATAN]: Check if expired
		if (Date.now() - entry.timestamp > entry.ttl) {
			this.cache.delete(key);
			return null;
		}

		return entry.data as T;
	}

	has(key: string): boolean {
		return this.cache.has(key);
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	getSize(): number {
		return this.cache.size;
	}

	private cleanup(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > entry.ttl) {
				this.cache.delete(key);
			}
		}
	}

	private scheduleCleanup(): void {
		if (this.cleanupTimeout) {
			clearTimeout(this.cleanupTimeout);
		}

		this.cleanupTimeout = Number(
			setTimeout(() => {
				this.cleanup();
				this.cleanupTimeout = null;

				// [CATATAN]: Schedule next cleanup only if cache has entries
				if (this.cache.size > 0) {
					this.scheduleCleanup();
				}
			}, CACHE_TTL_MS.SHORT)
		);
	}

	destroy(): void {
		if (this.cleanupTimeout) {
			clearTimeout(this.cleanupTimeout);
			this.cleanupTimeout = null;
		}
		this.clear();
	}
}

// [CATATAN]: IndexedDB cache (persistent storage)
class IndexedDBCache {
	async set<T>(key: string, data: T, ttl: number = CACHE_CONFIG.INDEXEDDB_TTL): Promise<void> {
		if (!browser) return;
		try {
			await setCache(
				key,
				{
					data,
					timestamp: Date.now(),
					ttl
				},
				cacheStore
			);
		} catch (error) {
			// [CATATAN]: Silent error handling
		}
	}

	async get<T>(key: string): Promise<T | null> {
		if (!browser) return null;
		try {
			const entry = await getCache(key, cacheStore);
			if (!entry) return null;
			// [CATATAN]: Check if expired
			if (Date.now() - entry.timestamp > entry.ttl) {
				await delCache(key, cacheStore);
				return null;
			}
			return entry.data;
		} catch (error) {
			return null;
		}
	}

	async delete(key: string): Promise<void> {
		if (!browser) return;
		try {
			await delCache(key, cacheStore);
		} catch (error) {
			// [CATATAN]: Silent error handling
		}
	}

	async clear(): Promise<void> {
		if (!browser) return;
		// [CATATAN]: Hapus seluruh data cache IndexedDB
		try {
			await clearCache(cacheStore);
		} catch (error) {
			// [CATATAN]: Silent error handling
		}
	}
}

// [CATATAN]: Smart cache manager with real-time capabilities
export class SmartCache {
	private memoryCache: MemoryCache;
	private indexedDBCache: IndexedDBCache;
	private backgroundRefreshMap = new Map<string, number>();
	private etagMap = new Map<string, string>();
	private keyRegistry = new Set<string>();
	// AUD-020: epoch commit per key + global. Naik tiap invalidate/clear.
	// Commit (foreground maupun background refresh) hanya jalan bila epoch
	// tak berubah sejak fetch dimulai — respons basi tak bangkitkan cache.
	private commitEpoch = new Map<string, number>();
	private commitGlobal = 0;

	private commitSnapshot(key: string): { epoch: number; global: number } {
		return { epoch: this.commitEpoch.get(key) ?? 0, global: this.commitGlobal };
	}

	private canCommit(
		key: string,
		snapshot: { epoch: number; global: number },
		guard?: () => boolean
	): boolean {
		if (guard && !guard()) return false;
		const current = this.commitSnapshot(key);
		return current.epoch === snapshot.epoch && current.global === snapshot.global;
	}

	private bumpCommitEpoch(key: string): void {
		this.commitEpoch.set(key, (this.commitEpoch.get(key) ?? 0) + 1);
	}
	private stats = {
		memoryHits: 0,
		indexedDBHits: 0,
		networkFetches: 0,
		requests: 0
	};

	constructor() {
		this.memoryCache = new MemoryCache();
		this.indexedDBCache = new IndexedDBCache();
	}

	// [CATATAN]: Main cache get method with stale-while-revalidate
	async get<T>(
		key: string,
		fetcher: () => Promise<T>,
		options: {
			ttl?: number;
			backgroundRefresh?: boolean;
			etag?: string;
			forceRefresh?: boolean;
			guard?: () => boolean;
		} = {}
	): Promise<T> {
		const { ttl, backgroundRefresh = true, etag, forceRefresh = false, guard } = options;
		this.stats.requests += 1;
		const snapshot = this.commitSnapshot(key);

		// [CATATAN]: Check memory cache first (fastest)
		if (!forceRefresh) {
			const memoryData = this.memoryCache.get<T>(key);
			if (memoryData !== null) {
				this.stats.memoryHits += 1;
				// [CATATAN]: Trigger background refresh if enabled
				if (backgroundRefresh) {
					this.scheduleBackgroundRefresh(
						key,
						async () => ({ data: await fetcher() }),
						ttl,
						undefined,
						guard
					);
				}
				return memoryData;
			}
		}

		// [CATATAN]: Check IndexedDB cache
		if (!forceRefresh) {
			const indexedDBData = await this.indexedDBCache.get<T>(key);
			if (indexedDBData !== null) {
				this.stats.indexedDBHits += 1;
				// [CATATAN]: Store in memory cache for faster access
				this.memoryCache.set(key, indexedDBData, ttl);

				// [CATATAN]: Trigger background refresh if enabled
				if (backgroundRefresh) {
					this.scheduleBackgroundRefresh(
						key,
						async () => ({ data: await fetcher() }),
						ttl,
						undefined,
						guard
					);
				}

				return indexedDBData;
			}
		}

		// [CATATAN]: Fetch fresh data
		this.stats.networkFetches += 1;
		const freshData = await fetcher();

		// AUD-020: skip commit bila guard/epoch gugur (cabang pindah atau
		// invalidate susul). Data tetap dikembalikan ke pemanggil.
		if (!this.canCommit(key, snapshot, guard)) return freshData;

		// [CATATAN]: Store in both caches
		this.memoryCache.set(key, freshData, ttl);
		await this.indexedDBCache.set(key, freshData, ttl);
		this.keyRegistry.add(key);

		// [CATATAN]: Update ETag if provided
		if (etag) {
			this.etagMap.set(key, etag);
		}

		return freshData;
	}

	// [CATATAN]: Get data with ETag support for conditional requests
	async getWithETag<T>(
		key: string,
		fetcher: (etag?: string) => Promise<{ data: T; etag?: string }>,
		options: {
			ttl?: number;
			backgroundRefresh?: boolean;
			forceRefresh?: boolean;
			guard?: () => boolean;
		} = {}
	): Promise<T> {
		const { ttl, backgroundRefresh = true, forceRefresh = false, guard } = options;
		const currentETag = this.etagMap.get(key);
		this.stats.requests += 1;
		const snapshot = this.commitSnapshot(key);

		// [CATATAN]: Check if we have cached data and ETag
		if (!forceRefresh && currentETag) {
			const cachedData = this.memoryCache.get<T>(key) || (await this.indexedDBCache.get<T>(key));
			if (cachedData !== null) {
				if (this.memoryCache.has(key)) {
					this.stats.memoryHits += 1;
				} else {
					this.stats.indexedDBHits += 1;
				}
				// [CATATAN]: Trigger background refresh with ETag
				if (backgroundRefresh) {
					this.scheduleBackgroundRefresh(key, fetcher, ttl, currentETag, guard);
				}
				return cachedData;
			}
		}

		// [CATATAN]: Fetch fresh data with ETag
		this.stats.networkFetches += 1;
		const result = await fetcher(currentETag);

		// AUD-020: skip commit bila guard/epoch gugur.
		if (!this.canCommit(key, snapshot, guard)) return result.data;

		// [CATATAN]: Store data and ETag
		this.memoryCache.set(key, result.data, ttl);
		await this.indexedDBCache.set(key, result.data, ttl);
		this.keyRegistry.add(key);

		if (result.etag) {
			this.etagMap.set(key, result.etag);
		}

		return result.data;
	}

	// [CATATAN]: Background refresh scheduling
	private scheduleBackgroundRefresh<T>(
		key: string,
		fetcher: (etag?: string) => Promise<{ data: T; etag?: string }>,
		ttl?: number,
		etag?: string,
		guard?: () => boolean
	): void {
		// [CATATAN]: Already scheduled, skip to avoid refresh storms
		if (this.backgroundRefreshMap.has(key)) {
			return;
		}

		// [CATATAN]: Jangan schedule refresh jika offline
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;

		// AUD-020: epoch saat schedule; commit refresh gugur bila guard
		// atau invalidate susul (respons basi tak timpa cache segar).
		const snapshot = this.commitSnapshot(key);
		if (guard && !guard()) return;

		// [CATATAN]: Schedule new refresh
		const refreshId = setTimeout(async () => {
			try {
				// [CATATAN]: Jangan fetch jika offline
				if (typeof navigator !== 'undefined' && !navigator.onLine) return;
				const result = await fetcher(etag);
				if (etag && result.etag === etag) return;
				if (!this.canCommit(key, snapshot, guard)) return;

				this.memoryCache.set(key, result.data, ttl);
				await this.indexedDBCache.set(key, result.data, ttl);
				this.keyRegistry.add(key);
				if (result.etag) {
					this.etagMap.set(key, result.etag);
				}
			} catch (error) {
				// [CATATAN]: Silent error handling
			} finally {
				this.backgroundRefreshMap.delete(key);
			}
		}, CACHE_CONFIG.BACKGROUND_REFRESH);
		this.backgroundRefreshMap.set(key, Number(refreshId));
	}

	// [CATATAN]: Invalidate cache entries
	async invalidate(pattern: string | RegExp): Promise<void> {
		const keysToDelete: string[] = [];

		if (typeof pattern === 'string') {
			if (pattern.includes('*')) {
				const prefix = pattern.replace('*', '');
				for (const key of this.keyRegistry) {
					if (key.startsWith(prefix)) {
						keysToDelete.push(key);
					}
				}
			} else {
				keysToDelete.push(pattern);
			}
		} else {
			for (const key of this.keyRegistry) {
				if (pattern.test(key)) {
					keysToDelete.push(key);
				}
			}
		}

		await Promise.all(
			keysToDelete.map(async (key) => {
				this.memoryCache.delete(key);
				await this.indexedDBCache.delete(key);
				this.backgroundRefreshMap.delete(key);
				this.etagMap.delete(key);
				this.keyRegistry.delete(key);
				// AUD-020: gugurkan commit fetch yang masih terbang untuk key ini.
				this.bumpCommitEpoch(key);
			})
		);
	}

	// [CATATAN]: Clear all caches
	async clear(): Promise<void> {
		// AUD-020: gugurkan semua commit yang masih terbang.
		this.commitGlobal += 1;
		this.memoryCache.clear();
		if (browser) {
			await this.indexedDBCache.clear();
		}

		// [CATATAN]: Clear background refresh intervals
		for (const refreshId of this.backgroundRefreshMap.values()) {
			clearTimeout(refreshId);
		}
		this.backgroundRefreshMap.clear();

		// [CATATAN]: Clear ETags
		this.etagMap.clear();
		this.keyRegistry.clear();
	}

	// [CATATAN]: Get cache statistics
	getStats(): {
		memorySize: number;
		registeredKeys: number;
		backgroundRefreshCount: number;
		etagCount: number;
		memoryHits: number;
		indexedDBHits: number;
		networkFetches: number;
		requests: number;
		hitRate: number;
	} {
		const hitCount = this.stats.memoryHits + this.stats.indexedDBHits;
		const hitRate = this.stats.requests > 0 ? hitCount / this.stats.requests : 0;
		return {
			memorySize: this.memoryCache.getSize(),
			registeredKeys: this.keyRegistry.size,
			backgroundRefreshCount: this.backgroundRefreshMap.size,
			etagCount: this.etagMap.size,
			memoryHits: this.stats.memoryHits,
			indexedDBHits: this.stats.indexedDBHits,
			networkFetches: this.stats.networkFetches,
			requests: this.stats.requests,
			hitRate
		};
	}

	resetStats(): void {
		this.stats.memoryHits = 0;
		this.stats.indexedDBHits = 0;
		this.stats.networkFetches = 0;
		this.stats.requests = 0;
	}

	// [CATATAN]: Destroy cache instance
	destroy(): void {
		this.memoryCache.destroy();
		this.clear();
	}
}

// [CATATAN]: Global cache instance
export const smartCache = new SmartCache();

// [CATATAN]: Cache keys for different data types
export const CACHE_KEYS = {
	// [CATATAN]: Dashboard data
	DASHBOARD_STATS: 'dashboard_stats',
	BEST_SELLERS: 'best_sellers',
	WEEKLY_INCOME: 'weekly_income',

	// [CATATAN]: POS data
	PRODUCTS: 'products',
	CATEGORIES: 'categories',
	ADDONS: 'addons',

	// [CATATAN]: Reports
	DAILY_REPORT: 'daily_report',
	WEEKLY_REPORT: 'weekly_report',
	MONTHLY_REPORT: 'monthly_report',

	// [CATATAN]: User data
	USER_PROFILE: 'user_profile',
	USER_ROLE: 'user_role',

	// [CATATAN]: Settings
	SECURITY_SETTINGS: 'security_settings',
	PENGATURAN: 'pengaturan'
} as const;

function branchCacheKey(key: string): string {
	return `${selectedBranch.value || 'default'}:${key}`;
}

// [CATATAN]: Cache utilities for specific data types
export class CacheUtils {
	// [CATATAN]: Dashboard data caching
	static async getDashboardStats<T>(fetcher: () => Promise<T>): Promise<T> {
		return smartCache.get(branchCacheKey(CACHE_KEYS.DASHBOARD_STATS), fetcher, {
			ttl: CACHE_TTL_MS.SHORT,
			backgroundRefresh: true
		});
	}

	// [CATATAN]: POS data caching
	static async getProducts<T>(fetcher: () => Promise<T[]>) {
		return smartCache.get(branchCacheKey(CACHE_KEYS.PRODUCTS), fetcher, {
			ttl: CACHE_TTL_MS.STANDARD,
			backgroundRefresh: true
		});
	}

	// [CATATAN]: Report data caching with ETag support
	static async getReportData(
		key: string,
		dateRange: string,
		fetcher: (etag?: string) => Promise<{ data: unknown; etag?: string }>
	) {
		const cacheKey = branchCacheKey(`${key}_${dateRange}`);
		return smartCache.getWithETag(cacheKey, fetcher, {
			ttl: CACHE_TTL_MS.STANDARD,
			backgroundRefresh: true
		});
	}

	static async invalidateDashboardData(): Promise<void> {
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.DASHBOARD_STATS));
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.BEST_SELLERS));
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.WEEKLY_INCOME));
	}

	static async invalidatePOSData(): Promise<void> {
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.PRODUCTS));
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.CATEGORIES));
		await smartCache.invalidate(branchCacheKey(CACHE_KEYS.ADDONS));
	}

	static async invalidateReportData(): Promise<void> {
		// [CATATAN]: Invalidate specific report keys instead of using regex
		await smartCache.invalidate(branchCacheKey('daily_report'));
		await smartCache.invalidate(branchCacheKey('weekly_report'));
		await smartCache.invalidate(branchCacheKey('monthly_report'));
		await smartCache.invalidate(branchCacheKey('yearly_report'));
	}
}
