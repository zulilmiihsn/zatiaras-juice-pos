CREATE TABLE `buku_kas` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`waktu` text NOT NULL,
	`sumber` text NOT NULL,
	`tipe` text NOT NULL,
	`jenis` text NOT NULL,
	`amount` real NOT NULL,
	`nominal` real,
	`qty` integer,
	`description` text,
	`customer_name` text,
	`payment_method` text,
	`transaction_id` text,
	`id_sesi_toko` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_buku_kas_branch_waktu` ON `buku_kas` (`branch_id`,`waktu`);--> statement-breakpoint
CREATE INDEX `idx_buku_kas_branch_transaction` ON `buku_kas` (`branch_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_buku_kas_branch_sesi` ON `buku_kas` (`branch_id`,`id_sesi_toko`);--> statement-breakpoint
CREATE TABLE `kategori` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`nama` text,
	`description` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_kategori_branch_created` ON `kategori` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `pengaturan` (
	`id` integer PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`pin` text DEFAULT '1234',
	`locked_pages` text DEFAULT '[]',
	`nama_toko` text,
	`alamat` text,
	`telepon` text,
	`instagram` text,
	`ucapan` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_pengaturan_branch` ON `pengaturan` (`branch_id`);--> statement-breakpoint
CREATE TABLE `produk` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`price` real NOT NULL,
	`harga` real,
	`stok` integer DEFAULT 0,
	`gambar` text,
	`category_id` text,
	`kategori_id` text,
	`tipe` text DEFAULT 'minuman',
	`deskripsi` text,
	`ekstra_ids` text DEFAULT '[]',
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_produk_branch_created` ON `produk` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_produk_branch_kategori` ON `produk` (`branch_id`,`kategori_id`);--> statement-breakpoint
CREATE TABLE `profil` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`role` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`nama_lengkap` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_profil_branch_username` ON `profil` (`branch_id`,`username`);--> statement-breakpoint
CREATE TABLE `sesi_toko` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`opening_cash` real NOT NULL,
	`opening_time` text NOT NULL,
	`closing_time` text,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_sesi_toko_branch_active` ON `sesi_toko` (`branch_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_sesi_toko_branch_opening` ON `sesi_toko` (`branch_id`,`opening_time`);--> statement-breakpoint
CREATE TABLE `tambahan` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`nama` text,
	`price` real NOT NULL,
	`harga` real,
	`is_active` integer DEFAULT true,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_tambahan_branch_created` ON `tambahan` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `transaksi_kasir` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`buku_kas_id` text NOT NULL,
	`produk_id` text,
	`custom_name` text,
	`qty` integer NOT NULL,
	`amount` real NOT NULL,
	`price` real,
	`transaction_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_created` ON `transaksi_kasir` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_transaction` ON `transaksi_kasir` (`branch_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_buku` ON `transaksi_kasir` (`branch_id`,`buku_kas_id`);