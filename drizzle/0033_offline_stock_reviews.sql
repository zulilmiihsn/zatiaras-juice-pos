CREATE TABLE `offline_stock_reviews` (
	`cabang_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL CHECK (length(trim(`request_fingerprint`)) > 0),
	`queued_at` integer NOT NULL CHECK (`queued_at` >= 0),
	`policy_revision_at_queue` integer CHECK (`policy_revision_at_queue` IS NULL OR `policy_revision_at_queue` >= 0),
	`current_policy_revision` integer NOT NULL CHECK (`current_policy_revision` >= 0),
	`revision` integer NOT NULL DEFAULT 0 CHECK (`revision` >= 0),
	`status` text NOT NULL CHECK (`status` IN ('pending', 'attached_to_reconciliation', 'approved_current', 'approved_after_recount', 'consumed')),
	`resolution` text CHECK (`resolution` IS NULL OR `resolution` IN ('apply_current', 'after_recount')),
	`reconciliation_job_id` text,
	`approved_policy_revision` integer CHECK (`approved_policy_revision` IS NULL OR `approved_policy_revision` >= 0),
	`reviewed_by` text,
	`reviewed_at` text,
	`consumed_at` text,
	PRIMARY KEY (`cabang_id`, `idempotency_key`),
	CHECK ((`status` IN ('approved_current', 'approved_after_recount', 'consumed')) OR (`resolution` IS NULL AND `reconciliation_job_id` IS NULL AND `approved_policy_revision` IS NULL AND `reviewed_by` IS NULL AND `reviewed_at` IS NULL)),
	CHECK (`status` <> 'consumed' OR `consumed_at` IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_offline_stock_reviews_branch_status` ON `offline_stock_reviews` (`cabang_id`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_offline_stock_reviews_branch_job` ON `offline_stock_reviews` (`cabang_id`, `reconciliation_job_id`);
--> statement-breakpoint
CREATE TRIGGER `trg_offline_stock_review_transition_guard`
BEFORE UPDATE ON `offline_stock_reviews`
WHEN NEW.`cabang_id` IS NOT OLD.`cabang_id`
	OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`
	OR NEW.`request_fingerprint` IS NOT OLD.`request_fingerprint`
	OR NEW.`revision` <> OLD.`revision` + 1
	OR (OLD.`status` = 'pending' AND NEW.`status` NOT IN ('approved_current', 'attached_to_reconciliation'))
	OR (OLD.`status` = 'attached_to_reconciliation' AND NEW.`status` NOT IN ('approved_after_recount', 'pending'))
	OR (OLD.`status` = 'approved_current' AND NEW.`status` NOT IN ('consumed', 'pending'))
	OR (OLD.`status` = 'approved_after_recount' AND NEW.`status` <> 'consumed')
	OR (OLD.`status` = 'consumed')
BEGIN
	SELECT RAISE(ABORT, 'INVALID_OFFLINE_STOCK_REVIEW_TRANSITION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_offline_review_guard`
BEFORE INSERT ON `buku_kas`
WHEN NEW.`sumber` = 'pos' AND NEW.`restored_from_archive` = 0 AND NEW.`stock_replay_disposition` IN ('owner_approved_current', 'owner_approved_after_recount') AND NOT EXISTS (
	SELECT 1 FROM `offline_stock_reviews` r
	WHERE r.`cabang_id` = NEW.`cabang_id`
		AND r.`idempotency_key` = NEW.`idempotency_key`
		AND r.`request_fingerprint` = COALESCE(NEW.`request_fingerprint`, '')
		AND (
			(NEW.`stock_replay_disposition` = 'owner_approved_current' AND r.`status` = 'approved_current')
			OR (NEW.`stock_replay_disposition` = 'owner_approved_after_recount' AND r.`status` = 'approved_after_recount')
		)
		AND r.`approved_policy_revision` = NEW.`stock_policy_revision`
)
BEGIN
	SELECT RAISE(ABORT, 'STOCK_REVIEW_NOT_APPROVED');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_offline_review_consume`
AFTER INSERT ON `buku_kas`
WHEN NEW.`sumber` = 'pos' AND NEW.`restored_from_archive` = 0 AND NEW.`stock_replay_disposition` IN ('owner_approved_current', 'owner_approved_after_recount')
BEGIN
	UPDATE `offline_stock_reviews`
	SET `status` = 'consumed',
		`revision` = `revision` + 1,
		`consumed_at` = NEW.`created_at`
	WHERE `cabang_id` = NEW.`cabang_id`
		AND `idempotency_key` = NEW.`idempotency_key`
		AND `status` IN ('approved_current', 'approved_after_recount');
END;
