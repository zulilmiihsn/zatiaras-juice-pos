-- Empty by default: schema migration alone never pauses a branch.
CREATE TABLE kiosk_shift_cutover (
  cabang_id TEXT PRIMARY KEY NOT NULL CHECK (cabang_id IN ('samarinda','balikpapan','berau'))
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TRIGGER kiosk_cutover_only_when_closed BEFORE INSERT ON kiosk_shift_cutover
WHEN EXISTS (SELECT 1 FROM sesi_toko WHERE cabang_id=NEW.cabang_id AND is_active=1)
BEGIN SELECT RAISE(ABORT, 'KIOS_SHIFT_STILL_OPEN'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_cutover_no_move BEFORE UPDATE ON kiosk_shift_cutover
BEGIN SELECT RAISE(ABORT, 'KIOS_CUTOVER_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_cutover_block_open BEFORE INSERT ON sesi_toko
WHEN NEW.is_active=1 AND EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=NEW.cabang_id)
BEGIN SELECT RAISE(ABORT, 'KIOS_CUTOVER_PAUSED'); END;
--> statement-breakpoint
CREATE TRIGGER kiosk_cutover_block_reopen BEFORE UPDATE OF is_active,cabang_id ON sesi_toko
WHEN NEW.is_active=1 AND EXISTS (SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=NEW.cabang_id)
BEGIN SELECT RAISE(ABORT, 'KIOS_CUTOVER_PAUSED'); END;
