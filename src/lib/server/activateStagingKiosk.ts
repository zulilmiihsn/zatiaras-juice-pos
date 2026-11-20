import { error } from '@sveltejs/kit';
import { getD1Database, type BranchContext } from './branchResolver';
import { prepareKioskCatalog } from './prepareKioskCatalog';
import { KIOSK_CATALOG_KEY, readKioskCatalog } from './kioskCatalog';
import { verifyPosPricingToken } from './posPricingToken';
import { readKioskInventorySeed } from './kioskInventory';
import { readKioskOrderHandoff, seedKioskOrderHandoff } from './kioskOrderHandoff';
import { initializeKioskShift } from './initializeKioskShift';
import type { DurableObjectStorage } from '@cloudflare/workers-types';

export function isStagingKioskPilot(env: App.Platform['env'] | undefined, branch: BranchContext) {
	return branch === 'balikpapan' && env?.KIOSK_STAGING_PILOT === 'balikpapan';
}

export async function activateStagingKiosk(
	platform: App.Platform | undefined,
	branch: BranchContext
) {
	if (!isStagingKioskPilot(platform?.env, branch)) throw error(404, 'Pilot staging tidak tersedia');
	const hub = platform?.env.REALTIME_HUB;
	if (!hub) throw error(503, 'Koordinator kios belum tersedia');
	await prepareKioskCatalog(platform, branch);
	const response = await hub.get(hub.idFromName(`cashier:${branch}`)).fetch(
		new Request('https://cashier.internal/projection/activate-staging', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ branch })
		})
	);
	if (!response.ok)
		throw error(
			409,
			'Peralihan belum terkonfirmasi. Jangan buka toko. Periksa status lalu ulangi persiapan staging.'
		);
}

/** Only the private staging binding can fence the branch. Retry the same handoff on interruption. */
export async function initializeStagingKiosk(
	env: App.Platform['env'],
	storage: Pick<DurableObjectStorage, 'get' | 'transaction'>,
	branch: BranchContext,
	now: number
) {
	if (!isStagingKioskPilot(env, branch) || env.KIOSK_PROJECTION_BRANCHES !== branch)
		throw new Error('Pilot dan sinkronisasi Balikpapan staging belum dikonfigurasi');
	const db = getD1Database(env, branch);
	if ((await storage.get('shift:active')) !== undefined) {
		await readKioskOrderHandoff(db, branch, now);
		return { status: 'already-initialized' } as const;
	}
	const products = readKioskCatalog(await storage.get(KIOSK_CATALOG_KEY), branch, now);
	if (!products?.length) throw new Error('Katalog valid belum tersedia');
	await verifyPosPricingToken(env, products[0].price_token, {
		kind: 'catalog_product',
		branch,
		now
	});
	const settings = await db
		.prepare('SELECT pin, pin_hash FROM pengaturan WHERE cabang_id=? AND kunci IS NULL LIMIT 1')
		.bind(branch)
		.first<{ pin: string | null; pin_hash: string | null }>();
	if (settings?.pin && settings.pin !== '1234' && !settings.pin_hash)
		throw new Error('PIN lama harus dimigrasikan dahulu');
	await readKioskInventorySeed(db, branch);
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
