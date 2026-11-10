-- Rollback 0045: lepas FK transaksi_kasir -> buku_kas TANPA membuang baris. BUKAN bagian rantai
-- drizzle/ dan tidak dicatat di d1_migrations. Pakai bila FK terbukti mengganggu jalur tertentu
-- dan restore backup akan membuang transaksi yang masuk sesudahnya.
--
-- Prasyarat: backup terverifikasi. Per shard, via:
--   wrangler d1 execute <SHARD> --remote --config wrangler.pages.jsonc \
--     --file scripts/rollback-0045-transaksi-kasir-fk.sql --yes
-- Indeks unik idx_buku_kas_cabang_id_unique sengaja dipertahankan (tidak berbahaya, id sudah unik).
-- Aman diulang; gagal berarti jumlah baris tidak cocok dan tabel lama tetap utuh.
DROP TABLE IF EXISTS `transaksi_kasir__old`;
--> statement-breakpoint
DROP TABLE IF EXISTS `_fk_copy_guard`;
--> statement-breakpoint
CREATE TABLE `transaksi_kasir__old` (
	`id` text PRIMARY KEY NOT NULL,
	`cabang_id` text NOT NULL,
	`buku_kas_id` text NOT NULL,
	`produk_id` text,
	`nama_kustom` text,
	`jumlah` integer NOT NULL,
	`nominal` real NOT NULL,
	`harga` real,
	`transaction_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	`nama_produk` text,
	`harga_dasar` real,
	`total_tambahan` real DEFAULT 0,
	`snapshot_tambahan` text,
	`gula` text,
	`es` text,
	`catatan` text,
	`snapshot_hpp` text,
	`nominal_hpp` real DEFAULT 0
);
--> statement-breakpoint
INSERT INTO `transaksi_kasir__old` (`id`, `cabang_id`, `buku_kas_id`, `produk_id`, `nama_kustom`, `jumlah`, `nominal`, `harga`, `transaction_id`, `created_at`, `updated_at`, `nama_produk`, `harga_dasar`, `total_tambahan`, `snapshot_tambahan`, `gula`, `es`, `catatan`, `snapshot_hpp`, `nominal_hpp`)
SELECT `id`, `cabang_id`, `buku_kas_id`, `produk_id`, `nama_kustom`, `jumlah`, `nominal`, `harga`, `transaction_id`, `created_at`, `updated_at`, `nama_produk`, `harga_dasar`, `total_tambahan`, `snapshot_tambahan`, `gula`, `es`, `catatan`, `snapshot_hpp`, `nominal_hpp` FROM `transaksi_kasir`;
--> statement-breakpoint
CREATE TABLE `_fk_copy_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
INSERT INTO `_fk_copy_guard` (`ok`)
SELECT CASE WHEN (SELECT COUNT(*) FROM `transaksi_kasir`) = (SELECT COUNT(*) FROM `transaksi_kasir__old`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `_fk_copy_guard`;
--> statement-breakpoint
DROP TABLE `transaksi_kasir`;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir__old` RENAME TO `transaksi_kasir`;
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_created` ON `transaksi_kasir` (`cabang_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_transaction` ON `transaksi_kasir` (`cabang_id`, `transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_buku` ON `transaksi_kasir` (`cabang_id`, `buku_kas_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_created_id` ON `transaksi_kasir` (`cabang_id`, `created_at`, `id`);
