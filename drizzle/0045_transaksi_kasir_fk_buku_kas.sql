-- Fase 1 constraint relasi (ADR 0003): detail transaksi wajib menunjuk header buku_kas pada
-- cabang yang sama. SQLite tidak dapat menambah FK ke tabel yang sudah ada, jadi
-- transaksi_kasir dibangun ulang. Migrasi ini tidak mengubah atau membuang baris apa pun:
-- bila ada baris yatim atau lintas cabang, penyalinan gagal dan tabel lama tetap utuh.
-- Prasyarat operator: backup terverifikasi dan `pnpm d1:health` bersih (runbook 3.1).
-- Aman diulang: sisa percobaan yang gagal dibersihkan dulu, jadi koreksi data lalu jalankan lagi.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_buku_kas_cabang_id_unique` ON `buku_kas` (`cabang_id`, `id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `transaksi_kasir__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `_fk_copy_guard`;
--> statement-breakpoint
CREATE TABLE `transaksi_kasir__new` (
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
	`nominal_hpp` real DEFAULT 0,
	FOREIGN KEY (`cabang_id`, `buku_kas_id`) REFERENCES `buku_kas`(`cabang_id`, `id`)
);
--> statement-breakpoint
INSERT INTO `transaksi_kasir__new` (`id`, `cabang_id`, `buku_kas_id`, `produk_id`, `nama_kustom`, `jumlah`, `nominal`, `harga`, `transaction_id`, `created_at`, `updated_at`, `nama_produk`, `harga_dasar`, `total_tambahan`, `snapshot_tambahan`, `gula`, `es`, `catatan`, `snapshot_hpp`, `nominal_hpp`)
SELECT `id`, `cabang_id`, `buku_kas_id`, `produk_id`, `nama_kustom`, `jumlah`, `nominal`, `harga`, `transaction_id`, `created_at`, `updated_at`, `nama_produk`, `harga_dasar`, `total_tambahan`, `snapshot_tambahan`, `gula`, `es`, `catatan`, `snapshot_hpp`, `nominal_hpp` FROM `transaksi_kasir`;
--> statement-breakpoint
-- Tabel lama baru dibuang bila jumlah baris sama; CHECK menggagalkan migrasi sebelum DROP.
CREATE TABLE `_fk_copy_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
INSERT INTO `_fk_copy_guard` (`ok`)
SELECT CASE WHEN (SELECT COUNT(*) FROM `transaksi_kasir`) = (SELECT COUNT(*) FROM `transaksi_kasir__new`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `_fk_copy_guard`;
--> statement-breakpoint
DROP TABLE `transaksi_kasir`;
--> statement-breakpoint
ALTER TABLE `transaksi_kasir__new` RENAME TO `transaksi_kasir`;
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_created` ON `transaksi_kasir` (`cabang_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_transaction` ON `transaksi_kasir` (`cabang_id`, `transaction_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_buku` ON `transaksi_kasir` (`cabang_id`, `buku_kas_id`);
--> statement-breakpoint
CREATE INDEX `idx_transaksi_kasir_branch_created_id` ON `transaksi_kasir` (`cabang_id`, `created_at`, `id`);
