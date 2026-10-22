import { json, error as kitError } from '@sveltejs/kit';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	resolveOrderQueueDb,
	transitionOrderPreparation,
	OrderQueueError
} from '$lib/server/orderQueue/useCase';
import type { RequestHandler } from './$types';

/**
 * POST /api/antrean/status — Proses / Selesai / Buka kembali satu pesanan.
 * Body: { idempotency_key, target: pending|processing|done, expected_revision }.
 * Cabang selalu dari session; isi branch di body diabaikan.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const branch = requireSessionBranch(locals);
	const body = (await parseBody(request)) as {
		idempotency_key?: unknown;
		target?: unknown;
		expected_revision?: unknown;
	} | null;
	if (!body || typeof body !== 'object') throw kitError(400, 'Body status antrean tidak valid');
	const db = resolveOrderQueueDb(platform, branch);
	try {
		const data = await transitionOrderPreparation(
			db,
			branch,
			{ userId: session.userId, role: session.role },
			body,
			platform
		);
		return json({ ok: true, data });
	} catch (error) {
		if (error instanceof OrderQueueError) throw kitError(error.status, error.message);
		throw error;
	}
};
