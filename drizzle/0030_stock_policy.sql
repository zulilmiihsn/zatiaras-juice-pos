CREATE TABLE IF NOT EXISTS `stock_policy` (
	`cabang_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL CHECK (`mode` IN ('tracked', 'ignored')),
	`revision` integer NOT NULL CHECK (`revision` >= 1),
	`disabled_at` text,
	`reconciled_at` text,
	`updated_at` text NOT NULL CHECK (length(trim(`updated_at`)) > 0),
	`updated_by` text NOT NULL CHECK (length(trim(`updated_by`)) > 0),
	`updated_by_role` text NOT NULL CHECK (length(trim(`updated_by_role`)) > 0),
	`reconciliation_job_id` text,
	CHECK (`mode` <> 'ignored' OR `disabled_at` IS NOT NULL),
	CHECK (`reconciliation_job_id` IS NULL OR `reconciled_at` IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stock_policy_transitions` (
	`cabang_id` text NOT NULL,
	`revision` integer NOT NULL CHECK (`revision` >= 1),
	`previous_revision` integer NOT NULL CHECK (`previous_revision` >= 0),
	`previous_mode` text NOT NULL CHECK (`previous_mode` IN ('tracked', 'ignored')),
	`mode` text NOT NULL CHECK (`mode` IN ('tracked', 'ignored')),
	`effective_at` text NOT NULL CHECK (length(trim(`effective_at`)) > 0),
	`disabled_at` text,
	`reconciled_at` text,
	`actor_user_id` text NOT NULL CHECK (length(trim(`actor_user_id`)) > 0),
	`actor_role` text NOT NULL CHECK (length(trim(`actor_role`)) > 0),
	`reconciliation_job_id` text,
	PRIMARY KEY (`cabang_id`, `revision`),
	CHECK (`revision` = `previous_revision` + 1),
	CHECK (`mode` <> 'ignored' OR `disabled_at` IS NOT NULL),
	CHECK (`reconciliation_job_id` IS NULL OR `reconciled_at` IS NOT NULL)
);
--> statement-breakpoint
CREATE TRIGGER `trg_stock_policy_insert_guard`
BEFORE INSERT ON `stock_policy`
WHEN NEW.`revision` <> 1 OR NEW.`mode` <> 'ignored'
BEGIN
	SELECT RAISE(ABORT, 'INVALID_STOCK_POLICY_INSERT');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_policy_update_guard`
BEFORE UPDATE ON `stock_policy`
WHEN NEW.`cabang_id` <> OLD.`cabang_id`
	OR NEW.`revision` <> OLD.`revision` + 1
	OR NEW.`mode` = OLD.`mode`
	OR (NEW.`mode` = 'tracked' AND (NEW.`reconciled_at` IS NULL OR NEW.`reconciliation_job_id` IS NULL))
BEGIN
	SELECT RAISE(ABORT, 'INVALID_STOCK_POLICY_TRANSITION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_policy_transition_insert`
AFTER INSERT ON `stock_policy`
BEGIN
	INSERT INTO `stock_policy_transitions` (
		`cabang_id`, `revision`, `previous_revision`, `previous_mode`, `mode`,
		`effective_at`, `disabled_at`, `reconciled_at`, `actor_user_id`, `actor_role`,
		`reconciliation_job_id`
	) VALUES (
		NEW.`cabang_id`, NEW.`revision`, 0, 'tracked', NEW.`mode`,
		NEW.`updated_at`, NEW.`disabled_at`, NEW.`reconciled_at`, NEW.`updated_by`,
		NEW.`updated_by_role`, NEW.`reconciliation_job_id`
	);
END;
--> statement-breakpoint
CREATE TRIGGER `trg_stock_policy_transition_update`
AFTER UPDATE ON `stock_policy`
BEGIN
	INSERT INTO `stock_policy_transitions` (
		`cabang_id`, `revision`, `previous_revision`, `previous_mode`, `mode`,
		`effective_at`, `disabled_at`, `reconciled_at`, `actor_user_id`, `actor_role`,
		`reconciliation_job_id`
	) VALUES (
		NEW.`cabang_id`, NEW.`revision`, OLD.`revision`, OLD.`mode`, NEW.`mode`,
		NEW.`updated_at`, NEW.`disabled_at`, NEW.`reconciled_at`, NEW.`updated_by`,
		NEW.`updated_by_role`, NEW.`reconciliation_job_id`
	);
END;
