/**
 * 🏪 STORE & SESSION TYPE DEFINITIONS
 *
 * Tipe-tipe untuk state management dan session toko.
 */

// ============================================================================
// [CATATAN]: 🏬 TOKO SESSION
// ============================================================================

/**
 * Representasi sesi toko aktif dari tabel `sesi_toko`.
 * Digunakan di dashboard (buka/tutup toko) dan POS.
 */
export interface TokoSession {
	id: string;
	kas_awal: number;
	waktu_buka: string;
	waktu_tutup?: string;
	is_active: boolean;
}

/**
 * Ringkasan untuk modal tutup toko.
 */
export interface TutupTokoSummary {
	modalAwal: number;
	totalPenjualan: number;
	pemasukanTunai: number;
	pengeluaranTunai: number;
	uangKasir: number;
}

// ============================================================================
// [CATATAN]: 🔐 SECURITY SETTINGS
// ============================================================================

export interface SecuritySettingsData {
	pin: string;
	halaman_terkunci: string[];
}
