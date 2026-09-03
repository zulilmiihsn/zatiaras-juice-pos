-- Hapus kolom redundan buku_kas.nominal. `amount` (notNull) adalah field
-- kanonik tunggal; nominal sebelumnya cuma cermin yang selalu = amount.
-- Semua penulisan & pembacaan kode sudah dipindah ke amount.
ALTER TABLE `buku_kas` DROP COLUMN `nominal`;
