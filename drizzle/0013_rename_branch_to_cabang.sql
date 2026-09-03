-- Konsistensi: kolom `branch_id` -> `cabang_id` di seluruh tabel (Bahasa Indonesia).
-- Index yang mereferensikan kolom ikut ter-update otomatis oleh SQLite (nama index
-- tetap, mis. idx_produk_branch_created). Payload realtime (message.branch_id) BUKAN
-- kolom DB dan sengaja tidak diubah.
ALTER TABLE `profil` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `auth_sessions` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `produk` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `bahan` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `pengaturan_hpp` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `resep_produk` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `bahan_mutasi` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `kategori` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `tambahan` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `buku_kas` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `transaksi_kasir` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `ringkasan_penjualan_harian` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `penjualan_produk_harian` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `pengaturan` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `sesi_toko` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `audit_logs` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `rate_limits` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `error_events` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `request_metrics` RENAME COLUMN `branch_id` TO `cabang_id`;--> statement-breakpoint
ALTER TABLE `d1_backup_runs` RENAME COLUMN `branch_id` TO `cabang_id`;
