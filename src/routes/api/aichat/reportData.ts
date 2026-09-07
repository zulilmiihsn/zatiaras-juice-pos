import { formatRupiah } from '$lib/utils/currency';
import type { D1Database } from '@cloudflare/workers-types';

export interface FormattedMonth {
	month: string;
	monthName: string;
	pemasukan: number;
	pengeluaran: number;
	laba: number;
	transaksi: number;
	paymentMethods: Record<string, { jumlah: number; nominal: number }>;
	topProducts: { id: string; nama: string; totalTerjual: number; totalPendapatan: number }[];
}

export interface RangeContext {
	requested: {
		start: string;
		end: string;
		startFormatted: string;
		endFormatted: string;
		type: string;
	};
	dataRequirements: {
		jenisData: string[];
		prioritas: string;
		scope: string;
	};
}

export interface DayAnalytics {
	date: string;
	revenue: number;
	transactions: number;
	avgTicket: number;
}

export interface ServerReportData {
	summary?: {
		pendapatan?: number;
		pengeluaran?: number;
		labaKotor?: number;
		pajak?: number;
		labaBersih?: number;
		totalTransaksi?: number;
		requestedMonthlyData?: FormattedMonth[];
	};
	startDate?: string;
	endDate?: string;
	pembayaran?: Record<string, { jumlah: number; nominal: number }>;
	jamRamai?: string[];
	products?: { id: string; nama: string; harga: number }[];
	categories?: { id: string; nama: string }[];
	addons?: { id: string; nama: string; harga: number }[];
	specificProduct?: { nama: string; harga: number; id: string } | null;
	produkTerlaris?: { nama: string; totalTerjual: number; totalPendapatan: number }[];
	analytics?: {
		avgTransactionsPerDay?: number;
		avgRevenuePerDay?: number;
		avgTicketSize?: number;
		totalDays?: number;
		bestDay?: DayAnalytics | null;
		worstDay?: DayAnalytics | null;
	};
	dailyPerformance?: {
		formattedDate: string;
		count: number;
		revenue: number;
		avgTicket: number;
	}[];
	stokBahan?: {
		totalItem: number;
		totalAsetStok: number;
		bahanKritis: { nama: string; stok: number; ambang: number; satuan: string }[];
	};
	marginProduk?: {
		nama: string;
		omzet: number;
		hpp: number;
		labaKotor: number;
		marginPersen: number;
	}[];
	seleraKonsumen?: {
		gula: { level: string; jumlah: number }[];
		es: { level: string; jumlah: number }[];
	};
	sesiToko?: {
		totalSesi: number;
		avgOmzetPerSesi: number;
		sesiTerakhir?: {
			waktuBuka: string;
			waktuTutup?: string | null;
			kasAwal: number;
			isActive: boolean;
		};
	};
	dataRequirements?: {
		jenisData?: string[];
		prioritas?: string;
		scope?: string;
	};
	[key: string]: unknown;
}

export interface ReportSqlResult {
	hasData: boolean;
	totalRecords: number;
	serverReportData: ServerReportData;
}

// [CATATAN]: Ekspresi SQL untuk ekstrak tanggal, bulan, dan jam WITA secara konsisten
const WITA_DATE = "date(CASE WHEN waktu LIKE '%Z' THEN datetime(waktu, '+8 hours') ELSE waktu END)";
const WITA_MONTH = "strftime('%Y-%m', CASE WHEN waktu LIKE '%Z' THEN datetime(waktu, '+8 hours') ELSE waktu END)";
const WITA_HOUR = "strftime('%H', CASE WHEN waktu LIKE '%Z' THEN datetime(waktu, '+8 hours') ELSE waktu END)";

const BK_WITA_DATE = "date(CASE WHEN bk.waktu LIKE '%Z' THEN datetime(bk.waktu, '+8 hours') ELSE bk.waktu END)";
const BK_WITA_MONTH = "strftime('%Y-%m', CASE WHEN bk.waktu LIKE '%Z' THEN datetime(bk.waktu, '+8 hours') ELSE bk.waktu END)";

/**
 * Tarik data agregasi laporan langsung lewat SQL engine Cloudflare D1.
 * Menghindari penarikan ribuan row mentah ke RAM Cloudflare Worker (anti OOM/CPU timeout).
 */
