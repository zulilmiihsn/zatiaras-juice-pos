ALTER TABLE `daily_product_sales` ADD COLUMN `cash_sales` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `daily_product_sales` ADD COLUMN `non_cash_sales` real DEFAULT 0 NOT NULL;
