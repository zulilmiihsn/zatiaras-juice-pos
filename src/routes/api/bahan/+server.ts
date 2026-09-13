import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getBahanList,
	insertBahanRows,
	updateBahanRow,
	deleteBahanRow
} from '$lib/server/services/bahanService';
import type { RequestHandler } from './$types';

/**
 * /api/bahan — Resource route controller untuk tabel `bahan` (bahan baku & stok).
 * Menangani HTTP auth, validasi request, dan delegasi ke bahanService.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'), 2000, 5000);

	const rows = await getBahanList(db, branch, limit);
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

	const result = await insertBahanRows(db, rawDb, branch, session, platform, rows);
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	const result = await updateBahanRow(
		db,
		rawDb,
		branch,
		session,
		platform,
		String(body.where.id),
		body.payload as Record<string, unknown>
	);
	return json(result);
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	if (!id) throw kitError(400, 'id diperlukan');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	const result = await deleteBahanRow(db, rawDb, branch, session, platform, id);
	return json(result);
};
