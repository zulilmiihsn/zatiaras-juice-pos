import { getOfflineSessionBranch, readOfflineSessionSnapshot } from '$lib/auth/offlineSession';
import { syncPendingTransactions } from '$lib/services/offlineSync';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getPendingTransactions } from '$lib/utils/offline';
import {
	acknowledgeStatusIntent,
	loadStatusIntents,
	rejectStagedStatusIntent,
	stageStatusIntent,
	type StatusIntent,
	type StatusIntentOperation
} from '$lib/utils/orderQueueLocal';
import type { TransitionOrderResult } from '$lib/server/orderQueue/types';

export interface OrderStatusSyncResult {
	synced: number;
	failed: number;
	conflicts: number;
}

interface StatusSyncFlight {
	promise: Promise<OrderStatusSyncResult>;
	requestedGeneration: number;
	processedGeneration: number;
	attempted: Set<string>;
	stageFailures: Set<string>;
}

interface StatusResponse {
	ok?: unknown;
	data?: unknown;
}

const flights = new Map<string, StatusSyncFlight>();

function sessionBranch(): string | null {
	return getOfflineSessionBranch(readOfflineSessionSnapshot());
}

function hasStatusScope(branch: string): boolean {
	return typeof window !== 'undefined' && navigator.onLine && sessionBranch() === branch;
}

function reportSyncMessage(kind: 'session' | 'storage' | 'failed' | 'conflict'): void {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('antrean-sync-message', { detail: { kind } }));
	}
}

function operationFingerprint(operation: StatusIntentOperation): string {
	return [
		operation.idempotency_key,
		operation.intent_id,
		operation.target,
		String(operation.expected_revision),
		String(operation.updated_at)
	].join('\u0000');
}

function desiredFingerprint(intent: StatusIntent): string {
	return [
		intent.idempotency_key,
		intent.intent_id ?? '',
		intent.target,
		String(intent.expected_revision),
		String(intent.updated_at)
	].join('\u0000');
}

function validIsoTimestamp(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
	)
		return false;
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function parseTransitionResponse(
	value: unknown,
	operation: StatusIntentOperation
): TransitionOrderResult | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const envelope = value as StatusResponse;
	if (
		envelope.ok !== true ||
		!envelope.data ||
		typeof envelope.data !== 'object' ||
		Array.isArray(envelope.data)
	)
		return null;
	const data = envelope.data as Record<string, unknown>;
	if (
		data.idempotency_key !== operation.idempotency_key ||
		data.preparation_state !== operation.target ||
		typeof data.transaction_id !== 'string' ||
		!data.transaction_id.trim() ||
		!Number.isSafeInteger(data.preparation_revision) ||
		Number(data.preparation_revision) < 0 ||
		typeof data.idempotent !== 'boolean'
	)
		return null;
	if (operation.target === 'done') {
		if (
			!validIsoTimestamp(data.preparation_completed_at) ||
			typeof data.preparation_completed_by !== 'string' ||
			!data.preparation_completed_by
		)
			return null;
	} else if (data.preparation_completed_at !== null || data.preparation_completed_by !== null) {
		return null;
	}
	return data as unknown as TransitionOrderResult;
}

async function postStatus(operation: StatusIntentOperation): Promise<Response> {
	return fetchWithCsrfRetry('/api/antrean/status', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			idempotency_key: operation.idempotency_key,
			target: operation.target,
			expected_revision: operation.expected_revision
		})
	});
}

function pendingCheckoutKeys(
	pendings: Array<Record<string, unknown>>,
	branch: string
): Set<string> {
	const keys = new Set<string>();
	for (const item of pendings) {
		if (
			item.type !== 'pos_transaction' ||
			(typeof item.branch === 'string' && item.branch.toLowerCase() !== branch)
		)
			continue;
		const request = item.request;
		if (!request || typeof request !== 'object' || Array.isArray(request)) continue;
		const key = (request as Record<string, unknown>).idempotency_key;
		if (typeof key === 'string' && key) keys.add(key);
	}
	return keys;
}

