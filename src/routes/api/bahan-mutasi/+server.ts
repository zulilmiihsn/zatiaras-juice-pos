import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import { getBahanMutasiList, recordBahanMutasi } from '$lib/server/services/bahanService';
import { loadStockPolicy } from '$lib/server/stockPolicy';
import type { RequestHandler } from './$types';

/**
 * /api/bahan-mutasi — Resource route controller untuk tabel `bahan_mutasi` (mutasi stok bahan).
 * Menangani HTTP auth, validasi request, dan delegasi ke bahanService.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const bahanId = url.searchParams.get('bahan_id');

	const rows = await getBahanMutasiList(db, branch, bahanId, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const rawDb = getRawDb(platform, branch);
	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		throw kitError(
			409,
			'Mutasi stok manual dijeda. Gunakan alur rekonsiliasi untuk menyesuaikan stok.'
		);
	}
	const rows = payloadRows(body.payload, branch);
	if (rows.length !== 1) throw kitError(400, 'Mutasi bahan harus satu per request');

	const result = await recordBahanMutasi(rawDb, branch, session, platform, rows[0]);
	return json(result);
};
