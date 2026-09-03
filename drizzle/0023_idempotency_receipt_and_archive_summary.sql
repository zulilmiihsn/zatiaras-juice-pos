ALTER TABLE `buku_kas` ADD `request_fingerprint` text;
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD `receipt_snapshot` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ringkasan_kas_arsip_harian` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`archive_id` text NOT NULL,
	`tanggal_wita` text NOT NULL,
	`tipe` text NOT NULL,
	`jenis` text NOT NULL,
	`metode_bayar` text,
	`jumlah_transaksi` integer DEFAULT 0 NOT NULL,
	`total_nominal` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ringkasan_kas_arsip_branch_tanggal` ON `ringkasan_kas_arsip_harian` (`cabang_id`, `tanggal_wita`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ringkasan_kas_arsip_archive` ON `ringkasan_kas_arsip_harian` (`archive_id`);
