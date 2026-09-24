import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { auditDataChange, getRawDb, publish } from '$lib/server/dataApiHelpers';
import type { StockPolicyActor } from '$lib/server/stockPolicy';

export type OfflineReviewStatus =
	| 'pending'
	| 'attached_to_reconciliation'
	| 'approved_current'
	| 'approved_after_recount'
	| 'consumed';

export type OfflineReviewRow = {
	cabang_id: string;
	idempotency_key: string;
	request_fingerprint: string;
	queued_at: number;
	policy_revision_at_queue: number | null;
	current_policy_revision: number;
	revision: number;
	status: OfflineReviewStatus;
	resolution: 'apply_current' | 'after_recount' | null;
	reconciliation_job_id: string | null;
	approved_policy_revision: number | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	consumed_at: string | null;
};

export class OfflineReviewError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 403 | 404 | 409
	) {
		super(message);
	}
}

export async function getTransitionCount(db: D1Database, branch: BranchContext): Promise<number> {
	const row = (await db
		.prepare('SELECT COUNT(*) AS n FROM stock_policy_transitions WHERE cabang_id = ?')
		.bind(branch)
		.first()) as { n?: number } | null;
	return Number(row?.n ?? 0);
}

export async function loadOfflineReview(
	db: D1Database,
	branch: BranchContext,
	idempotencyKey: string
): Promise<OfflineReviewRow | null> {
	return db
		.prepare(
			`SELECT cabang_id, idempotency_key, request_fingerprint, queued_at,
				policy_revision_at_queue, current_policy_revision, revision, status,
				resolution, reconciliation_job_id, approved_policy_revision,
				reviewed_by, reviewed_at, consumed_at
			 FROM offline_stock_reviews WHERE cabang_id = ? AND idempotency_key = ? LIMIT 1`
		)
		.bind(branch, idempotencyKey)
		.first<OfflineReviewRow>();
}

export async function ensurePendingReview(
	db: D1Database,
	branch: BranchContext,
	input: {
		idempotencyKey: string;
		requestFingerprint: string;
		queuedAt: number;
		policyRevisionAtQueue: number | null;
		currentPolicyRevision: number;
	}
): Promise<OfflineReviewRow> {
	const existing = await loadOfflineReview(db, branch, input.idempotencyKey);
	if (existing) {
		if (existing.request_fingerprint !== input.requestFingerprint) {
			throw new OfflineReviewError('Idempotency key antrean dipakai transaksi berbeda', 409);
		}
		return existing;
	}
	await db
		.prepare(
			`INSERT INTO offline_stock_reviews (
				cabang_id, idempotency_key, request_fingerprint, queued_at,
				policy_revision_at_queue, current_policy_revision, revision, status
			 ) VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')
			 ON CONFLICT(cabang_id, idempotency_key) DO NOTHING`
		)
		.bind(
			branch,
			input.idempotencyKey,
			input.requestFingerprint,
			input.queuedAt,
			input.policyRevisionAtQueue,
			input.currentPolicyRevision
		)
		.run();
	const row = await loadOfflineReview(db, branch, input.idempotencyKey);
	if (!row) throw new OfflineReviewError('Gagal mencatat antrean untuk review pemilik', 409);
	return row;
}

export async function approveCurrentReview(
	db: D1Database,
	branch: BranchContext,
	actor: StockPolicyActor,
	idempotencyKey: string,
	expectedRevision: number,
	now: string
): Promise<OfflineReviewRow> {
	if (actor.role !== 'pemilik')
		throw new OfflineReviewError('Hanya pemilik yang dapat menyetujui replay', 403);
	const result = await db
		.prepare(
			`UPDATE offline_stock_reviews
			 SET status = 'approved_current', resolution = 'apply_current',
				 approved_policy_revision = current_policy_revision,
				 reviewed_by = ?, reviewed_at = ?, revision = revision + 1
			 WHERE cabang_id = ? AND idempotency_key = ? AND revision = ? AND status = 'pending'`
		)
		.bind(actor.userId, now, branch, idempotencyKey, expectedRevision)
		.run();
	if (Number(result.meta.changes ?? 0) === 0) {
		throw new OfflineReviewError('Review berubah atau tidak dalam status pending', 409);
	}
	const row = await loadOfflineReview(db, branch, idempotencyKey);
	if (!row) throw new OfflineReviewError('Review tidak ditemukan', 404);
	return row;
}

export async function withdrawReview(
	db: D1Database,
	branch: BranchContext,
	actor: StockPolicyActor,
	idempotencyKey: string,
	expectedRevision: number
): Promise<OfflineReviewRow> {
	if (actor.role !== 'pemilik')
		throw new OfflineReviewError('Hanya pemilik yang dapat membatalkan persetujuan', 403);
	const result = await db
		.prepare(
			`UPDATE offline_stock_reviews
			 SET status = 'pending', resolution = NULL, reconciliation_job_id = NULL,
				 approved_policy_revision = NULL, reviewed_by = NULL, reviewed_at = NULL,
				 consumed_at = NULL, revision = revision + 1
			 WHERE cabang_id = ? AND idempotency_key = ? AND revision = ? AND status = 'approved_current'`
		)
		.bind(branch, idempotencyKey, expectedRevision)
		.run();
	if (Number(result.meta.changes ?? 0) === 0) {
		throw new OfflineReviewError('Review tidak dapat di-withdraw pada status ini', 409);
	}
	const row = await loadOfflineReview(db, branch, idempotencyKey);
	if (!row) throw new OfflineReviewError('Review tidak ditemukan', 404);
	return row;
}

export function loadBranchOfflineReviews(
	platform: App.Platform | undefined,
	branch: BranchContext
): Promise<OfflineReviewRow[]> {
	const db = getRawDb(platform, branch);
	return db
		.prepare(
			`SELECT cabang_id, idempotency_key, request_fingerprint, queued_at,
				policy_revision_at_queue, current_policy_revision, revision, status,
				resolution, reconciliation_job_id, approved_policy_revision,
				reviewed_by, reviewed_at, consumed_at
			 FROM offline_stock_reviews WHERE cabang_id = ? ORDER BY queued_at`
		)
		.bind(branch)
		.all<OfflineReviewRow>()
		.then((r) => (Array.isArray(r.results) ? r.results : []));
}

export async function resolveBranchOfflineReview(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: NonNullable<App.Locals['authSession']>,
	input: {
		idempotencyKey: string;
		expectedRevision: number;
		action: 'approve_current' | 'withdraw';
		now: string;
	}
): Promise<OfflineReviewRow> {
	const db = getRawDb(platform, branch);
	const actor = { userId: session.userId, role: session.role };
	const row =
		input.action === 'approve_current'
			? await approveCurrentReview(
					db,
					branch,
					actor,
					input.idempotencyKey,
					input.expectedRevision,
					input.now
				)
			: await withdrawReview(db, branch, actor, input.idempotencyKey, input.expectedRevision);
	await Promise.all([
		publish(platform, branch, 'offline_stock_reviews', 'update', {
			key: input.idempotencyKey
		}).catch(() => undefined),
		auditDataChange(
			db,
			branch,
			session,
			'offline_stock_reviews',
			input.action,
			input.idempotencyKey,
			{
				status: row.status
			}
		).catch(() => undefined)
	]);
	return row;
}
