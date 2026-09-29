import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getPendingTransactions } from '$lib/utils/offline';
import {
	loadStatusIntents,
	removeStatusIntent,
	type StatusIntent
} from '$lib/utils/orderQueueLocal';

interface QueueListResponse {
	ok: boolean;
	data?: {
		items?: Array<{
			idempotency_key?: string;
			preparation_state?: string;
			preparation_revision?: number;
		}>;
	};
}

function pendingCheckoutKeys(
	pendings: Array<Record<string, unknown>>,
	branch: string
): Set<string> {
	const out = new Set<string>();
	for (const item of pendings) {
		if (item.type !== 'pos_transaction') continue;
		if (typeof item.branch === 'string' && item.branch.toLowerCase() !== branch.toLowerCase()) {
			continue;
		}
		const request = item.request as Record<string, unknown> | undefined;
		const key =
			request && typeof request.idempotency_key === 'string' ? request.idempotency_key : '';
		if (key) out.add(key);
	}
	return out;
}

async function postStatus(intent: StatusIntent): Promise<Response> {
	return fetchWithCsrfRetry('/api/antrean/status', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			idempotency_key: intent.idempotency_key,
			target: intent.target,
			expected_revision: intent.expected_revision
		})
	});
}

async function fetchFreshRevision(
	branch: string,
	idempotencyKey: string
): Promise<{ state: string; revision: number } | null> {
	try {
		const response = await fetch(
			`/api/antrean?state=pending&limit=100&branch=${encodeURIComponent(branch)}`,
			{ credentials: 'include' }
		);
		if (response.ok) {
			const payload = (await response.json()) as QueueListResponse;
			const found = payload.data?.items?.find((i) => i.idempotency_key === idempotencyKey);
			if (found && typeof found.preparation_state === 'string') {
				return {
					state: found.preparation_state,
					revision: Number(found.preparation_revision ?? 0)
				};
			}
		}
		const doneResponse = await fetch(
			`/api/antrean?state=done&limit=50&branch=${encodeURIComponent(branch)}`,
			{ credentials: 'include' }
		);
		if (!doneResponse.ok) return null;
		const donePayload = (await doneResponse.json()) as QueueListResponse;
		const found = donePayload.data?.items?.find((i) => i.idempotency_key === idempotencyKey);
		if (found && typeof found.preparation_state === 'string') {
			return { state: found.preparation_state, revision: Number(found.preparation_revision ?? 0) };
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Sinkronkan intent status Antrean: checkout dulu (di-skip bila masih antre),
 * lalu status dengan key yang sama. Idempoten dan tahan crash antar langkah.
 */
export async function syncOrderStatusIntents(
	branchInput?: string
): Promise<{ synced: number; failed: number; conflicts: number }> {
	const result = { synced: 0, failed: 0, conflicts: 0 };
	if (typeof window === 'undefined' || !navigator.onLine) return result;
	const branch = (
		branchInput ||
		localStorage.getItem('selectedBranch') ||
		'samarinda'
	).toLowerCase();
	const intents = await loadStatusIntents(branch);
	if (!intents.length) return result;
	const pendings = await getPendingTransactions().catch(() => []);
	const checkoutKeys = pendingCheckoutKeys(pendings as Array<Record<string, unknown>>, branch);
	for (const intent of intents) {
		// Checkout belum terkirim: status menunggu giliran, bukan gagal.
		if (checkoutKeys.has(intent.idempotency_key)) continue;
		try {
			const response = await postStatus(intent);
			if (response.ok) {
				await removeStatusIntent(branch, intent.idempotency_key, {
					target: intent.target,
					updated_at: intent.updated_at
				});
				result.synced += 1;
				continue;
			}
			if (response.status === 404) {
				// Transaksi di-void/diarsip: intent usang, jangan retry selamanya.
				await removeStatusIntent(branch, intent.idempotency_key, {
					target: intent.target,
					updated_at: intent.updated_at
				});
				result.conflicts += 1;
				continue;
			}
			if (response.status === 409) {
				const fresh = await fetchFreshRevision(branch, intent.idempotency_key);
				if (fresh && fresh.state === intent.target) {
					await removeStatusIntent(branch, intent.idempotency_key, {
						target: intent.target,
						updated_at: intent.updated_at
					});
					result.synced += 1;
					continue;
				}
				// Server berubah berlawanan: serahkan ke staf (refresh), hentikan retry buta.
				await removeStatusIntent(branch, intent.idempotency_key, {
					target: intent.target,
					updated_at: intent.updated_at
				});
				result.conflicts += 1;
				window.dispatchEvent(new CustomEvent('antrean-conflict'));
				continue;
			}
			result.failed += 1;
		} catch {
			result.failed += 1;
		}
	}
	if (result.synced > 0 || result.conflicts > 0) {
		window.dispatchEvent(new CustomEvent('antrean-synced'));
	}
	return result;
}
