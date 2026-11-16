import { json, error as kitError } from '@sveltejs/kit';
import { constantTimeEqual } from '$lib/server/secureCompare';
import { loadPublicMenu } from '$lib/server/webOrders/publicMenu';
import { readWebOrdersConfig } from '$lib/server/webOrders/client';
import { WebOrderError } from '$lib/server/webOrders/types';
import type { RequestHandler } from './$types';

/**
 * GET /api/public/menu?outlet=<id outlet situs pesan>: menu dan ketersediaan, khusus baca.
 * Auth: Bearer WEB_ORDERS_TOKEN (rahasia yang sama dengan POS_API_TOKEN di situs pesan).
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
	const config = readWebOrdersConfig(platform?.env as Record<string, unknown> | undefined);
	if (!config) throw kitError(503, 'Pesanan web belum tersambung');
	const sent = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
	if (!sent || !constantTimeEqual(sent, config.token)) throw kitError(401, 'Tidak diizinkan');
	try {
		const data = await loadPublicMenu(platform, url.searchParams.get('outlet') ?? '');
		return json({ ok: true, ...data }, { headers: { 'cache-control': 'no-store' } });
	} catch (error) {
		if (error instanceof WebOrderError) throw kitError(error.status, error.message);
		throw error;
	}
};
