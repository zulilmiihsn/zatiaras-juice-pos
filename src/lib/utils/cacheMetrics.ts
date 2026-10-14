import { smartCache } from '$lib/utils/cache';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';

const MIN_REPORT_INTERVAL_MS = 15000;
const lastSentAtByPage = new Map<string, number>();

export async function reportCacheMetrics(
	page: 'dashboard' | 'laporan' | 'pos',
	force = false
): Promise<void> {
	if (typeof window === 'undefined') return;

	const now = Date.now();
	const lastSentAt = lastSentAtByPage.get(page) || 0;
	if (!force && now - lastSentAt < MIN_REPORT_INTERVAL_MS) {
		return;
	}

	lastSentAtByPage.set(page, now);
	const stats = smartCache.getStats();

	try {
		await fetchWithCsrfRetry('/api/cache-metrics', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			keepalive: true,
			body: JSON.stringify({
				page,
				timestamp: now,
				stats
			})
		});
	} catch {
		// silent: metrics must never break UX
	}
}