async function processStatusPass(
	branch: string,
	flight: StatusSyncFlight,
	result: OrderStatusSyncResult
): Promise<void> {
	if (!hasStatusScope(branch)) {
		reportSyncMessage('session');
		return;
	}
	const intents = await loadStatusIntents(branch);
	if (!intents.length) return;
	await syncPendingTransactions({ activeBranch: branch });
	if (!hasStatusScope(branch)) {
		reportSyncMessage('session');
		return;
	}
	const pending = (await getPendingTransactions()) as Array<Record<string, unknown>>;
	const waitingForCheckout = pendingCheckoutKeys(pending, branch);
	for (const intent of intents) {
		if (!hasStatusScope(branch)) {
			reportSyncMessage('session');
			return;
		}
		if (waitingForCheckout.has(intent.idempotency_key)) continue;
		if (flight.stageFailures.has(desiredFingerprint(intent))) continue;
		let operation: StatusIntentOperation | null;
		try {
			operation = await stageStatusIntent(branch, intent.idempotency_key);
		} catch {
			flight.stageFailures.add(desiredFingerprint(intent));
			result.failed++;
			reportSyncMessage('storage');
			continue;
		}
		if (!operation) continue;
		const fingerprint = operationFingerprint(operation);
		if (flight.attempted.has(fingerprint)) continue;
		flight.attempted.add(fingerprint);
		if (!hasStatusScope(branch)) {
			reportSyncMessage('session');
			return;
		}
		try {
			const response = await postStatus(operation);
			if (response.ok) {
				let body: unknown;
				try {
					body = await response.json();
				} catch {
					result.failed++;
					reportSyncMessage('failed');
					continue;
				}
				const transition = parseTransitionResponse(body, operation);
				if (!transition) {
					result.failed++;
					reportSyncMessage('failed');
					continue;
				}
				try {
					await acknowledgeStatusIntent(branch, operation, transition);
					result.synced++;
				} catch {
					result.failed++;
					reportSyncMessage('storage');
					continue;
				}
				window.dispatchEvent(new CustomEvent('antrean-synced'));
				continue;
			}
			if (response.status === 404 || response.status === 409) {
				let resolved: boolean;
				try {
					resolved = await rejectStagedStatusIntent(branch, operation);
				} catch {
					result.failed++;
					reportSyncMessage('storage');
					continue;
				}
				if (resolved) result.conflicts++;
				reportSyncMessage('conflict');
				window.dispatchEvent(new CustomEvent('antrean-conflict'));
				continue;
			}
			result.failed++;
			reportSyncMessage(response.status === 401 || response.status === 403 ? 'session' : 'failed');
		} catch {
			result.failed++;
			reportSyncMessage('failed');
		}
	}
}

async function hasUntouchedIntent(branch: string, flight: StatusSyncFlight): Promise<boolean> {
	const [intents, pending] = await Promise.all([
		loadStatusIntents(branch),
		getPendingTransactions() as Promise<Array<Record<string, unknown>>>
	]);
	const waitingForCheckout = pendingCheckoutKeys(pending, branch);
	return intents.some((intent) => {
		if (waitingForCheckout.has(intent.idempotency_key)) return false;
		if (flight.stageFailures.has(desiredFingerprint(intent))) return false;
		if (intent.in_flight) {
			return !flight.attempted.has(operationFingerprint(intent.in_flight));
		}
		return !flight.attempted.has(desiredFingerprint(intent));
	});
}

async function drainStatusSync(
	branch: string,
	flight: StatusSyncFlight
): Promise<OrderStatusSyncResult> {
	const result: OrderStatusSyncResult = { synced: 0, failed: 0, conflicts: 0 };
	for (;;) {
		const generation = flight.requestedGeneration;
		try {
			await processStatusPass(branch, flight, result);
			await processStatusPass(branch, flight, result);
			flight.processedGeneration = generation;
			if (!hasStatusScope(branch)) {
				if (flights.get(branch) === flight) flights.delete(branch);
				return result;
			}
			if (await hasUntouchedIntent(branch, flight)) {
				await Promise.resolve();
				continue;
			}
		} catch {
			result.failed++;
			reportSyncMessage('storage');
			flight.processedGeneration = generation;
		}
		await Promise.resolve();
		if (flight.requestedGeneration !== flight.processedGeneration) continue;
		if (flights.get(branch) === flight) flights.delete(branch);
		return result;
	}
}

/** Replay checkout first, then durable, staged status operations; same-branch calls coalesce. */
export function syncOrderStatusIntents(
	branchInput?: string
): Promise<{ synced: number; failed: number; conflicts: number }> {
	if (typeof window === 'undefined' || !navigator.onLine) {
		return Promise.resolve({ synced: 0, failed: 0, conflicts: 0 });
	}
	const verifiedBranch = sessionBranch();
	const branch = branchInput?.trim().toLowerCase() || verifiedBranch;
	if (!branch || branch !== verifiedBranch) {
		reportSyncMessage('session');
		return Promise.resolve({ synced: 0, failed: 0, conflicts: 0 });
	}
	const existing = flights.get(branch);
	if (existing) {
		existing.requestedGeneration++;
		return existing.promise;
	}
	const flight: StatusSyncFlight = {
		promise: Promise.resolve({ synced: 0, failed: 0, conflicts: 0 }),
		requestedGeneration: 1,
		processedGeneration: 0,
		attempted: new Set<string>(),
		stageFailures: new Set<string>()
	};
	flight.promise = Promise.resolve().then(() => drainStatusSync(branch, flight));
	flights.set(branch, flight);
	return flight.promise;
}
