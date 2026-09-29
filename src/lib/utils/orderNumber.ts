/**
 * Nomor antrean harian POS: 001-999 per cabang per tanggal WITA, reset tiap
 * tanggal baru. Di atas 999 lanjut 1000+ (tidak memblokir penjualan).
 * Alokasi atomik di server (pos_nomor_harian); fungsi ini hanya format tampil.
 */
export function formatNomorHarian(nomor: number | null | undefined): string | null {
	if (nomor == null) return null;
	const n = Number(nomor);
	if (!Number.isInteger(n) || n < 1) return null;
	return String(n).padStart(3, '0');
}
