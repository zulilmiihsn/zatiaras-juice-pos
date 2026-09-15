-- F05: job/lease/manifest arsip khusus. Ganti string lock tanpa pemilik.
-- Status: claimed -> uploading -> finalizing -> completed | failed | orphan.
-- Unique guard: satu job aktif per cabang+tahun. Lease expiry + owner token
-- mencegah worker lama menghapus lock worker baru.
CREATE TABLE IF NOT EXISTS `archive_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`before_year` integer NOT NULL,
	`cutoff` text NOT NULL,
	`status` text NOT NULL,
	`owner_token` text NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`object_key` text,
	`checksum` text,
	`counts` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_archive_jobs_branch_year_active` ON `archive_jobs` (`cabang_id`, `before_year`) WHERE `status` IN ('claimed', 'uploading', 'finalizing');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_archive_jobs_branch_status` ON `archive_jobs` (`cabang_id`, `status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `archive_job_items` (
	`job_id` text NOT NULL,
	`cabang_id` text NOT NULL,
	`buku_kas_id` text NOT NULL,
	`transaction_id` text,
	`revision` integer NOT NULL DEFAULT 0,
	PRIMARY KEY (`job_id`, `buku_kas_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_archive_job_items_job` ON `archive_job_items` (`job_id`);
