CREATE TABLE IF NOT EXISTS `stock_feature_rollout` (
	`feature` text PRIMARY KEY NOT NULL,
	`branches` text NOT NULL DEFAULT '',
	`updated_at` text NOT NULL CHECK (length(trim(`updated_at`)) > 0)
);
--> statement-breakpoint
INSERT INTO `stock_feature_rollout` (`feature`, `branches`, `updated_at`)
VALUES ('stock_monitoring', '', '2026-09-24T00:00:00.000Z')
ON CONFLICT(`feature`) DO NOTHING;
