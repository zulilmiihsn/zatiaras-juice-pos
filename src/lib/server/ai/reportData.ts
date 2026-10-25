import { formatRupiah } from '$lib/utils/currency';
import { branchContext, normalizeBranch } from '$lib/server/branchResolver';
import {
	buildCanonicalFacts,
	buildLaporanAggregate,
	canonicalProductName
} from '$lib/server/reportQueries';
import { loadStockPolicy } from '$lib/server/stockPolicy';
import type { D1Database } from '@cloudflare/workers-types';

export interface FormattedMonth {
	month: string;
	monthName: string;
	pemasukan: number;
	pengeluaran: number;
	laba: number;
	transaksi: number;
	paymentMethods: Record<string, { nominal: number }>;
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
	pembayaran?: Record<string, { nominal: number }>;
	jamRamai?: string[];
	products?: { id: string; nama: string; harga: number }[];
	categories?: { id: string; nama: string }[];
	addons?: { id: string; nama: string; harga: number }[];
	specificProduct?: { nama: string; harga: number; id: string } | null;
	produkTerlaris?: { nama: string; totalTerjual: number; totalPendapatan: number }[];
	/** Rentang menyentuh data terarsip: jam ramai, margin, selera, omzet shift hanya data aktif. */
	rincianDetailAktifSaja?: { arsipSebelum: string };
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
		monitoringPaused?: boolean;
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

// Ekspresi SQL untuk ekstrak tanggal, bulan, dan jam WITA secara konsisten
const WITA_DATE = "date(CASE WHEN waktu LIKE '%Z' THEN datetime(waktu, '+8 hours') ELSE waktu END)";
const WITA_HOUR =
	"strftime('%H', CASE WHEN waktu LIKE '%Z' THEN datetime(waktu, '+8 hours') ELSE waktu END)";

const BK_WITA_DATE =
	"date(CASE WHEN bk.waktu LIKE '%Z' THEN datetime(bk.waktu, '+8 hours') ELSE bk.waktu END)";
const PAYMENT_LABELS: Record<string, string> = {
	tunai: 'Tunai (Cash)',
	'non-tunai': 'Non-tunai (QRIS/transfer)',
	lainnya: 'Lainnya'
};

const NON_CASH_METHODS = new Set(['non-tunai', 'nontunai', 'qris', 'transfer', 'debit']);

/** Bucket metode bayar laporan: POS hanya memisah tunai/non-tunai. */
function paymentBucket(metode: string | null): string {
	const value = (metode ?? '').trim().toLowerCase();
	// 'cash' = nilai tunai lama (lihat DetailTransaksiModal); nilai tak dikenal tidak ditebak.
	if (value === 'tunai' || value === 'cash') return 'tunai';
	if (NON_CASH_METHODS.has(value)) return 'non-tunai';
	return 'lainnya';
}

function formatPayments(payments: Record<string, { nominal: number }>): string[] {
	const total = Object.values(payments).reduce((sum, p) => sum + p.nominal, 0);
	return Object.entries(payments)
		.sort(([, a], [, b]) => b.nominal - a.nominal)
		.map(([method, p]) => {
			const share = total > 0 ? Math.round((p.nominal / total) * 1000) / 10 : 0;
			return `${PAYMENT_LABELS[method] || method}: Rp ${formatRupiah(p.nominal)} (${share}%)`;
		});
}

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
	// Monitoring stok nonaktif: jangan kirim saldo basi sebagai fakta terkini ke model.
	const policy = await loadStockPolicy(rawDb, branchContext(normalizeBranch(requestedBranch)));
	const stockMonitoringPaused = policy.mode === 'ignored';
	// Seluruh fakta finansial (ringkasan, bulanan, harian, pembayaran,
	// produk) berasal dari sumber kanonik yang sama dengan laporan: ringkasan
	// POS harian + produk harian (bertahan setelah arsip), buku_kas manual aktif,
	// dan ringkasan kas arsip manual. Gagal sumber merambat sebagai error.
	const branchId = branchContext(normalizeBranch(requestedBranch));
	// Eksekusi semua kueri agregasi secara paralel dalam 1 batch Promise
	const [
		canonicalFacts,
		hourRes,
		stokKritisRes,
		totalBahanRes,
		marginProdukRes,
		seleraGulaRes,
		seleraEsRes,
		sesiSummaryRes,
		latestSesiRes,
		canonicalAggregate,
		archiveCoverageRes
	] = await Promise.all([
		// 1. fakta harian/pembayaran/produk kanonik (aktif + arsip),
		// pemilik aturan tunggal di reportQueries.
		buildCanonicalFacts(rawDb, branchId, startYmd, endYmd),

		// 2. Pola Jam Ramai (Top 3) — butuh detail transaksi aktif.
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

		// 10. Stok Bahan Kritis (stok <= ambang_stok)
		(stockMonitoringPaused
			? Promise.resolve({ results: [] })
			: rawDb
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
					.catch(() => ({ results: [] }))) as Promise<{
			results?: Array<{
				nama: string;
				stok: number;
				ambang: number;
				satuan: string;
			}>;
		}>,

		// 11. Total Persediaan Bahan Baku
		(stockMonitoringPaused
			? Promise.resolve(null)
			: rawDb
					.prepare(
						`SELECT
					COUNT(*) AS totalItem,
					COALESCE(SUM(stok_saat_ini * biaya_per_satuan), 0) AS totalAsetStok
				FROM bahan
				WHERE cabang_id = ? AND is_active = 1`
					)
					.bind(requestedBranch)
					.first()
					.catch(() => null)) as Promise<{ totalItem?: number; totalAsetStok?: number } | null>,

		// 12. HPP & Margin Laba Kotor per Menu
		(stockMonitoringPaused
			? Promise.resolve({ results: [] })
			: rawDb
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
					AND COUNT(*) = COUNT(NULLIF(tk.snapshot_hpp, ''))
					AND COUNT(*) = COUNT(tk.nominal_hpp)
				ORDER BY marginPersen DESC
				LIMIT 10`
					)
					.bind(requestedBranch, startYmd, endYmd)
					.all()
					.catch(() => ({ results: [] }))) as Promise<{
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

		// 16. sesi terkini DALAM periode WITA yang diminta
		// (semantik bukaan sama dengan ringkasan shift; shift lintas
		// tengah malam ikut periode bukanya). Di luar periode = tak ada
		// sesiTerakhir (diexclude), bukan sesi live hari ini.
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
					AND substr(datetime(waktu_buka, '+8 hours'), 1, 10) >= ?
					AND substr(datetime(waktu_buka, '+8 hours'), 1, 10) <= ?
				ORDER BY waktu_buka DESC
				LIMIT 1`
			)
			.bind(requestedBranch, startYmd, endYmd)
			.first()
			.catch(() => null) as Promise<{
			id?: string;
			waktuBuka?: string;
			waktuTutup?: string | null;
			kasAwal?: number;
			isActive?: number;
		} | null>,

		// 17. agregat kanonik (aktif + arsip) sebagai otoritas inti.
		buildLaporanAggregate(rawDb, branchId, startYmd, endYmd),

		// 18. batas arsip selesai. Rincian jam/margin/selera butuh detail
		// item yang tidak tersisa di tabel aktif setelah arsip.
		rawDb
			.prepare(
				`SELECT MAX(before_year) AS beforeYear
				 FROM archive_jobs
				 WHERE cabang_id = ? AND status = 'completed'`
			)
			.bind(branchId)
			.first()
			// Hanya anotasi cakupan, bukan angka uang: gagal baca = tanpa catatan.
			.catch(() => null) as Promise<{ beforeYear?: number | null } | null>
	]);

