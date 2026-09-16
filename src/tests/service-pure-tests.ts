import assert from 'node:assert/strict';
import { parsePrinterConfig } from '../lib/utils/printerConfig.js';
import { selectSyncablePendings } from '../lib/utils/offlineQueue.js';
import type { PendingTransaction } from '../lib/utils/offlineQueue.js';

// parsePrinterConfig: murni, tak sentuh localStorage.
assert.deepEqual(parsePrinterConfig(null), { method: 'intent', paperSize: '58mm', deviceName: '' });
assert.deepEqual(parsePrinterConfig('rusak'), {
	method: 'intent',
	paperSize: '58mm',
	deviceName: ''
});
assert.deepEqual(parsePrinterConfig({ method: 'server', paperSize: '80mm', deviceName: 'PC' }), {
	method: 'server',
	paperSize: '80mm',
	deviceName: 'PC'
});
assert.deepEqual(
	parsePrinterConfig({ method: 'fax', paperSize: 'A4', deviceName: 42 }).method,
	'intent'
);
assert.deepEqual(parsePrinterConfig({ method: 'usb' }).paperSize, '58mm');

const now = Date.now();
const base: PendingTransaction = {
	schema_version: 2,
	queue_id: 'q',
	branch: 'samarinda',
	status: 'pending',
	created_at: new Date(now).toISOString(),
	updated_at: new Date(now).toISOString(),
	attempt_count: 0,
	next_attempt_at: 0,
	last_error: null,
	failure_kind: null
};
const item = (patch: Partial<PendingTransaction>): PendingTransaction => ({ ...base, ...patch });

// Tahan permanen: review owner, cabang beda, auth/konflik.
const mixed = [
	item({ queue_id: 'ok' }),
	item({ queue_id: 'review', requires_owner_review: true }),
	item({ queue_id: 'cabang', branch: 'balikpapan' }),
	item({ queue_id: 'auth', failure_kind: 'auth', next_attempt_at: Number.MAX_SAFE_INTEGER }),
	item({ queue_id: 'konflik', failure_kind: 'conflict', next_attempt_at: Number.MAX_SAFE_INTEGER }),
	item({ queue_id: 'nanti', next_attempt_at: now + 3600_000 })
];
assert.deepEqual(
	selectSyncablePendings(mixed, { activeBranch: 'samarinda' }).map((i) => i.queue_id),
	['ok']
);
// Force tetap hormati review/cabang/permanen.
assert.deepEqual(
	selectSyncablePendings(mixed, { activeBranch: 'samarinda', force: true }).map((i) => i.queue_id),
	['ok', 'nanti']
);
// queueIds eksplisit lolos antrean waktu, bukan permanen.
assert.deepEqual(
	selectSyncablePendings(mixed, {
		activeBranch: 'samarinda',
		queueIds: new Set(['nanti', 'auth'])
	}).map((i) => i.queue_id),
	['ok', 'auth', 'nanti']
);

console.log('service-pure-tests: all assertions passed');
