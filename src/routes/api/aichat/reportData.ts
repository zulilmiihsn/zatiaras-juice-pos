import { formatRupiah } from '$lib/utils/currency';
import { bukuKas, transaksiKasir } from '$lib/database/schema';
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm';

type Db = ReturnType<typeof import('$lib/server/branchResolver').getDrizzleDb>;
type Row = Record<string, unknown>;
export const D1_REPORT_ID_CHUNK_SIZE = 99;

export function chunkReportIds(ids: string[], size = D1_REPORT_ID_CHUNK_SIZE): string[][] {
	if (!Number.isInteger(size) || size <= 0 || size > D1_REPORT_ID_CHUNK_SIZE) {
		throw new Error(`Ukuran chunk ID laporan harus 1-${D1_REPORT_ID_CHUNK_SIZE}`);
	}
	const chunks: string[][] = [];
	for (let index = 0; index < ids.length; index += size) {
		chunks.push(ids.slice(index, index + size));
	}
	return chunks;
}

// [CATATAN]: ── fetchReportData ────────────────────────────────────────────────────────
// [CATATAN]: Query buku_kas berpaginasi untuk rentang waktu, plus transaksi_kasir terkait POS.

async function fetchAllData(
	db: Db,
	requestedBranch: string,
	startDate: string,
	endDate: string,
	filters: Record<string, unknown>
): Promise<Row[]> {
	let allData: Row[] = [];
	let page = 0;
	const pageSize = 500; // Reduce page size untuk menghindari timeout
	let hasMore = true;
	const maxPages = 20; // Limit maksimal halaman untuk menghindari infinite loop

	while (hasMore && page < maxPages) {
		const conditions = [
			eq(bukuKas.cabang_id, requestedBranch),
			gte(bukuKas.waktu, startDate),
			lte(bukuKas.waktu, endDate)
		];
		if (filters.sumber) {
			conditions.push(eq(bukuKas.sumber, String(filters.sumber)));
		}
		if (filters.excludeSumber) {
			conditions.push(ne(bukuKas.sumber, String(filters.excludeSumber)));
		}

		const queryPromise = db
			.select()
			.from(bukuKas)
			.where(and(...conditions))
			.orderBy(asc(bukuKas.waktu))
			.limit(pageSize)
			.offset(page * pageSize);

		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => reject(new Error('Query timeout')), 30000);
		});

		let data: Row[];
		try {
			data = (await Promise.race([queryPromise, timeoutPromise])) as Row[];
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}

		if (data.length > 0) {
			allData = [...allData, ...data];

			// [CATATAN]: Jika data kurang dari pageSize, berarti sudah habis
			if (data.length < pageSize) {
				hasMore = false;
			} else {
				page++;
			}
		} else {
			hasMore = false;
		}
	}
	if (hasMore) {
		throw new Error(`Batas laporan ${maxPages * pageSize} baris terlampaui`);
	}
	return allData;
}

export interface ReportData {
	bukuKasPos: Row[];
	bukuKasManual: Row[];
	transaksiKasirData: Row[];
}

export async function fetchReportData(
	db: Db,
	requestedBranch: string,
	startDate: string,
	endDate: string
): Promise<ReportData> {
	// [CATATAN]: Ambil data untuk periode yang diminta dengan pagination
	const [bukuKasPos, bukuKasManual] = await Promise.all([
		fetchAllData(db, requestedBranch, startDate, endDate, { sumber: 'pos' }),
		fetchAllData(db, requestedBranch, startDate, endDate, { excludeSumber: 'pos' })
	]);

	// [CATATAN]: Ambil data transaksi_kasir dengan relasi produk untuk data POS
	const transaksiKasirData: Row[] = [];
	if (bukuKasPos && bukuKasPos.length > 0) {
		// [CATATAN]: Ambil buku_kas_id dari data POS
		const bukuKasIds = bukuKasPos
			.map((item: Row) => item.id)
			.filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
			.map(String);

		if (bukuKasIds.length > 0) {
			for (const idChunk of chunkReportIds(bukuKasIds)) {
				const rows = await db
					.select()
					.from(transaksiKasir)
					.where(
						and(
							eq(transaksiKasir.cabang_id, requestedBranch),
							inArray(transaksiKasir.buku_kas_id, idChunk)
						)
					);
				transaksiKasirData.push(...rows);
			}
		}
	}

	return { bukuKasPos, bukuKasManual, transaksiKasirData };
}

// [CATATAN]: ── aggregateMonthly ───────────────────────────────────────────────────────
// [CATATAN]: Agregasi pemasukan/pengeluaran/laba + payment methods + produk terlaris per bulan.

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

