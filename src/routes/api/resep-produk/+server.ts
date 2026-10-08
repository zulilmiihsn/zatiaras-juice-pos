import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getResepListForBranch,
	insertResepRowsForBranch,
	replaceResepForProductForBranch,
	deleteResepRowForBranch,
	deleteResepByProductForBranch
} from '$lib/server/services/resepService';
import type { RequestHandler } from './$types';

/**
 * /api/resep-produk — Resource route controller untuk tabel `resep_produk`.
 * Menangani HTTP auth, validasi request, dan delegasi ke resepService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const limit = parseDataLimit(url.searchParams.get('limit'), 5000, 10000);
	const productId = url.searchParams.get('produk_id');

	const rows = await getResepListForBranch(platform, branch, productId, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const rows = payloadRows(body.payload, branch);
	const result = await insertResepRowsForBranch(platform, branch, session, rows);
	return json(result);
};

export const PUT: RequestHandler = async ({ request, url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const productId = String(url.searchParams.get('produk_id') || '');
	const body = await parseBody<WriteBody>(request);
	if (!productId || !body?.payload) throw kitError(400, 'Produk / payload tidak valid');

	const rows = payloadRows(body.payload, branch);
	const result = await replaceResepForProductForBranch(platform, branch, session, productId, rows);
	return json(result);
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	const productId = url.searchParams.get('produk_id');
	if (!id && !productId) throw kitError(400, 'id atau produk_id diperlukan');

	if (productId) {
		const result = await deleteResepByProductForBranch(platform, branch, session, productId);
		return json(result);
	}

	const result = await deleteResepRowForBranch(platform, branch, session, String(id));
	return json(result);
};
