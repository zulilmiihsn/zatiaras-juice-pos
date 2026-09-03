import type { BranchId } from '$lib/server/branchResolver';

export type RateLimitResult = {
	allowed: boolean;
	available: boolean;
	backend: 'durable-object' | 'd1' | 'unavailable';
	limit: number;
	count: number;
	retryAfterSeconds: number;
	resetAt: number;
};

function rateLimitId(branch: BranchId, identifier: string) {
	return `${branch}:${identifier}`;
}

async function consumeDurableRateLimit(
	platform: App.Platform | undefined,
	branch: BranchId,
	identifier: string,
	limit: number,
	windowMs: number
): Promise<RateLimitResult | null> {
	try {
		const hub = platform?.env?.REALTIME_HUB;
		if (!hub) return null;

		const id = hub.idFromName(branch);
		const stub = hub.get(id);
		const response = await stub.fetch(
			new Request('https://rate-limit.local/rate-limit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ identifier, limit, windowMs })
			})
		);
		if (!response.ok) return null;

		const payload = (await response.json()) as Partial<RateLimitResult>;
		if (typeof payload.allowed !== 'boolean') return null;

		return {
			allowed: payload.allowed,
			available: true,
			backend: 'durable-object',
			limit: Number(payload.limit || limit),
			count: Number(payload.count || 0),
			retryAfterSeconds: Number(payload.retryAfterSeconds || 0),
			resetAt: Number(payload.resetAt || Date.now() + windowMs)
		};
	} catch {
		return null;
	}
}

/**
 * Rate limit dengan SATU fallback yang disengaja (wajib, 1 lapis):
 *   Durable Object (utama, akurat lintas-isolate)  →  D1 (cadangan).
 * D1 diperlukan karena DO tidak terikat di dev lokal & saat DO down; tanpa ini
 * login/checkout lokal akan selalu ke-block. Bila keduanya gagal → fail-closed
 * (tolak, available:false). Jangan tambah lapisan lain.
 */
export async function consumeRateLimit(
	db: import('@cloudflare/workers-types').D1Database,
	branch: BranchId,
	identifier: string,
	limit: number,
	windowMs: number,
	platform?: App.Platform
): Promise<RateLimitResult> {
	const durableResult = await consumeDurableRateLimit(
		platform,
		branch,
		identifier,
		limit,
		windowMs
	);
	if (durableResult) return durableResult;

	const now = Date.now();
	const resetAt = now + windowMs;
	const id = rateLimitId(branch, identifier);

	try {
		await db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(now).run();

		const current = (await db
			.prepare('SELECT count, reset_at FROM rate_limits WHERE id = ? LIMIT 1')
			.bind(id)
			.first()) as { count: number; reset_at: number } | null;

		if (!current || current.reset_at <= now) {
			await db
				.prepare(
					`INSERT INTO rate_limits (id, cabang_id, identifier, count, reset_at, updated_at)
					 VALUES (?, ?, ?, 1, ?, ?)
					 ON CONFLICT(id) DO UPDATE SET count = 1, reset_at = excluded.reset_at, updated_at = excluded.updated_at`
				)
				.bind(id, branch, identifier, resetAt, now)
				.run();

			return {
				allowed: true,
				available: true,
				backend: 'd1',
				limit,
				count: 1,
				retryAfterSeconds: 0,
				resetAt
			};
		}

		if (current.count >= limit) {
			return {
				allowed: false,
				available: true,
				backend: 'd1',
				limit,
				count: current.count,
				retryAfterSeconds: Math.ceil((current.reset_at - now) / 1000),
				resetAt: current.reset_at
			};
		}

		const nextCount = current.count + 1;
		await db
			.prepare('UPDATE rate_limits SET count = ?, updated_at = ? WHERE id = ?')
			.bind(nextCount, now, id)
			.run();

		return {
			allowed: true,
			available: true,
			backend: 'd1',
			limit,
			count: nextCount,
			retryAfterSeconds: 0,
			resetAt: current.reset_at
		};
	} catch {
		return {
			allowed: false,
			available: false,
			backend: 'unavailable',
			limit,
			count: 0,
			retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)),
			resetAt
		};
	}
}
