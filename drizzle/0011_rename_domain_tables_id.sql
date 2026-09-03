-- Konsistensi penamaan: tabel domain yang masih Inggris -> Bahasa Indonesia.
-- Index ikut tabel secara otomatis (nama index tetap, tidak diubah). Tabel
-- infra/sistem (auth_sessions, audit_logs, dst) sengaja dibiarkan Inggris.
ALTER TABLE `hpp_settings` RENAME TO `pengaturan_hpp`;--> statement-breakpoint
ALTER TABLE `daily_sales_summary` RENAME TO `ringkasan_penjualan_harian`;--> statement-breakpoint
ALTER TABLE `daily_product_sales` RENAME TO `penjualan_produk_harian`;
