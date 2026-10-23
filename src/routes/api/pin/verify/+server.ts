import { error as kitError, json } from '@sveltejs/kit';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { verifyPinForBranch } from '$lib/server/services/pinService';
import { getPageUnlockExpiresAt } from '$lib/server/pageAccess';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const session = requireAuthSession(locals);
	requireSessionBranch(locals, url.searchParams.get('branch'));
	if (session.role !== 'kasir') throw kitError(403, 'Verifikasi PIN hanya untuk kasir');
	return json(
		{ ok: true, expiresAt: getPageUnlockExpiresAt(session) },
		{ headers: { 'Cache-Control': 'no-store' } }
	);
};

/**
 * Verifikasi PIN kasir untuk buka halaman terkunci.
 * Route hanya auth + parsing + response; logika di pinService.
 * Route tipis: DB di service via BranchContext.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	const branch = requireSessionBranch(locals);
	if (session.role !== 'kasir') throw kitError(403, 'Verifikasi PIN hanya untuk kasir');

	const body = (await parseBody(request)) as { pin?: unknown; page?: unknown } | null;
	const pin = typeof body?.pin === 'string' ? body.pin : '';

	const result = await verifyPinForBranch(platform, branch, session, pin, body?.page);
	if (!result.ok) {
		return json(
			{ ok: false, message: result.message },
			{
				status: result.status,
				...(result.retryAfterSeconds !== undefined
					? { headers: { 'Retry-After': String(result.retryAfterSeconds) } }
					: {})
			}
		);
	}
	return json({ ok: true, expiresAt: result.expiresAt });
};
