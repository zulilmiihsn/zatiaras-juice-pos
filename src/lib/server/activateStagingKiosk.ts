import { error } from '@sveltejs/kit';
import { getD1Database, type BranchContext } from './branchResolver';
import { buildKioskCatalog } from './prepareKioskCatalog';
import { publishKioskCatalog, readKioskCatalog } from './kioskCatalog';
import { verifyPosPricingToken } from './posPricingToken';
import { readKioskInventorySeed } from './kioskInventory';
import { readKioskOrderHandoff, seedKioskOrderHandoff } from './kioskOrderHandoff';
import { initializeKioskShift } from './initializeKioskShift';
import type { DurableObjectStorage } from '@cloudflare/workers-types';

import { kioskPilotEnvironment } from './kioskLoginPolicy';

export async function changeKioskPilot(
	platform: App.Platform | undefined,
	branch: BranchContext,
	action: 'activate' | 'rollback',
	target: 'staging' | 'production'
) {
	if (kioskPilotEnvironment(platform?.env, branch) !== target)
		throw error(404, 'Pilot kios tidak tersedia');
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw error(503, 'Koordinator kios belum tersedia');
	const response = await hub
		.get(hub.idFromName(`cashier:${branch}`))
		.fetch(
			new Request(`https://cashier.internal/projection/${action}-${target}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ branch })
			})
		)
		.catch(() => null);
	const result = response?.ok ? await response.json().catch(() => null) : null;
	if (
		result?.ok !== true ||
		(action === 'rollback'
			? result.status !== 'rolled-back'
			: !['initialized', 'already-initialized'].includes(result.status))
	)
		throw error(
			409,
			action === 'rollback'
				? 'Kembali ke kasir lama belum terkonfirmasi. Pastikan shift kios tutup dan sinkronisasi selesai.'
				: 'Peralihan belum terkonfirmasi. Jangan buka toko. Periksa status lalu ulangi persiapan staging.'
		);
}

/** Only the private staging binding can fence the branch. Retry the same handoff on interruption. */
export async function initializeKioskPilot(
	env: App.Platform['env'],
	storage: Pick<DurableObjectStorage, 'get' | 'transaction'>,
	branch: BranchContext,
	now: number,
	target: 'staging' | 'production'
) {
	if (kioskPilotEnvironment(env, branch) !== target || env.KIOSK_PROJECTION_BRANCHES !== branch)
		throw new Error('Pilot dan sinkronisasi Balikpapan staging belum dikonfigurasi');
	const db = getD1Database(env, branch);
	if ((await storage.get('shift:active')) !== undefined) {
		if ((await storage.get('shift:open-policy')) === 'rolled-back')
			throw new Error(
				'Pilot sudah dikembalikan ke jalur pusat; jangan gunakan ulang snapshot stok lama'
			);
		await readKioskOrderHandoff(db, branch, now);
		return { status: 'already-initialized' } as const;
	}
	const catalog = await buildKioskCatalog({ env }, branch);
	const checkedAt = Date.now();
	const products = readKioskCatalog(catalog, branch, checkedAt);
	if (!products?.length) throw new Error('Katalog valid belum tersedia');
	await verifyPosPricingToken(env, products[0].price_token, {
		kind: 'catalog_product',
		branch,
		now: checkedAt
	});
	const settings = await db
		.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id=? AND kunci IS NULL LIMIT 1')
		.bind(branch)
		.first<{ pin: string | null; pin_hash: string | null }>();
	if (settings?.pin && settings.pin !== '1234' && !settings.pin_hash)
		throw new Error('PIN lama harus dimigrasikan dahulu');
	await readKioskInventorySeed(db, branch);
	if (!(await publishKioskCatalog(storage, branch, catalog, checkedAt)).ok)
		throw new Error('Katalog kios belum dapat disimpan');
	// The INSERT trigger rechecks for an open shift at the point of the write.
	await db
		.prepare(
			'INSERT INTO kiosk_shift_cutover(cabang_id) VALUES (?) ON CONFLICT(cabang_id) DO NOTHING'
		)
		.bind(branch)
		.run();
	const seed = await readKioskOrderHandoff(db, branch, now);
	await seedKioskOrderHandoff(storage, seed, await readKioskInventorySeed(db, branch));
	return initializeKioskShift(db, storage, branch, now);
}