	// Format stok bahan & bahan kritis
	const stokBahan = {
		totalItem: stockMonitoringPaused ? 0 : totalBahanRes?.totalItem || 0,
		totalAsetStok: stockMonitoringPaused ? 0 : Math.round(totalBahanRes?.totalAsetStok || 0),
		bahanKritis: stockMonitoringPaused
			? []
			: (stokKritisRes?.results || []).map((b) => ({
					nama: b.nama,
					stok: b.stok,
					ambang: b.ambang,
					satuan: b.satuan
				})),
		monitoringPaused: stockMonitoringPaused
	};

	// Format HPP & margin produk
	const marginProduk = (marginProdukRes?.results || []).map((m) => ({
		nama: m.nama,
		omzet: Math.round(m.omzet),
		hpp: Math.round(m.hpp),
		labaKotor: Math.round(m.labaKotor),
		marginPersen: m.marginPersen
	}));

	// Format selera konsumen (gula & es)
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

	// Format ringkasan sesi / shift toko
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

	// HasData + inti finansial dari agregat kanonik
	// (aktif + arsip). Arsip saja tetap terbaca; gagal sumber
	// merambat sebagai error (kanonik tanpa catch), bukan NO_DATA.
	const totalRecords = canonicalAggregate.transactions.length;
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

	const pendapatan = canonicalAggregate.summary.pendapatan;
	const pengeluaran = canonicalAggregate.summary.pengeluaran;
	const labaKotor = pendapatan - pengeluaran;

	// Pajak + laba bersih dari mesin kanonik (omzet usaha,
	// YTD before, segmentasi tahun pajak). Duplikasi lokal bermasalah
	// (semua income + YTD=0) dihapus; config dibaca kanonik (fail-closed sama).
	const pajak = canonicalAggregate.summary.pajak;
	const labaBersih = canonicalAggregate.summary.labaBersih;

