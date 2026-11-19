ALTER TABLE sesi_toko ADD COLUMN kiosk_managed INTEGER NOT NULL DEFAULT 0 CHECK (kiosk_managed IN (0,1));
--> statement-breakpoint
DROP TRIGGER kiosk_cutover_block_open;
--> statement-breakpoint
CREATE TRIGGER kiosk_cutover_block_open BEFORE INSERT ON sesi_toko
WHEN NEW.is_active=1 AND NEW.kiosk_managed=0 AND EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=NEW.cabang_id)
BEGIN SELECT RAISE(ABORT, 'KIOS_CUTOVER_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_managed_requires_cutover BEFORE INSERT ON sesi_toko
WHEN NEW.kiosk_managed=1 AND NOT EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=NEW.cabang_id)
BEGIN SELECT RAISE(ABORT, 'KIOS_CUTOVER_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_managed_immutable BEFORE UPDATE OF kiosk_managed ON sesi_toko
WHEN OLD.kiosk_managed<>NEW.kiosk_managed
BEGIN SELECT RAISE(ABORT, 'KIOS_MANAGED_IMMUTABLE'); END;
