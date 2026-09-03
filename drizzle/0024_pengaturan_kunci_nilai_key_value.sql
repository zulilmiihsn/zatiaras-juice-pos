ALTER TABLE `pengaturan` ADD `kunci` text;
--> statement-breakpoint
ALTER TABLE `pengaturan` ADD `nilai` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_pengaturan_branch_kunci` ON `pengaturan` (`cabang_id`, `kunci`);
