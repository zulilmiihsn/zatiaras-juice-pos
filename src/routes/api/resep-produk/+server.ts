import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getResepList,
	insertResepRows,
	replaceResepForProduct,
	deleteResepRow,
	deleteResepByProduct
} from '$lib/server/services/resepService';
import type { RequestHandler } from './$types';

/**
 * /api/resep-produk — Resource route controller untuk tabel `resep_produk`.
 * Menangani HTTP auth, validasi request, dan delegasi ke resepService.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'), 5000, 10000);
	const productId = url.searchParams.get('produk_id');

	const rows = await getResepList(db, branch, productId, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);
	const rows = payloadRows(body.payload, branch);

	const result = await insertResepRows(db, rawDb, branch, session, platform, rows);
	return json(result);
};

export const PUT: RequestHandler = async ({ request, url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const productId = String(url.searchParams.get('produk_id') || '');
	const body = await parseBody<WriteBody>(request);
	if (!productId || !body?.payload) throw kitError(400, 'Produk / payload tidak valid');

	const rawDb = getRawDb(platform, branch);
	const rows = payloadRows(body.payload, branch);

	const result = await replaceResepForProduct(rawDb, branch, session, platform, productId, rows);
	return json(result);
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	const productId = url.searchParams.get('produk_id');
	if (!id && !productId) throw kitError(400, 'id atau produk_id diperlukan');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	if (productId) {
		const result = await deleteResepByProduct(db, rawDb, branch, session, platform, productId);
		return json(result);
	}

	const result = await deleteResepRow(db, rawDb, branch, session, platform, String(id));
	return json(result);
};
