import assert from 'node:assert/strict';
import test from 'node:test';
import { branchContext, type BranchContext } from '../lib/server/branchResolver';
import { loadStockPolicy, writeStockPolicy } from '../lib/server/stockPolicy';
import {
	createStockReconciliation,
	updateStockReconciliationCounts,
	finalizeStockReconciliation
} from '../lib/server/stockReconciliation';
import {
	approveCurrentReview,
	ensurePendingReview,
	loadOfflineReview,
	withdrawReview,
	OfflineReviewError
} from '../lib/server/stockOfflineReview';
import { signStockPolicyEpoch } from '../lib/server/stockPolicyEpoch';
import { resolveStockReplay } from '../lib/server/checkout/stockReplayPolicy';
import { CheckoutUseCaseError } from '../lib/server/checkout/utils';
import type { PosTransactionInput } from '../lib/server/checkout/types';
import { createTestD1 } from './helpers/testD1';

const NOW = Date.parse('2026-10-19T00:00:00.000Z');
const stamp = new Date(NOW).toISOString();
const owner = { userId: 'replay-contract-owner', role: 'pemilik' };
const env = {
	POS_PRICE_SIGNING_KEY: 'replay-contract-fixture-not-production-0001'
} as App.Platform['env'];
const platform = { env } as App.Platform;
const unchangedBranch = branchContext('samarinda');
const transitionedBranch = branchContext('samarinda2');
const foreignBranch = branchContext('berau');
const { db, close } = await createTestD1();
console.log(
	`stock-replay-contract backend: ${process.argv.includes('--d1') ? 'workerd D1' : 'SQLite'}`
);
if (process.argv.includes('--d1')) assert.equal(typeof db.withSession, 'function');

async function decision(
	branch: BranchContext,
	key: string,
	body: PosTransactionInput,
	fingerprint = `fp:${key}`,
	mode: 'online' | 'offline_replay' = 'offline_replay'
) {
	return resolveStockReplay({
		db,
		branch,
		platform,
		body: { queued_at: NOW - 1000, ...body },
		mode,
		stockPolicy: await loadStockPolicy(db, branch),
		idempotencyKey: key,
		requestFingerprint: fingerprint
	});
}

async function activateTracking(branch: BranchContext) {
	const policy = await loadStockPolicy(db, branch);
	const ignored = await writeStockPolicy(db, branch, {
		expectedRevision: policy.revision,
		mode: 'ignored',
		actor: owner,
		now: stamp
	});
	const job = await createStockReconciliation(db, branch, owner, stamp);
	await updateStockReconciliationCounts(
		db,
		branch,
		job.id,
		owner,
		job.items.map((item) => ({
			entityType: item.entity_type,
			entityId: item.entity_id,
			countedQuantity: 3
		}))
	);
	await finalizeStockReconciliation(db, branch, job.id, ignored.policy.revision, owner, stamp);
	return { job, policy: await loadStockPolicy(db, branch) };
}

const quarantined = (error: unknown) =>
	error instanceof CheckoutUseCaseError && error.status === 428;
