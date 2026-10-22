-- Status "Diproses" diturunkan dari preparation_started_at. CHECK lama
-- preparation_state tetap ('pending','done') agar tabel buku_kas tak dibangun ulang.
ALTER TABLE `buku_kas` ADD COLUMN `preparation_started_at` text;
