import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { buildPosQuote } from '$lib/server/checkout/quoteUseCase';
import { CheckoutDomainError } from '$lib/server/checkout/utils';
import type { RequestHandler } from './$types';

/**
 * Quote POS: hitung ringkasan + token harga bertanda tangan.
 * Route hanya auth + parsing body + response; logika di quoteUseCase.
 * Route tipis: DB di use case via BranchContext.
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await request.json().catch(() => null);
	try {
		return json(
			await buildPosQuote(platform, branch, { userId: session.userId, role: session.role }, body)
		);
	} catch (error) {
		if (error instanceof CheckoutDomainError) throw kitError(error.status, error.message);
		throw error;
	}
};
