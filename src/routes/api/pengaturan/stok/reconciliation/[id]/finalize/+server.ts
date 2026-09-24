import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	mapReconciliationError,
	parseFinalizeReconciliationBody,
	requireReconciliationOwner,
	requireReconciliationRollout
} from '$lib/server/stockReconciliationApi';
import { finalizeBranchStockReconciliation } from '$lib/server/stockReconciliation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, params, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireReconciliationOwner(session.role);
	if (!params.id?.trim()) throw kitError(400, 'ID job rekonsiliasi wajib diisi');
	const body = parseFinalizeReconciliationBody(await request.json().catch(() => null));
	const branch = requireSessionBranch(locals, body.branch);
	requireReconciliationRollout(platform, branch);
	try {
		const job = await finalizeBranchStockReconciliation(
			platform,
			branch,
			session,
			params.id,
			body.expectedPolicyRevision,
			new Date().toISOString()
		);
		return json({ ok: true, data: job });
	} catch (error) {
		mapReconciliationError(error);
	}
};
