-- Fingerprint intent kulakan ikut atomic movement/stock/cash/HPP commit.
-- NULL mempertahankan histori lama; intent lama tidak boleh ditebak/backfill.
ALTER TABLE bahan_mutasi ADD COLUMN request_fingerprint TEXT;