	const dailyFacts = canonicalFacts.daily.map((d) => ({
		tanggal: d.tanggal,
		pemasukan: Number(d.pemasukan) || 0,
		pengeluaran: Number(d.pengeluaran) || 0,
		transaksi: Number(d.transaksi) || 0
	}));
	// Transaksi penjualan: POS + pemasukan usaha manual (modal/lainnya tidak dihitung).
	const totalTransaksi = dailyFacts.reduce((sum, d) => sum + d.transaksi, 0);

	// Pembayaran per bulan dan keseluruhan, metode dinormalisasi
	// ke bucket laporan (tunai / non-tunai / lainnya). POS dari ringkasan harian.
	const monthlyPaymentsMap: Record<string, Record<string, { nominal: number }>> = {};
	const pembayaran: Record<string, { nominal: number }> = {};
	const addPayment = (bulan: string, metode: string, value: unknown) => {
		const nominal = Number(value) || 0;
		if (nominal === 0) return;
		const month = (monthlyPaymentsMap[bulan] ??= {});
		month[metode] = { nominal: (month[metode]?.nominal ?? 0) + nominal };
		pembayaran[metode] = { nominal: (pembayaran[metode]?.nominal ?? 0) + nominal };
	};
	for (const d of canonicalFacts.daily) {
		addPayment(d.tanggal.slice(0, 7), 'tunai', d.posTunai);
		addPayment(d.tanggal.slice(0, 7), 'non-tunai', d.posNonTunai);
	}
	for (const row of canonicalFacts.manualPayments) {
		addPayment(row.bulan, paymentBucket(row.metode), row.nominal);
	}

	// Produk per bulan dan keseluruhan, varian ukuran digabung
	// seperti laporan kanonik.
	type ProductFact = { id: string; nama: string; totalTerjual: number; totalPendapatan: number };
	const addProduct = (map: Map<string, ProductFact>, nama: string, qty: number, gross: number) => {
		const current = map.get(nama) ?? { id: nama, nama, totalTerjual: 0, totalPendapatan: 0 };
		current.totalTerjual += qty;
		current.totalPendapatan += gross;
		map.set(nama, current);
	};
	const byTerjual = (a: ProductFact, b: ProductFact) =>
		b.totalTerjual - a.totalTerjual || b.totalPendapatan - a.totalPendapatan;
	const monthlyProducts = new Map<string, Map<string, ProductFact>>();
	const periodProducts = new Map<string, ProductFact>();
	for (const row of canonicalFacts.products) {
		const nama = canonicalProductName(row.nama);
		const qty = Number(row.totalTerjual) || 0;
		const gross = Number(row.totalPendapatan) || 0;
		if (!monthlyProducts.has(row.bulan)) monthlyProducts.set(row.bulan, new Map());
		addProduct(monthlyProducts.get(row.bulan)!, nama, qty, gross);
		addProduct(periodProducts, nama, qty, gross);
	}

	// Format data bulanan
	const monthlyTotals = new Map<
		string,
		{ pemasukan: number; pengeluaran: number; transaksi: number }
	>();
	for (const d of dailyFacts) {
		const bulan = d.tanggal.slice(0, 7);
		const current = monthlyTotals.get(bulan) ?? { pemasukan: 0, pengeluaran: 0, transaksi: 0 };
		current.pemasukan += d.pemasukan;
		current.pengeluaran += d.pengeluaran;
		current.transaksi += d.transaksi;
		monthlyTotals.set(bulan, current);
	}
	const requestedMonthlyData: FormattedMonth[] = [...monthlyTotals.entries()].map(([bulan, m]) => {
		const [year, month] = bulan.split('-');
		const dateObj = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
		const monthName = dateObj.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
		return {
			month: bulan,
			monthName,
			pemasukan: m.pemasukan,
			pengeluaran: m.pengeluaran,
			laba: m.pemasukan - m.pengeluaran,
			transaksi: m.transaksi,
			paymentMethods: monthlyPaymentsMap[bulan] || {},
			topProducts: [...(monthlyProducts.get(bulan)?.values() ?? [])].sort(byTerjual).slice(0, 3)
		};
	});

