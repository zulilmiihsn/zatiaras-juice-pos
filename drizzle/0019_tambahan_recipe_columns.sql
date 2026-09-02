ALTER TABLE `tambahan` ADD COLUMN `bahan_id` text;--> statement-breakpoint
ALTER TABLE `tambahan` ADD COLUMN `jumlah_bahan` real;--> statement-breakpoint
ALTER TABLE `tambahan` ADD COLUMN `satuan_resep` text;--> statement-breakpoint
ALTER TABLE `tambahan` ADD COLUMN `jumlah_dasar_per_item` real;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tambahan_branch_bahan` ON `tambahan` (`cabang_id`, `bahan_id`);
