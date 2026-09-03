ALTER TABLE `bahan` ADD COLUMN `cost_per_unit` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `bahan` ADD COLUMN `last_purchase_qty` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `bahan` ADD COLUMN `last_purchase_cost` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hpp_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`rent_monthly` real DEFAULT 0 NOT NULL,
	`electricity_monthly` real DEFAULT 0 NOT NULL,
	`water_monthly` real DEFAULT 0 NOT NULL,
	`salary_monthly` real DEFAULT 0 NOT NULL,
	`other_monthly` real DEFAULT 0 NOT NULL,
	`target_items_monthly` integer DEFAULT 1000 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hpp_settings_branch` ON `hpp_settings` (`branch_id`);
