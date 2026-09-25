import assert from 'node:assert/strict';
import {
	parseCachedStockPolicy,
	readCachedStockPolicy,
	stockPolicyCacheKey,
	writeCachedStockPolicy,
	type PolicyCacheStorage
} from '../lib/utils/stockPolicyCache';

function memoryStorage(initial: Record<string, string> = {}): PolicyCacheStorage {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key) => (store.has(key) ? store.get(key)! : null),
		setItem: (key, value) => {
			store.set(key, value);
		}
	};
}

try {
	assert.equal(stockPolicyCacheKey('Samarinda'), 'pos-stock-policy:samarinda');
	assert.equal(stockPolicyCacheKey('  '), 'pos-stock-policy:samarinda');

	assert.deepEqual(parseCachedStockPolicy(null), null);
	assert.deepEqual(parseCachedStockPolicy('x'), null);
	assert.deepEqual(parseCachedStockPolicy({ mode: 'tracked', revision: 1 }), null);
	assert.deepEqual(
		parseCachedStockPolicy({ mode: 'ignored', revision: '1', epoch_token: 't' }),
		null
	);
	assert.deepEqual(parseCachedStockPolicy({ mode: 'tracked', revision: 2, epoch_token: 't' }), {
		mode: 'tracked',
		revision: 2,
		epoch_token: 't'
	});

	const storage = memoryStorage({
		'pos-stock-policy:samarinda': 'bukan-json'
	});
	assert.equal(readCachedStockPolicy('samarinda', storage), null);
	assert.equal(readCachedStockPolicy('samarinda', null), null);

	// Tulis katalog membawa token baru.
	writeCachedStockPolicy(
		'samarinda',
		{ mode: 'tracked', revision: 3, epoch_token: 'epoch-3' },
		storage
	);
	assert.deepEqual(readCachedStockPolicy('samarinda', storage), {
		mode: 'tracked',
		revision: 3,
		epoch_token: 'epoch-3'
	});

	// Refresh tanpa token pada mode+revision sama: token dipertahankan.
	writeCachedStockPolicy('samarinda', { mode: 'tracked', revision: 3 }, storage);
	assert.deepEqual(readCachedStockPolicy('samarinda', storage), {
		mode: 'tracked',
		revision: 3,
		epoch_token: 'epoch-3'
	});

	// Revision berubah tanpa token: token lama dibuang, bukan dipakai ulang.
	writeCachedStockPolicy('samarinda', { mode: 'ignored', revision: 4 }, storage);
	assert.deepEqual(readCachedStockPolicy('samarinda', storage), {
		mode: 'ignored',
		revision: 4,
		epoch_token: ''
	});

	console.log('stock-policy-cache-tests: parse, preserve, and invalidate passed');
} catch (error) {
	throw error;
}
