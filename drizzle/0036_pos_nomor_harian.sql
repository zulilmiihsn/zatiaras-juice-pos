-- Nomor antrean harian POS: 001-999 per cabang per tanggal WITA, reset tiap tanggal baru.
-- Kontrak: alokasi atomik via pos_nomor_harian (upsert + RETURNING) di checkout,
-- disimpan di buku_kas.nomor_harian + tanggal_nomor. Retry idempoten memakai ulang
-- nomor pemenang; nomor transaksi gagal/void tidak dipakai ulang (boleh ada gap).
-- Transaksi manual/catat dan baris legacy: kedua kolom NULL.
ALTER TABLE `buku_kas` ADD COLUMN `nomor_harian` integer CHECK (`nomor_harian` IS NULL OR `nomor_harian` >= 1);
--> statement-breakpoint
ALTER TABLE `buku_kas` ADD COLUMN `tanggal_nomor` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pos_nomor_harian` (
	`cabang_id` text NOT NULL,
	`tanggal` text NOT NULL,
	`terakhir` integer NOT NULL DEFAULT 0 CHECK (`terakhir` >= 0),
	PRIMARY KEY (`cabang_id`, `tanggal`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_buku_kas_cabang_tanggal_nomor` ON `buku_kas` (`cabang_id`, `tanggal_nomor`, `nomor_harian`);
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_nomor_pair_guard`
BEFORE INSERT ON `buku_kas`
WHEN NOT (
	(NEW.`nomor_harian` IS NULL AND NEW.`tanggal_nomor` IS NULL)
	OR (NEW.`nomor_harian` IS NOT NULL AND NEW.`tanggal_nomor` IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_NOMOR_HARIAN');
END;
--> statement-breakpoint
CREATE TRIGGER `trg_buku_kas_nomor_pair_update_guard`
BEFORE UPDATE OF `nomor_harian`, `tanggal_nomor` ON `buku_kas`
WHEN NOT (
	(NEW.`nomor_harian` IS NULL AND NEW.`tanggal_nomor` IS NULL)
	OR (NEW.`nomor_harian` IS NOT NULL AND NEW.`tanggal_nomor` IS NOT NULL)
)
BEGIN
	SELECT RAISE(ABORT, 'INVALID_NOMOR_HARIAN');
END;
