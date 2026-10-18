import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '../branchResolver';
import type { StockPolicy } from '../stockPolicy';
import { verifyStockPolicyEpoch } from '../stockPolicyEpoch';
import { ensurePendingReview, getTransitionCount, loadOfflineReview } from '../stockOfflineReview';
import type { InventoryApplication, PosTransactionInput, StockReplayDisposition } from './types';
import { CheckoutUseCaseError } from './utils';

export interface StockReplayDecision {
	inventoryApplication: InventoryApplication;
	replayDisposition: StockReplayDisposition;
}

/** Revisi kebijakan stok saat transaksi diantrekan: dari token epoch bertanda tangan, atau angka lama. */
async function revisionAtQueue(
	platform: App.Platform | undefined,
	branch: BranchContext,
	body: PosTransactionInput
): Promise<number | null> {
	if (typeof body.stock_policy_epoch_token === 'string' && body.stock_policy_epoch_token) {
		try {
			const epoch = await verifyStockPolicyEpoch(
				platform?.env,
				body.stock_policy_epoch_token,
				branch
			);
			return epoch.revision;
		} catch {
			// Token epoch tak valid diperlakukan seperti tanpa revisi; keputusannya ada di pencocokan revisi.
			return null;
		}
	}
	const legacy = body.stock_policy_revision_at_queue;
	return typeof legacy === 'number' && Number.isInteger(legacy) ? legacy : null;
}

/**
 * Menentukan apakah stok dipotong untuk transaksi ini. Penjualan online mengikuti kebijakan
 * cabang saat ini. Replay offline yang melewati perubahan kebijakan stok tidak boleh
 * memotong stok diam-diam: kebijakan `ignored` melewatinya, selain itu ditahan (428)
 * sampai pemilik menyetujui di tinjauan.
 */
export async function resolveStockReplay(input: {
	db: D1Database;
	branch: BranchContext;
	platform: App.Platform | undefined;
	body: PosTransactionInput;
	mode: 'online' | 'offline_replay';
	stockPolicy: StockPolicy;
	idempotencyKey: string;
	requestFingerprint: string;
}): Promise<StockReplayDecision> {
	const { db, branch, body, stockPolicy } = input;
	const policyApplication: InventoryApplication =
		stockPolicy.mode === 'tracked' ? 'apply' : 'skip_policy_ignored';
	const unchanged: StockReplayDecision = {
		inventoryApplication: policyApplication,
		replayDisposition: 'normal'
	};
	if (input.mode !== 'offline_replay') return unchanged;

	const epochRevision = await revisionAtQueue(input.platform, branch, body);
	const transitions = await getTransitionCount(db, branch);
	const neverTransitioned = transitions === 0 && (epochRevision === null || epochRevision === 0);
	const tokenMatchesCurrent =
		epochRevision !== null &&
		epochRevision === stockPolicy.revision &&
		(transitions > 0 || stockPolicy.revision === 0);
	if (neverTransitioned || tokenMatchesCurrent) return unchanged;

	if (stockPolicy.mode === 'ignored') {
		return { inventoryApplication: 'skip_policy_ignored', replayDisposition: 'stale_to_ignored' };
	}

	const review = await loadOfflineReview(db, branch, input.idempotencyKey);
	const approvedForCurrentPolicy =
		review?.request_fingerprint === input.requestFingerprint &&
		review.approved_policy_revision === stockPolicy.revision;
	if (approvedForCurrentPolicy && review.status === 'approved_current') {
		return { inventoryApplication: 'apply', replayDisposition: 'owner_approved_current' };
	}
	if (approvedForCurrentPolicy && review.status === 'approved_after_recount') {
		return {
			inventoryApplication: 'skip_reconciled_replay',
			replayDisposition: 'owner_approved_after_recount'
		};
	}

	const queuedAt = Number(body.queued_at);
	await ensurePendingReview(db, branch, {
		idempotencyKey: input.idempotencyKey,
		requestFingerprint: input.requestFingerprint,
		queuedAt: Number.isFinite(queuedAt) ? queuedAt : Date.now(),
		policyRevisionAtQueue: epochRevision,
		currentPolicyRevision: stockPolicy.revision
	});
	throw new CheckoutUseCaseError(
		428,
		'Transaksi offline melewati perubahan kebijakan stok dan perlu ditinjau pemilik'
	);
}
