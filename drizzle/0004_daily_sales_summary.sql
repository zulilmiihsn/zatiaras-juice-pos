CREATE TABLE IF NOT EXISTS `daily_sales_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`sales_date` text NOT NULL,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`gross_sales` real DEFAULT 0 NOT NULL,
	`cash_sales` real DEFAULT 0 NOT NULL,
	`non_cash_sales` real DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_daily_sales_branch_date` ON `daily_sales_summary` (`branch_id`,`sales_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_daily_sales_branch_date_range` ON `daily_sales_summary` (`branch_id`,`sales_date`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `daily_product_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`sales_date` text NOT NULL,
	`product_id` text NOT NULL,
	`product_name` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	`gross_sales` real DEFAULT 0 NOT NULL,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_daily_product_sales_unique` ON `daily_product_sales` (`branch_id`,`sales_date`,`product_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_daily_product_sales_branch_date` ON `daily_product_sales` (`branch_id`,`sales_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_daily_product_sales_branch_product` ON `daily_product_sales` (`branch_id`,`product_id`);
