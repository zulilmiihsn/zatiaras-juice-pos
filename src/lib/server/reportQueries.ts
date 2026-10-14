import type { BranchId, BranchContext } from '$lib/server/branchResolver';
import type { D1Database } from '@cloudflare/workers-types';
import { getRawDb } from '$lib/server/dataApiHelpers';
import {
	TAX_CONTRACT_VERSION,
	calculateEngineTax,
	legacyToSettings,
	validateTaxSettings
} from '$lib/tax/engine';
import type { TaxSettings } from '$lib/types/pajak';

function taxLabelFor(settings: TaxSettings): string {
	if (!settings.isTaxEnabled) return 'Pajak Dinonaktifkan (0%)';
	const active = settings.taxes.filter((t) => t.isEnabled && t.persentase > 0);
	if (active.length === 0) return 'Tidak Ada Pajak Aktif (0%)';
	if (active.length === 1) return `${active[0].nama} (${active[0].persentase}%)`;
	const sum = active.reduce((s, t) => s + t.persentase, 0);
	return `Total Pajak ${sum}% (${active.map((t) => `${t.nama.split('(')[0].trim()} ${t.persentase}%`).join(', ')})`;
}

export type LaporanAggregate = {
	summary: {
		pendapatan: number;
		pengeluaran: number;
		saldo: number;
		labaKotor: number;
		pajak: number;
		labaBersih: number;
	};
	pemasukanUsaha: Array<Record<string, unknown>>;
	pemasukanLain: Array<Record<string, unknown>>;
	bebanUsaha: Array<Record<string, unknown>>;
	bebanLain: Array<Record<string, unknown>>;
	transactions: Array<Record<string, unknown>>;
	taxContext?: {
		contract: number;
		revision: number;
		omzetUsaha: number;
		ytdBefore: number;
		ytdEnd: number;
		perTahun: Array<{ tahun: string; omzet: number; pajak: number }>;
		breakdowns: Array<{ nama: string; persentase: number; nominal: number }>;
		label: string;
	};
};

/** Nama produk laporan: varian ukuran digabung (laporan, dashboard, konteks AI). */
export function canonicalProductName(name: unknown, fallback = 'Item'): string {
	return String(name || fallback)
		.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '')
		.trim();
}

// Aturan kanonik tunggal: baris buku_kas manual (bukan POS) dan tanggal WITA-nya.
// POS dibaca dari ringkasan harian, yang bertahan setelah transaksi diarsipkan.
const MANUAL_ROW = "(sumber IS NULL OR sumber != 'pos')";
const MANUAL_WITA_DATE = "date(datetime(waktu, '+8 hours'))";

export interface CanonicalFacts {
	/** Per hari: transaksi = POS + pemasukan usaha manual (aktif + arsip). */
	daily: Array<{
		tanggal: string;
		pemasukan: number;
		pengeluaran: number;
		transaksi: number;
		posTunai: number;
		posNonTunai: number;
	}>;
	/** Pemasukan manual (aktif + arsip) per bulan x metode bayar mentah. */
	manualPayments: Array<{ bulan: string; metode: string | null; nominal: number }>;
	/** Produk POS per bulan x nama mentah (aktif + terarsip). */
	products: Array<{ bulan: string; nama: string; totalTerjual: number; totalPendapatan: number }>;
}

/**
 * Fakta rincian (harian, pembayaran, produk) dari sumber yang sama dengan
 * buildLaporanAggregate. Gagal sumber merambat sebagai error.
 */
