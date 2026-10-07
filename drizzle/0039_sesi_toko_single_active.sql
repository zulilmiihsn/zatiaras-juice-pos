-- Satu sesi aktif per cabang (AUD-010). Partial unique sebagai pertahanan kedua;
-- transisi buka atomik di layanan (INSERT ... WHERE NOT EXISTS).
-- Preflight sebelum apply: SELECT cabang_id, COUNT(*) FROM sesi_toko
-- WHERE is_active = 1 GROUP BY cabang_id HAVING COUNT(*) > 1;
-- Bila ada duplikat, migrasi ini gagal aman: rekonsiliasi (tutup sesi ganda)
-- dahulu, lalu jalankan ulang. Jangan hapus sesi otomatis.
CREATE UNIQUE INDEX idx_sesi_toko_branch_single_active ON sesi_toko(cabang_id) WHERE is_active = 1;
