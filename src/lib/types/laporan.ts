/**
 * 📊 LAPORAN (REPORT) TYPE DEFINITIONS
 *
 * Tipe-tipe untuk halaman laporan keuangan dan buku kas.
 */

// ============================================================================
// [CATATAN]: 📒 BUKU KAS RECORD
// ============================================================================

/**
 * Representasi satu baris dari tabel `buku_kas`.
 * Digunakan di laporan, riwayat, dan kalkulasi keuangan.
 */
export interface BukuKasRecord {
	id: string;
	tipe: 'in' | 'out';
	jenis: 'pendapatan_usaha' | 'beban_usaha' | 'lainnya';
	nominal: number;
	catatan?: string;
	deskripsi?: string; // Alias legacy
	metode_bayar: 'tunai' | 'non-tunai' | 'qris';
	sumber?: 'pos' | 'manual' | 'catat';
	waktu?: string;
	created_at: string;
	transaction_date?: string;
	id_sesi_toko?: string;
	cabang_id?: string;
	user_id?: string;
	// [CATATAN]: Fields dari join transaksi_kasir
	ref_transaksi_kasir_id?: string;
	nama_produk?: string;
	produk_detail?: string;
	transaction_id?: string;
	nama?: string;
	nama_pelanggan?: string;
}

/**
 * Satu baris transaksi pada halaman Riwayat (turunan ringkas dari `buku_kas`).
 * Dipakai bersama oleh riwayat umum/kasir/pemilik + util cetak struk.
 */
export interface HistoryItem {
	id: string;
	transaction_id?: string;
	waktu: string;
	nama: string;
	nominal: number;
	tipe: string;
	sumber: string;
	metode_bayar: string;
	nama_pelanggan: string;
}

// ============================================================================
// [CATATAN]: 📈 LAPORAN SUMMARY
// ============================================================================

/**
 * Ringkasan keuangan yang ditampilkan di summary cards laporan.
 */
export interface LaporanSummary {
	pendapatan: number | null;
	pengeluaran: number | null;
	saldo: number | null;
	labaKotor: number | null;
	pajak: number | null;
	labaBersih: number | null;
	taxBreakdown?: Array<{
		nama: string;
		persentase: number;
		nominal: number;
	}>;
	taxLabel?: string;
}

// ============================================================================
// [CATATAN]: 🧾 RECEIPT SETTINGS
// ============================================================================

/**
 * Pengaturan struk/receipt dari tabel `pengaturan_struk`.
 */
export interface ReceiptSettings {
	id?: string;
	nama_toko: string;
	alamat_toko?: string;
	alamat?: string; // Alias from `pengaturan` table
	no_telp?: string;
	telepon?: string; // Alias from `pengaturan` table
	instagram?: string;
	ucapan?: string;
	catatan_bawah?: string;
	show_logo?: boolean;
	logo_url?: string;
	show_alamat?: boolean;
	show_telp?: boolean;
	show_tanggal?: boolean;
	show_kasir?: boolean;
	show_catatan?: boolean;
	paper_size?: 'thermal58' | 'thermal80' | 'a4';
}

// ============================================================================
// [CATATAN]: 📊 REPORT FILTER
// ============================================================================

export type FilterType = 'harian' | 'mingguan' | 'bulanan' | 'tahunan';

export interface ReportDateRange {
	startDate: string;
	endDate: string;
}

// ============================================================================
// [CATATAN]: 💹 DASHBOARD STATS
// ============================================================================

export interface TopUsedIngredient {
	id: string;
	nama: string;
	satuan: string;
	terpakai: number;
	stok_saat_ini: number;
	ambang_stok: number;
	is_low: boolean;
}

export interface DashboardStats {
	omzet: number;
	jumlahTransaksi: number;
	profit: number;
	itemTerjual: number;
	totalItem: number;
	avgTransaksi: number;
	jamRamai: string;
	penjualanTunai?: number;
	penjualanNonTunai?: number;
	lowStockCount?: number;
	lowStockNames?: string[];
	topIngredients?: TopUsedIngredient[];
}

export interface WeeklyIncomeData {
	weeklyIncome: number[];
	weeklyMax: number;
}

export interface BestSeller {
	nama: string;
	image?: string;
	total_qty: number;
}
