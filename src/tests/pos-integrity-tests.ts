import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeItemFinancials } from '../lib/server/checkout/financials';
import {
	PosPricingTokenError,
	signPosPricingToken,
	verifyPosPricingToken
} from '../lib/server/posPricingToken';
import type { AddOnRow, ProductRow } from '../lib/server/checkout/types';
import { cacheStore, catalogStore, pendingTransactionStore } from '../lib/utils/idbStores';

const env = {
	POS_PRICE_SIGNING_KEY: 'test-only-pos-price-signing-key-32-bytes-minimum',
	POS_PRICE_SIGNING_KEY_ID: 'v1'
} as App.Platform['env'];
const now = Date.parse('2026-07-04T00:00:00.000Z');

const token = await signPosPricingToken(env, {
	kind: 'catalog_product',
	branch: 'samarinda',
	data: { id: 'produk-1', nama: 'Jus Mangga', harga: 12_000 },
	ttlMs: 60_000,
	now
});
const verified = await verifyPosPricingToken<{
	id: string;
	nama: string;
	harga: number;
}>(env, token, {
	kind: 'catalog_product',
	branch: 'samarinda',
	now: now + 30_000
});
assert.equal(verified.data.harga, 12_000);
const rotatedEnv = {
	POS_PRICE_SIGNING_KEY: 'new-test-only-pos-price-signing-key-32-bytes-minimum',
	POS_PRICE_SIGNING_KEY_ID: 'v2',
	POS_PRICE_SIGNING_KEY_PREVIOUS: env.POS_PRICE_SIGNING_KEY,
	POS_PRICE_SIGNING_KEY_PREVIOUS_ID: 'v1'
} as App.Platform['env'];
const verifiedAfterRotation = await verifyPosPricingToken<{ harga: number }>(rotatedEnv, token, {
	kind: 'catalog_product',
	branch: 'samarinda',
	now: now + 30_000
});
assert.equal(verifiedAfterRotation.data.harga, 12_000);

await assert.rejects(
	() =>
		verifyPosPricingToken(env, `${token.slice(0, -1)}x`, {
			kind: 'catalog_product',
			branch: 'samarinda',
			now: now + 30_000
		}),
	(error: unknown) => error instanceof PosPricingTokenError && error.code === 'TOKEN_INVALID'
);
await assert.rejects(
	() =>
		verifyPosPricingToken(env, token, {
			kind: 'catalog_product',
			branch: 'balikpapan',
			now: now + 30_000
		}),
	(error: unknown) =>
		error instanceof PosPricingTokenError && error.code === 'TOKEN_BRANCH_MISMATCH'
);
await assert.rejects(
	() =>
		verifyPosPricingToken(env, token, {
			kind: 'catalog_product',
			branch: 'samarinda',
			now: now + 60_001
		}),
	(error: unknown) => error instanceof PosPricingTokenError && error.code === 'TOKEN_EXPIRED'
);

const product: ProductRow = {
	id: 'produk-1',
	nama: 'Nama DB',
	harga: 10_000,
	stok: 20,
	lacak_stok: false,
	lacak_bahan: false,
	is_active: true
};
const addOn: AddOnRow = {
	id: 'tambahan-1',
	nama: 'Tambahan DB',
	harga: 1_000,
	is_active: true
};
const pricedFromQuote = computeItemFinancials({
	input: {
		source: {
			product_id: product.id,
			jumlah: 2,
			add_on_ids: [addOn.id]
		},
		productId: product.id,
		addOnIds: [addOn.id],
		jumlah: 2,
		pricingSnapshot: {
			product_name: 'Jus Mangga',
			product_price: 12_000,
			addOns: [{ id: addOn.id, nama: 'Jelly', harga: 2_000 }]
		}
	},
	productsById: new Map([[product.id, product]]),
	addOnsById: new Map([[addOn.id, addOn]]),
	recipesByProduct: new Map(),
	stockTrackingAvailable: false,
	ingredientTrackingAvailable: false,
	stockDeductions: new Map(),
	ingredientDeductions: new Map(),
	bukuKasId: 'kas-1',
	transactionId: 'trx-1'
});
assert.equal(pricedFromQuote.harga_dasar, 12_000);
assert.equal(pricedFromQuote.total_tambahan, 2_000);
assert.equal(pricedFromQuote.nominal, 28_000);

assert.notEqual(cacheStore, pendingTransactionStore);
assert.notEqual(catalogStore, pendingTransactionStore);

const cacheSource = readFileSync(new URL('../lib/utils/cache.ts', import.meta.url), 'utf8');
const offlineSource = readFileSync(new URL('../lib/utils/offline.ts', import.meta.url), 'utf8');
const productSource = readFileSync(
	new URL('../lib/services/productService.ts', import.meta.url),
	'utf8'
);
const checkoutSource = readFileSync(
	new URL('../routes/api/pos/transaction/+server.ts', import.meta.url),
	'utf8'
);
const quoteSource = readFileSync(
	new URL('../routes/api/pos/quote/+server.ts', import.meta.url),
	'utf8'
);
assert.match(cacheSource, /clearCache\(cacheStore\)/);
assert.doesNotMatch(cacheSource, /await clearCache\(\)/);
assert.match(offlineSource, /pendingTransactionStore/);
assert.match(productSource, /catalogStore/);
assert.match(productSource, /\/api\/pos\/catalog/);
assert.match(checkoutSource, /verifyPosPricingToken/);
assert.match(checkoutSource, /offline_signed_catalog/);
assert.match(checkoutSource, /Idempotency key sudah dipakai untuk transaksi berbeda/);
assert.doesNotMatch(checkoutSource, /OFFLINE_REPLAY_MAX_AGE_MS/);
assert.match(quoteSource, /Item custom hanya boleh dibuat pemilik/);
assert.doesNotMatch(quoteSource, /product_price_token:\s*item/);

