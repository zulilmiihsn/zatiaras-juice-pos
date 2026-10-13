-- Additive private staging. No ledger/stock rewrite; production apply requires backup and explicit approval.
CREATE TABLE archive_restore_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  cabang_id TEXT NOT NULL,
  archive_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  expected_bk INTEGER NOT NULL CHECK(expected_bk >= 0),
  expected_tk INTEGER NOT NULL CHECK(expected_tk >= 0),
  status TEXT NOT NULL CHECK(status IN ('staging', 'completed')),
  created_at TEXT NOT NULL,
  committed_at TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX archive_restore_jobs_branch_archive ON archive_restore_jobs(cabang_id, archive_id);
--> statement-breakpoint
CREATE TABLE archive_restore_rows (
  job_id TEXT NOT NULL REFERENCES archive_restore_jobs(id),
  cabang_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('buku_kas', 'transaksi_kasir')),
  row_id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  PRIMARY KEY(job_id, kind, row_id),
  CHECK(json_extract(data_json, '$.id') IS row_id),
  CHECK(json_extract(data_json, '$.cabang_id') IS cabang_id)
);
--> statement-breakpoint
CREATE INDEX archive_restore_rows_branch_job ON archive_restore_rows(cabang_id, job_id, kind);
