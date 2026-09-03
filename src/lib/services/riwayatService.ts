/**
 * Service data Riwayat transaksi harian (DRY) — dipakai oleh riwayat umum/kasir/pemilik.
 * Mengganti `fetchTransaksiHariIni`/`todayRange` yang sebelumnya diduplikasi di 3 file.
 *
 * Murni data: tidak menyentuh state komponen (loading/toast). Caller yang bungkus
 * loading + try/catch + notifikasi. Lihat CONVENTIONS.md §3.
 */
import { witaToUtcRange, getTodayWita } from '$lib/utils/dateTime';
import { transactionService } from '$lib/services/transactionService';
import type { BukuKasRecord, HistoryItem } from '$lib/types/laporan';

/** Rentang UTC untuk "hari ini" dalam zona WITA. */
function todayRange() {
	const todayWita = getTodayWita(); // format YYYY-MM-DD
	return witaToUtcRange(todayWita);
}

export interface RiwayatFilter {
	searchKeyword?: string;
	/** 'all' | 'qris' | 'tunai' — string longgar karena state komponen bertipe string. */
	filterPayment?: string;
}

/**
 * Ambil transaksi hari ini dari `buku_kas`, map ke HistoryItem, urut terbaru dulu,
 * filter nominal > 0, lalu terapkan filter pencarian & metode bayar.
 * Throw bila fetch gagal (caller yang menangani).
 */
export async function fetchTransaksiHariIni(filter: RiwayatFilter = {}): Promise<HistoryItem[]> {
	const { searchKeyword = '', filterPayment = 'all' } = filter;
	const { startUtc: start, endUtc: end } = todayRange();

	const data = (await transactionService.getRows('buku_kas', {
		start,
		end
	})) as unknown as BukuKasRecord[];

	let result: HistoryItem[] = (data ?? []).map((t: BukuKasRecord) => ({
		id: t.id,
		// [CATATAN]: Utamakan ref_transaksi_kasir_id (untuk cetak ulang/delete POS), fallback transaction_id
		transaction_id: t.ref_transaksi_kasir_id || t.transaction_id,
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

	// [CATATAN]: Filter pencarian (nama)
	const keyword = searchKeyword.trim().toLowerCase();
	if (keyword) {
		result = result.filter((t) => t.nama?.toLowerCase().includes(keyword));
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
