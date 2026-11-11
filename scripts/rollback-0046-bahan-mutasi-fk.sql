-- Rollback 0046: hanya setelah backup terverifikasi, hentikan penulisan dan uji pada salinan.
-- Tidak menghapus riwayat. Indeks unik induk dipertahankan; migrasi tetap tercatat.
CREATE UNIQUE INDEX IF NOT EXISTS `idx_bahan_cabang_id_unique` ON `bahan` (`cabang_id`, `id`);
--> statement-breakpoint
DROP TABLE IF EXISTS `bahan_mutasi__new`;
--> statement-breakpoint
DROP TABLE IF EXISTS `_bahan_fk_guard`;
--> statement-breakpoint
CREATE TABLE `_bahan_fk_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));
--> statement-breakpoint
CREATE TABLE `bahan_mutasi__new` (
 `id` text PRIMARY KEY NOT NULL,
 `cabang_id` text NOT NULL,
 `bahan_id` text NOT NULL,
 `delta_jumlah` real NOT NULL,
 `stok_setelah` real,
 `sumber` text DEFAULT 'manual' NOT NULL,
 `referensi_id` text,
 `catatan` text,
 `dibuat_oleh` text,
 `created_at` text DEFAULT CURRENT_TIMESTAMP,
 `operation_key` text,
 `request_fingerprint` text
);
--> statement-breakpoint
INSERT INTO `bahan_mutasi__new` (`id`,`cabang_id`,`bahan_id`,`delta_jumlah`,`stok_setelah`,`sumber`,`referensi_id`,`catatan`,`dibuat_oleh`,`created_at`,`operation_key`,`request_fingerprint`)
SELECT `id`,`cabang_id`,`bahan_id`,`delta_jumlah`,`stok_setelah`,`sumber`,`referensi_id`,`catatan`,`dibuat_oleh`,`created_at`,`operation_key`,`request_fingerprint` FROM `bahan_mutasi`;
--> statement-breakpoint
INSERT INTO `_bahan_fk_guard` (`ok`)
SELECT CASE WHEN (SELECT COUNT(*) FROM `bahan_mutasi`) = (SELECT COUNT(*) FROM `bahan_mutasi__new`) THEN 1 ELSE 0 END;
--> statement-breakpoint
DROP TABLE `_bahan_fk_guard`;
--> statement-breakpoint
DROP TABLE `bahan_mutasi`;
--> statement-breakpoint
ALTER TABLE `bahan_mutasi__new` RENAME TO `bahan_mutasi`;
--> statement-breakpoint
CREATE INDEX `idx_bahan_mutasi_branch_created` ON `bahan_mutasi` (`cabang_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_bahan_mutasi_branch_bahan` ON `bahan_mutasi` (`cabang_id`,`bahan_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bahan_mutasi_branch_operation_key` ON `bahan_mutasi` (`cabang_id`,`operation_key`) WHERE `operation_key` IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER `trg_bahan_mutasi_reconciliation_guard`
BEFORE INSERT ON `bahan_mutasi`
WHEN NEW.`sumber` = 'reconciliation' AND (
 NEW.`delta_jumlah` = 0 OR NOT EXISTS (
  SELECT 1 FROM `stock_reconciliations` j
  INNER JOIN `stock_reconciliation_items` i ON i.`job_id` = j.`id` AND i.`cabang_id` = j.`cabang_id`
  INNER JOIN `bahan` b ON b.`cabang_id` = j.`cabang_id` AND b.`id` = i.`entity_id`
  WHERE j.`id` = NEW.`referensi_id` AND j.`cabang_id` = NEW.`cabang_id` AND j.`status` = 'applied'
  AND i.`entity_type` = 'bahan' AND i.`entity_id` = NEW.`bahan_id` AND i.`counted_quantity` = NEW.`stok_setelah`
  AND ABS(NEW.`stok_setelah` - (b.`stok_saat_ini` + NEW.`delta_jumlah`)) <= 0.0000001
 )
)
BEGIN
 SELECT RAISE(ABORT, 'INVALID_INGREDIENT_RECONCILIATION_MUTATION');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_bahan_mutasi_reconciliation_apply`
AFTER INSERT ON `bahan_mutasi`
WHEN NEW.`sumber` = 'reconciliation'
BEGIN
 UPDATE `bahan` SET `stok_saat_ini` = NEW.`stok_setelah`, `updated_at` = NEW.`created_at`
 WHERE `cabang_id` = NEW.`cabang_id` AND `id` = NEW.`bahan_id`;
END;
