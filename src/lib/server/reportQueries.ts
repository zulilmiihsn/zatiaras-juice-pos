import type { BranchId } from '$lib/server/branchResolver';
import type { D1Database } from '@cloudflare/workers-types';

export type LaporanAggregate = {
	summary: {
		pendapatan: number;
		pengeluaran: number;
		saldo: number;
		labaKotor: number;
		pajak: number;
		labaBersih: number;
	};
	pemasukanUsaha: Array<Record<string, any>>;
	pemasukanLain: Array<Record<string, any>>;
	bebanUsaha: Array<Record<string, any>>;
	bebanLain: Array<Record<string, any>>;
	transactions: Array<Record<string, any>>;
};

/**
 * Menyusun laporan ter-agregasi untuk rentang tanggal WITA dari tabel harian
 * (daily_sales_summary + daily_product_sales) + entri manual buku_kas.
 *
 * Tidak men-scan transaksi_kasir atau seluruh buku_kas: baca dibatasi oleh
 * (hari x produk), bukan volume transaksi. POS direpresentasikan sebagai baris
 * ringkas per (produk x metode); entri manual diteruskan apa adanya. Bentuk
 * keluaran identik dengan getReportData lama agar UI tidak perlu berubah.
 *
 * `startDate`/`endDate` adalah tanggal WITA 'YYYY-MM-DD'.
 */
