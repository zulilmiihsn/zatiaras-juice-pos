-- Konsistensi: kolom "product" -> "produk" (Bahasa Indonesia).
-- Index yang mereferensikan kolom ikut ter-update otomatis oleh SQLite.
-- Catatan: kontrak request checkout (items[].product_id) sengaja tetap, ini
-- murni rename kolom DB.
ALTER TABLE `resep_produk` RENAME COLUMN `product_id` TO `produk_id`;--> statement-breakpoint
ALTER TABLE `transaksi_kasir` RENAME COLUMN `product_name` TO `nama_produk`;--> statement-breakpoint
ALTER TABLE `penjualan_produk_harian` RENAME COLUMN `product_id` TO `produk_id`;--> statement-breakpoint
ALTER TABLE `penjualan_produk_harian` RENAME COLUMN `product_name` TO `nama_produk`;
