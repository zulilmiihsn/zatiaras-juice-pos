CREATE TABLE `__new_pengaturan` (
	`id` integer PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
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
	`id`, `cabang_id`, `pin`, `pin_hash`, `halaman_terkunci`, `nama_toko`,
	`alamat`, `telepon`, `instagram`, `ucapan`, `created_at`, `updated_at`
)
SELECT
	`id`,
	`cabang_id`,
	CASE WHEN `pin` = '1234' THEN NULL ELSE `pin` END,
	NULL,
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
CREATE INDEX `idx_pengaturan_branch` ON `pengaturan` (`cabang_id`);
