-- F01: Selaraskan pengaturan dengan kode: ID TEXT, bedakan row utama (kunci IS NULL) vs key/value.
-- Operator: backup tiap shard dulu. Cek schema aktual:
--   SELECT sql FROM sqlite_master WHERE name='pengaturan';
-- Jika kolom fisik `pajak_config` ada berisi data, konversi manual ke row kunci='pajak_config'/nilai
-- sebelum apply; migrasi ini rebuild tanpa kolom phantom tersebut (kode pakai kunci/nilai).
-- ID numerik lama dipertahankan via CAST(id AS TEXT): 910001 menjadi '910001', bukan UUID baru.
CREATE TABLE `__new_pengaturan` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`kunci` text,
	`nilai` text,
	`pin` text,
	`pin_hash` text,
	`halaman_terkunci` text DEFAULT '[]',
	`nama_toko` text,
	`alamat` text,
	`telepon` text,
	`instagram` text,
	`ucapan` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
INSERT INTO `__new_pengaturan` (
	`id`, `cabang_id`, `kunci`, `nilai`, `pin`, `pin_hash`,
	`halaman_terkunci`, `nama_toko`, `alamat`, `telepon`,
	`instagram`, `ucapan`, `created_at`, `updated_at`
)
SELECT
	CAST(`id` AS TEXT),
	`cabang_id`,
	`kunci`,
	`nilai`,
	CASE WHEN `pin` = '1234' THEN NULL ELSE `pin` END,
	`pin_hash`,
	`halaman_terkunci`,
	`nama_toko`,
	`alamat`,
	`telepon`,
	`instagram`,
	`ucapan`,
	`created_at`,
	`updated_at`
FROM `pengaturan`;
--> statement-breakpoint
DROP TABLE `pengaturan`;
--> statement-breakpoint
ALTER TABLE `__new_pengaturan` RENAME TO `pengaturan`;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pengaturan_branch` ON `pengaturan` (`cabang_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pengaturan_branch_kunci` ON `pengaturan` (`cabang_id`, `kunci`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pengaturan_branch_main` ON `pengaturan` (`cabang_id`) WHERE `kunci` IS NULL;
