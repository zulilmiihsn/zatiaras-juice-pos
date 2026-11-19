import type { getCheckoutCapabilities } from '../../lib/server/checkout/dataLoader';

type CapsDb = Parameters<typeof getCheckoutCapabilities>[0];
export function fakeCapsDb(opts: {
	tables: string[];
	bukuKas: string[];
	produk: string[];
	transaksiKasir: string[];
}): CapsDb {
	const pick = (sql: string): Array<{ name: string }> => {
		const rows = sql.includes('sqlite_master')
			? opts.tables
			: sql.includes('buku_kas')
				? opts.bukuKas
				: sql.includes('produk')
					? opts.produk
					: opts.transaksiKasir;
		return rows.map((name) => ({ name }));
	};
	return {
		prepare: (sql: string) => ({
			bind: (..._args: unknown[]) => ({ all: async () => ({ results: pick(sql) }) }),
			all: async () => ({ results: pick(sql) })
		})
	} as unknown as CapsDb;
}
