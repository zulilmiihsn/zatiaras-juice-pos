import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import { getPosKas7HariForBranch } from '$lib/server/dashboardQueries';
import { requirePageAccessForBranch } from '$lib/server/pageAccess';
import type { RequestHandler } from './$types';

/**
 * /api/dashboard/pos-kas-7hari — Header transaksi POS 7 hari terakhir.
 * Menggantikan dispatch dari /api/data?table=pos_kas_7hari.
 * Route tipis (AUD-053): auth + parse + respons; SQL di dashboardQueries via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	await requirePageAccessForBranch(platform, branch, locals.authSession!, 'beranda');
	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');
	if (!start || !end) throw kitError(400, 'start dan end diperlukan');
	return json(await getPosKas7HariForBranch(platform, branch, start, end));
};
