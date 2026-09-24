import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import {
	loadStockPolicy,
	StockPolicyConflictError,
	writeStockPolicy
} from '../lib/server/stockPolicy';
import { GET, PUT } from '../routes/api/pengaturan/stok/+server';
import { createTestD1 } from './helpers/testD1';
import { executeCheckout, CheckoutUseCaseError } from '../lib/server/checkout/checkoutUseCase';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import { voidTransaksiKasir } from '../lib/server/services/transaksiKasirService';
import type { D1Database } from '@cloudflare/workers-types';
import {
	createStockReconciliation,
	finalizeStockReconciliation,
	updateStockReconciliationCounts
} from '../lib/server/stockReconciliation';

const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const samarinda2 = branchContext('samarinda2');
const actor = { userId: 'owner-1', role: 'pemilik' };

function event(
	method: 'GET' | 'PUT',
	role: string,
	url = 'https://test.invalid/api/pengaturan/stok',
	body?: unknown,
	branch = 'samarinda',
	realtimeFail = false
) {
	return {
		request: new Request(url, {
			method,
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }
		}),
		url: new URL(url),
		locals: {
			authSession: {
				id: 'session-1',
				userId: 'owner-1',
				username: 'owner',
				role,
				branch,
				createdAt: 0,
				expiresAt: 1,
				unlockedPages: [],
				unlockExpiresAt: 0
			}
		},
		platform: {
			env: {
				DB_SAMARINDA_GROUP: db,
				STOCK_POLICY_ROLLOUT_BRANCHES: 'samarinda',
				REALTIME_HUB: realtimeFail
					? {
							idFromName: () => 'id',
							get: () => ({ fetch: async () => Promise.reject(new Error('realtime down')) })
						}
					: undefined
			}
		}
	};
}

async function expectStatus(run: () => unknown, status: number): Promise<void> {
	await assert.rejects(
		async () => run(),
		(error: { status?: number }) => error.status === status
	);
}

