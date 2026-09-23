-- Reconcile-prod-0030: one-off, BUKAN bagian rantai drizzle/.
--
-- Latar: database production dibangun di luar rantai migrasi (0/30 applied).
-- Menerapkan rantai penuh berbahaya (rename/drop/rebuild buta). File ini hanya
-- berisi operasi aditif + rebuild pengaturan yang preserving data.
--
-- Prasyarat: backup + drill lulus. Per shard, via:
--   wrangler d1 execute <SHARD> --remote --config wrangler.pages.jsonc \
--     --file scripts/reconcile-prod-0030.sql --yes
--
-- Idempoten kecuali 2x ALTER TABLE buku_kas: pastikan kolom revision /
-- mutation_token BELUM ada (PRAGMA table_info) atau comment 2 baris itu bila
-- retry sesudah sukses parsial. Kegagalan lain gagal keras (PK), bukan korup diam.
-- Verifikasi sesudah apply: pakai query di docs/OPERATOR-RUNBOOK.md §3.

-- 1. Tabel arsip (salinan 0027_archive_jobs).
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
-- Klaim per-cabang (salinan 0028, menggantikan varian per-cabang+tahun).
CREATE UNIQUE INDEX IF NOT EXISTS `idx_archive_jobs_branch_active` ON `archive_jobs` (`cabang_id`) WHERE `status` IN ('claimed', 'uploading', 'finalizing');
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
--> statement-breakpoint
-- 2. CAS ledger + void markers + trigger (salinan 0026_buku_kas_cas_void).
ALTER TABLE `buku_kas` ADD COLUMN `revision` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `mutation_token` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pos_void_markers` (
	`cabang_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`idempotency_key` text,
	`request_fingerprint` text,
	`actor` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`cabang_id`, `transaction_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_pos_void_markers_branch_key` ON `pos_void_markers` (`cabang_id`, `idempotency_key`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS `trg_buku_kas_block_void_replay`;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_block_void_replay`
BEFORE INSERT ON `buku_kas`
WHEN NEW.`sumber` = 'pos' AND (
	(NEW.`transaction_id` IS NOT NULL AND EXISTS (
		SELECT 1 FROM `pos_void_markers`
		WHERE `cabang_id` = NEW.`cabang_id` AND `transaction_id` = NEW.`transaction_id`
	)) OR (
		NEW.`idempotency_key` IS NOT NULL AND EXISTS (
			SELECT 1 FROM `pos_void_markers`
			WHERE `cabang_id` = NEW.`cabang_id` AND `idempotency_key` = NEW.`idempotency_key`
		)
	)
)
BEGIN
	SELECT RAISE(ABORT, 'TRANSACTION_VOIDED');
END;
--> statement-breakpoint
-- 3. Karantina outbox audit (salinan 0029_audit_quarantine).
CREATE TABLE IF NOT EXISTS `audit_log_quarantine` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text,
	`attempt_count` integer NOT NULL DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`quarantined_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_log_quarantine_branch` ON `audit_log_quarantine` (`cabang_id`);
--> statement-breakpoint
-- 4. pengaturan.id INTEGER -> TEXT (salinan 0025, preserving via CAST).
-- ID numerik lama menjadi string ('910001'); pin '1234' menjadi NULL (di prod
-- saat ini pin sudah NULL, jadi no-op). Aman diulang: CAST identitas untuk TEXT.
CREATE TABLE IF NOT EXISTS `__new_pengaturan` (
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
