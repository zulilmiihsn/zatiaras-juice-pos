import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { getBestSellersSummary } from '$lib/server/dashboardQueries';
import { requirePageAccess } from '$lib/server/pageAccess';
import type { RequestHandler } from './$types';

/**
 * /api/dashboard/best-sellers — Top 3 produk terlaris dari daily_product_sales.
 * Menggantikan dispatch dari /api/data?table=best_sellers_summary.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const rawDb = getRawDb(platform, branch);
	await requirePageAccess(rawDb, locals.authSession!, 'beranda');
	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');
	if (!start || !end) throw kitError(400, 'start dan end diperlukan');
	return json(await getBestSellersSummary(rawDb, branch, start, end));
};
