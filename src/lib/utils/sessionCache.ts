import { clear, keys, delMany } from 'idb-keyval';
import { smartCache } from './cache';
import { catalogStore } from './idbStores';
import { bestEffortCache } from './cachePersistence';

const LEGACY_PRIVATE_PREFIXES = ['pos_kas_7hari_', 'avg_transaksi_', 'jam_ramai_mingguan_'];

/** Hapus data yang dapat dimuat ulang; antrean transaksi dan intent offline tetap utuh. */
export async function clearCachedSessionData(): Promise<void> {
	// clear menaikkan epoch sebelum await sehingga respons sesi lama tidak boleh commit lagi.
	const cleared = smartCache.clear();
	await Promise.all([
		bestEffortCache(() => cleared),
		bestEffortCache(() => clear(catalogStore)),
		bestEffortCache(async () => {
			const privateKeys = (await keys()).filter(
				(key) =>
					typeof key === 'string' &&
					LEGACY_PRIVATE_PREFIXES.some((prefix) => key.startsWith(prefix))
			);
			if (privateKeys.length) await delMany(privateKeys);
		})
	]);
}
