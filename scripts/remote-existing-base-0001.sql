CREATE UNIQUE INDEX IF NOT EXISTS `idx_buku_kas_branch_idempotency` ON `buku_kas` (`branch_id`,`idempotency_key`);
--> statement-breakpoint
ALTER TABLE `produk` ADD COLUMN `track_stock` integer DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_auth_sessions_expires` ON `auth_sessions` (`expires_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_auth_sessions_user` ON `auth_sessions` (`branch_id`,`user_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_produk_track_stock_nonnegative`
BEFORE UPDATE OF `stok` ON `produk`
WHEN NEW.track_stock = 1 AND COALESCE(NEW.stok, 0) < 0
BEGIN
	SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`actor_user_id` text,
	`actor_username` text,
	`actor_role` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`transaction_id` text,
	`amount` real,
	`metadata` text,
	`ip_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_logs_branch_created` ON `audit_logs` (`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_logs_branch_action` ON `audit_logs` (`branch_id`,`action`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_logs_branch_transaction` ON `audit_logs` (`branch_id`,`transaction_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`identifier` text NOT NULL,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rate_limits_branch_identifier` ON `rate_limits` (`branch_id`,`identifier`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_rate_limits_reset` ON `rate_limits` (`reset_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `error_events` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`status` integer,
	`context` text,
	`user_id` text,
	`role` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_error_events_branch_created` ON `error_events` (`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_error_events_branch_source` ON `error_events` (`branch_id`,`source`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `request_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` real NOT NULL,
	`user_id` text,
	`role` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_metrics_branch_created` ON `request_metrics` (`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_request_metrics_branch_path` ON `request_metrics` (`branch_id`,`path`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `d1_backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`database_name` text NOT NULL,
	`operation` text NOT NULL,
	`status` text NOT NULL,
	`file_path` text,
	`file_size_bytes` integer,
	`message` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_d1_backup_runs_branch_started` ON `d1_backup_runs` (`branch_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_d1_backup_runs_db_started` ON `d1_backup_runs` (`database_name`,`started_at`);