try {
	assert.deepEqual(await loadStockPolicy(db, samarinda), {
		mode: 'tracked',
		revision: 0,
		disabled_at: null,
		reconciled_at: null,
		updated_at: null
	});
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM stock_policy').first<number>('n'), 0);
	const virtualNoOp = await writeStockPolicy(db, samarinda, {
		expectedRevision: 0,
		mode: 'tracked',
		actor,
		now: '2026-09-24T00:00:00.000Z'
	});
	assert.equal(virtualNoOp.changed, false);
	assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM stock_policy').first<number>('n'), 0);

	const raced = await Promise.allSettled([
		writeStockPolicy(db, samarinda, {
			expectedRevision: 0,
			mode: 'ignored',
			actor,
			now: '2026-09-24T01:00:00.000Z'
		}),
		writeStockPolicy(db, samarinda, {
			expectedRevision: 0,
			mode: 'ignored',
			actor,
			now: '2026-09-24T01:00:01.000Z'
		})
	]);
	assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
	assert.equal(raced.filter((result) => result.status === 'rejected').length, 1);
	const rejected = raced.find((result) => result.status === 'rejected');
	assert.ok(rejected && rejected.reason instanceof StockPolicyConflictError);

	const first = await loadStockPolicy(db, samarinda);
	assert.equal(first.mode, 'ignored');
	assert.equal(first.revision, 1);
	const transition = await db
		.prepare(
			'SELECT previous_mode, previous_revision, mode, revision, actor_user_id, actor_role FROM stock_policy_transitions WHERE cabang_id = ?'
		)
		.bind(samarinda)
		.first<{
			previous_mode: string;
			previous_revision: number;
			mode: string;
			revision: number;
			actor_user_id: string;
			actor_role: string;
		}>();
	assert.deepEqual(
		{ ...transition },
		{
			previous_mode: 'tracked',
			previous_revision: 0,
			mode: 'ignored',
			revision: 1,
			actor_user_id: 'owner-1',
			actor_role: 'pemilik'
		}
	);

	assert.deepEqual(await loadStockPolicy(db, samarinda2), {
		mode: 'tracked',
		revision: 0,
		disabled_at: null,
		reconciled_at: null,
		updated_at: null
	});
	await writeStockPolicy(db, samarinda2, {
		expectedRevision: 0,
		mode: 'ignored',
		actor,
		now: '2026-09-24T02:00:00.000Z'
	});
	assert.equal((await loadStockPolicy(db, samarinda)).updated_at, first.updated_at);
	const emptyJob = await createStockReconciliation(
		db,
		samarinda2,
		actor,
		'2026-09-24T02:15:00.000Z'
	);
	await finalizeStockReconciliation(
		db,
		samarinda2,
		emptyJob.id,
		1,
		actor,
		'2026-09-24T02:30:00.000Z'
	);
	const existingTracked = await writeStockPolicy(db, samarinda2, {
		expectedRevision: 2,
		mode: 'ignored',
		actor,
		now: '2026-09-24T02:45:00.000Z'
	});
	assert.equal(existingTracked.policy.revision, 3);
	assert.equal(existingTracked.policy.mode, 'ignored');

	const noOp = await writeStockPolicy(db, samarinda, {
		expectedRevision: 1,
		mode: 'ignored',
		actor,
		now: '2026-09-24T03:00:00.000Z'
	});
	assert.equal(noOp.changed, false);
	assert.equal(noOp.policy.updated_at, first.updated_at);
	assert.equal(
		await db
			.prepare('SELECT COUNT(*) AS n FROM stock_policy_transitions WHERE cabang_id = ?')
			.bind(samarinda)
			.first<number>('n'),
		1
	);
	await assert.rejects(
		writeStockPolicy(db, samarinda, {
			expectedRevision: 1,
			mode: 'tracked',
			actor,
			now: '2026-09-24T04:00:00.000Z'
		}),
		(error: { status?: number }) => error.status === 409
	);

	const getResponse = await GET(
		event(
			'GET',
			'kasir',
			'https://test.invalid/api/pengaturan/stok?branch=samarinda'
		) as unknown as Parameters<typeof GET>[0]
	);
	assert.equal(getResponse.status, 200);
	assert.equal(
		((await getResponse.json()) as { data: { can_manage_policy: boolean; mode: string } }).data
			.can_manage_policy,
		false
	);

	await expectStatus(() => GET(event('GET', 'admin') as unknown as Parameters<typeof GET>[0]), 403);
	await expectStatus(
		() =>
			GET(
				event(
					'GET',
					'kasir',
					'https://test.invalid/api/pengaturan/stok?branch=samarinda2'
				) as unknown as Parameters<typeof GET>[0]
			),
		403
	);
	await expectStatus(
		() =>
			GET(
				event(
					'GET',
					'kasir',
					'https://test.invalid/api/pengaturan/stok?extra=1'
				) as unknown as Parameters<typeof GET>[0]
			),
		400
	);

	for (const invalid of [
		{ branch: 'samarinda', expected_revision: 0, mode: 'invalid' },
		{ branch: 'samarinda', expected_revision: '0', mode: 'ignored' },
		{ branch: 'samarinda', expected_revision: 0, mode: 'ignored', extra: true }
	]) {
		await expectStatus(
			() =>
				PUT(event('PUT', 'pemilik', undefined, invalid) as unknown as Parameters<typeof PUT>[0]),
			400
		);
	}
	await expectStatus(
		() =>
			PUT(
				event('PUT', 'admin', undefined, {
					branch: 'samarinda',
					expected_revision: 1,
					mode: 'ignored'
				}) as unknown as Parameters<typeof PUT>[0]
			),
		403
	);
	await expectStatus(
		() =>
			PUT(
				event('PUT', 'kasir', undefined, {
					branch: 'samarinda',
					expected_revision: 1,
					mode: 'ignored'
				}) as unknown as Parameters<typeof PUT>[0]
			),
		403
	);
	await expectStatus(
		() =>
			PUT(
				event('PUT', 'pemilik', undefined, {
					branch: 'samarinda2',
					expected_revision: 3,
					mode: 'ignored'
				}) as unknown as Parameters<typeof PUT>[0]
			),
		403
	);

	await db
		.prepare('DELETE FROM stock_policy_transitions WHERE cabang_id = ?')
		.bind(samarinda)
		.run();
	await db.prepare('DELETE FROM stock_policy WHERE cabang_id = ?').bind(samarinda).run();
	const putResponse = await PUT(
		event(
			'PUT',
			'pemilik',
			undefined,
			{ branch: 'samarinda', expected_revision: 0, mode: 'ignored' },
			'samarinda',
			true
		) as unknown as Parameters<typeof PUT>[0]
	);
	assert.equal(putResponse.status, 200, 'realtime failure must not roll back policy');
	assert.equal((await loadStockPolicy(db, samarinda)).revision, 1);
	assert.equal(
		await db
			.prepare(
				"SELECT COUNT(*) AS n FROM audit_logs WHERE cabang_id = ? AND entity_type = 'stock_policy'"
			)
			.bind(samarinda)
			.first<number>('n'),
		1
	);

	const useSharedWorkerd = process.argv.includes('--d1');
	const checkoutHarness = useSharedWorkerd
		? { db, close: async () => undefined }
		: await createTestD1(false);
	try {
		const checkoutDb = checkoutHarness.db;
		if (useSharedWorkerd) {
			await checkoutDb.batch([
				checkoutDb.prepare('DELETE FROM stock_policy_transitions'),
				checkoutDb.prepare('DELETE FROM stock_policy')
			]);
		}
		await checkoutDb
			.prepare(
				`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
				 VALUES
					('checkout-product', 'samarinda', 'Produk Checkout', 10000, 2, 1, 0, 1),
					('ignored-product', 'samarinda', 'Produk Ignored', 12000, 0, 1, 0, 1),
					('last-product', 'samarinda', 'Produk Terakhir', 8000, 1, 1, 0, 1),
					('race-product', 'samarinda', 'Produk Race', 9000, 1, 1, 0, 1),
					('recipe-product', 'samarinda', 'Produk Resep', 15000, 0, 0, 1, 1)`
			)
			.run();
		await checkoutDb.batch([
			checkoutDb.prepare(
				`INSERT INTO bahan (
					id, cabang_id, nama, satuan, stok_saat_ini, biaya_per_satuan, is_active
				) VALUES
					('recipe-ingredient', 'samarinda', 'Jeruk', 'gram', 100, 200, 1),
					('addon-ingredient', 'samarinda', 'Jelly', 'gram', 100, 100, 1)`
			),
			checkoutDb.prepare(
				`INSERT INTO resep_produk (
					id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, jumlah_dasar_per_item
				) VALUES ('recipe-row', 'samarinda', 'recipe-product', 'recipe-ingredient', 'reguler', 10, 10)`
			),
			checkoutDb.prepare(
				`INSERT INTO tambahan (
					id, cabang_id, nama, harga, bahan_id, jumlah_bahan, jumlah_dasar_per_item, is_active
				) VALUES ('recipe-addon', 'samarinda', 'Jelly', 2000, 'addon-ingredient', 5, 5, 1)`
			)
		]);

		const checkoutEnv = {
			DB_SAMARINDA_GROUP: checkoutDb,
			POS_PRICE_SIGNING_KEY: 'stock-policy-checkout-test-key-32-bytes-minimum',
			POS_PRICE_SIGNING_KEY_ID: 'test'
		} as App.Platform['env'];
		const checkoutPlatform = { env: checkoutEnv } as App.Platform;
		const checkoutSession = { userId: 'owner-checkout', username: 'owner', role: 'pemilik' };

		async function checkoutProduct(
			productId: string,
			price: number,
			key: string,
			database: D1Database = checkoutDb,
			platform: App.Platform = checkoutPlatform,
			addOns: Array<{ id: string; nama: string; harga: number }> = []
		) {
			const source = {
				product_id: productId,
				jumlah: 1,
				add_on_ids: addOns.map((item) => item.id)
			};
			const totalPrice = price + addOns.reduce((sum, item) => sum + item.harga, 0);
			const quoteToken = await signPosPricingToken(checkoutEnv, {
				kind: 'checkout_quote',
				branch: 'samarinda',
				data: {
					items: [
						{
							source,
							product_name: productId,
							product_price: price,
							add_ons: addOns,
							line_total: totalPrice
						}
					],
					total_amount: totalPrice,
					total_qty: 1
				},
				ttlMs: 60_000
			});
			return executeCheckout({
				db: database,
				branch: branchContext('samarinda'),
				session: checkoutSession,
				platform,
				rawBody: {
					idempotency_key: key,
					metode_bayar: 'tunai',
					cash_received: totalPrice,
					items: [source],
					quote_token: quoteToken
				}
			});
		}

		const trackedSale = await checkoutProduct('checkout-product', 10_000, 'tracked-checkout-1');
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'checkout-product'")
				.first<number>('stok'),
			1
		);
		assert.equal(
			await checkoutDb
				.prepare(
					"SELECT COUNT(*) AS n FROM produk_mutasi WHERE referensi_id = ? AND sumber = 'pos'"
				)
				.bind(trackedSale.data.transaction_id)
				.first<number>('n'),
			1
		);

		await writeStockPolicy(checkoutDb, branchContext('samarinda'), {
			expectedRevision: 0,
			mode: 'ignored',
			actor,
			now: '2026-09-24T05:00:00.000Z'
		});
		const retry = await checkoutProduct('checkout-product', 10_000, 'tracked-checkout-1');
		assert.equal(retry.idempotent, true);
		assert.equal(retry.data.transaction_id, trackedSale.data.transaction_id);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'checkout-product'")
				.first<number>('stok'),
			1
		);

		const ignoredSale = await checkoutProduct('ignored-product', 12_000, 'ignored-checkout-1');
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'ignored-product'")
				.first<number>('stok'),
			0
		);
		const ignoredRecipe = await checkoutProduct(
			'recipe-product',
			15_000,
			'ignored-recipe-1',
			checkoutDb,
			checkoutPlatform,
			[{ id: 'recipe-addon', nama: 'Jelly', harga: 2_000 }]
		);
		const ignoredRecipeRow = await checkoutDb
			.prepare(
				`SELECT nominal_hpp, snapshot_hpp FROM transaksi_kasir
				 WHERE cabang_id = ? AND transaction_id = ?`
			)
			.bind('samarinda', ignoredRecipe.data.transaction_id)
			.first<{ nominal_hpp: number; snapshot_hpp: string }>();
		assert.equal(ignoredRecipeRow?.nominal_hpp, 2_500);
		assert.ok(ignoredRecipeRow?.snapshot_hpp);
		assert.equal(
			await checkoutDb
				.prepare('SELECT COUNT(*) AS n FROM bahan_mutasi WHERE cabang_id = ? AND referensi_id = ?')
				.bind('samarinda', ignoredRecipe.data.transaction_id)
				.first<number>('n'),
			0
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok_saat_ini FROM bahan WHERE id = 'recipe-ingredient'")
				.first<number>('stok_saat_ini'),
			100
		);
		assert.equal(
			await checkoutDb
				.prepare('SELECT COUNT(*) AS n FROM produk_mutasi WHERE referensi_id = ?')
				.bind(ignoredSale.data.transaction_id)
				.first<number>('n'),
			0
		);

		const checkoutReconciliation = await createStockReconciliation(
			checkoutDb,
			branchContext('samarinda'),
			{ userId: 'owner-checkout', role: 'pemilik' },
			'2026-09-24T05:30:00.000Z'
		);
		await updateStockReconciliationCounts(
			checkoutDb,
			branchContext('samarinda'),
			checkoutReconciliation.id,
			{ userId: 'owner-checkout', role: 'pemilik' },
			checkoutReconciliation.items.map((item) => ({
				entityType: item.entity_type,
				entityId: item.entity_id,
				countedQuantity:
					item.entity_type === 'bahan'
						? 100
						: item.entity_id === 'checkout-product'
							? 1
							: item.entity_id === 'last-product' || item.entity_id === 'race-product'
								? 1
								: 0
			}))
		);
		await finalizeStockReconciliation(
			checkoutDb,
			branchContext('samarinda'),
			checkoutReconciliation.id,
			1,
			{ userId: 'owner-checkout', role: 'pemilik' },
			'2026-09-24T06:00:00.000Z'
		);
		const trackedRecipe = await checkoutProduct(
			'recipe-product',
			15_000,
			'tracked-recipe-1',
			checkoutDb,
			checkoutPlatform,
			[{ id: 'recipe-addon', nama: 'Jelly', harga: 2_000 }]
		);
		const trackedRecipeRow = await checkoutDb
			.prepare(
				`SELECT nominal_hpp, snapshot_hpp FROM transaksi_kasir
				 WHERE cabang_id = ? AND transaction_id = ?`
			)
			.bind('samarinda', trackedRecipe.data.transaction_id)
			.first<{ nominal_hpp: number; snapshot_hpp: string }>();
		assert.equal(trackedRecipeRow?.nominal_hpp, ignoredRecipeRow?.nominal_hpp);
		assert.equal(trackedRecipeRow?.snapshot_hpp, ignoredRecipeRow?.snapshot_hpp);
		assert.equal(
			await checkoutDb
				.prepare('SELECT COUNT(*) AS n FROM bahan_mutasi WHERE cabang_id = ? AND referensi_id = ?')
				.bind('samarinda', trackedRecipe.data.transaction_id)
				.first<number>('n'),
			2
		);

		const voidSession = {
			id: 'session-checkout',
			userId: 'owner-checkout',
			username: 'owner',
			role: 'pemilik',
			branch: 'samarinda',
			createdAt: 0,
			expiresAt: 1,
			unlockedPages: [],
			unlockExpiresAt: 0
		} as NonNullable<App.Locals['authSession']>;
		await voidTransaksiKasir(
			checkoutDb,
			'samarinda',
			voidSession,
			checkoutPlatform,
			trackedSale.data.transaction_id
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'checkout-product'")
				.first<number>('stok'),
			2
		);
		assert.equal(
			await checkoutDb
				.prepare(
					"SELECT COUNT(*) AS n FROM produk_mutasi WHERE referensi_id = ? AND sumber = 'void'"
				)
				.bind(trackedSale.data.transaction_id)
				.first<number>('n'),
			1
		);
		const duplicateVoid = await voidTransaksiKasir(
			checkoutDb,
			'samarinda',
			voidSession,
			checkoutPlatform,
			trackedSale.data.transaction_id
		);
		assert.equal(duplicateVoid.duplicate, true);

		await voidTransaksiKasir(
			checkoutDb,
			'samarinda',
			voidSession,
			checkoutPlatform,
			ignoredSale.data.transaction_id
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'ignored-product'")
				.first<number>('stok'),
			0,
			'ignored sale void must not increase product after policy re-enabled'
		);

		await checkoutDb.batch([
			checkoutDb.prepare(
				`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, is_active)
				 VALUES ('restored-product', 'samarinda', 'Produk Restore', 5000, 10, 1, 1)`
			),
			checkoutDb.prepare(
				`INSERT INTO produk_mutasi (
					id, cabang_id, produk_id, delta_jumlah, stok_setelah, sumber, referensi_id
				) VALUES ('restored-pos-ledger', 'samarinda', 'restored-product', -2, 8, 'pos', 'restored-tx')`
			),
			checkoutDb.prepare("UPDATE produk SET stok = 10 WHERE id = 'restored-product'"),
			checkoutDb.prepare(
				`INSERT INTO buku_kas (
					id, cabang_id, waktu, sumber, tipe, jenis, nominal, jumlah, transaction_id,
					restored_from_archive
				) VALUES ('restored-header', 'samarinda', '2026-09-24T00:00:00.000Z', 'pos',
					'in', 'pendapatan_usaha', 5000, 1, 'restored-tx', 1)`
			),
			checkoutDb.prepare(
				`INSERT INTO transaksi_kasir (
					id, cabang_id, buku_kas_id, produk_id, jumlah, nominal, harga, nama_produk,
					nominal_hpp, transaction_id, created_at
				) VALUES ('restored-item', 'samarinda', 'restored-header', 'restored-product', 1,
					5000, 5000, 'Produk Restore', 0, 'restored-tx', '2026-09-24T00:00:00.000Z')`
			),
			checkoutDb.prepare(
				`INSERT INTO bahan_mutasi (
					id, cabang_id, bahan_id, delta_jumlah, stok_setelah, sumber, referensi_id
				) VALUES ('restored-ingredient-ledger', 'samarinda', 'recipe-ingredient', -3, 97,
					'pos', 'restored-tx')`
			)
		]);
		await voidTransaksiKasir(checkoutDb, 'samarinda', voidSession, checkoutPlatform, 'restored-tx');
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'restored-product'")
				.first<number>('stok'),
			10
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok_saat_ini FROM bahan WHERE id = 'recipe-ingredient'")
				.first<number>('stok_saat_ini'),
			90,
			'restored void must not restore ingredient inventory'
		);

		const concurrent = await Promise.allSettled([
			checkoutProduct('last-product', 8_000, 'last-checkout-a'),
			checkoutProduct('last-product', 8_000, 'last-checkout-b')
		]);
		assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'last-product'")
				.first<number>('stok'),
			0
		);

		let racedBatch = false;
		const raceDb = {
			prepare: checkoutDb.prepare.bind(checkoutDb),
			async batch(statements: Parameters<D1Database['batch']>[0]) {
				if (!racedBatch) {
					racedBatch = true;
					await writeStockPolicy(checkoutDb, branchContext('samarinda'), {
						expectedRevision: 2,
						mode: 'ignored',
						actor,
						now: '2026-09-24T07:00:00.000Z'
					});
				}
				return checkoutDb.batch(statements);
			}
		} as D1Database;
		await assert.rejects(
			checkoutProduct('race-product', 9_000, 'policy-race-1', raceDb, checkoutPlatform),
			(error: unknown) => error instanceof CheckoutUseCaseError && error.status === 412
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT stok FROM produk WHERE id = 'race-product'")
				.first<number>('stok'),
			1
		);
		assert.equal(
			await checkoutDb
				.prepare("SELECT COUNT(*) AS n FROM buku_kas WHERE idempotency_key = 'policy-race-1'")
				.first<number>('n'),
			0
		);
	} finally {
		await checkoutHarness.close();
	}

	console.log('stock-policy-tests: policy, CAS, isolation, API validation, audit/realtime passed');
} finally {
	await close();
}
