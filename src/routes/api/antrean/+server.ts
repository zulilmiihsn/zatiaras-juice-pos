import { json, error as kitError } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import {
	listOrderQueue,
	OrderQueueError,
	resolveOrderQueueDb
} from '$lib/server/orderQueue/useCase';
import type { RequestHandler } from './$types';

/**
 * GET /api/antrean — daftar pesanan POS per cabang untuk layar Antrean.
 * Query: state=pending|done (default pending), limit 1-100 (default 50), cursor opak.
 * Route tipis: auth + parse + delegasi ke orderQueue use case.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const db = resolveOrderQueueDb(platform, branch);
	try {
		const data = await listOrderQueue(db, branch, {
			state: url.searchParams.get('state'),
			limit: url.searchParams.get('limit'),
			cursor: url.searchParams.get('cursor')
		});
		return json({ ok: true, data });
	} catch (error) {
		if (error instanceof OrderQueueError) throw kitError(error.status, error.message);
		throw error;
	}
};
