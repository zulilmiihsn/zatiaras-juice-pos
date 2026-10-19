/**
 * Snapshot cache dapat dibuat ulang dari server. Kegagalan storage opsional
 * tidak boleh menggagalkan pembacaan jaringan atau mengembalikan data basi.
 * Jangan gunakan untuk antrean transaksi: penulisannya wajib berhasil.
 */
export async function bestEffortCache<T>(operation: () => Promise<T>): Promise<T | undefined> {
	try {
		return await operation();
	} catch {
		// Storage ditolak, rusak, atau penuh; pemanggil tetap memakai sumber otoritatif.
		return undefined;
	}
}
