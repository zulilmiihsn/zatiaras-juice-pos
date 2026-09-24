import { error as kitError, json } from '@sveltejs/kit';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { branchStockRolloutAllows } from '$lib/server/stockPolicy';
import { loadBranchOfflineReviews } from '$lib/server/stockOfflineReview';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	if (session.role !== 'pemilik') throw kitError(403, 'Role tidak memiliki akses');
	for (const key of url.searchParams.keys()) {
		if (key !== 'branch') throw kitError(400, `Parameter ${key} tidak dikenal`);
	}
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	if (!(await branchStockRolloutAllows(platform, branch))) {
		throw kitError(403, 'Review replay offline belum tersedia untuk cabang ini');
	}
	const items = await loadBranchOfflineReviews(platform, branch);
	return json({ ok: true, data: { items } });
};
