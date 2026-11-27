import { branchContext, getD1Database, type BranchId } from './branchResolver';
import { getKioskPilotStatus } from './activateKioskPilot';
import { buildKioskCatalog } from './prepareKioskCatalog';
import { verifyPosPricingToken } from './posPricingToken';
import { withBranchStorage } from './branchStorageEnvironment';
import type { createBranchStorageClient } from './branchStorageClient';

/** Called only after a closed candidate authenticates its private relay request. */
export async function checkPausedBranchConnection(env: Record<string, unknown>, branch: BranchId) {
	try {
		const db = getD1Database(env, branch);
		const status = await db
			.prepare(`SELECT COUNT(*) AS shifts FROM sesi_toko WHERE cabang_id = ? AND is_active = 1`)
			.bind(branch)
			.first<{ shifts: number }>();
		if (status?.shifts !== 0) throw new Error('Shift target belum tutup');
		const storage = withBranchStorage(env, branch).STORAGE as
			ReturnType<typeof createBranchStorageClient> | undefined;
		if (!storage || typeof env.BRANCH_STORAGE_ORIGIN !== 'string')
			throw new Error('Relay penyimpanan target belum terhubung');
		// A scoped miss distinguishes authenticated R2 read access from a failed transport.
		const object = await storage.get(`produk/${branch}/00000000-0000-0000-0000-000000000000.png`);
		await object?.body?.cancel();
		const headers = new Headers({ 'cache-control': 'no-store' });
		if (env.BRANCH_OPERATIONAL_READY === 'yes') {
			if (
				env.KIOSK_PRODUCTION_PILOT !== branch ||
				env.KIOSK_PROJECTION_BRANCHES !== branch ||
				!env.BRANCH_MAINTENANCE
			)
				throw new Error('Binding operasional calon cabang tidak lengkap');
			const context = branchContext(branch);
			const platform = { env: env as App.Platform['env'] };
			const sync = await getKioskPilotStatus(platform, context);
			if (sync.shift !== 'uninitialized' || sync.paused || sync.pending !== 0)
				throw new Error('Koordinator produksi sudah memiliki state yang perlu direkonsiliasi');
			// Build but never publish the catalog: the verifier must not seed inventory or a shift.
			const catalog = await buildKioskCatalog(platform, context);
			const sample = catalog.products[0]?.price_token;
			if (!sample) throw new Error('Katalog produksi belum bisa disiapkan');
			await verifyPosPricingToken(platform.env, sample, {
				kind: 'catalog_product',
				branch: context,
				now: Date.now()
			});
			headers.set('x-zpos-operational-ready', 'yes');
		}
		return new Response(null, { status: 204, headers });
	} catch {
		// This probe must not expose tenant data, credentials, or provider errors.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}
