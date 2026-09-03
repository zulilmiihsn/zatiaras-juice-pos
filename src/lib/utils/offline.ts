import { get as idbGet, update as idbUpdate, del as idbDel } from 'idb-keyval';
import { pendingTransactionStore } from '$lib/utils/idbStores';
import {
	normalizePendingTransaction,
	getPendingDedupeKey,
	isNormalizedPendingTransaction,
	type PendingFailureKind,
	type PendingTransaction
} from './offlineQueue';

export type { PendingFailureKind, PendingStatus, PendingTransaction } from './offlineQueue';

const PENDING_KEY = 'pending_transactions';
const MAX_PENDING_TRANSACTIONS = 1_000;

function notifyPendingChanged() {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('pending-changed'));
	}
}

export async function addPendingTransaction(
	trx: unknown,
	branch?: string
): Promise<PendingTransaction> {
	const activeBranch =
		branch ||
		(typeof trx === 'object' && trx && 'branch' in trx
			? String((trx as { branch?: unknown }).branch)
			: typeof window !== 'undefined'
				? localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda'
				: 'samarinda');
	const pending = normalizePendingTransaction(trx, { branch: activeBranch });
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) => {
			const queue = (Array.isArray(existing) ? existing : []).map((item) =>
				normalizePendingTransaction(item)
			);
			const dedupeKey = getPendingDedupeKey(pending);
			if (dedupeKey && queue.some((item) => getPendingDedupeKey(item) === dedupeKey)) {
				return queue;
			}
			if (queue.length >= MAX_PENDING_TRANSACTIONS) {
				throw new Error(
					'Antrean offline penuh. Sinkronkan transaksi sebelum membuat transaksi baru.'
				);
			}
			return [...queue, pending];
		},
		pendingTransactionStore
	);
	notifyPendingChanged();
	return pending;
}

export async function getPendingTransactions(): Promise<PendingTransaction[]> {
	const existing = await idbGet<unknown[]>(PENDING_KEY, pendingTransactionStore);
	if (!Array.isArray(existing) || existing.length === 0) return [];

	const normalized = existing.map((item) => normalizePendingTransaction(item));
	if (existing.some((item) => !isNormalizedPendingTransaction(item))) {
		await idbUpdate(PENDING_KEY, () => normalized, pendingTransactionStore);
	}
	return normalized;
}

export async function removePendingTransaction(queueId: string): Promise<void> {
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) =>
			(Array.isArray(existing) ? existing : []).filter((item) => item.queue_id !== queueId),
		pendingTransactionStore
	);
	notifyPendingChanged();
}

export async function markPendingTransactionSyncing(queueId: string): Promise<void> {
	const now = Date.now();
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) =>
			(Array.isArray(existing) ? existing : []).map((value) => {
				const item = normalizePendingTransaction(value, { now });
				if (item.queue_id !== queueId) return item;
				return {
					...item,
					status: 'syncing' as const,
					attempt_count: item.attempt_count + 1,
					updated_at: new Date(now).toISOString(),
					last_error: null,
					failure_kind: null
				};
			}),
		pendingTransactionStore
	);
	notifyPendingChanged();
}

export async function markPendingTransactionFailed(
	queueId: string,
	input: {
		error: string;
		failureKind: Exclude<PendingFailureKind, null>;
		nextAttemptAt: number;
	}
): Promise<void> {
	const now = Date.now();
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) =>
			(Array.isArray(existing) ? existing : []).map((value) => {
				const item = normalizePendingTransaction(value, { now });
				if (item.queue_id !== queueId) return item;
				return {
					...item,
					status: 'failed' as const,
					updated_at: new Date(now).toISOString(),
					next_attempt_at: input.nextAttemptAt,
					last_error: input.error.slice(0, 240),
					failure_kind: input.failureKind
				};
			}),
		pendingTransactionStore
	);
	notifyPendingChanged();
}

export async function retryFailedPendingTransactions(
	failureKinds?: Array<Exclude<PendingFailureKind, null>>
): Promise<void> {
	const now = Date.now();
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) =>
			(Array.isArray(existing) ? existing : []).map((value) => {
				const item = normalizePendingTransaction(value, { now });
				if (
					item.status !== 'failed' ||
					(failureKinds && item.failure_kind && !failureKinds.includes(item.failure_kind))
				) {
					return item;
				}
				return {
					...item,
					status: 'pending' as const,
					updated_at: new Date(now).toISOString(),
					next_attempt_at: 0,
					last_error: null,
					failure_kind: null
				};
			}),
		pendingTransactionStore
	);
	notifyPendingChanged();
}

export async function retryPendingTransaction(queueId: string): Promise<void> {
	const now = Date.now();
	await idbUpdate(
		PENDING_KEY,
		(existing: PendingTransaction[] | undefined) =>
			(Array.isArray(existing) ? existing : []).map((value) => {
				const item = normalizePendingTransaction(value, { now });
				if (item.queue_id !== queueId || item.status !== 'failed') return item;
				return {
					...item,
					status: 'pending' as const,
					updated_at: new Date(now).toISOString(),
					next_attempt_at: 0,
					last_error: null,
					failure_kind: null
				};
			}),
		pendingTransactionStore
	);
	notifyPendingChanged();
}

export async function clearPendingTransactions(): Promise<void> {
	await idbDel(PENDING_KEY, pendingTransactionStore);
	notifyPendingChanged();
}
