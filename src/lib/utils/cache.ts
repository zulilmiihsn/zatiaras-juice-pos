import { browser } from '$app/environment';
import {
	clear as clearCache,
	get as getCache,
	update as updateCache,
	del as delCache
} from 'idb-keyval';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { cacheStore } from '$lib/utils/idbStores';
import { CACHE_TTL_MS } from '$lib/constants/cache';

// Cache configuration
const CACHE_CONFIG = {
	// Memory cache TTL (in milliseconds)
	MEMORY_TTL: CACHE_TTL_MS.SHORT,
	// IndexedDB cache TTL (in milliseconds)
	INDEXEDDB_TTL: CACHE_TTL_MS.STANDARD,
	// Background refresh interval (in milliseconds)
	BACKGROUND_REFRESH: CACHE_TTL_MS.BACKGROUND_REFRESH,
	// Stale-while-revalidate window (in milliseconds)
	STALE_WHILE_REVALIDATE: CACHE_TTL_MS.STALE_WHILE_REVALIDATE,
	// Cache size limits
	MAX_MEMORY_ENTRIES: 100,
	MAX_INDEXEDDB_ENTRIES: 1000
};

// Cache entry interface
interface CacheEntry<T> {
	data: T;
	timestamp: number;
	ttl: number;
	version?: string;
	etag?: string;
}

// Memory cache (fastest access)
class MemoryCache {
	private cache = new Map<string, CacheEntry<unknown>>();
	private cleanupTimeout: number | null = null;

	constructor() {
		// Schedule cleanup only when needed
		this.scheduleCleanup();
	}