export async function fetchReportDataSql(
	rawDb: D1Database,
	requestedBranch: string,
	startYmd: string,
	endYmd: string
): Promise<ReportSqlResult> {
	// [CATATAN]: Eksekusi semua kueri agregasi secara paralel dalam 1 batch Promise
	const [
		summaryRes,
		monthlyRes,
		monthlyPaymentsRes,
		monthlyProductsRes,
		dailyRes,
		paymentRes,
		hourRes,
		topProductsRes,
		taxConfigRes,
		stokKritisRes,
		totalBahanRes,
		marginProdukRes,
		seleraGulaRes,
		seleraEsRes,
		sesiSummaryRes,
		latestSesiRes
	] = await Promise.all([
		// 1. Ringkasan Finansial
		rawDb
			.prepare(
				`SELECT
					COALESCE(SUM(CASE WHEN tipe = 'in' THEN nominal ELSE 0 END), 0) AS pendapatan,
					COALESCE(SUM(CASE WHEN tipe = 'out' THEN nominal ELSE 0 END), 0) AS pengeluaran,
					COUNT(DISTINCT CASE WHEN sumber = 'pos' AND transaction_id IS NOT NULL THEN transaction_id END) AS totalTransaksiPos,
					COUNT(DISTINCT transaction_id) AS totalTransaksi,
					COUNT(*) AS totalRecords
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ?`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.first() as Promise<{
			pendapatan?: number;
			pengeluaran?: number;
			totalTransaksiPos?: number;
			totalTransaksi?: number;
			totalRecords?: number;
		} | null>,

		// 2. Agregasi Bulanan
		rawDb
			.prepare(
				`SELECT
					${WITA_MONTH} AS bulan,
					COALESCE(SUM(CASE WHEN tipe = 'in' THEN nominal ELSE 0 END), 0) AS pemasukan,
					COALESCE(SUM(CASE WHEN tipe = 'out' THEN nominal ELSE 0 END), 0) AS pengeluaran,
					COUNT(DISTINCT CASE WHEN sumber = 'pos' AND transaction_id IS NOT NULL THEN transaction_id END) AS transaksi
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ?
				GROUP BY ${WITA_MONTH}
				ORDER BY bulan ASC`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				bulan: string;
				pemasukan: number;
				pengeluaran: number;
				transaksi: number;
			}>;
		}>,

		// 3. Metode Pembayaran per Bulan
		rawDb
			.prepare(
				`SELECT
					${WITA_MONTH} AS bulan,
					COALESCE(NULLIF(metode_bayar, ''), 'lainnya') AS metode,
					COUNT(*) AS jumlah,
					COALESCE(SUM(nominal), 0) AS nominal
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ? AND tipe = 'in'
				GROUP BY ${WITA_MONTH}, COALESCE(NULLIF(metode_bayar, ''), 'lainnya')`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				bulan: string;
				metode: string;
				jumlah: number;
				nominal: number;
			}>;
		}>,

		// 4. Produk Terlaris per Bulan
		rawDb
			.prepare(
				`SELECT
					${BK_WITA_MONTH} AS bulan,
					COALESCE(NULLIF(tk.nama_produk, ''), NULLIF(tk.nama_kustom, ''), NULLIF(p.nama, ''), 'Produk') AS nama,
					COALESCE(tk.produk_id, 'custom') AS id,
					SUM(tk.jumlah) AS totalTerjual,
					SUM(COALESCE(tk.nominal, tk.jumlah * COALESCE(tk.harga, 0))) AS totalPendapatan
				FROM transaksi_kasir tk
				JOIN buku_kas bk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
				LEFT JOIN produk p ON tk.produk_id = p.id
				WHERE tk.cabang_id = ? AND ${BK_WITA_DATE} >= ? AND ${BK_WITA_DATE} <= ?
				GROUP BY 1, 2, 3
				ORDER BY bulan ASC, totalTerjual DESC`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				bulan: string;
				nama: string;
				id: string;
				totalTerjual: number;
				totalPendapatan: number;
			}>;
		}>,

		// 5. Performa Harian
		rawDb
			.prepare(
				`SELECT
					${WITA_DATE} AS tanggal,
					COUNT(DISTINCT CASE WHEN sumber = 'pos' AND transaction_id IS NOT NULL THEN transaction_id ELSE id END) AS count,
					COALESCE(SUM(CASE WHEN tipe = 'in' THEN nominal ELSE 0 END), 0) AS revenue
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ? AND tipe = 'in'
				GROUP BY ${WITA_DATE}
				ORDER BY tanggal ASC`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				tanggal: string;
				count: number;
				revenue: number;
			}>;
		}>,

		// 6. Rincian Pembayaran Keseluruhan
		rawDb
			.prepare(
				`SELECT
					COALESCE(NULLIF(metode_bayar, ''), 'lainnya') AS metode,
					COUNT(*) AS jumlah,
					COALESCE(SUM(nominal), 0) AS nominal
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ? AND tipe = 'in'
				GROUP BY COALESCE(NULLIF(metode_bayar, ''), 'lainnya')
				ORDER BY nominal DESC`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				metode: string;
				jumlah: number;
				nominal: number;
			}>;
		}>,

		// 7. Pola Jam Ramai (Top 3)
		rawDb
			.prepare(
				`SELECT
					${WITA_HOUR} AS jam,
					COUNT(*) AS jumlah,
					COALESCE(SUM(nominal), 0) AS nominal
				FROM buku_kas
				WHERE cabang_id = ? AND ${WITA_DATE} >= ? AND ${WITA_DATE} <= ? AND tipe = 'in' AND sumber = 'pos'
				GROUP BY ${WITA_HOUR}
				ORDER BY jumlah DESC
				LIMIT 3`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				jam: string;
				jumlah: number;
				nominal: number;
			}>;
		}>,

		// 8. Top 10 Produk Keseluruhan Periode
		rawDb
			.prepare(
				`SELECT
					COALESCE(NULLIF(tk.nama_produk, ''), NULLIF(tk.nama_kustom, ''), NULLIF(p.nama, ''), 'Produk') AS nama,
					COALESCE(tk.produk_id, 'custom') AS id,
					SUM(tk.jumlah) AS totalTerjual,
					SUM(COALESCE(tk.nominal, tk.jumlah * COALESCE(tk.harga, 0))) AS totalPendapatan
				FROM transaksi_kasir tk
				JOIN buku_kas bk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
				LEFT JOIN produk p ON tk.produk_id = p.id
				WHERE tk.cabang_id = ? AND ${BK_WITA_DATE} >= ? AND ${BK_WITA_DATE} <= ?
				GROUP BY 1, 2
				ORDER BY totalTerjual DESC
				LIMIT 10`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all() as Promise<{
			results?: Array<{
				nama: string;
				id: string;
				totalTerjual: number;
				totalPendapatan: number;
			}>;
		}>,

		// 9. Pengaturan Pajak
		rawDb
			.prepare(`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`)
			.bind(requestedBranch)
			.first()
			.catch(() => null) as Promise<{ nilai?: string } | null>,

		// 10. Stok Bahan Kritis (stok <= ambang_stok)
		rawDb
			.prepare(
				`SELECT
					nama,
					stok_saat_ini AS stok,
					ambang_stok AS ambang,
					satuan
				FROM bahan
				WHERE cabang_id = ? AND is_active = 1 AND stok_saat_ini <= ambang_stok
				ORDER BY (stok_saat_ini - ambang_stok) ASC
				LIMIT 10`
			)
			.bind(requestedBranch)
			.all()
			.catch(() => ({ results: [] })) as Promise<{
			results?: Array<{
				nama: string;
				stok: number;
				ambang: number;
				satuan: string;
			}>;
		}>,

		// 11. Total Persediaan Bahan Baku
		rawDb
			.prepare(
				`SELECT
					COUNT(*) AS totalItem,
					COALESCE(SUM(stok_saat_ini * biaya_per_satuan), 0) AS totalAsetStok
				FROM bahan
				WHERE cabang_id = ? AND is_active = 1`
			)
			.bind(requestedBranch)
			.first()
			.catch(() => null) as Promise<{ totalItem?: number; totalAsetStok?: number } | null>,

		// 12. HPP & Margin Laba Kotor per Menu
		rawDb
			.prepare(
				`SELECT
					COALESCE(NULLIF(tk.nama_produk, ''), NULLIF(tk.nama_kustom, ''), NULLIF(p.nama, ''), 'Produk') AS nama,
					SUM(tk.nominal) AS omzet,
					SUM(COALESCE(tk.nominal_hpp, 0)) AS hpp,
					(SUM(tk.nominal) - SUM(COALESCE(tk.nominal_hpp, 0))) AS labaKotor,
					CASE
						WHEN SUM(tk.nominal) > 0 THEN
							ROUND(((SUM(tk.nominal) - SUM(COALESCE(tk.nominal_hpp, 0))) / SUM(tk.nominal)) * 100, 1)
						ELSE 0
					END AS marginPersen
				FROM transaksi_kasir tk
				JOIN buku_kas bk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
				LEFT JOIN produk p ON tk.produk_id = p.id
				WHERE tk.cabang_id = ? AND ${BK_WITA_DATE} >= ? AND ${BK_WITA_DATE} <= ?
				GROUP BY 1
				HAVING omzet > 0
				ORDER BY marginPersen DESC
				LIMIT 10`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all()
			.catch(() => ({ results: [] })) as Promise<{
			results?: Array<{
				nama: string;
				omzet: number;
				hpp: number;
				labaKotor: number;
				marginPersen: number;
			}>;
		}>,

		// 13. Selera Gula Konsumen
		rawDb
			.prepare(
				`SELECT
					COALESCE(NULLIF(tk.gula, ''), 'Normal') AS level,
					COUNT(*) AS jumlah
				FROM transaksi_kasir tk
				JOIN buku_kas bk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
				WHERE tk.cabang_id = ? AND ${BK_WITA_DATE} >= ? AND ${BK_WITA_DATE} <= ?
					AND tk.gula IS NOT NULL AND tk.gula != ''
				GROUP BY 1
				ORDER BY jumlah DESC
				LIMIT 5`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all()
			.catch(() => ({ results: [] })) as Promise<{
			results?: Array<{
				level: string;
				jumlah: number;
			}>;
		}>,

		// 14. Selera Es Konsumen
		rawDb
			.prepare(
				`SELECT
					COALESCE(NULLIF(tk.es, ''), 'Normal') AS level,
					COUNT(*) AS jumlah
				FROM transaksi_kasir tk
				JOIN buku_kas bk ON tk.buku_kas_id = bk.id AND tk.cabang_id = bk.cabang_id
				WHERE tk.cabang_id = ? AND ${BK_WITA_DATE} >= ? AND ${BK_WITA_DATE} <= ?
					AND tk.es IS NOT NULL AND tk.es != ''
				GROUP BY 1
				ORDER BY jumlah DESC
				LIMIT 5`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.all()
			.catch(() => ({ results: [] })) as Promise<{
			results?: Array<{
				level: string;
				jumlah: number;
			}>;
		}>,

		// 15. Ringkasan Sesi Shift Toko
		rawDb
			.prepare(
				`SELECT
					COUNT(*) AS totalSesi,
					COALESCE(AVG(total_omzet), 0) AS avgOmzetPerSesi
				FROM (
					SELECT
						st.id,
						COALESCE(SUM(CASE WHEN bk.tipe = 'in' AND bk.sumber = 'pos' THEN bk.nominal ELSE 0 END), 0) AS total_omzet
					FROM sesi_toko st
					LEFT JOIN buku_kas bk ON bk.id_sesi_toko = st.id AND bk.cabang_id = st.cabang_id
					WHERE st.cabang_id = ?
						AND substr(datetime(st.waktu_buka, '+8 hours'), 1, 10) >= ?
						AND substr(datetime(st.waktu_buka, '+8 hours'), 1, 10) <= ?
					GROUP BY st.id
				)`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.first()
			.catch(() => null) as Promise<{ totalSesi?: number; avgOmzetPerSesi?: number } | null>,

		// 16. Sesi Toko Terkini
		rawDb
			.prepare(
				`SELECT
					id,
					datetime(waktu_buka, '+8 hours') AS waktuBuka,
					CASE WHEN waktu_tutup IS NOT NULL THEN datetime(waktu_tutup, '+8 hours') ELSE NULL END AS waktuTutup,
					kas_awal AS kasAwal,
					is_active AS isActive
				FROM sesi_toko
				WHERE cabang_id = ?
				ORDER BY waktu_buka DESC
				LIMIT 1`
			)
			.bind(requestedBranch)
			.first()
			.catch(() => null) as Promise<{
			id?: string;
			waktuBuka?: string;
			waktuTutup?: string | null;
			kasAwal?: number;
			isActive?: number;
		} | null>
	]);

	// [CATATAN]: Format stok bahan & bahan kritis
	const stokBahan = {
		totalItem: totalBahanRes?.totalItem || 0,
		totalAsetStok: Math.round(totalBahanRes?.totalAsetStok || 0),
		bahanKritis: (stokKritisRes?.results || []).map((b) => ({
			nama: b.nama,
			stok: b.stok,
			ambang: b.ambang,
			satuan: b.satuan
		}))
	};

	// [CATATAN]: Format HPP & margin produk
	const marginProduk = (marginProdukRes?.results || []).map((m) => ({
		nama: m.nama,
		omzet: Math.round(m.omzet),
		hpp: Math.round(m.hpp),
		labaKotor: Math.round(m.labaKotor),
		marginPersen: m.marginPersen
	}));

	// [CATATAN]: Format selera konsumen (gula & es)
	const seleraKonsumen = {
		gula: (seleraGulaRes?.results || []).map((g) => ({
			level: g.level,
			jumlah: g.jumlah
		})),
		es: (seleraEsRes?.results || []).map((e) => ({
			level: e.level,
			jumlah: e.jumlah
		}))
	};

	// [CATATAN]: Format ringkasan sesi / shift toko
	const sesiToko = {
		totalSesi: sesiSummaryRes?.totalSesi || 0,
		avgOmzetPerSesi: Math.round(sesiSummaryRes?.avgOmzetPerSesi || 0),
		sesiTerakhir: latestSesiRes?.id
			? {
					waktuBuka: latestSesiRes.waktuBuka || '',
					waktuTutup: latestSesiRes.waktuTutup || null,
					kasAwal: latestSesiRes.kasAwal || 0,
					isActive: Boolean(latestSesiRes.isActive)
				}
			: undefined
	};

	const totalRecords = summaryRes?.totalRecords || 0;
	if (totalRecords === 0) {
		return {
			hasData: false,
			totalRecords: 0,
			serverReportData: {
				stokBahan,
				sesiToko
			}
		};
	}

	const pendapatan = summaryRes?.pendapatan || 0;
	const pengeluaran = summaryRes?.pengeluaran || 0;
	const labaKotor = pendapatan - pengeluaran;

	// [CATATAN]: Parsing konfigurasi pajak
	let taxRate = 0.005;
	let taxEnabled = true;
	let taxThreshold = 500_000_000;
	let applyThreshold = false;

	if (taxConfigRes?.nilai) {
		try {
			const parsed = JSON.parse(taxConfigRes.nilai);
			if (parsed && typeof parsed === 'object') {
				if (parsed.enabled === false) taxEnabled = false;
				if (typeof parsed.rate === 'number') taxRate = parsed.rate;
				if (typeof parsed.threshold === 'number') taxThreshold = parsed.threshold;
				if (typeof parsed.apply_threshold === 'boolean') applyThreshold = parsed.apply_threshold;
			}
		} catch {}
	}

	let pajak = 0;
	if (taxEnabled && pendapatan > 0) {
		pajak = applyThreshold
			? Math.round(Math.min(pendapatan, Math.max(0, pendapatan - taxThreshold)) * taxRate)
			: Math.round(pendapatan * taxRate);
	}
	const labaBersih = labaKotor - pajak;
	const totalTransaksi = summaryRes?.totalTransaksiPos || summaryRes?.totalTransaksi || 0;

	// [CATATAN]: Format data bulanan
	const monthlyPaymentsMap: Record<string, Record<string, { jumlah: number; nominal: number }>> = {};
	for (const row of monthlyPaymentsRes?.results || []) {
		if (!monthlyPaymentsMap[row.bulan]) monthlyPaymentsMap[row.bulan] = {};
		monthlyPaymentsMap[row.bulan][row.metode] = {
			jumlah: row.jumlah,
			nominal: row.nominal
		};
	}

	const monthlyProductsMap: Record<
		string,
		Array<{ id: string; nama: string; totalTerjual: number; totalPendapatan: number }>
	> = {};
	for (const row of monthlyProductsRes?.results || []) {
		if (!monthlyProductsMap[row.bulan]) monthlyProductsMap[row.bulan] = [];
		if (monthlyProductsMap[row.bulan].length < 3) {
			monthlyProductsMap[row.bulan].push({
				id: row.id,
				nama: row.nama,
				totalTerjual: row.totalTerjual,
				totalPendapatan: row.totalPendapatan
			});
		}
	}

	const requestedMonthlyData: FormattedMonth[] = (monthlyRes?.results || []).map((m) => {
		const [year, month] = m.bulan.split('-');
		const dateObj = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
		const monthName = dateObj.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
		return {
			month: m.bulan,
			monthName,
			pemasukan: m.pemasukan,
			pengeluaran: m.pengeluaran,
			laba: m.pemasukan - m.pengeluaran,
			transaksi: m.transaksi,
			paymentMethods: monthlyPaymentsMap[m.bulan] || {},
			topProducts: monthlyProductsMap[m.bulan] || []
		};
	});

	// [CATATAN]: Format performa harian & statistik
	const dailyList = (dailyRes?.results || []).map((d) => {
		const parts = d.tanggal.split('-');
		const dateObj = new Date(
			parseInt(parts[0], 10),
			parseInt(parts[1], 10) - 1,
			parseInt(parts[2], 10)
		);
		const formattedDate = dateObj.toLocaleDateString('id-ID', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		return {
			date: d.tanggal,
			formattedDate,
			count: d.count,
			revenue: d.revenue,
			avgTicket: d.count > 0 ? d.revenue / d.count : 0
		};
	});

	const totalDays = dailyList.length;
	const avgTransactionsPerDay =
		totalDays > 0 ? dailyList.reduce((s, d) => s + d.count, 0) / totalDays : 0;
	const avgRevenuePerDay = totalDays > 0 ? pendapatan / totalDays : 0;
	const avgTicketSize = totalTransaksi > 0 ? pendapatan / totalTransaksi : 0;

	let bestDay: DayAnalytics | null = null;
	let worstDay: DayAnalytics | null = null;

	if (dailyList.length > 0) {
		const sorted = [...dailyList].sort((a, b) => b.revenue - a.revenue);
		const best = sorted[0];
		const worst = sorted[sorted.length - 1];
		if (best && best.revenue > 0) {
			bestDay = {
				date: best.formattedDate,
				revenue: best.revenue,
				transactions: best.count,
				avgTicket: Math.round(best.avgTicket)
			};
		}
		if (worst && worst.revenue > 0) {
			worstDay = {
				date: worst.formattedDate,
				revenue: worst.revenue,
				transactions: worst.count,
				avgTicket: Math.round(worst.avgTicket)
			};
		}
	}

	// [CATATAN]: Format rincian pembayaran
	const pembayaran: Record<string, { jumlah: number; nominal: number }> = {};
	for (const p of paymentRes?.results || []) {
		pembayaran[p.metode] = {
			jumlah: p.jumlah,
			nominal: p.nominal
		};
	}

	// [CATATAN]: Format jam ramai
	const jamRamai = (hourRes?.results || []).map((h) => `${h.jam}:00 (${h.jumlah} trx)`);

	// [CATATAN]: Format produk terlaris
	const produkTerlaris = (topProductsRes?.results || []).map((p) => ({
		id: p.id,
		nama: p.nama,
		totalTerjual: p.totalTerjual,
		totalPendapatan: p.totalPendapatan
	}));

	const serverReportData: ServerReportData = {
		summary: {
			pendapatan,
			pengeluaran,
			labaKotor,
			pajak,
			labaBersih,
			totalTransaksi,
			requestedMonthlyData
		},
		startDate: startYmd,
		endDate: endYmd,
		pembayaran,
		jamRamai,
		produkTerlaris,
		dailyPerformance: dailyList,
		analytics: {
			avgTransactionsPerDay: Math.round(avgTransactionsPerDay * 100) / 100,
			avgRevenuePerDay: Math.round(avgRevenuePerDay),
			avgTicketSize: Math.round(avgTicketSize),
			totalDays,
			bestDay,
			worstDay
		},
		stokBahan,
		marginProduk,
		seleraKonsumen,
		sesiToko
	};

	return {
		hasData: true,
		totalRecords,
		serverReportData
	};
}

/**
 * Bangun teks konteks terstruktur untuk prompt AI Business Analyst.
 */
export function buildReportContext(
	serverReportData: ServerReportData,
	rangeContext: RangeContext
): string {
	if (!serverReportData) return 'Tidak ada data laporan tersedia.';

	return `
=== KONTEKS RENTANG WAKTU ===
PERIODE YANG DIMINTA USER:
- Rentang: ${rangeContext.requested.startFormatted} s.d. ${rangeContext.requested.endFormatted}
- Format: ${rangeContext.requested.start} s.d. ${rangeContext.requested.end}
- Tipe: ${rangeContext.requested.type}

=== KEBUTUHAN DATA YANG DIPERLUKAN ===
- Jenis Data: ${rangeContext.dataRequirements?.jenisData?.join(', ') || 'semua data'}
- Prioritas: ${rangeContext.dataRequirements?.prioritas || 'general_analysis'}
- Scope: ${rangeContext.dataRequirements?.scope || 'general_analysis'}

=== DATA LAPORAN PERIODE YANG DIMINTA (SUDAH DIFETCH SESUAI KONTEKS) ===
Rentang Waktu: ${serverReportData.startDate} s.d. ${serverReportData.endDate}
- Pendapatan: Rp ${formatRupiah(serverReportData.summary?.pendapatan) || '0'}
- Pengeluaran: Rp ${formatRupiah(serverReportData.summary?.pengeluaran) || '0'}
- Laba Kotor: Rp ${formatRupiah(serverReportData.summary?.labaKotor) || '0'}
- Pajak: Rp ${formatRupiah(serverReportData.summary?.pajak) || '0'}
- Laba Bersih: Rp ${formatRupiah(serverReportData.summary?.labaBersih) || '0'}
- Total Transaksi: ${serverReportData.summary?.totalTransaksi || '0'}

PENTING: Data di atas sudah mencakup keseluruhan periode yang diminta. ANALISIS data yang tersedia, jangan katakan tidak ada data.

=== DATA PER BULAN UNTUK PERIODE YANG DIMINTA ===
${
	(serverReportData.summary?.requestedMonthlyData || [])
		.map(
			(month) => `
Bulan ${month.monthName} (${month.month}):
- Pendapatan: Rp ${formatRupiah(month.pemasukan)}
- Pengeluaran: Rp ${formatRupiah(month.pengeluaran)}
- Laba: Rp ${formatRupiah(month.laba)}
- Total Transaksi: ${month.transaksi}
- Metode Pembayaran: ${Object.entries(month.paymentMethods)
				.map(([method, data]) => {
					const methodLabels: Record<string, string> = {
						tunai: 'Tunai (Cash)',
						qris: 'QRIS (Digital Payment)',
						lainnya: 'Lainnya'
					};
					const label = methodLabels[method] || method;
					return `${label}: ${data.jumlah} trx (Rp ${formatRupiah(data.nominal)})`;
				})
				.join(', ')}
- Top 3 Produk Terlaris: ${month.topProducts.map((p) => `${p.nama} (${p.totalTerjual} terjual, Rp ${formatRupiah(p.totalPendapatan)})`).join(', ')}
`
		)
		.join('\n') || '- (tidak ada data per bulan)'
}

=== RINCIAN PEMBAYARAN ===
${
	Object.entries(serverReportData.pembayaran || {})
		.map(([k, v]) => {
			const methodLabels: Record<string, string> = {
				tunai: 'Tunai (Cash)',
				qris: 'QRIS (Digital Payment)',
				lainnya: 'Lainnya'
			};
			const label = methodLabels[k] || k;
			return `- ${label}: ${v.jumlah} trx, Rp ${formatRupiah(v.nominal)}`;
		})
		.join('\n') || '- (tidak ada)'
}

=== POLA WAKTU ===
Jam Ramai (Top 3):
${(serverReportData.jamRamai || []).map((s, i) => `- ${i + 1}. ${s}`).join('\n') || '- (tidak ada)'}

=== PRODUK & KATEGORI ===
Produk (sample): ${
		serverReportData.products
			?.slice(0, 5)
			.map((p) => p.nama)
			.join(', ') || '-'
	}
Kategori (sample): ${
		serverReportData.categories
			?.slice(0, 5)
			.map((c) => c.nama)
			.join(', ') || '-'
	}

${
	serverReportData.specificProduct
		? `
=== PRODUK SPESIFIK YANG DICARI ===
Nama: ${serverReportData.specificProduct.nama}
Harga: Rp ${formatRupiah(serverReportData.specificProduct.harga) || 'Tidak tersedia'}
ID: ${serverReportData.specificProduct.id}
`
		: ''
}

Top Produk Terlaris:
${(serverReportData.produkTerlaris || []).map((p, i) => `- ${i + 1}. ${p.nama} • ${p.totalTerjual} terjual • Rp ${formatRupiah(p.totalPendapatan)}`).join('\n') || '-'}

=== ANALISIS MENDALAM ===
Performa Harian:
- Rata-rata transaksi per hari: ${serverReportData.analytics?.avgTransactionsPerDay || 0} trx
- Rata-rata pendapatan per hari: Rp ${formatRupiah(serverReportData.analytics?.avgRevenuePerDay || 0)}
- Rata-rata nilai per transaksi: Rp ${formatRupiah(serverReportData.analytics?.avgTicketSize || 0)}
- Total hari aktif: ${serverReportData.analytics?.totalDays || 0} hari

Hari Terbaik: ${serverReportData.analytics?.bestDay ? `${serverReportData.analytics.bestDay.date} - Rp ${formatRupiah(serverReportData.analytics.bestDay.revenue)} (${serverReportData.analytics.bestDay.transactions} trx, avg Rp ${formatRupiah(serverReportData.analytics.bestDay.avgTicket)})` : 'Tidak ada data'}

Hari Terburuk: ${serverReportData.analytics?.worstDay ? `${serverReportData.analytics.worstDay.date} - Rp ${formatRupiah(serverReportData.analytics.worstDay.revenue)} (${serverReportData.analytics.worstDay.transactions} trx, avg Rp ${formatRupiah(serverReportData.analytics.worstDay.avgTicket)})` : 'Tidak ada data'}

Detail Performa Harian:
${
	(serverReportData.dailyPerformance || [])
		.map(
			(day) =>
				`- ${day.formattedDate}: ${day.count} trx, Rp ${formatRupiah(day.revenue)} (avg Rp ${formatRupiah(Math.round(day.avgTicket))})`
		)
		.join('\n') || '- (tidak ada data harian)'
}

=== STOK & BAHAN BAKU ===
Total Item Bahan Aktif: ${serverReportData.stokBahan?.totalItem || 0} bahan
Total Nilai Aset Stok Bahan: Rp ${formatRupiah(serverReportData.stokBahan?.totalAsetStok || 0)}
Bahan Kritis (Stok <= Ambang Batas / Butuh Restok Segera):
${(serverReportData.stokBahan?.bahanKritis || []).map((b, i) => `- ${i + 1}. ${b.nama}: Sisa ${b.stok} ${b.satuan} (Ambang batas: ${b.ambang} ${b.satuan})`).join('\n') || '- (Semua stok bahan aman di atas ambang batas)'}

=== HPP & MARGIN KEUNTUNGAN MENU ===
Top 10 Menu dengan Margin Laba Kotor Tertinggi:
${(serverReportData.marginProduk || []).map((m, i) => `- ${i + 1}. ${m.nama}: Margin ${m.marginPersen}% • Omzet Rp ${formatRupiah(m.omzet)} • HPP Rp ${formatRupiah(m.hpp)} • Laba Kotor Rp ${formatRupiah(m.labaKotor)}`).join('\n') || '- (Data HPP transaksi belum tercatat)'}

=== PREFERENSI & SELERA KONSUMEN ===
Pilihan Tingkat Kemanisan (Gula):
${(serverReportData.seleraKonsumen?.gula || []).map((g) => `- Gula ${g.level}: ${g.jumlah} pesanan`).join('\n') || '- (Tidak ada data kustomisasi gula)'}
Pilihan Tingkat Es:
${(serverReportData.seleraKonsumen?.es || []).map((e) => `- Es ${e.level}: ${e.jumlah} pesanan`).join('\n') || '- (Tidak ada data kustomisasi es)'}

=== SHIFT & SESI TOKO ===
Total Sesi Shift Toko: ${serverReportData.sesiToko?.totalSesi || 0} sesi
Rata-rata Omzet per Shift: Rp ${formatRupiah(serverReportData.sesiToko?.avgOmzetPerSesi || 0)}
${serverReportData.sesiToko?.sesiTerakhir ? `Sesi Terkini: Buka ${serverReportData.sesiToko.sesiTerakhir.waktuBuka}${serverReportData.sesiToko.sesiTerakhir.waktuTutup ? `, Tutup ${serverReportData.sesiToko.sesiTerakhir.waktuTutup}` : ' (Sedang Berjalan)'} • Kas Awal Rp ${formatRupiah(serverReportData.sesiToko.sesiTerakhir.kasAwal)}` : ''}
`;
}
