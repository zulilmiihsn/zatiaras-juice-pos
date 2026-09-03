type D1Like = {
	prepare(query: string): {
		all(): Promise<{ results?: Array<{ name?: string }> }>;
	};
};

type CacheEntry = {
	expiresAt: number;
	value: Promise<boolean>;
};

const CAPABILITY_TTL_MS = 5 * 60_000;
const capabilityCache = new Map<string, CacheEntry>();

export async function hasDatabaseColumn(
	db: D1Like,
	cacheScope: string,
	table: string,
	column: string
): Promise<boolean> {
	const key = `${cacheScope}:${table}:${column}`;
	const now = Date.now();
	const cached = capabilityCache.get(key);
	if (cached && cached.expiresAt > now) return cached.value;

	const value = db
		.prepare(`PRAGMA table_info(${table})`)
		.all()
		.then(({ results = [] }) => results.some((row) => row.name === column))
		.catch(() => false);
	capabilityCache.set(key, { expiresAt: now + CAPABILITY_TTL_MS, value });
	return value;
}

export function clearDatabaseCapabilityCache(cacheScope?: string): void {
	if (!cacheScope) {
		capabilityCache.clear();
		return;
	}
	for (const key of capabilityCache.keys()) {
		if (key.startsWith(`${cacheScope}:`)) capabilityCache.delete(key);
	}
}