try {
	await db
		.prepare(
			`INSERT INTO produk (id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES ('replay-product','samarinda2','Jus Jambu',15000,3,1,0,1)`
		)
		.run();
	const tracking = await activateTracking(transitionedBranch);
	assert.equal(tracking.policy.revision, 2);
	await writeStockPolicy(db, foreignBranch, {
		expectedRevision: 0,
		mode: 'ignored',
		actor: owner,
		now: stamp
	});

	await test('unchanged branches retain legacy replay compatibility and online policy stays authoritative', async () => {
		for (const body of [
			{},
			{ stock_policy_revision_at_queue: 0 },
			{ stock_policy_epoch_token: 'invalid-token' }
		]) {
			assert.deepEqual(await decision(unchangedBranch, 'unchanged', body), {
				inventoryApplication: 'apply',
				replayDisposition: 'normal'
			});
		}
		assert.deepEqual(
			await decision(
				transitionedBranch,
				'online',
				{ stock_policy_epoch_token: 'invalid-token' },
				'fp:online',
				'online'
			),
			{ inventoryApplication: 'apply', replayDisposition: 'normal' }
		);
		assert.deepEqual(await decision(foreignBranch, 'ignored', {}), {
			inventoryApplication: 'skip_policy_ignored',
			replayDisposition: 'stale_to_ignored'
		});
	});

	await test('a verified current epoch authorizes normal replay and takes precedence over legacy numbers', async () => {
		const token = await signStockPolicyEpoch(env, {
			branch: transitionedBranch,
			mode: 'tracked',
			revision: 2,
			now: NOW
		});
		assert.deepEqual(
			await decision(transitionedBranch, 'signed-current', {
				stock_policy_epoch_token: token,
				stock_policy_revision_at_queue: 0
			}),
			{ inventoryApplication: 'apply', replayDisposition: 'normal' }
		);
		assert.equal(await loadOfflineReview(db, transitionedBranch, 'signed-current'), null);
	});

	await test('an unsigned client-supplied current revision cannot bypass owner review after policy transitions', async () => {
		await assert.rejects(
			decision(transitionedBranch, 'unsigned-current', { stock_policy_revision_at_queue: 2 }),
			quarantined
		);
		const row = await loadOfflineReview(db, transitionedBranch, 'unsigned-current');
		assert.equal(row?.status, 'pending');
		assert.equal(row?.policy_revision_at_queue, 2);
		assert.equal(row?.current_policy_revision, 2);
	});

	await test('missing, forged, foreign-branch, and stale epochs quarantine without changing stock', async () => {
		const foreign = await signStockPolicyEpoch(env, {
			branch: foreignBranch,
			mode: 'tracked',
			revision: 2,
			now: NOW
		});
		const stale = await signStockPolicyEpoch(env, {
			branch: transitionedBranch,
			mode: 'tracked',
			revision: 0,
			now: NOW - 1000
		});
		const cases: Array<[string, PosTransactionInput]> = [
			['missing', {}],
			[
				'forged',
				{ stock_policy_epoch_token: 'forged.signature', stock_policy_revision_at_queue: 2 }
			],
			['foreign', { stock_policy_epoch_token: foreign }],
			['stale', { stock_policy_epoch_token: stale }],
			['fractional-legacy', { stock_policy_revision_at_queue: 1.5 }],
			['negative-legacy', { stock_policy_revision_at_queue: -1 }],
			['unsafe-legacy', { stock_policy_revision_at_queue: Number.MAX_SAFE_INTEGER + 1 }]
		];
		for (const [key, body] of cases) {
			await assert.rejects(decision(transitionedBranch, key, body), quarantined);
			const row = await loadOfflineReview(db, transitionedBranch, key);
			assert.equal(row?.status, 'pending');
			assert.equal(row?.queued_at, NOW - 1000);
		}
		assert.equal(
			await db
				.prepare(`SELECT stok FROM produk WHERE cabang_id = ? AND id = ?`)
				.bind(transitionedBranch, 'replay-product')
				.first<number>('stok'),
			3
		);
	});

	await test('owner approval is scoped to the exact branch, fingerprint, and current policy', async () => {
		await ensurePendingReview(db, transitionedBranch, {
			idempotencyKey: 'owner-current',
			requestFingerprint: 'fp:owner-current',
			queuedAt: NOW - 1000,
			policyRevisionAtQueue: 0,
			currentPolicyRevision: 2
		});
		await approveCurrentReview(db, transitionedBranch, owner, 'owner-current', 0, stamp);
		assert.deepEqual(await decision(transitionedBranch, 'owner-current', {}), {
			inventoryApplication: 'apply',
			replayDisposition: 'owner_approved_current'
		});
		await assert.rejects(
			decision(transitionedBranch, 'owner-current', {}, 'other-intent'),
			(error: unknown) => error instanceof OfflineReviewError && error.status === 409
		);
		await ensurePendingReview(db, foreignBranch, {
			idempotencyKey: 'foreign-owner',
			requestFingerprint: 'fp:foreign-owner',
			queuedAt: NOW - 1000,
			policyRevisionAtQueue: 0,
			currentPolicyRevision: 1
		});
		await approveCurrentReview(db, foreignBranch, owner, 'foreign-owner', 0, stamp);
		await assert.rejects(decision(transitionedBranch, 'foreign-owner', {}), quarantined);
		assert.equal(
			(await loadOfflineReview(db, foreignBranch, 'foreign-owner'))?.status,
			'approved_current'
		);
		assert.equal(
			(await loadOfflineReview(db, transitionedBranch, 'foreign-owner'))?.status,
			'pending'
		);
	});

	await test('recount-approved replay does not deduct stock that was already physically counted', async () => {
		await ensurePendingReview(db, transitionedBranch, {
			idempotencyKey: 'after-recount',
			requestFingerprint: 'fp:after-recount',
			queuedAt: NOW - 1000,
			policyRevisionAtQueue: 0,
			currentPolicyRevision: 2
		});
		await db
			.prepare(
				`UPDATE offline_stock_reviews SET status='attached_to_reconciliation', revision=revision+1 WHERE cabang_id=? AND idempotency_key=?`
			)
			.bind(transitionedBranch, 'after-recount')
			.run();
		await db
			.prepare(
				`UPDATE offline_stock_reviews SET status='approved_after_recount', resolution='after_recount', reconciliation_job_id=?, approved_policy_revision=2, reviewed_by=?, reviewed_at=?, revision=revision+1 WHERE cabang_id=? AND idempotency_key=?`
			)
			.bind(tracking.job.id, owner.userId, stamp, transitionedBranch, 'after-recount')
			.run();
		assert.deepEqual(await decision(transitionedBranch, 'after-recount', {}), {
			inventoryApplication: 'skip_reconciled_replay',
			replayDisposition: 'owner_approved_after_recount'
		});
		assert.equal(
			(await loadOfflineReview(db, transitionedBranch, 'after-recount'))?.status,
			'approved_after_recount'
		);
	});

	await test('withdrawing approval after another policy cycle refreshes the review before renewed consent', async () => {
		const next = await activateTracking(transitionedBranch);
		assert.equal(next.policy.revision, 4);
		await assert.rejects(decision(transitionedBranch, 'owner-current', {}), quarantined);
		const pending = await withdrawReview(db, transitionedBranch, owner, 'owner-current', 1);
		assert.equal(pending.current_policy_revision, 4);
		assert.equal(pending.status, 'pending');
		await approveCurrentReview(
			db,
			transitionedBranch,
			owner,
			'owner-current',
			pending.revision,
			stamp
		);
		assert.deepEqual(await decision(transitionedBranch, 'owner-current', {}), {
			inventoryApplication: 'apply',
			replayDisposition: 'owner_approved_current'
		});
	});
	await test('a newly fetched epoch cannot authorize an older queued sale', async () => {
		const policy = await loadStockPolicy(db, transitionedBranch);
		const token = await signStockPolicyEpoch(env, {
			branch: transitionedBranch,
			mode: policy.mode,
			revision: policy.revision,
			now: NOW
		});
		await assert.rejects(
			decision(transitionedBranch, 'future-epoch', {
				queued_at: NOW - 86400000,
				stock_policy_epoch_token: token
			}),
			quarantined
		);
	});
	await test('owner consent cannot be reused after changing the queued transaction time', async () => {
		await assert.rejects(
			decision(transitionedBranch, 'owner-current', { queued_at: NOW - 5000 }),
			(error: unknown) => error instanceof OfflineReviewError && error.status === 409
		);
	});
	await test('racing review claims cannot acknowledge another intent under the same key', async () => {
		const base = {
			idempotencyKey: 'racing-review',
			queuedAt: NOW - 1000,
			policyRevisionAtQueue: 0,
			currentPolicyRevision: 4
		};
		const results = await Promise.allSettled([
			ensurePendingReview(db, transitionedBranch, { ...base, requestFingerprint: 'racing-a' }),
			ensurePendingReview(db, transitionedBranch, {
				...base,
				requestFingerprint: 'racing-b',
				queuedAt: NOW - 2000
			})
		]);
		assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
		const rejected = results.find((r) => r.status === 'rejected');
		assert.ok(rejected?.status === 'rejected');
		assert.ok(rejected.reason instanceof OfflineReviewError && rejected.reason.status === 409);
	});
} finally {
	await close();
}
