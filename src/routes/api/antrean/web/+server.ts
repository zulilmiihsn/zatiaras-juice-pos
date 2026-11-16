import { json } from '@sveltejs/kit';
import { requireAnyRole, requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { listWebOrdersForBranch } from '$lib/server/webOrders/useCase';
import type { RequestHandler } from './$types';

/** GET /api/antrean/web: pesanan web yang menunggu cek QRIS untuk cabang session. */
export const GET: RequestHandler = async ({ platform, locals }) => {
	const session = requireAuthSession(locals);
	requireAnyRole(session.role, ['kasir', 'pemilik']);
	const branch = requireSessionBranch(locals);
	const data = await listWebOrdersForBranch(platform, branch);
	return json({ ok: true, data }, { headers: { 'cache-control': 'no-store' } });
};
