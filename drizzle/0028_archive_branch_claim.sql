-- R02: satu klaim arsip aktif per cabang (bukan per cabang+tahun).
-- Cutoff berbeda dapat mengambil row yang sama; eksklusi per cabang mencegah
-- dua job bersamaan menggandakan summary untuk row yang tumpang tindih.
DROP INDEX IF EXISTS `idx_archive_jobs_branch_year_active`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_archive_jobs_branch_active` ON `archive_jobs` (`cabang_id`) WHERE `status` IN ('claimed', 'uploading', 'finalizing');
