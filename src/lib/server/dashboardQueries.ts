import { and, eq, gte, lte, asc } from 'drizzle-orm';
import { dailySalesSummary, bukuKas } from '$lib/database/schema';
import type { BranchId, DrizzleDb } from '$lib/server/branchResolver';
import type { D1Database } from '@cloudflare/workers-types';

/** Konversi timestamp ISO ke tanggal WITA 'YYYY-MM-DD' (zona Asia/Makassar). */
function witaDate(ts: string): string {
	return new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Asia/Makassar',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(ts));
}

/**
 * Statistik dashboard untuk rentang, dari ringkasan harian
 * (daily_sales_summary, sudah memuat total_hpp). Satu metode — tabel ringkasan
 * dijamin ada (migrasi 0004/0007) dan dijaga konsisten oleh checkout/void.
 * Periode tanpa penjualan → summary kosong (konsumen menghitungnya nol).
 */
export async function getDashboardStats(
	db: DrizzleDb,
	branch: BranchId,
	startTime: string,
	endTime: string
): Promise<Record<string, unknown>> {
	const startDate = witaDate(startTime);
	const endDate = witaDate(endTime);
	const summary = await db
		.select()
		.from(dailySalesSummary)
		.where(
			and(
				eq(dailySalesSummary.cabang_id, branch),
				gte(dailySalesSummary.tanggal_penjualan, startDate),
				lte(dailySalesSummary.tanggal_penjualan, endDate)
			)
		)
		.orderBy(asc(dailySalesSummary.tanggal_penjualan));
	return { summary };
}

/** Ringkasan pemasukan harian untuk grafik mingguan, dari daily_sales_summary. */
export async function getWeeklyIncomeSummary(
	db: DrizzleDb,
	branch: BranchId,
	startTime: string,
	endTime: string
): Promise<unknown[]> {
	const startDate = witaDate(startTime);
	const endDate = witaDate(endTime);
	return db
		.select()
		.from(dailySalesSummary)
		.where(
			and(
				eq(dailySalesSummary.cabang_id, branch),
				gte(dailySalesSummary.tanggal_penjualan, startDate),
				lte(dailySalesSummary.tanggal_penjualan, endDate)
			)
		)
		.orderBy(asc(dailySalesSummary.tanggal_penjualan));
}

/** Top 3 produk terlaris untuk rentang, dari daily_product_sales. */
export async function getBestSellersSummary(
	rawDb: D1Database,
	branch: BranchId,
	startTime: string,
	endTime: string
): Promise<unknown[]> {
	const startDate = witaDate(startTime);
	const endDate = witaDate(endTime);
	const rows = await rawDb
		.prepare(
			`SELECT produk_id,
			        MIN(nama_produk) AS nama_produk,
			        SUM(jumlah) AS total_qty,
			        SUM(penjualan_kotor) AS penjualan_kotor
				 FROM penjualan_produk_harian
				 WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?
					AND (produk_id NOT LIKE 'custom:%' AND produk_id != '__custom__')
				 GROUP BY produk_id
				 ORDER BY total_qty DESC
				 LIMIT 3`
		)
		.bind(branch, startDate, endDate)
		.all();

	return ((rows.results || []) as Array<Record<string, unknown>>).map((row) => ({
		...row,
		nama_produk: String(row.nama_produk || '')
			.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '')
			.trim()
	}));
}

/** Header transaksi POS dalam rentang (untuk agregasi kas 7 hari di klien). */
export async function getPosKas7Hari(
	db: DrizzleDb,
	branch: BranchId,
	startTime: string,
	endTime: string
): Promise<unknown[]> {
	return db
		.select({ transaction_id: bukuKas.transaction_id, waktu: bukuKas.waktu })
		.from(bukuKas)
		.where(
			and(
				eq(bukuKas.cabang_id, branch),
				eq(bukuKas.sumber, 'pos'),
				gte(bukuKas.waktu, startTime),
				lte(bukuKas.waktu, endTime)
			)
		);
}
