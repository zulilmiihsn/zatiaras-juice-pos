import { json, error as kitError } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { CheckoutDomainError } from '$lib/server/checkout/utils';
import { acceptWebOrder } from '$lib/server/webOrders/useCase';
import { WebOrderError } from '$lib/server/webOrders/types';
import type { RequestHandler } from './$types';

/** POST /api/antrean/web/[id]/terima: uang QRIS sudah cocok, jadikan penjualan POS dan mulai diproses. */
export const POST: RequestHandler = async ({ params, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const branch = requireSessionBranch(locals);
	try {
		const data = await acceptWebOrder(
			platform,
			branch,
			{ userId: session.userId, username: session.username, role: session.role },
			params.id
		);
		return json({ ok: true, data });
	} catch (error) {
		if (error instanceof WebOrderError || error instanceof CheckoutDomainError) {
			throw kitError(error.status, error.message);
		}
		throw error;
	}
};