	set<T>(key: string, data: T, ttl: number = CACHE_CONFIG.MEMORY_TTL): void {
		// Remove oldest entries if cache is full
		if (this.cache.size >= CACHE_CONFIG.MAX_MEMORY_ENTRIES) {
			const oldestKey = this.cache.keys().next().value || '';
			this.cache.delete(oldestKey);
		}

		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			ttl
		});

		// Schedule cleanup if not already scheduled
		if (!this.cleanupTimeout) {
			this.scheduleCleanup();
		}
	}

	get<T>(key: string): T | null {
		const entry = this.cache.get(key);
		if (!entry) return null;

		// Check if expired
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

				// Schedule next cleanup only if cache has entries
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

// IndexedDB cache (persistent storage)
class IndexedDBCache {
	async set<T>(
		key: string,
		data: T,
		ttl: number = CACHE_CONFIG.INDEXEDDB_TTL,
		guard?: () => boolean
	): Promise<void> {
		if (!browser) return;
		try {
			const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
			await updateCache<CacheEntry<T> | undefined>(
				key,
				(current) => (!guard || guard() ? entry : current),
				cacheStore
			);
		} catch {
			// Persistent cache is best-effort; a storage outage must not discard a valid network result.
			return;
		}
	}

	async get<T>(key: string): Promise<T | null> {
		if (!browser) return null;
		try {
			const entry = await getCache(key, cacheStore);
			if (!entry) return null;
			// Check if expired
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
			// Silent error handling
		}
	}

	async clear(): Promise<void> {
		if (!browser) return;
		// Hapus seluruh data cache IndexedDB
		try {
			await clearCache(cacheStore);
		} catch (error) {
			// Silent error handling
		}
	}
}

// Smart cache manager with real-time capabilities
export class SmartCache {
	private memoryCache: MemoryCache;
	private indexedDBCache: IndexedDBCache;
	private backgroundRefreshMap = new Map<string, number>();
	private etagMap = new Map<string, string>();
	private keyRegistry = new Set<string>();
	// Epoch commit per key + global. Naik tiap invalidate/clear.
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

	/** Satu commit epoch dipakai juga oleh snapshot offline milik caller, bukan hanya cache internal. */
	createCommitGuard(key: string, guard?: () => boolean): () => boolean {
		this.keyRegistry.add(key);
		const snapshot = this.commitSnapshot(key);
		return () => this.canCommit(key, snapshot, guard);
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

	// Main cache get method with stale-while-revalidate
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
		this.keyRegistry.add(key);
		this.stats.requests += 1;
		const snapshot = this.commitSnapshot(key);

		// Check memory cache first (fastest)
		if (!forceRefresh) {
			const memoryData = this.memoryCache.get<T>(key);
			if (memoryData !== null) {
				this.stats.memoryHits += 1;
				// Trigger background refresh if enabled
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

		// Check IndexedDB cache
		if (!forceRefresh) {
			const indexedDBData = await this.indexedDBCache.get<T>(key);
			if (indexedDBData !== null) {
				this.stats.indexedDBHits += 1;
				// An IDB read begun before invalidate is an obsolete flight too, not a fresh memory hit.
				if (this.canCommit(key, snapshot, guard)) {
					this.memoryCache.set(key, indexedDBData, ttl);
					if (backgroundRefresh) {
						this.scheduleBackgroundRefresh(
							key,
							async () => ({ data: await fetcher() }),
							ttl,
							undefined,
							guard
						);
					}
				}

				return indexedDBData;
			}
		}

		// Fetch fresh data
		this.stats.networkFetches += 1;
		const freshData = await fetcher();

		// Skip commit bila guard/epoch gugur (cabang pindah atau
		// invalidate susul). Data tetap dikembalikan ke pemanggil.
		if (!this.canCommit(key, snapshot, guard)) return freshData;

		// Store in both caches
		this.memoryCache.set(key, freshData, ttl);
		await this.indexedDBCache.set(key, freshData, ttl, () => this.canCommit(key, snapshot, guard));
		if (!this.canCommit(key, snapshot, guard)) return freshData;
		this.keyRegistry.add(key);

		// Update ETag if provided
		if (etag) {
			this.etagMap.set(key, etag);
		}

		return freshData;
	}

	// Get data with ETag support for conditional requests
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
		this.keyRegistry.add(key);
		this.stats.requests += 1;
		const snapshot = this.commitSnapshot(key);

		// Check if we have cached data and ETag
		if (!forceRefresh && currentETag) {
			const cachedData = this.memoryCache.get<T>(key) || (await this.indexedDBCache.get<T>(key));
			if (cachedData !== null) {
				if (this.memoryCache.has(key)) {
					this.stats.memoryHits += 1;
				} else {
					this.stats.indexedDBHits += 1;
				}
				// Trigger background refresh with ETag
				if (backgroundRefresh) {
					this.scheduleBackgroundRefresh(key, fetcher, ttl, currentETag, guard);
				}
				return cachedData;
			}
		}

		// Fetch fresh data with ETag
		this.stats.networkFetches += 1;
		const result = await fetcher(currentETag);

		// Skip commit bila guard/epoch gugur.
		if (!this.canCommit(key, snapshot, guard)) return result.data;

		// Store data and ETag
		this.memoryCache.set(key, result.data, ttl);
		await this.indexedDBCache.set(key, result.data, ttl, () =>
			this.canCommit(key, snapshot, guard)
		);
		if (!this.canCommit(key, snapshot, guard)) return result.data;
		this.keyRegistry.add(key);

		if (result.etag) {
			this.etagMap.set(key, result.etag);
		}

		return result.data;
	}

	// Background refresh scheduling
	private scheduleBackgroundRefresh<T>(
		key: string,
		fetcher: (etag?: string) => Promise<{ data: T; etag?: string }>,
		ttl?: number,
		etag?: string,
		guard?: () => boolean
	): void {
		// Already scheduled, skip to avoid refresh storms
		if (this.backgroundRefreshMap.has(key)) {
			return;
		}

		// Jangan schedule refresh jika offline
		if (typeof navigator !== 'undefined' && !navigator.onLine) return;

		// Epoch saat schedule; commit refresh gugur bila guard
		// atau invalidate susul (respons basi tak timpa cache segar).
		const snapshot = this.commitSnapshot(key);
		if (guard && !guard()) return;

		// Schedule new refresh
		const refreshId = setTimeout(async () => {
			try {
				// Jangan fetch jika offline
				if (typeof navigator !== 'undefined' && !navigator.onLine) return;
				if (!this.canCommit(key, snapshot, guard)) return;
				const result = await fetcher(etag);
				if (etag && result.etag === etag) return;
				if (!this.canCommit(key, snapshot, guard)) return;

				this.memoryCache.set(key, result.data, ttl);
				await this.indexedDBCache.set(key, result.data, ttl, () =>
					this.canCommit(key, snapshot, guard)
				);
				if (!this.canCommit(key, snapshot, guard)) return;
				this.keyRegistry.add(key);
				if (result.etag) {
					this.etagMap.set(key, result.etag);
				}
			} catch (error) {
				// Silent error handling
			} finally {
				if (this.backgroundRefreshMap.get(key) === Number(refreshId))
					this.backgroundRefreshMap.delete(key);
			}
		}, CACHE_CONFIG.BACKGROUND_REFRESH);
		this.backgroundRefreshMap.set(key, Number(refreshId));
	}

	// Invalidate cache entries
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
				// Invalidate before the first storage await; late responses must observe the new epoch.
				this.bumpCommitEpoch(key);
				this.memoryCache.delete(key);
				const refreshId = this.backgroundRefreshMap.get(key);
				if (refreshId !== undefined) clearTimeout(refreshId);
				this.backgroundRefreshMap.delete(key);
				this.etagMap.delete(key);
				await this.indexedDBCache.delete(key);
				// Keep known keys until clear: a newer cold flight may already be using this key.
			})
		);
	}

	// Clear all caches
	async clear(): Promise<void> {
		// Gugurkan semua commit yang masih terbang.
		this.commitGlobal += 1;
		this.memoryCache.clear();

		// Clear background refresh intervals
		for (const refreshId of this.backgroundRefreshMap.values()) {
			clearTimeout(refreshId);
		}
		this.backgroundRefreshMap.clear();

		// Clear ETags
		this.etagMap.clear();
		this.keyRegistry.clear();
		// Clear synchronous registries first so this older clear cannot erase a newer flight's key.
		if (browser) await this.indexedDBCache.clear();
	}

	// Get cache statistics
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

	// Destroy cache instance
	destroy(): void {
		this.memoryCache.destroy();
		this.clear();
	}
}

