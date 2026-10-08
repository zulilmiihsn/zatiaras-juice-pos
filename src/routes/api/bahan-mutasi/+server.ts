import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getBahanMutasiListForBranch,
	recordBahanMutasiForBranch
} from '$lib/server/services/bahanService';
import type { RequestHandler } from './$types';

/**
 * /api/bahan-mutasi — Resource route controller untuk tabel `bahan_mutasi` (mutasi stok bahan).
 * Menangani HTTP auth, validasi request, dan delegasi ke bahanService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const bahanId = url.searchParams.get('bahan_id');

	const rows = await getBahanMutasiListForBranch(platform, branch, bahanId, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const rows = payloadRows(body.payload, branch);
	if (rows.length !== 1) throw kitError(400, 'Mutasi bahan harus satu per request');

	const result = await recordBahanMutasiForBranch(platform, branch, session, rows[0]);
	return json(result);
};
