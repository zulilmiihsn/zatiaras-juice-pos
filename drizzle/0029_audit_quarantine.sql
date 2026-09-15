-- R09: karantina outbox audit. Row invalid/lolos-retry disimpan dengan alasan,
-- bukan dihapus diam-diam; worker hanya mengambil row retryable.
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
