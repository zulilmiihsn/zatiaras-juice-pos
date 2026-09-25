export type CachedStockPolicyMode = 'tracked' | 'ignored';

export interface CachedStockPolicy {
	mode: CachedStockPolicyMode;
	revision: number;
	epoch_token: string;
}

export interface PolicyCacheStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const KEY_PREFIX = 'pos-stock-policy:';

export function stockPolicyCacheKey(branch: string): string {
	return `${KEY_PREFIX}${branch.trim().toLowerCase() || 'samarinda'}`;
}

function defaultStorage(): PolicyCacheStorage | null {
	try {
		if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
		return localStorage;
	} catch {
		return null;
	}
}

/** Parse ketat: mode/revision invalid atau token bukan string = cache tidak valid. */
export function parseCachedStockPolicy(value: unknown): CachedStockPolicy | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const parsed = value as Record<string, unknown>;
	if (parsed.mode !== 'tracked' && parsed.mode !== 'ignored') return null;
	if (typeof parsed.revision !== 'number' || !Number.isInteger(parsed.revision)) return null;
	if (typeof parsed.epoch_token !== 'string') return null;
	return { mode: parsed.mode, revision: parsed.revision, epoch_token: parsed.epoch_token };
}

export function readCachedStockPolicy(
	branch: string,
	storage: PolicyCacheStorage | null = defaultStorage()
): CachedStockPolicy | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(stockPolicyCacheKey(branch));
		if (!raw) return null;
		return parseCachedStockPolicy(JSON.parse(raw));
	} catch {
		return null;
	}
}

/**
 * Satu-satunya penulis cache policy. Token epoch dari katalog dipertahankan
 * bila pemanggil tidak membawa token baru dan mode+revision tidak berubah —
 * token adalah bukti epoch replay offline, jangan timpa dengan kosong.
 */
export function writeCachedStockPolicy(
	branch: string,
	policy: { mode: CachedStockPolicyMode; revision: number; epoch_token?: string },
	storage: PolicyCacheStorage | null = defaultStorage()
): void {
	if (!storage) return;
	try {
		const key = stockPolicyCacheKey(branch);
		let epochToken = typeof policy.epoch_token === 'string' ? policy.epoch_token : '';
		if (!epochToken) {
			const existing = readCachedStockPolicy(branch, storage);
			if (existing && existing.mode === policy.mode && existing.revision === policy.revision) {
				epochToken = existing.epoch_token;
			}
		}
		storage.setItem(key, JSON.stringify({ ...policy, epoch_token: epochToken }));
	} catch {
		// Best-effort; server tetap otoritatif.
	}
}
