-- A permit exists only inside the atomic D1 projection batch.
CREATE TABLE kiosk_inventory_projection_permit (
  cabang_id TEXT PRIMARY KEY NOT NULL REFERENCES kiosk_shift_cutover(cabang_id)
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_produk_insert BEFORE INSERT ON produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_produk_update BEFORE UPDATE ON produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id,NEW.cabang_id))
AND NOT (EXISTS (SELECT 1 FROM kiosk_inventory_projection_permit WHERE cabang_id=OLD.cabang_id)
  AND OLD.id IS NEW.id AND OLD.cabang_id IS NEW.cabang_id AND OLD.lacak_stok IS NEW.lacak_stok AND OLD.lacak_bahan IS NEW.lacak_bahan AND OLD.is_active IS NEW.is_active)
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_produk_delete BEFORE DELETE ON produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_bahan_insert BEFORE INSERT ON bahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_bahan_update BEFORE UPDATE ON bahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id,NEW.cabang_id))
AND NOT (EXISTS (SELECT 1 FROM kiosk_inventory_projection_permit WHERE cabang_id=OLD.cabang_id)
  AND OLD.id IS NEW.id AND OLD.cabang_id IS NEW.cabang_id AND OLD.satuan IS NEW.satuan AND OLD.is_active IS NEW.is_active)
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_bahan_delete BEFORE DELETE ON bahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_tambahan_insert BEFORE INSERT ON tambahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_tambahan_update BEFORE UPDATE ON tambahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id,NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_tambahan_delete BEFORE DELETE ON tambahan
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_resep_produk_insert BEFORE INSERT ON resep_produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_resep_produk_update BEFORE UPDATE ON resep_produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id,NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_resep_produk_delete BEFORE DELETE ON resep_produk
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_stock_policy_insert BEFORE INSERT ON stock_policy
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_stock_policy_update BEFORE UPDATE ON stock_policy
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id,NEW.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_inventory_stock_policy_delete BEFORE DELETE ON stock_policy
WHEN EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id IN (OLD.cabang_id))
BEGIN SELECT RAISE(ABORT, 'KIOS_INVENTORY_FENCED'); END;
