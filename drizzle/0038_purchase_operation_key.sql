-- Kunci idempotency perintah kulakan atomik (AUD-006). NULL untuk baris non-purchase.
ALTER TABLE bahan_mutasi ADD COLUMN operation_key TEXT;
--> statement-breakpoint
-- Partial unique: hanya baris purchase ber-kunci yang wajib unik per cabang.
CREATE UNIQUE INDEX idx_bahan_mutasi_branch_operation_key ON bahan_mutasi(cabang_id, operation_key) WHERE operation_key IS NOT NULL;