export async function buildLaporanAggregate(
	rawDb: D1Database,
	branch: BranchId,
	startDate: string,
	endDate: string
): Promise<LaporanAggregate> {
	const summaryRow = (await rawDb
		.prepare(
			`SELECT COALESCE(SUM(penjualan_kotor),0) AS gross
			 FROM ringkasan_penjualan_harian
			 WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?`
		)
		.bind(branch, startDate, endDate)
		.first()) as { gross?: number } | null;

	const productRows =
		(
			(await rawDb
				.prepare(
					`SELECT nama_produk,
					COALESCE(SUM(penjualan_tunai),0) AS cash,
					COALESCE(SUM(penjualan_nontunai),0) AS non_cash
				 FROM penjualan_produk_harian
				 WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?
				 GROUP BY nama_produk`
				)
				.bind(branch, startDate, endDate)
				.all()) as {
				results?: Array<{ nama_produk?: string; cash?: number; non_cash?: number }>;
			}
		).results || [];

	const manualRows =
		(
			(await rawDb
				.prepare(
					`SELECT id, transaction_id, waktu, sumber, tipe, jenis, nominal,
					deskripsi, metode_bayar, nama_pelanggan
				 FROM buku_kas
				 WHERE cabang_id = ?
					AND (sumber IS NULL OR sumber != 'pos')
					AND date(datetime(waktu, '+8 hours')) >= ?
					AND date(datetime(waktu, '+8 hours')) <= ?
				 ORDER BY waktu DESC`
				)
				.bind(branch, startDate, endDate)
				.all()) as {
				results?: Array<Record<string, any>>;
			}
		).results || [];

	const archivedManualRows =
		(
			(await rawDb
				.prepare(
					`SELECT id, archive_id, tanggal_wita, tipe, jenis, metode_bayar,
					jumlah_transaksi, total_nominal
				 FROM ringkasan_kas_arsip_harian
				 WHERE cabang_id = ?
					AND tanggal_wita >= ?
					AND tanggal_wita <= ?
				 ORDER BY tanggal_wita DESC`
				)
				.bind(branch, startDate, endDate)
				.all()
				.catch(() => ({ results: [] }))) as {
				results?: Array<Record<string, any>>;
			}
		).results || [];

	const transactions: Array<Record<string, any>> = [];
	const groupedProducts = new Map<string, { cash: number; nonCash: number }>();
	for (const p of productRows) {
		const name = String(p.nama_produk || 'Item')
			.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '')
			.trim();
		const current = groupedProducts.get(name) || { cash: 0, nonCash: 0 };
		current.cash += Number(p.cash || 0);
		current.nonCash += Number(p.non_cash || 0);
		groupedProducts.set(name, current);
	}
	for (const [name, p] of groupedProducts.entries()) {
		if (p.cash > 0) {
			transactions.push({
				id: `pos:${name}:tunai`,
				transaction_id: null,
				waktu: endDate,
				sumber: 'pos',
				tipe: 'in',
				jenis: 'pendapatan_usaha',
				nominal: p.cash,
				deskripsi: name,
				metode_bayar: 'tunai'
			});
		}
		if (p.nonCash > 0) {
			transactions.push({
				id: `pos:${name}:non-tunai`,
				transaction_id: null,
				waktu: endDate,
				sumber: 'pos',
				tipe: 'in',
				jenis: 'pendapatan_usaha',
				nominal: p.nonCash,
				deskripsi: name,
				metode_bayar: 'non-tunai'
			});
		}
	}

	let manualIncome = 0;
	let manualExpense = 0;
	for (const m of manualRows) {
		const value = Number(m.nominal) || 0;
		transactions.push({
			...m,
			sumber: m.sumber || 'catat',
			nominal: value,
			deskripsi: m.deskripsi || 'Transaksi Lainnya'
		});
		if (m.tipe === 'in') manualIncome += value;
		else if (m.tipe === 'out') manualExpense += value;
	}

	for (const a of archivedManualRows) {
		const value = Number(a.total_nominal) || 0;
		transactions.push({
			id: `arsip:${a.id}`,
			transaction_id: a.archive_id,
			waktu: `${a.tanggal_wita}T00:00:00.000Z`,
			sumber: 'arsip',
			tipe: a.tipe,
			jenis: a.jenis,
			nominal: value,
			deskripsi: `Arsip Kas (${a.jumlah_transaksi} transaksi)`,
			metode_bayar: a.metode_bayar || 'lainnya'
		});
		if (a.tipe === 'in') manualIncome += value;
		else if (a.tipe === 'out') manualExpense += value;
	}

	const posGross = Number(summaryRow?.gross || 0);
	const pemasukan = transactions.filter((t) => t.tipe === 'in');
	const pengeluaran = transactions.filter((t) => t.tipe === 'out');
	const pemasukanUsaha = pemasukan.filter((t) => t.jenis === 'pendapatan_usaha');
	const pemasukanLain = pemasukan.filter((t) => t.jenis === 'lainnya');
	const bebanUsaha = pengeluaran.filter((t) => t.jenis === 'beban_usaha');
	const bebanLain = pengeluaran.filter((t) => t.jenis === 'lainnya');

	const omzetUsaha =
		posGross + pemasukanUsaha.reduce((sum, t) => sum + (Number(t.nominal) || 0), 0);
	const totalPemasukan = posGross + manualIncome;
	const totalPengeluaran = manualExpense;
	const labaKotor = totalPemasukan - totalPengeluaran;

	// [CATATAN]: Perhitungan Pajak PP 55/2022 (Threshold Rp 500Jt Kumulatif Tahunan)
	const year = startDate.slice(0, 4);
	const yearStart = `${year}-01-01`;
	let cumulativeBefore = 0;

	if (startDate > yearStart) {
		const prevPos = (await rawDb
			.prepare(
				`SELECT COALESCE(SUM(penjualan_kotor),0) AS gross
				 FROM ringkasan_penjualan_harian
				 WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan < ?`
			)
			.bind(branch, yearStart, startDate)
			.first()
			.catch(() => ({ gross: 0 }))) as { gross?: number };

		const prevActive = (await rawDb
			.prepare(
				`SELECT COALESCE(SUM(nominal),0) AS total
				 FROM buku_kas
				 WHERE cabang_id = ? AND tipe = 'in' AND jenis = 'pendapatan_usaha'
					AND (sumber IS NULL OR sumber != 'pos')
					AND date(datetime(waktu, '+8 hours')) >= ? AND date(datetime(waktu, '+8 hours')) < ?`
			)
			.bind(branch, yearStart, startDate)
			.first()
			.catch(() => ({ total: 0 }))) as { total?: number };

		const prevArchived = (await rawDb
			.prepare(
				`SELECT COALESCE(SUM(total_nominal),0) AS total
				 FROM ringkasan_kas_arsip_harian
				 WHERE cabang_id = ? AND tipe = 'in' AND jenis = 'pendapatan_usaha'
					AND tanggal_wita >= ? AND tanggal_wita < ?`
			)
			.bind(branch, yearStart, startDate)
			.first()
			.catch(() => ({ total: 0 }))) as { total?: number };

		cumulativeBefore =
			Number(prevPos?.gross || 0) +
			Number(prevActive?.total || 0) +
			Number(prevArchived?.total || 0);
	}

	const cumulativeEnd = cumulativeBefore + omzetUsaha;
	let taxRate = 0.005;
	let taxEnabled = true;
	let taxThreshold = 500_000_000;
	let applyThreshold = false;
	try {
		const taxConfigRow = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`
			)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (taxConfigRow?.nilai) {
			const parsed = JSON.parse(taxConfigRow.nilai);
			if (parsed && typeof parsed === 'object') {
				if (parsed.enabled === false) taxEnabled = false;
				if (typeof parsed.rate === 'number') taxRate = parsed.rate;
				if (typeof parsed.threshold === 'number') taxThreshold = parsed.threshold;
				if (typeof parsed.apply_threshold === 'boolean') applyThreshold = parsed.apply_threshold;
			}
		}
	} catch {}

	let pajak = 0;
	if (taxEnabled) {
		if (applyThreshold) {
			const taxableTurnover = Math.min(
				omzetUsaha,
				Math.max(
					0,
					Math.max(0, cumulativeEnd - taxThreshold) - Math.max(0, cumulativeBefore - taxThreshold)
				)
			);
			pajak = taxableTurnover > 0 ? Math.round(taxableTurnover * taxRate) : 0;
		} else {
			pajak = Math.round(omzetUsaha * taxRate);
		}
	}

	return {
		summary: {
			pendapatan: totalPemasukan,
			pengeluaran: totalPengeluaran,
			saldo: labaKotor,
			labaKotor,
			pajak,
			labaBersih: labaKotor - pajak
		},
		pemasukanUsaha,
		pemasukanLain,
		bebanUsaha,
		bebanLain,
		transactions
	};
}
