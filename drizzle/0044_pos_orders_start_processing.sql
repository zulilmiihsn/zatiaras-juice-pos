-- Order POS dari kasir langsung berstatus Diproses: isi preparation_started_at
-- saat order dibuat. Tab Masuk disisakan untuk sumber lain yang belum ditentukan.
UPDATE `buku_kas`
SET `preparation_started_at` = COALESCE(`created_at`, `waktu`)
WHERE `sumber` = 'pos'
  AND `preparation_state` = 'pending'
  AND `preparation_started_at` IS NULL;