export function aggregateMonthly(laporan: Row[], transaksiKasirData: Row[]): FormattedMonth[] {
	// [CATATAN]: Hitung data per bulan untuk periode yang diminta (untuk analisis detail)
	const requestedMonthlyData: Record<
		string,
		{
			pemasukan: number;
			pengeluaran: number;
			laba: number;
			transaksi: number;
			produkTerlaris: Record<string, { jumlah: number; revenue: number; nama: string }>;
			paymentMethods: Record<string, { jumlah: number; nominal: number }>;
		}
	> = {};

	// [CATATAN]: Proses data periode yang diminta per bulan
	for (const item of laporan) {
		const date = new Date(item.waktu as string | number);
		const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

		if (!requestedMonthlyData[monthKey]) {
			requestedMonthlyData[monthKey] = {
				pemasukan: 0,
				pengeluaran: 0,
				laba: 0,
				transaksi: 0,
				produkTerlaris: {},
				paymentMethods: {}
			};
		}

		const amount = (item.nominal as number) || 0;
		if (item.tipe === 'in') {
			requestedMonthlyData[monthKey].pemasukan += amount;
		} else {
			requestedMonthlyData[monthKey].pengeluaran += amount;
		}
		requestedMonthlyData[monthKey].laba =
			requestedMonthlyData[monthKey].pemasukan - requestedMonthlyData[monthKey].pengeluaran;

		if (item.sumber === 'pos' && item.transaction_id) {
			requestedMonthlyData[monthKey].transaksi += 1;
		}

		// [CATATAN]: Hitung metode pembayaran per bulan
		const pm = (item.metode_bayar as string) || 'lainnya';
		if (!requestedMonthlyData[monthKey].paymentMethods[pm]) {
			requestedMonthlyData[monthKey].paymentMethods[pm] = { jumlah: 0, nominal: 0 };
		}
		requestedMonthlyData[monthKey].paymentMethods[pm].jumlah += 1;
		requestedMonthlyData[monthKey].paymentMethods[pm].nominal += amount;

		// [CATATAN]: Hitung produk terlaris per bulan - akan dihitung terpisah menggunakan transaksiKasirData
	}

	// [CATATAN]: Hitung produk terlaris per bulan menggunakan data transaksi_kasir
	for (const item of transaksiKasirData || []) {
		const date = new Date((item.created_at || item.waktu) as string | number);
		const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

		if (requestedMonthlyData[monthKey]) {
			const pid = item.produk_id as string;
			if (!pid) continue;
			const jumlah = Number(item.jumlah || 0) || 0;
			const satuan = Number(item.harga || item.amount || 0) || 0;
			const revenue = satuan * (jumlah || 1);
			const productName =
				((item.produk as Record<string, unknown>)?.nama as string) ||
				(item.nama_kustom as string) ||
				`Produk ${pid.slice(0, 8)}`;

			if (!requestedMonthlyData[monthKey].produkTerlaris[pid]) {
				requestedMonthlyData[monthKey].produkTerlaris[pid] = {
					jumlah: 0,
					revenue: 0,
					nama: productName
				};
			}
			requestedMonthlyData[monthKey].produkTerlaris[pid].jumlah += jumlah || 0;
			requestedMonthlyData[monthKey].produkTerlaris[pid].revenue += revenue;
		}
	}

	// [CATATAN]: Format data per bulan untuk AI
	return Object.entries(requestedMonthlyData)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([monthKey, data]) => {
			const date = new Date(monthKey + '-01');
			const monthName = date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
			const topProducts = Object.entries(data.produkTerlaris)
				.map(([pid, prod]) => ({
					id: pid,
					nama: prod.nama,
					totalTerjual: prod.jumlah,
					totalPendapatan: prod.revenue
				}))
				.sort((a, b) => b.totalTerjual - a.totalTerjual)
				.slice(0, 3);

			return {
				month: monthKey,
				monthName,
				pemasukan: data.pemasukan,
				pengeluaran: data.pengeluaran,
				laba: data.laba,
				transaksi: data.transaksi,
				paymentMethods: data.paymentMethods,
				topProducts
			};
		});
}

// [CATATAN]: ── computeAnalytics ───────────────────────────────────────────────────────
// [CATATAN]: Breakdown pembayaran, jam ramai, tren harian, statistik, best/worst day.

interface DailyPerformanceItem {
	date: string;
	formattedDate: string;
	count: number;
	revenue: number;
	avgTicket: number;
}

