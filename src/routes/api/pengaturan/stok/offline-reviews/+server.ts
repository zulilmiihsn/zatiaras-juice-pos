import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { loadBranchOfflineReviews } from '$lib/server/stockOfflineReview';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	for (const key of url.searchParams.keys()) {
		if (key !== 'branch') throw kitError(400, `Parameter ${key} tidak dikenal`);
	}
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const items = await loadBranchOfflineReviews(platform, branch);
	return json({ ok: true, data: { items } });
};
