import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getBahanListForBranch,
	insertBahanRowsForBranch,
	updateBahanRowForBranch,
	deleteBahanRowForBranch
} from '$lib/server/services/bahanService';
import type { RequestHandler } from './$types';

/**
 * /api/bahan — Resource route controller untuk tabel `bahan` (bahan baku & stok).
 * Menangani HTTP auth, validasi request, dan delegasi ke bahanService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const limit = parseDataLimit(url.searchParams.get('limit'), 2000, 5000);

	const rows = await getBahanListForBranch(platform, branch, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const rows = payloadRows(body.payload, branch);
	const result = await insertBahanRowsForBranch(platform, branch, session, rows);
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	const result = await updateBahanRowForBranch(
		platform,
		branch,
		session,
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

	const result = await deleteBahanRowForBranch(platform, branch, session, id);
	return json(result);
};
