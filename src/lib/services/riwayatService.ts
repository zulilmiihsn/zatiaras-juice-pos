/**
 * Service data Riwayat transaksi harian (DRY) — dipakai oleh riwayat umum/kasir/pemilik.
 * Mengganti `fetchTransaksiHariIni`/`todayRange` yang sebelumnya diduplikasi di 3 file.
 *
 * Murni data: tidak menyentuh state komponen (loading/toast). Caller yang bungkus
 * loading + try/catch + notifikasi. Lihat CONVENTIONS.md §3.
 */
import { getTodayWita, rentangHariWitaUtc } from '$lib/utils/dateTime';
import { transactionService } from '$lib/services/transactionService';
import type { BukuKasRecord, HistoryItem } from '$lib/types/laporan';

/** Preset rentang Riwayat. Default 'hari-ini' = perilaku lama. */
export type RentangRiwayat = 'hari-ini' | '7-hari';

/**
 * Rentang UTC untuk preset, dalam zona WITA. Murni bila todayYmd diisi
 * (untuk tes deterministik); default tanggal WITA saat ini.
 * Definisi "7 hari" sama dengan tab Selesai Antrean: hari ini + 6 hari ke belakang.
 */
export function rentangRiwayatUtc(
	rentang: RentangRiwayat = 'hari-ini',
	todayYmd: string = getTodayWita()
): { startUtc: string; endUtc: string } {
	return rentangHariWitaUtc(rentang === '7-hari' ? 7 : 1, todayYmd);
}

export interface RiwayatFilter {
	searchKeyword?: string;
	/** 'all' | 'qris' | 'tunai' — string longgar karena state komponen bertipe string. */
	filterPayment?: string;
	rentang?: RentangRiwayat;
}

/**
 * Ambil transaksi hari ini dari `buku_kas`, map ke HistoryItem, urut terbaru dulu,
 * filter nominal > 0, lalu terapkan filter pencarian & metode bayar.
 * Throw bila fetch gagal (caller yang menangani).
 */
export async function fetchTransaksiHariIni(filter: RiwayatFilter = {}): Promise<HistoryItem[]> {
	const { searchKeyword = '', filterPayment = 'all', rentang = 'hari-ini' } = filter;
	const { startUtc: start, endUtc: end } = rentangRiwayatUtc(rentang);

	const data = (await transactionService.getRows('buku_kas', {
		start,
		end
	})) as unknown as BukuKasRecord[];

	let result: HistoryItem[] = (data ?? []).map((t: BukuKasRecord) => ({
		id: t.id,
		// [CATATAN]: Utamakan ref_transaksi_kasir_id (untuk cetak ulang/delete POS), fallback transaction_id
		transaction_id: t.ref_transaksi_kasir_id || t.transaction_id,
		nomor_harian: t.nomor_harian ?? null,
		tanggal_nomor: t.tanggal_nomor ?? null,
		idempotency_key: t.idempotency_key,
		waktu: t.waktu || t.created_at,
		nama: t.deskripsi || t.nama_pelanggan || t.nama || '-',
		nominal: t.nominal || 0,
		tipe: t.tipe || (t as unknown as Record<string, string>).type,
		sumber: t.sumber || 'catat',
		metode_bayar: t.metode_bayar || 'tunai',
		nama_pelanggan: t.nama_pelanggan || ''
	}));

	// [CATATAN]: Urutkan terbaru dulu
	result.sort((a, b) => new Date(b.waktu).getTime() - new Date(a.waktu).getTime());

	// [CATATAN]: Hanya nominal > 0
	result = result.filter((t) => t.nominal > 0);

	// [CATATAN]: Filter pencarian (nama atau nomor antrean harian, mis. "42")
	const keyword = searchKeyword.trim().toLowerCase();
	if (keyword) {
		const nomorKeyword = /^\d{1,4}$/.test(keyword) ? Number(keyword) : null;
		result = result.filter(
			(t) =>
				t.nama?.toLowerCase().includes(keyword) ||
				(nomorKeyword !== null && t.nomor_harian === nomorKeyword)
		);
	}

	// [CATATAN]: Filter metode bayar
	if (filterPayment !== 'all') {
		result = result.filter((t) => {
			if (filterPayment === 'qris')
				return t.metode_bayar === 'qris' || t.metode_bayar === 'non-tunai';
			if (filterPayment === 'tunai') return t.metode_bayar === 'tunai';
			return true;
		});
	}

	return result;
}

function toHistoryItem(t: BukuKasRecord): HistoryItem {
	return {
		id: t.id,
		// [CATATAN]: Utamakan ref_transaksi_kasir_id (untuk cetak ulang/delete POS), fallback transaction_id
		transaction_id: t.ref_transaksi_kasir_id || t.transaction_id,
		nomor_harian: t.nomor_harian ?? null,
		tanggal_nomor: t.tanggal_nomor ?? null,
		idempotency_key: t.idempotency_key,
		waktu: t.waktu || t.created_at,
		nama: t.deskripsi || t.nama_pelanggan || t.nama || '-',
		nominal: t.nominal || 0,
		tipe: t.tipe || (t as unknown as Record<string, string>).type,
		sumber: t.sumber || 'catat',
		metode_bayar: t.metode_bayar || 'tunai',
		nama_pelanggan: t.nama_pelanggan || ''
	};
}

export interface RiwayatPage {
	items: HistoryItem[];
	nextCursor: string | null;
	hasMore: boolean;
}

/**
 * Riwayat halaman hari ini, terbaru dulu (waktu DESC, id DESC).
 * Filter tanggal/search/payment diterapkan SEBELUM limit di server,
 * sehingga pencarian menemukan transaksi di luar halaman pertama.
 */
export async function fetchTransaksiHariIniPage(
	filter: RiwayatFilter = {},
	cursor: string | null = null,
	limit = 50
): Promise<RiwayatPage> {
	const { searchKeyword = '', filterPayment = 'all', rentang = 'hari-ini' } = filter;
	const { startUtc: start, endUtc: end } = rentangRiwayatUtc(rentang);
	const params: Record<string, string> = {
		start,
		end,
		direction: 'desc',
		limit: String(limit)
	};
	if (searchKeyword.trim()) params.search = searchKeyword.trim();
	if (filterPayment !== 'all') params.metode = filterPayment === 'qris' ? 'qris' : 'tunai';

	const page = await transactionService.getRowsPage('buku_kas', params, cursor);
	const items = ((page.data ?? []) as unknown as BukuKasRecord[])
		.map(toHistoryItem)
		.filter((t) => t.nominal > 0);
	return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
}
