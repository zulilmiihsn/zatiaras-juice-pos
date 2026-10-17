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
import {
	applyQuoteToCart,
	buildCheckoutItems,
	hasOfflinePriceTokens,
	parseCheckoutResponse,
	parseQuoteResponse
} from '../lib/utils/posCheckout';
import type { CartItem } from '../lib/types/cart';

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

// Kontrak klien checkout POS (utils/posCheckout).
{
	const tokened: CartItem = {
		product: { id: 7, nama: 'Jus', harga: 10_000, tipe: 'minuman', price_token: 'p7' },
		jumlah: 2,
		porsi: 'jumbo',
		addOns: [{ id: 3, nama: 'Keju', harga: 2_000, price_token: 'a3' }],
		gula: 'less',
		es: '',
		catatan: ''
	};
	const custom: CartItem = {
		product: { id: 'custom-1', nama: 'Titipan', harga: 5_000, tipe: 'custom' },
		jumlah: 1,
		addOns: [],
		gula: '',
		es: '',
		catatan: 'bungkus'
	};
	assert.deepEqual(buildCheckoutItems([tokened, custom]), [
		{
			product_id: 7,
			nama_kustom: null,
			custom_price: null,
			jumlah: 2,
			add_on_ids: [3],
			porsi: 'jumbo',
			gula: 'less',
			es: null,
			catatan: null,
			product_price_token: 'p7',
			add_on_price_tokens: ['a3']
		},
		{
			product_id: null,
			nama_kustom: 'Titipan',
			custom_price: 5_000,
			jumlah: 1,
			add_on_ids: [],
			porsi: 'reguler',
			gula: null,
			es: null,
			catatan: 'bungkus',
			product_price_token: null,
			add_on_price_tokens: []
		}
	]);

	const now = Date.parse('2026-06-29T08:00:00.000Z');
	const future = '2026-06-29T09:00:00.000Z';
	assert.equal(hasOfflinePriceTokens([tokened, custom], future, now), true);
	assert.equal(hasOfflinePriceTokens([tokened], '2026-06-29T07:00:00.000Z', now), false);
	assert.equal(hasOfflinePriceTokens([tokened], null, now), false, 'katalog tanpa expiry ditolak');
	assert.equal(
		hasOfflinePriceTokens(
			[{ ...tokened, product: { ...tokened.product, price_token: undefined } }],
			future,
			now
		),
		false,
		'produk tanpa token ditolak'
	);
	assert.equal(
		hasOfflinePriceTokens(
			[{ ...tokened, addOns: [{ id: 3, nama: 'Keju', harga: 2_000 }] }],
			future,
			now
		),
		false,
		'topping tanpa token ditolak'
	);

	const quote = {
		ok: true,
		quote_token: 'q1',
		expires_at: future,
		total_amount: 30_000,
		total_qty: 2,
		items: [
			{
				source: {},
				product_name: 'Jus Mangga',
				product_price: 13_000,
				add_ons: [{ id: '3', nama: 'Keju', harga: 2_000 }],
				line_total: 30_000
			}
		]
	};
	assert.equal(parseQuoteResponse(quote, 1).quote_token, 'q1');
	assert.throws(() => parseQuoteResponse(quote, 2), /quote POS tidak valid/, 'jumlah baris beda');
	assert.throws(() => parseQuoteResponse({ ...quote, quote_token: '' }, 1), /tidak valid/);
	assert.throws(() => parseQuoteResponse(null, 1), /tidak valid/);

	const [quoted] = applyQuoteToCart([tokened], quote);
	assert.equal(quoted.product.nama, 'Jus Mangga');
	assert.equal(quoted.product.harga, 13_000);
	assert.equal(quoted.product.price_token, 'p7', 'atribut lokal produk tetap');
	assert.deepEqual(quoted.addOns, [
		{ id: '3', nama: 'Keju', harga: 2_000, price_token: 'a3', is_active: true }
	]);

	assert.throws(() => parseCheckoutResponse({ ok: true, data: { total_amount: 1 } }), /transaksi/);
	assert.throws(() => parseCheckoutResponse({ ok: false }), /transaksi/);
	assert.equal(
		parseCheckoutResponse({ ok: true, data: { total_amount: 1, receipt: receiptSample } })
			.total_amount,
		1
	);
}

console.log('offline-pos-tests: all assertions passed');
