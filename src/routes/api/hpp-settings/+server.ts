import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import {
	getHppSettingsForBranch,
	upsertHppSettingsForBranch,
	type HppSettingsInput
} from '$lib/server/services/hppSettingsService';
import type { RequestHandler } from './$types';

/**
 * /api/hpp-settings — Resource route untuk tabel `hpp_settings` (1 row per cabang).
 * Menggantikan dispatch dari /api/data?table=hpp_settings.
 * Invariant: upsert via `ON CONFLICT(id) DO UPDATE` dengan id tetap `${branch}:default`.
 * RBAC: pemilik (owner) untuk upsert. GET boleh untuk semua yang login.
 * Route tipis (AUD-053): auth + parse + respons; SQL di service via BranchContext.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));

	const rows = await getHppSettingsForBranch(platform, branch);
	return json(rows);
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const input = (Array.isArray(body.payload) ? body.payload[0] : body.payload) as HppSettingsInput;
	const result = await upsertHppSettingsForBranch(platform, branch, session, input);
	return json(result);
};

export const POST: RequestHandler = PUT;
