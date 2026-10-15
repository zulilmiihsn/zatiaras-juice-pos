import { json } from '@sveltejs/kit';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { changePinForBranch } from '$lib/server/services/pinService';
import type { RequestHandler } from './$types';

/**
 * Ganti PIN cabang (pemilik).
 * Route hanya auth + parsing + response; logika di pinService.
 * Route tipis: DB di service via BranchContext.
 */
export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['pemilik']);
	const branch = requireSessionBranch(locals);
	const body = (await parseBody(request)) as {
		currentPin?: unknown;
		newPin?: unknown;
	} | null;
	const currentPin = typeof body?.currentPin === 'string' ? body.currentPin : '';
	const newPin = typeof body?.newPin === 'string' ? body.newPin : '';

	return json(await changePinForBranch(platform, branch, session, currentPin, newPin));
};
