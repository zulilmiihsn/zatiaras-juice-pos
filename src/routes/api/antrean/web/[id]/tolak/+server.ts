import { json, error as kitError } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { rejectWebOrder } from '$lib/server/webOrders/useCase';
import { WebOrderError } from '$lib/server/webOrders/types';
import type { RequestHandler } from './$types';

/** POST /api/antrean/web/[id]/tolak: pembayaran tidak ditemukan atau pesanan dibatalkan. */
export const POST: RequestHandler = async ({ params, platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const branch = requireSessionBranch(locals);
	try {
		await rejectWebOrder(platform, branch, params.id);
		return json({ ok: true });
	} catch (error) {
		if (error instanceof WebOrderError) throw kitError(error.status, error.message);
		throw error;
	}
};
