import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import { getDb, getRawDb } from '$lib/server/dataApiHelpers';
import { getDashboardStats } from '$lib/server/dashboardQueries';
import { requirePageAccess } from '$lib/server/pageAccess';
import type { RequestHandler } from './$types';

/**
 * /api/dashboard/stats — Statistik dashboard dari tabel ringkasan harian.
 * Menggantikan dispatch dari /api/data?table=dashboard_stats.
 * Mengembalikan { summary: [...] } (array daily_sales_summary rows).
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	await requirePageAccess(getRawDb(platform, branch), locals.authSession!, 'beranda');
	const db = getDb(platform, branch);
	const start = url.searchParams.get('start');
	const end = url.searchParams.get('end');
	if (!start || !end) throw kitError(400, 'start dan end diperlukan');
	return json(await getDashboardStats(db, branch, start, end));
};
