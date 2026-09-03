CREATE INDEX IF NOT EXISTS `idx_buku_kas_branch_waktu_id`
ON `buku_kas` (`branch_id`, `waktu`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_transaksi_kasir_branch_created_id`
ON `transaksi_kasir` (`branch_id`, `created_at`, `id`);
