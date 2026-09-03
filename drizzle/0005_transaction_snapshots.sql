ALTER TABLE `transaksi_kasir` ADD COLUMN `product_name` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `base_price` real;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `add_on_total` real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `add_on_snapshot` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `sugar` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `ice` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `note` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `hpp_snapshot` text;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir` ADD COLUMN `hpp_amount` real DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `request_metrics` ADD COLUMN `db_meta` text;