import {
	getProductStockAvailability,
	isProductOutOfStock,
	getProductAvailableStock
} from '../lib/services/stockAlertService';

// Test Stock Availability Logic
// 1. Direct unit stock tracking
const prodUnitEmpty = { id: 'p-1', nama: 'Kerupuk', lacak_stok: true, stok: 0 };
const prodUnitHasStock = { id: 'p-2', nama: 'Kerupuk Pedas', lacak_stok: 1, stok: 5 };
assert.equal(isProductOutOfStock(prodUnitEmpty), true);
assert.equal(getProductAvailableStock(prodUnitEmpty), 0);
assert.equal(isProductOutOfStock(prodUnitHasStock), false);
assert.equal(getProductAvailableStock(prodUnitHasStock), 5);

// 2. Recipe ingredient tracking
const prodJuice = { id: 'p-3', nama: 'Es Jeruk', lacak_bahan: true, stok: null };
const ingredientsEmpty = [{ id: 'ing-1', nama: 'Jeruk Segar', stok_saat_ini: 0 }];
const recipesJuice = [
	{ produk_id: 'p-3', bahan_id: 'ing-1', porsi: 'reguler', jumlah_per_item: 100 }
];
const availEmpty = getProductStockAvailability(
	prodJuice,
	'reguler',
	ingredientsEmpty,
	recipesJuice
);
assert.equal(availEmpty.isOutOfStock, true);
assert.equal(availEmpty.availableStock, 0);
assert.equal(availEmpty.limitingIngredientName, 'Jeruk Segar');

const ingredientsPartial = [
	{ id: 'ing-1', nama: 'Jeruk Segar', stok_saat_ini: 350 }, // 3 portions
	{ id: 'ing-2', nama: 'Gula Pasir', stok_saat_ini: 25 } // 1 portion (requires 20)
];
const recipesMulti = [
	{ produk_id: 'p-3', bahan_id: 'ing-1', porsi: 'reguler', jumlah_per_item: 100 },
	{ produk_id: 'p-3', bahan_id: 'ing-2', porsi: 'reguler', jumlah_per_item: 20 }
];
const availPartial = getProductStockAvailability(
	prodJuice,
	'reguler',
	ingredientsPartial,
	recipesMulti
);
assert.equal(availPartial.isOutOfStock, false);
assert.equal(availPartial.availableStock, 1);
assert.equal(availPartial.limitingIngredientName, 'Gula Pasir');

import { computeTransactionFingerprint } from '../lib/server/checkout/fingerprint';

// 3. Behavioral Idempotency Fingerprint Testing
const fpA1 = computeTransactionFingerprint({
	branch: 'samarinda',
	items: [{ product_id: 'p-1', jumlah: 2, custom_price: 10_000, porsi: 'reguler' }],
	totalAmount: 20_000,
	totalQty: 2,
	paymentMethod: 'tunai',
	customerName: 'Budi'
});

const fpA2 = computeTransactionFingerprint({
	branch: 'samarinda',
	items: [{ product_id: 'p-1', jumlah: 2, custom_price: 10_000, porsi: 'reguler' }],
	totalAmount: 20_000,
	totalQty: 2,
	paymentMethod: 'tunai',
	customerName: 'Budi'
});

// Deterministic hash
assert.equal(fpA1, fpA2);

// Same total (20k) but DIFFERENT product -> DIFFERENT fingerprint
const fpDiffProduct = computeTransactionFingerprint({
	branch: 'samarinda',
	items: [{ product_id: 'p-2', jumlah: 1, custom_price: 20_000, porsi: 'reguler' }],
	totalAmount: 20_000,
	totalQty: 1,
	paymentMethod: 'tunai',
	customerName: 'Budi'
});
assert.notEqual(fpA1, fpDiffProduct);

// Same product but DIFFERENT portion -> DIFFERENT fingerprint
const fpDiffPortion = computeTransactionFingerprint({
	branch: 'samarinda',
	items: [{ product_id: 'p-1', jumlah: 2, custom_price: 10_000, porsi: 'jumbo' }],
	totalAmount: 20_000,
	totalQty: 2,
	paymentMethod: 'tunai',
	customerName: 'Budi'
});
assert.notEqual(fpA1, fpDiffPortion);

// Same product but DIFFERENT payment method -> DIFFERENT fingerprint
const fpDiffPayment = computeTransactionFingerprint({
	branch: 'samarinda',
	items: [{ product_id: 'p-1', jumlah: 2, custom_price: 10_000, porsi: 'reguler' }],
	totalAmount: 20_000,
	totalQty: 2,
	paymentMethod: 'non-tunai',
	customerName: 'Budi'
});
assert.notEqual(fpA1, fpDiffPayment);

console.log('pos-integrity-tests: 35 assertions passed');
