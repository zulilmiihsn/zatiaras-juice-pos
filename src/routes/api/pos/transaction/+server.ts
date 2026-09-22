import { json, error as kitError } from '@sveltejs/kit';
import { getD1Database } from '$lib/server/branchResolver';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { CheckoutUseCaseError, executeCheckout } from '$lib/server/checkout/checkoutUseCase';
import type { RequestHandler } from './$types';

/**
 * Checkout POS otoritatif server.
 * Route hanya auth cabang, role, ambil DB, parsing body, panggil use case,
 * dan petakan hasil/error ke HTTP. Orkestrasi di checkoutUseCase.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);

	const rawBody = await request.json().catch(() => null);
	try {
		const result = await executeCheckout({
			db,
			branch,
			session: { userId: session.userId, username: session.username, role: session.role },
			platform,
			rawBody
		});
		return json(
			{ ok: true, idempotent: result.idempotent, data: result.data },
			{ headers: result.d1Meta ? { 'x-d1-meta': result.d1Meta } : undefined }
		);
	} catch (error) {
		if (error instanceof CheckoutUseCaseError) throw kitError(error.status, error.message);
		throw error;
	}
};
