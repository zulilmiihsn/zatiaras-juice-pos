import assert from 'node:assert/strict';
import { branchContext } from '../lib/server/branchResolver';
import { signStockPolicyEpoch, verifyStockPolicyEpoch } from '../lib/server/stockPolicyEpoch';
import { writeStockPolicy } from '../lib/server/stockPolicy';
import { signPosPricingToken } from '../lib/server/posPricingToken';
import {
	createStockReconciliation,
	finalizeStockReconciliation,
	updateStockReconciliationCounts
} from '../lib/server/stockReconciliation';
import { CheckoutUseCaseError, executeCheckout } from '../lib/server/checkout/checkoutUseCase';
import {
	approveCurrentReview,
	ensurePendingReview,
	loadOfflineReview,
	withdrawReview
} from '../lib/server/stockOfflineReview';
import { classifySyncFailure } from '../lib/utils/offlineQueue';
import { GET as CATALOG_GET } from '../routes/api/pos/catalog/+server';
import { GET as REVIEWS_GET } from '../routes/api/pengaturan/stok/offline-reviews/+server';
import { PUT as REVIEW_PUT } from '../routes/api/pengaturan/stok/offline-reviews/[idempotency_key]/+server';
import { createTestD1 } from './helpers/testD1';

const { db, close } = await createTestD1();
const samarinda = branchContext('samarinda');
const owner = { userId: 'owner-1', role: 'pemilik' };
const signingEnv = {
	POS_PRICE_SIGNING_KEY: '0123456789abcdef0123456789abcdef'
} as App.Platform['env'];

function session(role: string, branch = 'samarinda') {
	return {
		id: `session-${role}`,
		userId: `${role}-1`,
		username: role,
		role,
		branch,
		createdAt: 0,
		expiresAt: Date.now() + 60_000,
		unlockedPages: [],
		unlockExpiresAt: 0
	};
}

