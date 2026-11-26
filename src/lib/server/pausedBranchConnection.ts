import { getD1Database, type BranchId } from './branchResolver';
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
		return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
	} catch {
		// This probe must not expose tenant data, credentials, or provider errors.
		return new Response(null, { status: 503, headers: { 'cache-control': 'no-store' } });
	}
}
