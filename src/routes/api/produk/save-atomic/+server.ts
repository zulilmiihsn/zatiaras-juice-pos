import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import {
	SaveAtomicError,
	saveProductAtomicForBranch,
	type SaveAtomicBody
} from '$lib/server/services/productAtomicService';
import type { RequestHandler } from './$types';

/**
 * Simpan produk + resep atomik.
 * Route hanya auth cabang, role, parsing body, panggil service,
 * dan petakan hasil/error ke HTTP. Seluruh validasi + batch atomik
 * di productAtomicService.
 * Route tipis (AUD-053): DB di service via BranchContext.
 */
export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	const body = await parseBody<SaveAtomicBody>(request);
	const requestedBranch = url.searchParams.get('branch') || body?.branch;
	const branch = requireSessionBranch(locals, requestedBranch);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	try {
		return json(await saveProductAtomicForBranch(platform, branch, session, body));
	} catch (error) {
		if (error instanceof SaveAtomicError) throw kitError(error.status, error.message);
		throw error;
	}
};
