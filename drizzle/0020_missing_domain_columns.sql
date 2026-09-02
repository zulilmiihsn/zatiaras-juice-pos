-- bahan
ALTER TABLE `bahan` ADD COLUMN `tipe_satuan` text DEFAULT 'berat';--> statement-breakpoint
ALTER TABLE `bahan` ADD COLUMN `isi_per_kemasan` real DEFAULT 1;--> statement-breakpoint
ALTER TABLE `bahan` ADD COLUMN `satuan_beli` text;--> statement-breakpoint
ALTER TABLE `bahan` ADD COLUMN `kategori` text DEFAULT 'Bahan Baku';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_bahan_branch_kategori` ON `bahan` (`cabang_id`, `kategori`);--> statement-breakpoint

-- pengaturan_hpp
ALTER TABLE `pengaturan_hpp` ADD COLUMN `rincian_biaya` text;--> statement-breakpoint

-- resep_produk
ALTER TABLE `resep_produk` ADD COLUMN `porsi` text DEFAULT 'reguler';--> statement-breakpoint
ALTER TABLE `resep_produk` ADD COLUMN `satuan_resep` text;--> statement-breakpoint
ALTER TABLE `resep_produk` ADD COLUMN `jumlah_dasar_per_item` real;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_resep_produk_product_bahan_porsi` ON `resep_produk` (`cabang_id`, `produk_id`, `bahan_id`, `porsi`);
