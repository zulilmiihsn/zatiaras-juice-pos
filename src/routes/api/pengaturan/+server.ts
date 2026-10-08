import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import {
	getPengaturanForBranch,
	insertPengaturanRowsForBranch,
	updatePengaturanRowForBranch
} from '$lib/server/services/pengaturanService';
import type { RequestHandler } from './$types';

/**
 * /api/pengaturan — Resource route controller untuk tabel `pengaturan` (1 row per cabang).
 * Menangani HTTP auth, validasi request, dan delegasi ke pengaturanService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));

	const rows = await getPengaturanForBranch(platform, branch);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const requestedRows = Array.isArray(body.payload) ? body.payload : [body.payload];

	const result = await insertPengaturanRowsForBranch(platform, branch, session, requestedRows);
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || body.where?.id == null) throw kitError(400, 'Payload / id tidak valid');

	const idStr = String(body.where!.id);

	const result = await updatePengaturanRowForBranch(
		platform,
		branch,
		session,
		idStr,
		body.payload as Record<string, unknown>
	);
	return json(result);
};
