import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { mapReconciliationError } from '$lib/server/stockReconciliationApi';
import { loadBranchActiveReconciliation } from '$lib/server/stockReconciliation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	if (session.role !== 'pemilik' && session.role !== 'admin') {
		throw kitError(403, 'Role tidak memiliki akses');
	}
	for (const key of url.searchParams.keys()) {
		if (key !== 'branch') {
			throw kitError(400, `Parameter ${key} tidak dikenal`);
		}
	}
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	try {
		const job = await loadBranchActiveReconciliation(platform, branch);
		return json({ ok: true, data: { job } });
	} catch (error) {
		mapReconciliationError(error);
	}
};
