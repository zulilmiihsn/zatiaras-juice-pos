import { json, error as kitError } from '@sveltejs/kit';
import { requireAuthSession, requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { decodeDataCursor, parseDataLimit } from '$lib/server/dataPagination';
import { getOrderHistoryForBranch } from '$lib/server/services/bukuKasService';
import type { RequestHandler } from './$types';

const QUERY_KEYS = new Set([
	'branch',
	'rentang',
	'search',
	'metode',
	'limit',
	'cursor',
	'pagination'
]);

/** Cashiers may read recent orders for their branch without opening financial-report permissions. */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	for (const key of url.searchParams.keys()) {
		if (!QUERY_KEYS.has(key)) throw kitError(400, 'Parameter riwayat pesanan tidak didukung');
	}
	const pagination = url.searchParams.get('pagination');
	if (pagination !== null && pagination !== 'cursor') throw kitError(400, 'Pagination tidak valid');
	const limit = parseDataLimit(url.searchParams.get('limit'), 50, 200);
	const cursor = decodeDataCursor(url.searchParams.get('cursor'));
	const result = await getOrderHistoryForBranch(
		platform,
		branch,
		{
			rentang: url.searchParams.get('rentang'),
			search: url.searchParams.get('search'),
			metode: url.searchParams.get('metode')
		},
		limit,
		cursor,
		pagination === 'cursor' || cursor !== null
	);
	return json(result.isPage ? result.page : result.rows);
};
