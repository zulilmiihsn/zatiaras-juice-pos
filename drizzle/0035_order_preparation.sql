ALTER TABLE `buku_kas` ADD COLUMN `preparation_state` text CHECK (`preparation_state` IS NULL OR `preparation_state` IN ('pending', 'done'));
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `preparation_revision` integer NOT NULL DEFAULT 0 CHECK (`preparation_revision` >= 0);
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `preparation_completed_at` text;
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `preparation_completed_by` text;
--> statement-breakpoint
CREATE INDEX `idx_buku_kas_branch_preparation` ON `buku_kas` (`cabang_id`, `preparation_state`, `waktu`, `id`);
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_preparation_pair_guard`
BEFORE INSERT ON `buku_kas`
WHEN NOT (
	(NEW.`preparation_state` IS NULL AND NEW.`preparation_completed_at` IS NULL AND NEW.`preparation_completed_by` IS NULL)
	OR (NEW.`preparation_state` = 'pending' AND NEW.`preparation_completed_at` IS NULL AND NEW.`preparation_completed_by` IS NULL)
	OR (NEW.`preparation_state` = 'done' AND NEW.`preparation_completed_at` IS NOT NULL AND NEW.`preparation_completed_by` IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_PREPARATION_STATE');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_preparation_pair_update_guard`
BEFORE UPDATE OF `preparation_state`, `preparation_completed_at`, `preparation_completed_by` ON `buku_kas`
WHEN NOT (
	(NEW.`preparation_state` IS NULL AND NEW.`preparation_completed_at` IS NULL AND NEW.`preparation_completed_by` IS NULL)
	OR (NEW.`preparation_state` = 'pending' AND NEW.`preparation_completed_at` IS NULL AND NEW.`preparation_completed_by` IS NULL)
	OR (NEW.`preparation_state` = 'done' AND NEW.`preparation_completed_at` IS NOT NULL AND NEW.`preparation_completed_by` IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_PREPARATION_STATE');
END;
