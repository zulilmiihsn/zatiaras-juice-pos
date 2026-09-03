ALTER TABLE `produk` ADD COLUMN `track_ingredients` integer DEFAULT false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bahan` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`unit` text DEFAULT 'gram' NOT NULL,
	`current_stock` real DEFAULT 0 NOT NULL,
	`low_stock_threshold` real DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bahan_branch_created` ON `bahan` (`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bahan_branch_name` ON `bahan` (`branch_id`,`name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `resep_produk` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`product_id` text NOT NULL,
	`bahan_id` text NOT NULL,
	`qty_per_item` real NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_resep_produk_branch_product` ON `resep_produk` (`branch_id`,`product_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_resep_produk_branch_bahan` ON `resep_produk` (`branch_id`,`bahan_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_resep_produk_product_bahan` ON `resep_produk` (`branch_id`,`product_id`,`bahan_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `bahan_mutasi` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`bahan_id` text NOT NULL,
	`quantity_delta` real NOT NULL,
	`stock_after` real,
	`source` text DEFAULT 'manual' NOT NULL,
	`reference_id` text,
	`note` text,
	`created_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bahan_mutasi_branch_created` ON `bahan_mutasi` (`branch_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bahan_mutasi_branch_bahan` ON `bahan_mutasi` (`branch_id`,`bahan_id`);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_bahan_nonnegative`
BEFORE UPDATE OF `current_stock` ON `bahan`
WHEN COALESCE(NEW.current_stock, 0) < 0
BEGIN
	SELECT RAISE(ABORT, 'INSUFFICIENT_INGREDIENT');
END;
