import { branchContext, getD1Database, type BranchId } from './branchResolver';
import { changeKioskPilot, getKioskPilotStatus } from './activateKioskPilot';
import { constantTimeEqual } from './secureCompare';
import { buildKioskCatalog } from './prepareKioskCatalog';
import { verifyPosPricingToken } from './posPricingToken';
import { withBranchStorage } from './branchStorageEnvironment';
import type { createBranchStorageClient } from './branchStorageClient';

/** Called only after a closed candidate authenticates its private relay request. */
export async function checkPausedBranchConnection(env: Record<string, unknown>, branch: BranchId) {
	try {
		const db = getD1Database(env, branch);
		const status = await db
			.prepare(
				`SELECT
				(SELECT COUNT(*) FROM sesi_toko WHERE cabang_id = ? AND is_active = 1) AS shifts,
				(SELECT COUNT(*) FROM kiosk_shift_cutover WHERE cabang_id = ?) AS managed`
			)
			.bind(branch, branch)
			.first<{ shifts: number; managed: number }>();
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
			const expected = sync.shift === 'uninitialized' ? 0 : sync.shift === 'closed' ? 1 : -1;
			if (sync.paused || sync.pending !== 0 || expected < 0 || status.managed !== expected)
				throw new Error('Status koordinator dan fence D1 perlu direkonsiliasi');
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
			headers.set('x-zpos-coordinator-shift', sync.shift);
		}
		return new Response(null, { status: 204, headers });
	} catch {
		// This probe must not expose tenant data, credentials, or provider errors.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}

export const PAUSED_ACTIVATION_PATH = '/internal/cutover/activate';

/** Both the branch relay and the separately provisioned cutover key must authorize this mutation. */
export async function activatePausedBranch(
	request: Request,
	env: Record<string, unknown>,
	branch: BranchId
) {
	const key = env.BRANCH_ACTIVATION_SECRET;
	if (
		request.method !== 'POST' ||
		env.BRANCH_OPERATIONAL_READY !== 'yes' ||
		typeof key !== 'string' ||
		key.length < 32 ||
		!constantTimeEqual(request.headers.get('x-zpos-cutover-activation') ?? '', key)
	)
		return new Response(null, { status: 404 });
	const readiness = await checkPausedBranchConnection(env, branch);
	if (readiness.status !== 204) return readiness;
	try {
		await changeKioskPilot(
			{ env: env as App.Platform['env'] },
			branchContext(branch),
			'activate',
			'production'
		);
		const result = await checkPausedBranchConnection(env, branch);
		if (result.status !== 204 || result.headers.get('x-zpos-coordinator-shift') !== 'closed')
			throw new Error('Aktivasi belum terkonfirmasi');
		return result;
	} catch {
		// Failure may leave a fence. Do not expose data or clear it automatically.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}
