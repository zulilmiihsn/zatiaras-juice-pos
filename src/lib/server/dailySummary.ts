import type { BranchId } from '$lib/server/branchResolver';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/**
 * Membalik (decrement) kontribusi sebuah transaksi POS terhadap tabel ringkasan
 * harian ketika transaksi tersebut dihapus/void.
 *
 * Menghasilkan statement tanpa mengeksekusi. Pemanggil wajib memasukkan statement
 * ini ke batch atomik yang sama dengan restore stok dan delete transaksi.
 */
export async function buildDailySummaryReversalStatements(
	rawDb: D1Database,
	branch: BranchId,
	transactionId: string
): Promise<{ found: boolean; statements: D1PreparedStatement[] }> {
	// [CATATAN]: Agregat kontribusi transaksi: tanggal WITA dari created_at item, dan
	// [CATATAN]: metode bayar dari buku_kas induknya.
	const header = (await rawDb
		.prepare(
			`SELECT
				date(datetime(tk.created_at, '+8 hours')) AS tanggal_penjualan,
				bk.metode_bayar AS metode_bayar,
				COALESCE(SUM(tk.jumlah), 0) AS item_qty,
				COALESCE(SUM(tk.nominal), 0) AS gross,
				COALESCE(SUM(tk.nominal_hpp), 0) AS hpp
			 FROM transaksi_kasir tk
			 INNER JOIN buku_kas bk
				ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
			 WHERE tk.cabang_id = ? AND tk.transaction_id = ?
			 GROUP BY tanggal_penjualan, bk.metode_bayar
			 LIMIT 1`
		)
		.bind(branch, transactionId)
		.first()) as {
		tanggal_penjualan?: string;
		metode_bayar?: string;
		item_qty?: number;
		gross?: number;
		hpp?: number;
	} | null;

	if (!header || !header.tanggal_penjualan) return { found: false, statements: [] };

	const salesDate = header.tanggal_penjualan;
	const itemQty = Number(header.item_qty || 0);
	const gross = Number(header.gross || 0);
	const hpp = Number(header.hpp || 0);
	const isCash = header.metode_bayar === 'tunai';
	const cashDelta = isCash ? gross : 0;
	const nonCashDelta = isCash ? 0 : gross;
	const now = new Date().toISOString();

	// [CATATAN]: Kontribusi per produk untuk daily_product_sales.
	const products =
		(
			(await rawDb
				.prepare(
					`SELECT COALESCE(produk_id, 'custom:' || nama_produk) AS produk_id,
				COALESCE(SUM(jumlah), 0) AS jumlah,
				COALESCE(SUM(nominal), 0) AS gross
			 FROM transaksi_kasir
			 WHERE cabang_id = ? AND transaction_id = ?
			 GROUP BY COALESCE(produk_id, 'custom:' || nama_produk)`
				)
				.bind(branch, transactionId)
				.all()) as {
				results?: Array<{ produk_id?: string; jumlah?: number; gross?: number }>;
			}
		).results || [];

	const statements: D1PreparedStatement[] = [
		rawDb
			.prepare(
				`UPDATE ringkasan_penjualan_harian SET
					jumlah_transaksi = MAX(0, jumlah_transaksi - 1),
					jumlah_item = MAX(0, jumlah_item - ?),
					penjualan_kotor = MAX(0, penjualan_kotor - ?),
					penjualan_tunai = MAX(0, penjualan_tunai - ?),
					penjualan_nontunai = MAX(0, penjualan_nontunai - ?),
					total_hpp = MAX(0, total_hpp - ?),
					updated_at = ?
				 WHERE cabang_id = ? AND tanggal_penjualan = ?`
			)
			.bind(itemQty, gross, cashDelta, nonCashDelta, hpp, now, branch, salesDate),
		...products.map((p) =>
			rawDb
				.prepare(
					`UPDATE penjualan_produk_harian SET
						jumlah = MAX(0, jumlah - ?),
						penjualan_kotor = MAX(0, penjualan_kotor - ?),
						penjualan_tunai = MAX(0, penjualan_tunai - ?),
						penjualan_nontunai = MAX(0, penjualan_nontunai - ?),
						jumlah_transaksi = MAX(0, jumlah_transaksi - 1),
						updated_at = ?
					 WHERE cabang_id = ? AND tanggal_penjualan = ? AND produk_id = ?`
				)
				.bind(
					Number(p.jumlah || 0),
					Number(p.gross || 0),
					isCash ? Number(p.gross || 0) : 0,
					isCash ? 0 : Number(p.gross || 0),
					now,
					branch,
					salesDate,
					String(p.produk_id)
				)
		)
	];

	return { found: true, statements };
}