	// Format performa harian & statistik (hari dengan pemasukan).
	const dailyList = dailyFacts
		.filter((d) => d.pemasukan > 0 || d.transaksi > 0)
		.map((d) => {
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
				count: d.transaksi,
				revenue: d.pemasukan,
				avgTicket: d.transaksi > 0 ? d.pemasukan / d.transaksi : 0
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

	// Format jam ramai
	const jamRamai = (hourRes?.results || []).map((h) => `${h.jam}:00 (${h.jumlah} trx)`);

	// Format produk terlaris
	const produkTerlaris = [...periodProducts.values()].sort(byTerjual).slice(0, 10);

	// Rentang yang menyentuh data terarsip — rincian berbasis detail
	// item hanya mencakup transaksi yang belum diarsipkan.
	const beforeYear = Number(archiveCoverageRes?.beforeYear);
	const arsipSebelum =
		Number.isInteger(beforeYear) && startYmd < `${beforeYear}-01-01`
			? `${beforeYear}-01-01`
			: undefined;

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
		sesiToko,
		...(arsipSebelum ? { rincianDetailAktifSaja: { arsipSebelum } } : {})
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
	const stockMonitoringPaused = serverReportData.stokBahan?.monitoringPaused === true;

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
${stockMonitoringPaused ? '- Selisih pendapatan dan pengeluaran tercatat' : '- Laba Kotor'}: Rp ${formatRupiah(serverReportData.summary?.labaKotor) || '0'}
- Pajak: Rp ${formatRupiah(serverReportData.summary?.pajak) || '0'}
${stockMonitoringPaused ? '- Selisih tercatat setelah pajak (bukan laba bersih aktual)' : '- Laba Bersih'}: Rp ${formatRupiah(serverReportData.summary?.labaBersih) || '0'}
- Total Transaksi: ${serverReportData.summary?.totalTransaksi || '0'}

PENTING: Analisis hanya metrik yang tersedia. Data biaya yang tidak tercatat bukan biaya nol; selisih tercatat tidak membuktikan profitabilitas aktual.

=== DATA PER BULAN UNTUK PERIODE YANG DIMINTA ===
${
	(serverReportData.summary?.requestedMonthlyData || [])
		.map(
			(month) => `
Bulan ${month.monthName} (${month.month}):
- Pendapatan: Rp ${formatRupiah(month.pemasukan)}
- Pengeluaran: Rp ${formatRupiah(month.pengeluaran)}
${stockMonitoringPaused ? '- Selisih tercatat' : '- Laba'}: Rp ${formatRupiah(month.laba)}
- Total Transaksi: ${month.transaksi}
- Metode Pembayaran: ${formatPayments(month.paymentMethods).join(', ') || '-'}
- Top 3 Produk Terlaris: ${month.topProducts.map((p) => `${p.nama} (${p.totalTerjual} terjual, Rp ${formatRupiah(p.totalPendapatan)})`).join(', ')}
`
		)
		.join('\n') || '- (tidak ada data per bulan)'
}

=== RINCIAN PEMBAYARAN ===
${
	formatPayments(serverReportData.pembayaran || {})
		.map((line) => `- ${line}`)
		.join('\n') || '- (tidak ada)'
}

${
	serverReportData.rincianDetailAktifSaja
		? `CATATAN CAKUPAN: transaksi sebelum ${serverReportData.rincianDetailAktifSaja.arsipSebelum} sudah diarsipkan. Ringkasan, data bulanan, harian, pembayaran, dan produk terlaris sudah mencakup arsip; jam ramai, margin HPP per menu, selera konsumen, dan rata-rata omzet per shift hanya dari transaksi yang belum diarsipkan.
`
		: ''
}=== POLA WAKTU ===
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
${
	serverReportData.stokBahan?.monitoringPaused
		? 'Monitoring stok sedang dijeda untuk cabang ini. Jangan klaim saldo stok atau status aman/kritis. Data stok sistem bukan kondisi terkini.'
		: `Total Item Bahan Aktif: ${serverReportData.stokBahan?.totalItem || 0} bahan
Total Nilai Aset Stok Bahan: Rp ${formatRupiah(serverReportData.stokBahan?.totalAsetStok || 0)}
Bahan Kritis (Stok <= Ambang Batas / Butuh Restok Segera):
${(serverReportData.stokBahan?.bahanKritis || []).map((b, i) => `- ${i + 1}. ${b.nama}: Sisa ${b.stok} ${b.satuan} (Ambang batas: ${b.ambang} ${b.satuan})`).join('\n') || '- (Semua stok bahan aman di atas ambang batas)'}`
}

=== HPP & MARGIN KEUNTUNGAN MENU ===
${
	stockMonitoringPaused
		? 'HPP dan margin tidak tersedia untuk analisis karena monitoring stok nonaktif. Jangan menghitung atau menyimpulkan margin, profitabilitas menu, maupun laba aktual. Fokus pada omzet, pengeluaran tercatat, volume penjualan, dan tren.'
		: `Menu dengan snapshot HPP lengkap pada seluruh transaksi menu dalam periode (maksimal 10):
${(serverReportData.marginProduk || []).map((m, i) => `- ${i + 1}. ${m.nama}: Margin ${m.marginPersen}% • Omzet Rp ${formatRupiah(m.omzet)} • HPP Rp ${formatRupiah(m.hpp)} • Laba Kotor Rp ${formatRupiah(m.labaKotor)}`).join('\n') || '- (Data HPP transaksi belum tercatat lengkap; margin tidak dapat disimpulkan)'}`
}

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
