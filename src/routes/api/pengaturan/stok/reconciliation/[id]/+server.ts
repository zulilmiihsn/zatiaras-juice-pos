import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	mapReconciliationError,
	parseCreateReconciliationBody,
	requireReconciliationOwner,
	requireReconciliationRollout
} from '$lib/server/stockReconciliationApi';
import { cancelBranchStockReconciliation } from '$lib/server/stockReconciliation';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ request, params, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireReconciliationOwner(session.role);
	if (!params.id?.trim()) throw kitError(400, 'ID job rekonsiliasi wajib diisi');
	const body = parseCreateReconciliationBody(await request.json().catch(() => null));
	const branch = requireSessionBranch(locals, body.branch);
	requireReconciliationRollout(platform, branch);
	try {
		const job = await cancelBranchStockReconciliation(platform, branch, session, params.id);
		return json({ ok: true, data: job });
	} catch (error) {
		mapReconciliationError(error);
	}
};
