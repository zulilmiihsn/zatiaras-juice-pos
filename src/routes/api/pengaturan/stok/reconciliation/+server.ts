import { json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import {
	mapReconciliationError,
	parseCreateReconciliationBody,
	requireReconciliationOwner,
	requireReconciliationRollout
} from '$lib/server/stockReconciliationApi';
import { createBranchStockReconciliation } from '$lib/server/stockReconciliation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireReconciliationOwner(session.role);
	const body = parseCreateReconciliationBody(await request.json().catch(() => null));
	const branch = requireSessionBranch(locals, body.branch);
	requireReconciliationRollout(platform, branch);
	try {
		const job = await createBranchStockReconciliation(
			platform,
			branch,
			session,
			new Date().toISOString()
		);
		return json({ ok: true, data: job });
	} catch (error) {
		mapReconciliationError(error);
	}
};
