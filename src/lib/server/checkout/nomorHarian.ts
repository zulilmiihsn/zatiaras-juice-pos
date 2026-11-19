import type { D1Database } from '@cloudflare/workers-types';
import type { BranchId } from '$lib/server/branchResolver';

/**
 * Nomor antrean harian POS — satu-satunya sumber alokasi.
 *
 * Kontrak:
 * - Kunci (cabang_id, tanggal WITA): nomor mulai 1 setiap tanggal baru.
 * - Alokasi satu statement atomik (upsert + RETURNING) sehingga dua kasir
 *   yang membayar bersamaan tidak pernah menerima nomor yang sama.
 * - Dipanggil SETELAH seluruh validasi, tepat sebelum batch commit, agar
 *   nomor tidak terbuang untuk request yang pasti ditolak.
 * - Nomor yang terlanjur dialokasi tetapi batch-nya gagal (konflik stok,
 *   race idempotency, dsb) menjadi gap dan TIDAK dipakai ulang — sama
 *   seperti nomor transaksi void. Ini disengaja agar tidak ada dua
 *   transaksi berbeda yang pernah memakai nomor sama.
 */
export async function allocateNomorHarian(
	db: D1Database,
	branch: BranchId,
	tanggalWita: string
): Promise<number> {
	const row = (await db
		.prepare(
			`INSERT INTO pos_nomor_harian (cabang_id, tanggal, terakhir)
			 SELECT ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id = ?)
			 ON CONFLICT(cabang_id, tanggal) DO UPDATE SET terakhir = terakhir + 1
			 RETURNING terakhir`
		)
		.bind(branch, tanggalWita, branch)
		.first()) as { terakhir?: number | null } | null;
	const nomor = Number(row?.terakhir);
	if (!Number.isInteger(nomor) || nomor < 1) {
		throw new Error(`Alokasi nomor harian gagal untuk ${branch}/${tanggalWita}`);
	}
	return nomor;
}