// Global cache instance
export const smartCache = new SmartCache();

// Cache keys for different data types
export const CACHE_KEYS = {
	// Dashboard data
	DASHBOARD_STATS: 'dashboard_stats',
	BEST_SELLERS: 'best_sellers',
	WEEKLY_INCOME: 'weekly_income',

	// POS data
	PRODUCTS: 'products',
	CATEGORIES: 'categories',
	ADDONS: 'addons',

	// Reports
	DAILY_REPORT: 'daily_report',
	WEEKLY_REPORT: 'weekly_report',
	MONTHLY_REPORT: 'monthly_report',

	// User data
	USER_PROFILE: 'user_profile',
	USER_ROLE: 'user_role',

	// Settings
	SECURITY_SETTINGS: 'security_settings',
	PENGATURAN: 'pengaturan'
} as const;

function branchCacheKey(key: string): string {
	return `${selectedBranch.value || 'default'}:${key}`;
}

// Cache utilities for specific data types
export class CacheUtils {
	// Dashboard data caching
	static async getDashboardStats<T>(fetcher: () => Promise<T>): Promise<T> {
		return smartCache.get(branchCacheKey(CACHE_KEYS.DASHBOARD_STATS), fetcher, {
			ttl: CACHE_TTL_MS.SHORT,
			backgroundRefresh: true
		});
	}

	// POS data caching
	static async getProducts<T>(fetcher: () => Promise<T[]>) {
		return smartCache.get(branchCacheKey(CACHE_KEYS.PRODUCTS), fetcher, {
			ttl: CACHE_TTL_MS.STANDARD,
			backgroundRefresh: true
		});
	}

	// Report data caching with ETag support
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
		// Invalidate specific report keys instead of using regex
		await smartCache.invalidate(branchCacheKey('daily_report'));
		await smartCache.invalidate(branchCacheKey('weekly_report'));
		await smartCache.invalidate(branchCacheKey('monthly_report'));
		await smartCache.invalidate(branchCacheKey('yearly_report'));
	}
}
