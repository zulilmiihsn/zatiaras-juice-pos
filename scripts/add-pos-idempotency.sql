ALTER TABLE buku_kas ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_buku_kas_branch_idempotency
ON buku_kas (branch_id, idempotency_key);