export interface ReportAnalytics {
	paymentBreakdown: Record<string, { jumlah: number; nominal: number }>;
	jamRamai: string[];
	dailyPerformance: DailyPerformanceItem[];
	avgTransactionsPerDay: number;
	avgRevenuePerDay: number;
	avgTicketSize: number;
	totalDays: number;
	bestDay: DailyPerformanceItem;
	worstDay: DailyPerformanceItem;
}

export function computeAnalytics(
	laporan: Row[],
	bukuKasPos: Row[],
	totalPemasukan: number
): ReportAnalytics {
	// [CATATAN]: Breakdown metode pembayaran & pola waktu
	const paymentBreakdown: Record<string, { jumlah: number; nominal: number }> = {};
	interface LaporanItem {
		metode_bayar?: string;
		amount?: number;
		nominal?: number;
	}
	for (const t of laporan) {
		const typedT = t as LaporanItem;
		const pm = typedT.metode_bayar || 'lainnya';
		if (!paymentBreakdown[pm]) paymentBreakdown[pm] = { jumlah: 0, nominal: 0 };
		paymentBreakdown[pm].jumlah += 1;
		paymentBreakdown[pm].nominal += typedT.amount || typedT.nominal || 0;
	}

	// [CATATAN]: Hitung jam ramai dari transaksi POS
	const hourCount: Record<string, number> = {};
	for (const t of bukuKasPos || []) {
		const waktu = new Date(t.waktu as string | number);
		const utcTimestamp = new Date(waktu);
		const h = utcTimestamp.getHours();
		const key = h.toString().padStart(2, '0');
		hourCount[key] = (hourCount[key] || 0) + 1;
	}
	const jamRamai = Object.entries(hourCount)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 3)
		.map(([h, c]) => `${h}:00 (${c} trx)`);

	// [CATATAN]: Analisis tren harian untuk insight lebih mendalam
	const dailyTrend: Record<string, { count: number; revenue: number; avgTicket: number }> = {};
	for (const t of bukuKasPos || []) {
		const waktu = new Date(t.waktu as string | number);
		const utcTimestamp = new Date(waktu);
		const dateKey = utcTimestamp.toISOString().split('T')[0];
		const revenue = (t.nominal as number) || 0;

		if (!dailyTrend[dateKey]) {
			dailyTrend[dateKey] = { count: 0, revenue: 0, avgTicket: 0 };
		}
		dailyTrend[dateKey].count += 1;
		dailyTrend[dateKey].revenue += revenue;
	}

	// [CATATAN]: Hitung rata-rata per transaksi
	Object.keys(dailyTrend).forEach((date) => {
		if (dailyTrend[date].count > 0) {
			dailyTrend[date].avgTicket = dailyTrend[date].revenue / dailyTrend[date].count;
		}
	});

	// [CATATAN]: Analisis performa harian
	const dailyPerformance = Object.entries(dailyTrend)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, data]) => ({
			date,
			formattedDate: new Date(date).toLocaleDateString('id-ID', {
				weekday: 'long',
				day: 'numeric',
				month: 'long'
			}),
			...data
		}));

	// [CATATAN]: Hitung statistik keseluruhan
	const totalDays = dailyPerformance.length;
	const avgTransactionsPerDay =
		totalDays > 0 ? dailyPerformance.reduce((sum, day) => sum + day.count, 0) / totalDays : 0;
	const avgRevenuePerDay =
		totalDays > 0 ? dailyPerformance.reduce((sum, day) => sum + day.revenue, 0) / totalDays : 0;
	const avgTicketSize =
		totalPemasukan > 0 && (bukuKasPos?.length || 0) > 0
			? totalPemasukan / (bukuKasPos?.length || 1)
			: 0;

	// [CATATAN]: Identifikasi hari terbaik dan terburuk
	const emptyDay: DailyPerformanceItem = {
		date: '',
		formattedDate: '',
		count: 0,
		revenue: 0,
		avgTicket: 0
	};
	const bestDay = dailyPerformance.reduce(
		(best, current) => (current.revenue > best.revenue ? current : best),
		dailyPerformance[0] || emptyDay
	);
	const worstDay = dailyPerformance.reduce(
		(worst, current) => (current.revenue < worst.revenue ? current : worst),
		dailyPerformance[0] || emptyDay
	);

	return {
		paymentBreakdown,
		jamRamai,
		dailyPerformance,
		avgTransactionsPerDay,
		avgRevenuePerDay,
		avgTicketSize,
		totalDays,
		bestDay,
		worstDay
	};
}

