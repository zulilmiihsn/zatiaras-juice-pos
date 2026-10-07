import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import {
	executePurchase,
	PurchaseUseCaseError,
	type PurchaseInput
} from '$lib/server/purchaseUseCase';
import type { RequestHandler } from './$types';

/**
 * POST /api/bahan/purchase — perintah kulakan atomik (AUD-006).
 * Satu request menggantikan tiga tulis terpisah (mutasi + kas + HPP).
 * Idempoten via operation_key. Pemilik saja, ikut stock policy.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<{ payload?: PurchaseInput }>(request);
	if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
		throw kitError(400, 'Payload tidak valid');
	}

	const rawDb = getRawDb(platform, branch);
	try {
		const result = await executePurchase(rawDb, branch, session, platform, body.payload);
		return json(result);
	} catch (error) {
		if (error instanceof PurchaseUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};
