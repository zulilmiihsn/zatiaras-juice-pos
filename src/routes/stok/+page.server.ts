import { redirect } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import { loadBranchStockPolicy } from '$lib/server/stockPolicy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	const session = locals.authSession;
	if (!session) {
		// Tanpa sesi server: alur auth client-side yang berlaku (jangan rebut redirect login).
		return { stockPolicyMode: 'tracked' as const };
	}
	const branch = requireSessionBranch(locals);
	const policy = await loadBranchStockPolicy(platform, branch);
	if (policy.mode === 'ignored') {
		const reconciling = url.searchParams.get('reconciliation');
		const isOwner = session.role === 'pemilik' || session.role === 'admin';
		if (!isOwner || !reconciling) {
			throw redirect(302, '/pos');
		}
	}
	return { stockPolicyMode: policy.mode };
};