// [CATATAN]: ── buildReportContext ─────────────────────────────────────────────────────
// [CATATAN]: Rangkai string konteks laporan untuk prompt AI.

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
	products?: { nama: string }[];
	categories?: { nama: string }[];
	specificProduct?: { nama: string; harga: number; id: string } | null;
	produkTerlaris?: { nama: string; totalTerjual: number; totalPendapatan: number }[];
	analytics?: {
		avgTransactionsPerDay?: number;
		avgRevenuePerDay?: number;
		avgTicketSize?: number;
		totalDays?: number;
		bestDay?: {
			date: string;
			revenue: number;
			transactions: number;
			avgTicket: number;
		} | null;
		worstDay?: {
			date: string;
			revenue: number;
			transactions: number;
			avgTicket: number;
		} | null;
	};
	dailyPerformance?: {
		formattedDate: string;
		count: number;
		revenue: number;
		avgTicket: number;
	}[];
	[key: string]: unknown;
}

export function buildReportContext(
	serverReportData: ServerReportData,
	rangeContext: RangeContext
): string {
	return serverReportData
		? `
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

PENTING: Data di atas sudah sesuai dengan periode yang diminta user. Jika user bertanya "2 bulan terakhir", maka data di atas adalah data untuk 2 bulan terakhir. Jika user bertanya "5 hari pertama bulan ini", maka data di atas adalah data untuk 5 hari pertama bulan ini, bukan data bulan penuh. ANALISIS data yang tersedia, jangan katakan tidak ada data.

=== DATA PER BULAN UNTUK PERIODE YANG DIMINTA ===
${
	(serverReportData.summary?.requestedMonthlyData || [])
		.map(
			(month: {
				monthName: string;
				month: string;
				pemasukan: number;
				pengeluaran: number;
				laba: number;
				transaksi: number;
				paymentMethods: Record<string, { jumlah: number; nominal: number }>;
				topProducts: { nama: string; totalTerjual: number; totalPendapatan: number }[];
			}) => `
Bulan ${month.monthName} (${month.month}):
- Pendapatan: Rp ${formatRupiah(month.pemasukan)}
- Pengeluaran: Rp ${formatRupiah(month.pengeluaran)}
- Laba: Rp ${formatRupiah(month.laba)}
- Total Transaksi: ${month.transaksi}
- Metode Pembayaran: ${Object.entries(month.paymentMethods)
				.map(([method, data]: [string, { jumlah: number; nominal: number }]) => {
					const methodLabels: Record<string, string> = {
						tunai: 'Tunai (Cash)',
						qris: 'QRIS (Digital Payment)',
						lainnya: 'Lainnya'
					};
					const label = methodLabels[method] || method;
					return `${label}: ${data.jumlah} trx (Rp ${formatRupiah(data.nominal)})`;
				})
				.join(', ')}
- Top 3 Produk Terlaris: ${month.topProducts.map((p: { nama: string; totalTerjual: number; totalPendapatan: number }) => `${p.nama} (${p.totalTerjual} terjual, Rp ${formatRupiah(p.totalPendapatan)})`).join(', ')}
`
		)
		.join('\n') || '- (tidak ada data per bulan)'
}

=== RINCIAN PEMBAYARAN ===
${
	Object.entries(serverReportData.pembayaran || {})
		.map(([k, v]: [string, { jumlah: number; nominal: number }]) => {
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
${(serverReportData.jamRamai || []).map((s: string, i: number) => `- ${i + 1}. ${s}`).join('\n') || '- (tidak ada)'}

=== PRODUK & KATEGORI ===
Produk (sample): ${
				serverReportData.products
					?.slice(0, 5)
					.map((p: { nama: string }) => p.nama)
					.join(', ') || '-'
			}
Kategori (sample): ${
				serverReportData.categories
					?.slice(0, 5)
					.map((c: { nama: string }) => c.nama)
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
${(serverReportData.produkTerlaris || []).map((p: { nama: string; totalTerjual: number; totalPendapatan: number }, i: number) => `- ${i + 1}. ${p.nama} • ${p.totalTerjual} terjual • Rp ${formatRupiah(p.totalPendapatan)}`).join('\n') || '-'}

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
			(day: { formattedDate: string; count: number; revenue: number; avgTicket: number }) =>
				`- ${day.formattedDate}: ${day.count} trx, Rp ${formatRupiah(day.revenue)} (avg Rp ${formatRupiah(Math.round(day.avgTicket))})`
		)
		.join('\n') || '- (tidak ada data harian)'
}
		`
		: 'Tidak ada data laporan tersedia.';
}