try {
	// Epoch roundtrip + branch mismatch + tamper.
	const token = await signStockPolicyEpoch(signingEnv, {
		branch: 'samarinda',
		mode: 'ignored',
		revision: 3,
		now: 1_700_000_000_000
	});
	const verified = await verifyStockPolicyEpoch(signingEnv, token, 'samarinda');
	assert.equal(verified.mode, 'ignored');
	assert.equal(verified.revision, 3);
	await assert.rejects(verifyStockPolicyEpoch(signingEnv, token, 'samarinda2'));
	await assert.rejects(verifyStockPolicyEpoch(signingEnv, `${token}x`, 'samarinda'));

	// Pending quarantine: create, idempotent same fingerprint, conflict on different.
	const pending = await ensurePendingReview(db, samarinda, {
		idempotencyKey: 'offline-key-1',
		requestFingerprint: 'fp-1',
		queuedAt: 1_700_000_000_001,
		policyRevisionAtQueue: 0,
		currentPolicyRevision: 1
	});
	assert.equal(pending.status, 'pending');
	assert.equal(pending.revision, 0);
	const same = await ensurePendingReview(db, samarinda, {
		idempotencyKey: 'offline-key-1',
		requestFingerprint: 'fp-1',
		queuedAt: 1_700_000_000_001,
		policyRevisionAtQueue: 0,
		currentPolicyRevision: 1
	});
	assert.equal(same.revision, 0);
	await assert.rejects(
		ensurePendingReview(db, samarinda, {
			idempotencyKey: 'offline-key-1',
			requestFingerprint: 'fp-other',
			queuedAt: 1_700_000_000_001,
			policyRevisionAtQueue: 0,
			currentPolicyRevision: 1
		}),
		(error: Error) => error.message.includes('berbeda')
	);

	// Approval CAS: success, stale conflict, withdraw back to pending.
	const approved = await approveCurrentReview(
		db,
		samarinda,
		owner,
		'offline-key-1',
		0,
		'2026-09-24T05:00:00.000Z'
	);
	assert.equal(approved.status, 'approved_current');
	assert.equal(approved.resolution, 'apply_current');
	assert.equal(approved.revision, 1);
	await assert.rejects(
		approveCurrentReview(db, samarinda, owner, 'offline-key-1', 0, '2026-09-24T05:01:00.000Z')
	);
	const withdrawn = await withdrawReview(db, samarinda, owner, 'offline-key-1', 1);
	assert.equal(withdrawn.status, 'pending');
	assert.equal(withdrawn.resolution, null);
	assert.equal(withdrawn.revision, 2);

	// Invalid direct transition pending -> consumed blocked by trigger.
	await assert.rejects(
		db
			.prepare(
				`UPDATE offline_stock_reviews SET status = 'consumed', revision = revision + 1, consumed_at = ? WHERE cabang_id = ? AND idempotency_key = ?`
			)
			.bind('2026-09-24T05:02:00.000Z', 'samarinda', 'offline-key-1')
			.run()
	);

	// Review guard on buku_kas: without approval aborts; with approval commits and consumes.
	await db
		.prepare(
			`INSERT INTO offline_stock_reviews (
				cabang_id, idempotency_key, request_fingerprint, queued_at,
				policy_revision_at_queue, current_policy_revision, revision, status
			 ) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')`
		)
		.bind('samarinda', 'offline-key-2', 'fp-2', 1_700_000_000_010, 0, 0)
		.run();
	await assert.rejects(
		db
			.prepare(
				`INSERT INTO buku_kas (
					id, cabang_id, waktu, sumber, tipe, jenis, nominal,
					idempotency_key, request_fingerprint,
					stock_policy_mode, stock_policy_revision, stock_replay_disposition,
					restored_from_archive, created_at, updated_at
				 ) VALUES (?, ?, ?, 'pos', 'in', 'pendapatan_usaha', 1000, ?, ?, 'tracked', 0, 'owner_approved_current', 0, ?, ?)`
			)
			.bind(
				'bk-review-guard-1',
				'samarinda',
				'2026-09-24T05:03:00.000Z',
				'offline-key-2',
				'fp-2',
				'2026-09-24T05:03:00.000Z',
				'2026-09-24T05:03:00.000Z'
			)
			.run(),
		(error: Error) => String(error.message).includes('STOCK_REVIEW_NOT_APPROVED')
	);
	await approveCurrentReview(db, samarinda, owner, 'offline-key-2', 0, '2026-09-24T05:04:00.000Z');
	await db
		.prepare(
			`INSERT INTO buku_kas (
				id, cabang_id, waktu, sumber, tipe, jenis, nominal,
				idempotency_key, request_fingerprint,
				stock_policy_mode, stock_policy_revision, stock_replay_disposition,
				restored_from_archive, created_at, updated_at
			 ) VALUES (?, ?, ?, 'pos', 'in', 'pendapatan_usaha', 1000, ?, ?, 'tracked', 0, 'owner_approved_current', 0, ?, ?)`
		)
		.bind(
			'bk-review-guard-2',
			'samarinda',
			'2026-09-24T05:05:00.000Z',
			'offline-key-2',
			'fp-2',
			'2026-09-24T05:05:00.000Z',
			'2026-09-24T05:05:00.000Z'
		)
		.run();
	const consumed = await loadOfflineReview(db, samarinda, 'offline-key-2');
	assert.equal(consumed?.status, 'consumed');

	// Failure classification keeps quarantine queue instead of silent drop.
	assert.equal(classifySyncFailure(428), 'conflict');
	assert.equal(classifySyncFailure(412), 'conflict');

	// Catalog exposes signed policy for offline queue metadata.
	const catalogResponse = (await CATALOG_GET({
		platform: {
			env: {
				DB_SAMARINDA_GROUP: db,
				POS_PRICE_SIGNING_KEY: '0123456789abcdef0123456789abcdef'
			}
		},
		locals: { authSession: session('kasir') }
	} as unknown as Parameters<typeof CATALOG_GET>[0])) as Response;
	assert.equal(catalogResponse.status, 200);
	const catalog = (await catalogResponse.json()) as {
		stock_policy?: { mode: string; revision: number; epoch_token: string };
	};
	assert.equal(catalog.stock_policy?.mode, 'tracked');
	assert.equal(catalog.stock_policy?.revision, 0);
	const catalogEpoch = await verifyStockPolicyEpoch(
		signingEnv,
		catalog.stock_policy?.epoch_token,
		'samarinda'
	);
	assert.equal(catalogEpoch.revision, 0);

	// Review API: owner list, kasir denied, approve via route, withdraw via route.
	const listResponse = (await REVIEWS_GET({
		url: new URL('https://test.invalid/api/pengaturan/stok/offline-reviews'),
		platform: { env: { DB_SAMARINDA_GROUP: db, STOCK_POLICY_ROLLOUT_BRANCHES: 'samarinda' } },
		locals: { authSession: session('pemilik') }
	} as unknown as Parameters<typeof REVIEWS_GET>[0])) as Response;
	assert.equal(listResponse.status, 200);
	await assert.rejects(
		(async () =>
			REVIEWS_GET({
				url: new URL('https://test.invalid/api/pengaturan/stok/offline-reviews'),
				platform: { env: { DB_SAMARINDA_GROUP: db, STOCK_POLICY_ROLLOUT_BRANCHES: 'samarinda' } },
				locals: { authSession: session('kasir') }
			} as unknown as Parameters<typeof REVIEWS_GET>[0]))()
	);
	const approveResponse = (await REVIEW_PUT({
		request: new Request('https://test.invalid/x', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ branch: 'samarinda', expected_revision: 2, action: 'approve_current' })
		}),
		params: { idempotency_key: 'offline-key-1' },
		platform: { env: { DB_SAMARINDA_GROUP: db, STOCK_POLICY_ROLLOUT_BRANCHES: 'samarinda' } },
		locals: { authSession: session('pemilik') }
	} as unknown as Parameters<typeof REVIEW_PUT>[0])) as Response;
	assert.equal(approveResponse.status, 200);
	const withdrawResponse = (await REVIEW_PUT({
		request: new Request('https://test.invalid/x', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ branch: 'samarinda', expected_revision: 3, action: 'withdraw' })
		}),
		params: { idempotency_key: 'offline-key-1' },
		platform: { env: { DB_SAMARINDA_GROUP: db, STOCK_POLICY_ROLLOUT_BRANCHES: 'samarinda' } },
		locals: { authSession: session('pemilik') }
	} as unknown as Parameters<typeof REVIEW_PUT>[0])) as Response;
	assert.equal(withdrawResponse.status, 200);

	// End-to-end offline replay: stale epoch quarantined (428), owner approval replays once.
	const replayHarness = await createTestD1(false);
	try {
		const replayDb = replayHarness.db;
		const replayBranch = branchContext('samarinda');
		const replayEnv = {
			POS_PRICE_SIGNING_KEY: '0123456789abcdef0123456789abcdef'
		} as App.Platform['env'];
		const replayPlatform = { env: replayEnv } as App.Platform;
		const replaySession = { userId: 'owner-1', username: 'owner', role: 'pemilik' };
		await replayDb
			.prepare(
				`INSERT INTO produk (id, cabang_id, nama, harga, stok, lacak_stok, lacak_bahan, is_active)
				 VALUES ('p-offline', 'samarinda', 'Produk Offline', 10000, 5, 1, 0, 1)`
			)
			.run();
		await writeStockPolicy(replayDb, replayBranch, {
			expectedRevision: 0,
			mode: 'ignored',
			actor: owner,
			now: '2026-09-24T06:00:00.000Z'
		});
		const job = await createStockReconciliation(
			replayDb,
			replayBranch,
			owner,
			'2026-09-24T06:01:00.000Z'
		);
		await updateStockReconciliationCounts(
			replayDb,
			replayBranch,
			job.id,
			owner,
			job.items.map((item) => ({
				entityType: item.entity_type,
				entityId: item.entity_id,
				countedQuantity: 5
			}))
		);
		await finalizeStockReconciliation(
			replayDb,
			replayBranch,
			job.id,
			1,
			owner,
			'2026-09-24T06:02:00.000Z'
		);
		const queuedAt = Date.now();
		const priceToken = await signPosPricingToken(replayEnv, {
			kind: 'catalog_product',
			branch: 'samarinda',
			data: { id: 'p-offline', nama: 'Produk Offline', harga: 10000 },
			ttlMs: 24 * 60 * 60 * 1000,
			now: queuedAt
		});
		const staleEpoch = await signStockPolicyEpoch(replayEnv, {
			branch: 'samarinda',
			mode: 'tracked',
			revision: 0,
			now: queuedAt - 60_000
		});
		const replayBody = {
			idempotency_key: 'offline-replay-e2e-1',
			mode: 'offline_replay' as const,
			queued_at: queuedAt,
			metode_bayar: 'tunai',
			cash_received: 10000,
			items: [{ product_id: 'p-offline', jumlah: 1, product_price_token: priceToken }],
			stock_policy_epoch_token: staleEpoch,
			stock_policy_revision_at_queue: 0
		};
		await assert.rejects(
			executeCheckout({
				db: replayDb,
				branch: replayBranch,
				session: replaySession,
				platform: replayPlatform,
				rawBody: replayBody
			}),
			(error: unknown) => error instanceof CheckoutUseCaseError && error.status === 428
		);
		const quarantine = await loadOfflineReview(replayDb, replayBranch, 'offline-replay-e2e-1');
		assert.equal(quarantine?.status, 'pending');
		await approveCurrentReview(
			replayDb,
			replayBranch,
			owner,
			'offline-replay-e2e-1',
			0,
			'2026-09-24T06:03:00.000Z'
		);
		const replayed = await executeCheckout({
			db: replayDb,
			branch: replayBranch,
			session: replaySession,
			platform: replayPlatform,
			rawBody: replayBody
		});
		assert.equal(replayed.idempotent, false);
		assert.equal(
			await replayDb
				.prepare("SELECT stok FROM produk WHERE id = 'p-offline'")
				.first<number>('stok'),
			4
		);
		const replayedAgain = await executeCheckout({
			db: replayDb,
			branch: replayBranch,
			session: replaySession,
			platform: replayPlatform,
			rawBody: replayBody
		});
		assert.equal(replayedAgain.idempotent, true);
		assert.equal(
			await replayDb
				.prepare("SELECT stok FROM produk WHERE id = 'p-offline'")
				.first<number>('stok'),
			4
		);
	} finally {
		await replayHarness.close();
	}

	console.log(
		'stock-offline-review-tests: epoch, quarantine, approval, triggers, catalog, routes passed'
	);
} finally {
	await close();
}
