import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { requirePageAccessForBranch } from '$lib/server/pageAccess';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getSesiTokoListForBranch,
	getSesiSummaryForBranch,
	insertSesiTokoRowsForBranch,
	updateSesiTokoRowForBranch
} from '$lib/server/services/sesiTokoService';
import type { RequestHandler } from './$types';

/**
 * /api/sesi-toko — Resource route controller untuk tabel `sesi_toko` (buka/tutup toko).
 * Menangani HTTP auth, validasi request, dan delegasi ke sesiTokoService.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	if (url.searchParams.get('summary') === '1' || url.searchParams.get('summary') === 'true') {
		const sid = url.searchParams.get('id');
		if (!sid) throw kitError(400, 'id sesi diperlukan');
		const summary = await getSesiSummaryForBranch(platform, branch, sid);
		if (!summary) throw kitError(404, 'Sesi tidak ditemukan');
		return json(summary);
	}
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const id = url.searchParams.get('id');
	const active = url.searchParams.get('is_active');

	const rows = await getSesiTokoListForBranch(platform, branch, id, active, limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	await requirePageAccessForBranch(platform, branch, session, 'beranda');

	const rows = payloadRows(body.payload, branch);
	const result = await insertSesiTokoRowsForBranch(platform, branch, session, rows);
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	await requirePageAccessForBranch(platform, branch, session, 'beranda');

	const result = await updateSesiTokoRowForBranch(
		platform,
		branch,
		session,
		String(body.where.id),
		body.payload as Record<string, unknown>
	);
	return json(result);
};
