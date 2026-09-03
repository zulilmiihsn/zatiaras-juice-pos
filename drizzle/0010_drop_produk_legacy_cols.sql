-- Tuntaskan unifikasi schema pasca-migrasi Supabase→D1 (lanjutan dari 0009).
-- Field kanonik: `produk.price`, `produk.kategori_id`, `tambahan.price`, `kategori.name`.
-- Kolom warisan (`harga`, `category_id`, `nama`) cuma cermin yang tak pernah ditulis
-- kode aplikasi. Backfill dulu jaga-jaga ada data nyangkut di prod, baru DROP.

-- 1) Backfill kategori_id dari category_id bila kosong.
UPDATE `produk` SET `kategori_id` = `category_id`
	WHERE `kategori_id` IS NULL AND `category_id` IS NOT NULL;--> statement-breakpoint

-- 2) Backfill price dari harga hanya bila price belum bernilai valid.
UPDATE `produk` SET `price` = `harga`
	WHERE (`price` IS NULL OR `price` = 0) AND `harga` IS NOT NULL AND `harga` > 0;--> statement-breakpoint
UPDATE `tambahan` SET `price` = `harga`
	WHERE (`price` IS NULL OR `price` = 0) AND `harga` IS NOT NULL AND `harga` > 0;--> statement-breakpoint

-- 3) Drop kolom redundan.
ALTER TABLE `produk` DROP COLUMN `harga`;--> statement-breakpoint
ALTER TABLE `produk` DROP COLUMN `category_id`;--> statement-breakpoint
ALTER TABLE `tambahan` DROP COLUMN `harga`;--> statement-breakpoint
ALTER TABLE `tambahan` DROP COLUMN `nama`;--> statement-breakpoint
ALTER TABLE `kategori` DROP COLUMN `nama`;
