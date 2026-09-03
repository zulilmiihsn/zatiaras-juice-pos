import assert from 'node:assert/strict';
import {
	buildPendingTransactionExport,
	classifySyncFailure,
	getPendingDedupeKey,
	getRetryDelayMs,
	isPendingReady,
	normalizePendingTransaction
} from '../lib/utils/offlineQueue';
import {
	isOfflinePosPath,
	persistOfflineSessionSnapshot,
	readOfflineSessionSnapshot
} from '../lib/auth/offlineSession';

class MemoryStorage {
	private values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const now = Date.parse('2026-06-19T00:00:00.000Z');

const normalized = normalizePendingTransaction(
	{
		type: 'pos_transaction',
		request: { idempotency_key: 'checkout-12345678' }
	},
	{ now, queueId: 'queue-1' }
);
assert.equal(normalized.queue_id, 'queue-1');
assert.equal(normalized.status, 'pending');
assert.equal(normalized.attempt_count, 0);
assert.equal(normalized.next_attempt_at, 0);
assert.equal(getPendingDedupeKey(normalized), 'pos:checkout-12345678');

const manualTransaction = normalizePendingTransaction(
	{ queue_id: 'manual-1', id: 'kas-1', sumber: 'catat' },
	{ now }
);
assert.equal(manualTransaction.queue_id, 'manual-1');
assert.equal(manualTransaction.status, 'pending');
assert.equal(manualTransaction.created_at, '2026-06-19T00:00:00.000Z');

assert.equal(getRetryDelayMs(1), 1_000);
assert.equal(getRetryDelayMs(2), 2_000);
assert.equal(getRetryDelayMs(20), 300_000);
assert.equal(classifySyncFailure(401), 'auth');
assert.equal(classifySyncFailure(409), 'conflict');
assert.equal(classifySyncFailure(429), 'rate_limit');
assert.equal(classifySyncFailure(503), 'server');
assert.equal(classifySyncFailure(), 'network');

assert.equal(isPendingReady(normalized, now), true);
assert.equal(
	isPendingReady(
		{ ...normalized, status: 'failed', failure_kind: 'auth', next_attempt_at: 0 },
		now
	),
	false
);
assert.equal(
	isPendingReady(
		{
			...normalized,
			status: 'syncing',
			updated_at: new Date(now - 6 * 60_000).toISOString()
		},
		now
	),
	true
);

const storage = new MemoryStorage();
const expiresAt = Date.now() + 60_000;
persistOfflineSessionSnapshot({ id: 'u1', role: 'kasir' }, expiresAt, storage);
assert.equal(readOfflineSessionSnapshot(storage)?.user.role, 'kasir');
assert.equal(readOfflineSessionSnapshot(storage, expiresAt + 1), null);
assert.equal(isOfflinePosPath('/pos'), true);
assert.equal(isOfflinePosPath('/pos/bayar'), true);
assert.equal(isOfflinePosPath('/laporan'), false);

const exportPayload = buildPendingTransactionExport(
	[
		{
			...normalized,
			request: {
				idempotency_key: 'checkout-12345678',
				quote_token: 'signed-price-token',
				password: 'must-not-export',
				csrfToken: 'must-not-export',
				headers: {
					Accept: 'application/json',
					Authorization: 'Bearer must-not-export',
					Cookie: 'zatiaras_sid=must-not-export',
					'X-CSRF-Token': 'must-not-export'
				}
			}
		}
	],
	now
);
assert.equal(exportPayload.version, 1);
assert.equal(exportPayload.exported_at, '2026-06-19T00:00:00.000Z');
const exportedRequest = exportPayload.transactions[0].request as Record<string, unknown>;
assert.equal(exportedRequest.quote_token, 'signed-price-token');
assert.equal('password' in exportedRequest, false);
assert.equal('csrfToken' in exportedRequest, false);
const exportedHeaders = exportedRequest.headers as Record<string, unknown>;
assert.equal(exportedHeaders.Accept, 'application/json');
assert.equal('Authorization' in exportedHeaders, false);
assert.equal('Cookie' in exportedHeaders, false);
assert.equal('X-CSRF-Token' in exportedHeaders, false);

import { catalogStore, pendingTransactionStore } from '../lib/utils/idbStores';

// Functional store and branch scoping tests
assert.ok(catalogStore);
assert.ok(pendingTransactionStore);
assert.notEqual(catalogStore, pendingTransactionStore);

// Branch isolation in pending transaction normalization
const samarindaTrx = normalizePendingTransaction(
	{ type: 'pos_transaction', request: { total: 10_000 } },
	{ branch: 'samarinda' }
);
assert.equal(samarindaTrx.branch, 'samarinda');

const balikpapanTrx = normalizePendingTransaction(
	{ type: 'pos_transaction', request: { total: 15_000 } },
	{ branch: 'balikpapan' }
);
assert.equal(balikpapanTrx.branch, 'balikpapan');
const legacyTrx = normalizePendingTransaction({
	type: 'pos_transaction',
	request: { total: 20_000 }
});
assert.equal(
	legacyTrx.requires_owner_review,
	true,
	'Legacy unassigned item must require owner review'
);

const receiptSample = { total_amount: 50_000, items: [] };
const receiptTrx = normalizePendingTransaction({
	type: 'pos_transaction',
	request: { total: 50_000 },
	receipt: receiptSample
});
assert.deepEqual(
	receiptTrx.receipt,
	receiptSample,
	'Pending transaction must preserve committed receipt'
);

console.log('offline-pos-tests: 40 assertions passed');
