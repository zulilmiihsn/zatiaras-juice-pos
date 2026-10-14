import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import {
	executePurchaseForBranch,
	PurchaseUseCaseError,
	type PurchaseInput
} from '$lib/server/purchaseUseCase';
import type { RequestHandler } from './$types';

/**
 * POST /api/bahan/purchase — perintah kulakan atomik.
 * Satu request menggantikan tiga tulis terpisah (mutasi + kas + HPP).
 * Idempoten via operation_key. Pemilik saja, ikut stock policy.
 * Route tipis: DB di use case via BranchContext.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<{ branch?: unknown; payload?: PurchaseInput }>(request);
	if (!body?.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
		throw kitError(400, 'Payload tidak valid');
	}

	// Preserve purchase session scope, termasuk admin; captured body bukan izin tenant baru.
	if (requireSessionBranch(locals, body.branch) !== branch) {
		throw kitError(403, 'Branch tidak sesuai session');
	}
	try {
		const result = await executePurchaseForBranch(platform, branch, session, body.payload);
		return json(result);
	} catch (error) {
		if (error instanceof PurchaseUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};
