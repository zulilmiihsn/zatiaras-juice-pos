import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	mapReconciliationError,
	parseCountReconciliationBody,
	requireReconciliationOwner,
	requireReconciliationRollout
} from '$lib/server/stockReconciliationApi';
import { updateBranchStockReconciliationCounts } from '$lib/server/stockReconciliation';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request, params, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireReconciliationOwner(session.role);
	if (!params.id?.trim()) throw kitError(400, 'ID job rekonsiliasi wajib diisi');
	const body = parseCountReconciliationBody(await request.json().catch(() => null));
	const branch = requireSessionBranch(locals, body.branch);
	await requireReconciliationRollout(platform, branch);
	try {
		const job = await updateBranchStockReconciliationCounts(
			platform,
			branch,
			session,
			params.id,
			body.items
		);
		return json({ ok: true, data: job });
	} catch (error) {
		mapReconciliationError(error);
	}
};
