import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_EVENTS_PER_WINDOW = 120;
const MAX_HISTORY = 2000;
const ALLOWED_PAGES = new Set(['dashboard', 'laporan', 'pos']);

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const metricsHistory: Array<{
	page: 'dashboard' | 'laporan' | 'pos';
	timestamp: number;
	receivedAt: number;
	userId: string;
	role: string;
	stats: {
		memoryHits: number;
		indexedDBHits: number;
		networkFetches: number;
		requests: number;
		hitRate: number;
		memorySize?: number;
		registeredKeys?: number;
		backgroundRefreshCount?: number;
		etagCount?: number;
	};
}> = [];

function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const current = rateLimitMap.get(ip);

	if (!current || now > current.resetAt) {
		rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
		return false;
	}

	if (current.count >= MAX_EVENTS_PER_WINDOW) {
		return true;
	}

	current.count += 1;
	return false;
}

function clampNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return min;
	if (parsed < min) return min;
	if (parsed > max) return max;
	return parsed;
}

function clampWindowMinutes(value: string | null): number {
	const parsed = Number.parseInt(value || '', 10);
	if (Number.isNaN(parsed)) return 60;
	if (parsed < 1) return 1;
	if (parsed > 1440) return 1440;
	return parsed;
}

function pushMetric(entry: (typeof metricsHistory)[number]): void {
	metricsHistory.push(entry);
	if (metricsHistory.length > MAX_HISTORY) {
		metricsHistory.splice(0, metricsHistory.length - MAX_HISTORY);
	}
}

function summarize(cutoff: number) {
	const pageTotals = new Map<
		string,
		{
			count: number;
			memoryHits: number;
			indexedDBHits: number;
			networkFetches: number;
			requests: number;
		}
	>();
	const latestByPage = new Map<string, (typeof metricsHistory)[number]>();

	for (let index = metricsHistory.length - 1; index >= 0; index -= 1) {
		const item = metricsHistory[index];
		if (item.receivedAt < cutoff) {
			break;
		}

		if (!latestByPage.has(item.page)) {
			latestByPage.set(item.page, item);
		}

		const current = pageTotals.get(item.page) || {
			count: 0,
			memoryHits: 0,
			indexedDBHits: 0,
			networkFetches: 0,
			requests: 0
		};

		current.count += 1;
		current.memoryHits += item.stats.memoryHits;
		current.indexedDBHits += item.stats.indexedDBHits;
		current.networkFetches += item.stats.networkFetches;
		current.requests += item.stats.requests;
		pageTotals.set(item.page, current);
	}

	const byPage = Array.from(pageTotals.entries()).map(([page, totals]) => {
		const hitCount = totals.memoryHits + totals.indexedDBHits;
		const hitRate = totals.requests > 0 ? hitCount / totals.requests : 0;
		const latest = latestByPage.get(page);
		return {
			page,
			samples: totals.count,
			hits: hitCount,
			memoryHits: totals.memoryHits,
			indexedDBHits: totals.indexedDBHits,
			networkFetches: totals.networkFetches,
			requests: totals.requests,
			hitRate,
			latest: latest
				? {
						timestamp: latest.timestamp,
						receivedAt: latest.receivedAt,
						memorySize: latest.stats.memorySize || 0,
						registeredKeys: latest.stats.registeredKeys || 0,
						backgroundRefreshCount: latest.stats.backgroundRefreshCount || 0,
						etagCount: latest.stats.etagCount || 0,
						hitRate: latest.stats.hitRate
					}
				: null
		};
	});

	const totals = byPage.reduce(
		(acc, page) => {
			acc.samples += page.samples;
			acc.hits += page.hits;
			acc.requests += page.requests;
			acc.networkFetches += page.networkFetches;
			return acc;
		},
		{ samples: 0, hits: 0, requests: 0, networkFetches: 0 }
	);

	const overallHitRate = totals.requests > 0 ? totals.hits / totals.requests : 0;

	return {
		windowStart: cutoff,
		totals: {
			...totals,
			hitRate: overallHitRate
		},
		byPage
	};
}

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	if (!locals.authSession) {
		return new Response(null, { status: 204 });
	}

	const clientIp = getClientAddress();
	if (isRateLimited(clientIp)) {
		return json(
			{
				success: false,
				code: 'RATE_LIMITED',
				message: 'Too many metric events',
				retryAfterSeconds: Math.ceil(WINDOW_MS / 1000)
			},
			{ status: 429 }
		);
	}

	let payload: { page?: unknown; timestamp?: unknown; stats?: unknown };
	try {
		payload = await request.json();
	} catch {
		return json(
			{ success: false, code: 'INVALID_JSON', message: 'Invalid JSON payload' },
			{ status: 400 }
		);
	}

	const normalizedPage = typeof payload.page === 'string' ? payload.page.trim().toLowerCase() : '';
	if (!ALLOWED_PAGES.has(normalizedPage)) {
		return json(
			{ success: false, code: 'VALIDATION_ERROR', message: 'Invalid page' },
			{ status: 400 }
		);
	}

	if (!payload.stats || typeof payload.stats !== 'object') {
		return json(
			{ success: false, code: 'VALIDATION_ERROR', message: 'Invalid stats' },
			{ status: 400 }
		);
	}

	const rawStats = payload.stats as Record<string, unknown>;
	const requests = clampNumber(rawStats.requests, 0, 1_000_000);
	const memoryHits = clampNumber(rawStats.memoryHits, 0, 1_000_000);
	const indexedDBHits = clampNumber(rawStats.indexedDBHits, 0, 1_000_000);
	const networkFetches = clampNumber(rawStats.networkFetches, 0, 1_000_000);
	const computedHitRate = requests > 0 ? (memoryHits + indexedDBHits) / requests : 0;

	const receivedAt = Date.now();
	const timestamp = clampNumber(payload.timestamp, receivedAt - WINDOW_MS, receivedAt + WINDOW_MS);

	pushMetric({
		page: normalizedPage as 'dashboard' | 'laporan' | 'pos',
		timestamp,
		receivedAt,
		userId: locals.authSession.userId,
		role: locals.authSession.role,
		stats: {
			memoryHits,
			indexedDBHits,
			networkFetches,
			requests,
			hitRate: computedHitRate,
			memorySize: clampNumber(rawStats.memorySize, 0, 100_000),
			registeredKeys: clampNumber(rawStats.registeredKeys, 0, 100_000),
			backgroundRefreshCount: clampNumber(rawStats.backgroundRefreshCount, 0, 100_000),
			etagCount: clampNumber(rawStats.etagCount, 0, 100_000)
		}
	});

	return json({ success: true });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.authSession) {
		return json({
			success: true,
			authenticated: false,
			summary: null
		});
	}

	if (locals.authSession.role !== 'admin' && locals.authSession.role !== 'pemilik') {
		return json({ success: false, code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
	}

	const windowMinutes = clampWindowMinutes(url.searchParams.get('windowMinutes'));
	const cutoff = Date.now() - windowMinutes * 60 * 1000;
	const summary = summarize(cutoff);

	return json({
		success: true,
		windowMinutes,
		summary
	});
};
