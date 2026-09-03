CREATE TABLE IF NOT EXISTS `audit_log_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempt_count` integer NOT NULL DEFAULT 0,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_log_outbox_branch_created`
	ON `audit_log_outbox` (`cabang_id`, `created_at`);