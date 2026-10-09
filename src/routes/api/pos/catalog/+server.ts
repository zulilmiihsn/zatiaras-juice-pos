import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { PosPricingTokenError } from '$lib/server/posPricingToken';
import { buildPosCatalogForBranch } from '$lib/server/checkout/catalogUseCase';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const branch = requireSessionBranch(locals);
	requireAnyRole(locals.authSession!.role, ['kasir', 'pemilik']);

	try {
		return json(await buildPosCatalogForBranch(platform, branch), {
			headers: { 'Cache-Control': 'no-store' }
		});
	} catch (error) {
		if (error instanceof PosPricingTokenError && error.code === 'SIGNING_KEY_UNAVAILABLE') {
			console.error(
				'[pos-catalog] POS_PRICE_SIGNING_KEY hilang: katalog dan checkout POS lumpuh. Isi secret di dashboard lalu redeploy.'
			);
			throw kitError(503, 'Layanan harga POS belum dikonfigurasi');
		}
		throw error;
	}
};
