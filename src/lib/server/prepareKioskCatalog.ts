import { error } from '@sveltejs/kit';
import type { BranchContext } from './branchResolver';
import { buildPosCatalogForBranch } from './checkout/catalogUseCase';

export async function prepareKioskCatalog(
	platform: App.Platform | undefined,
	branch: BranchContext
) {
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw error(503, 'Layanan katalog kios belum tersedia.');
	try {
		const { version, products, addOns, fetched_at, expires_at, signing_key_id, stock_policy } =
			await buildPosCatalogForBranch(platform, branch);
		const catalog = {
			version,
			branch,
			fetched_at,
			expires_at,
			signing_key_id,
			stock_policy,
			categories: [],
			addOns: addOns.map(({ id, nama, harga, is_active, price_token }) => ({
				id,
				nama,
				harga: Number(harga),
				is_active,
				price_token
			})),
			products: products.map(
				({ id, nama, harga, harga_jumbo, ekstra_ids, is_active, price_token }) => ({
					id,
					nama,
					harga: Number(harga),
					harga_jumbo: harga_jumbo == null ? null : Number(harga_jumbo),
					ekstra_ids,
					is_active,
					price_token
				})
			)
		};
		const response = await hub.get(hub.idFromName('cashier:' + branch)).fetch(
			new Request('https://cashier.internal/device/catalog', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ branch, catalog }),
				signal: AbortSignal.timeout(8000)
			})
		);
		if (!response.ok) throw new Error('Snapshot kios tidak terkonfirmasi');
		const outcome = await response.json();
		if (outcome?.ok !== true || !['updated', 'unchanged'].includes(outcome.status))
			throw new Error('Snapshot kios tidak terkonfirmasi');
	} catch {
		throw error(
			503,
			'Katalog kios belum bisa disiapkan. Pastikan database pusat tersedia dan coba lagi.'
		);
	}
}
