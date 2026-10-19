/**
 * Snapshot cache dapat dibuat ulang dari server. Kegagalan storage opsional
 * tidak boleh menggagalkan pembacaan jaringan atau mengembalikan data basi.
 * Jangan gunakan untuk antrean transaksi: penulisannya wajib berhasil.
 */
export const CACHE_OPERATION_TIMEOUT_MS = 2000;

export async function bestEffortCache<T>(
	operation: () => Promise<T>,
	timeoutMs = CACHE_OPERATION_TIMEOUT_MS
): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve().then(operation),
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), timeoutMs);
			})
		]);
	} catch {
		// Storage ditolak, rusak, atau penuh; pemanggil tetap memakai sumber otoritatif.
		return undefined;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
