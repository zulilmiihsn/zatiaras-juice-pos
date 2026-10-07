-- Username unik per cabang (AUD-015). Login/gantikeamanan trim username exact-match;
-- unique index menegakkan kontrak di DB, bukan hanya check-before-update di route.
-- Preflight sebelum apply: SELECT cabang_id, username, COUNT(*) FROM profil
-- GROUP BY cabang_id, username HAVING COUNT(*) > 1;
-- Bila ada duplikat legacy, rekonsiliasi (rename akun ganda) dahulu, lalu jalankan ulang.
-- Jangan hapus akun otomatis. Username sama pada cabang berbeda tetap diizinkan.
DROP INDEX IF EXISTS `idx_profil_branch_username`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_profil_branch_username` ON `profil` (`cabang_id`,`username`);