export async function buildCanonicalFacts(
	rawDb: D1Database,
	branch: BranchId,
	startDate: string,
	endDate: string
): Promise<CanonicalFacts> {
	const range = [branch, startDate, endDate];
	const [daily, payments, products] = await Promise.all([
		rawDb
			.prepare(
				`SELECT tanggal,
					COALESCE(SUM(pemasukan), 0) AS pemasukan,
					COALESCE(SUM(pengeluaran), 0) AS pengeluaran,
					COALESCE(SUM(transaksi), 0) AS transaksi,
					COALESCE(SUM(pos_tunai), 0) AS posTunai,
					COALESCE(SUM(pos_nontunai), 0) AS posNonTunai
				FROM (
					SELECT tanggal_penjualan AS tanggal, penjualan_kotor AS pemasukan, 0 AS pengeluaran,
						jumlah_transaksi AS transaksi, penjualan_tunai AS pos_tunai,
						penjualan_nontunai AS pos_nontunai
					FROM ringkasan_penjualan_harian
					WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?
					UNION ALL
					SELECT ${MANUAL_WITA_DATE},
						CASE WHEN tipe = 'in' THEN nominal ELSE 0 END,
						CASE WHEN tipe = 'out' THEN nominal ELSE 0 END,
						CASE WHEN tipe = 'in' AND jenis = 'pendapatan_usaha' THEN 1 ELSE 0 END,
						0, 0
					FROM buku_kas
					WHERE cabang_id = ? AND ${MANUAL_ROW}
						AND ${MANUAL_WITA_DATE} >= ? AND ${MANUAL_WITA_DATE} <= ?
					UNION ALL
					SELECT tanggal_wita,
						CASE WHEN tipe = 'in' THEN total_nominal ELSE 0 END,
						CASE WHEN tipe = 'out' THEN total_nominal ELSE 0 END,
						CASE WHEN tipe = 'in' AND jenis = 'pendapatan_usaha' THEN jumlah_transaksi ELSE 0 END,
						0, 0
					FROM ringkasan_kas_arsip_harian
					WHERE cabang_id = ? AND tanggal_wita >= ? AND tanggal_wita <= ?
				)
				GROUP BY tanggal
				ORDER BY tanggal ASC`
			)
			.bind(...range, ...range, ...range)
			.all() as Promise<{ results?: CanonicalFacts['daily'] }>,
		rawDb
			.prepare(
				`SELECT substr(tanggal, 1, 7) AS bulan, metode, COALESCE(SUM(nominal), 0) AS nominal
				FROM (
					SELECT ${MANUAL_WITA_DATE} AS tanggal, metode_bayar AS metode, nominal
					FROM buku_kas
					WHERE cabang_id = ? AND ${MANUAL_ROW} AND tipe = 'in'
						AND ${MANUAL_WITA_DATE} >= ? AND ${MANUAL_WITA_DATE} <= ?
					UNION ALL
					SELECT tanggal_wita, metode_bayar, total_nominal
					FROM ringkasan_kas_arsip_harian
					WHERE cabang_id = ? AND tipe = 'in' AND tanggal_wita >= ? AND tanggal_wita <= ?
				)
				GROUP BY 1, 2`
			)
			.bind(...range, ...range)
			.all() as Promise<{ results?: CanonicalFacts['manualPayments'] }>,
		rawDb
			.prepare(
				`SELECT substr(tanggal_penjualan, 1, 7) AS bulan, nama_produk AS nama,
					COALESCE(SUM(jumlah), 0) AS totalTerjual,
					COALESCE(SUM(penjualan_kotor), 0) AS totalPendapatan
				FROM penjualan_produk_harian
				WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?
				GROUP BY 1, 2`
			)
			.bind(...range)
			.all() as Promise<{ results?: CanonicalFacts['products'] }>
	]);
	return {
		daily: daily.results || [],
		manualPayments: payments.results || [],
		products: products.results || []
	};
}

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
					AND ${MANUAL_ROW}
					AND ${MANUAL_WITA_DATE} >= ?
					AND ${MANUAL_WITA_DATE} <= ?
				 ORDER BY waktu DESC`
				)
				.bind(branch, startDate, endDate)
				.all()) as {
				results?: Array<Record<string, unknown>>;
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
				.all()) as {
				results?: Array<Record<string, unknown>>;
			}
		).results || [];

	const transactions: Array<Record<string, unknown>> = [];
	const groupedProducts = new Map<string, { cash: number; nonCash: number }>();
	for (const p of productRows) {
		const name = canonicalProductName(p.nama_produk);
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
	// F12: pemasukanUsaha sudah mencakup baris POS (sumber pos dari agregat
	// produk). Jangan tambah posGross ke seluruhnya tanpa kecuali POS.
	const manualUsaha = pemasukan.filter((t) => t.jenis === 'pendapatan_usaha' && t.sumber !== 'pos');
	const pemasukanUsaha = pemasukan.filter((t) => t.jenis === 'pendapatan_usaha');
	const pemasukanLain = pemasukan.filter((t) => t.jenis === 'lainnya');
	const bebanUsaha = pengeluaran.filter((t) => t.jenis === 'beban_usaha');
	const bebanLain = pengeluaran.filter((t) => t.jenis === 'lainnya');

	const omzetUsaha = posGross + manualUsaha.reduce((sum, t) => sum + (Number(t.nominal) || 0), 0);
	const totalPemasukan = posGross + manualIncome;
	const totalPengeluaran = manualExpense;
	const labaKotor = totalPemasukan - totalPengeluaran;

	// Pajak via mesin kanonik + config persisted (v2 atau legacy).
	// Omzet usaha = POS + manual usaha aktif + arsip manual (F12, tanpa ganda).
	// Rentang lintas tahun dipecah per tahun pajak; threshold reset tiap Januari.
	async function turnoverBetween(from: string, to: string): Promise<number> {
		if (from > to) return 0;
		// Query WAJIB: gagal dibaca -> propagasikan error, jangan tampilkan 0 palsu.
		const [p, m, a] = await Promise.all([
			rawDb
				.prepare(
					`SELECT COALESCE(SUM(penjualan_kotor),0) AS gross
					 FROM ringkasan_penjualan_harian
					 WHERE cabang_id = ? AND tanggal_penjualan >= ? AND tanggal_penjualan <= ?`
				)
				.bind(branch, from, to)
				.first() as Promise<{ gross?: number }>,
			rawDb
				.prepare(
					`SELECT COALESCE(SUM(nominal),0) AS total
					 FROM buku_kas
					 WHERE cabang_id = ? AND tipe = 'in' AND jenis = 'pendapatan_usaha'
						AND ${MANUAL_ROW}
						AND ${MANUAL_WITA_DATE} >= ? AND ${MANUAL_WITA_DATE} <= ?`
				)
				.bind(branch, from, to)
				.first() as Promise<{ total?: number }>,
			rawDb
				.prepare(
					`SELECT COALESCE(SUM(total_nominal),0) AS total
					 FROM ringkasan_kas_arsip_harian
					 WHERE cabang_id = ? AND tipe = 'in' AND jenis = 'pendapatan_usaha'
						AND tanggal_wita >= ? AND tanggal_wita <= ?`
				)
				.bind(branch, from, to)
				.first() as Promise<{ total?: number }>
		]);
		return Number(p?.gross || 0) + Number(m?.total || 0) + Number(a?.total || 0);
	}

	let persistedSettings = legacyToSettings(null);
	let taxRevision = 0;
	try {
		const taxConfigRow = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`
			)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (taxConfigRow?.nilai) {
			const parsed = JSON.parse(taxConfigRow.nilai) as {
				schema_version?: number;
				revision?: number;
				settings?: unknown;
				enabled?: boolean;
				rate?: number;
			};
			if (parsed && typeof parsed === 'object' && parsed.schema_version === 2 && parsed.settings) {
				const v = validateTaxSettings(parsed.settings);
				if (v.ok) {
					persistedSettings = parsed.settings as typeof persistedSettings;
					taxRevision = Number(parsed.revision || 0);
				}
			} else if (parsed && typeof parsed === 'object') {
				persistedSettings = legacyToSettings(parsed);
			}
		}
	} catch (cause) {
		throw new Error(
			'Konfigurasi pajak tersimpan tidak valid. Laporan pajak ditahan agar tarif tidak keliru.',
			{ cause }
		);
	}

	const startYear = Number(startDate.slice(0, 4));
	const endYear = Number(endDate.slice(0, 4));
	const perTahun: Array<{ tahun: string; omzet: number; pajak: number }> = [];
	const breakdownTotal = new Map<string, { nama: string; persentase: number; nominal: number }>();
	let pajak = 0;
	let ytdBeforeFirst = 0;
	let ytdEndLast = 0;
	for (let y = startYear; y <= endYear; y++) {
		const segStart = y === startYear ? startDate : `${y}-01-01`;
		const segEnd = y === endYear ? endDate : `${y}-12-31`;
		const segTurnover = await turnoverBetween(segStart, segEnd);
		// YTD sebelum segmen = omzet 1 Jan s/d sehari sebelum segmen (reset tiap Januari).
		const ytdBefore =
			segStart <= `${y}-01-01` ? 0 : await turnoverBetween(`${y}-01-01`, prevDay(segStart));
		const res = calculateEngineTax({
			settings: persistedSettings,
			periodTurnover: segTurnover,
			periodGrossProfit: 0,
			ytdTurnoverBefore: ytdBefore
		});
		pajak += res.totalPajak;
		for (const b of res.breakdowns) {
			const cur = breakdownTotal.get(b.id) ?? {
				nama: b.nama,
				persentase: b.persentase,
				nominal: 0
			};
			cur.nominal += b.nominalPajak;
			breakdownTotal.set(b.id, cur);
		}
		perTahun.push({ tahun: String(y), omzet: segTurnover, pajak: res.totalPajak });
		if (y === startYear) ytdBeforeFirst = ytdBefore;
		ytdEndLast = Math.max(segTurnover, ytdBefore + segTurnover);
	}

	function prevDay(ymd: string): string {
		const d = new Date(`${ymd}T00:00:00Z`);
		d.setUTCDate(d.getUTCDate() - 1);
		return d.toISOString().slice(0, 10);
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
		transactions,
		taxContext: {
			contract: TAX_CONTRACT_VERSION,
			revision: taxRevision,
			omzetUsaha,
			ytdBefore: ytdBeforeFirst,
			ytdEnd: ytdEndLast,
			perTahun,
			breakdowns: [...breakdownTotal.values()],
			label: taxLabelFor(persistedSettings)
		}
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function buildLaporanAggregateForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	startDate: string,
	endDate: string
): Promise<LaporanAggregate> {
	return buildLaporanAggregate(getRawDb(platform, branch), branch, startDate, endDate);
}
