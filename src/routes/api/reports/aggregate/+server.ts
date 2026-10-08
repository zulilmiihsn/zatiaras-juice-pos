import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch } from '$lib/server/apiAuth';
import { buildLaporanAggregateForBranch } from '$lib/server/reportQueries';
import { requirePageAccessForBranch } from '$lib/server/pageAccess';
import type { RequestHandler } from './$types';

/**
 * /api/reports/aggregate — Laporan ter-agregasi dari tabel harian + buku_kas manual.
 * Menggantikan dispatch dari /api/data?table=laporan_aggregate.
 * Mengembalikan LaporanAggregate (summary, pemasukanUsaha, pemasukanLain, bebanUsaha, bebanLain, transactions).
 * Route tipis (AUD-053): auth + parse + respons; SQL di reportQueries via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	await requirePageAccessForBranch(platform, branch, locals.authSession!, 'laporan');
	const startDate = url.searchParams.get('start_date');
	const endDate = url.searchParams.get('end_date');
	if (
		!startDate ||
		!endDate ||
		!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
		!/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
		startDate > endDate
	) {
		throw kitError(400, 'Rentang tanggal tidak valid');
	}
	return json(await buildLaporanAggregateForBranch(platform, branch, startDate, endDate));
};
