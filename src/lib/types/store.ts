/**
 * 🏪 STORE & SESSION TYPE DEFINITIONS
 *
 * Tipe-tipe untuk state management dan session toko.
 */

// ============================================================================
// 🏬 TOKO SESSION
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
