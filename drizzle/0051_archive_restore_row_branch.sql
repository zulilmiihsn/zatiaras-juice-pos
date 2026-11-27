-- Do not normalize or discard incompatible in-progress jobs during the rebuild.
CREATE TABLE _archive_restore_branch_guard (ok INTEGER NOT NULL CHECK (ok = 1));
--> statement-breakpoint
INSERT INTO _archive_restore_branch_guard (ok)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM archive_restore_rows r
  LEFT JOIN archive_restore_jobs j ON j.id = r.job_id
  WHERE j.id IS NULL OR j.cabang_id IS NOT r.cabang_id
    OR j.cabang_id IS NOT json_extract(r.data_json, '$.cabang_id')
) THEN 0 ELSE 1 END;
--> statement-breakpoint
DROP TABLE _archive_restore_branch_guard;
--> statement-breakpoint
CREATE TABLE archive_restore_rows__new (
  job_id TEXT NOT NULL REFERENCES archive_restore_jobs(id),
  kind TEXT NOT NULL CHECK(kind IN ('buku_kas', 'transaksi_kasir')),
  row_id TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  PRIMARY KEY(job_id, kind, row_id),
  CHECK(json_extract(data_json, '$.id') IS row_id)
);
--> statement-breakpoint
INSERT INTO archive_restore_rows__new(job_id, kind, row_id, data_json)
SELECT job_id, kind, row_id, data_json FROM archive_restore_rows;
--> statement-breakpoint
DROP TABLE archive_restore_rows;
--> statement-breakpoint
ALTER TABLE archive_restore_rows__new RENAME TO archive_restore_rows;
--> statement-breakpoint
CREATE TRIGGER trg_archive_restore_row_job_insert
BEFORE INSERT ON archive_restore_rows
WHEN NOT EXISTS (
  SELECT 1 FROM archive_restore_jobs j
  WHERE j.id = NEW.job_id AND j.cabang_id IS json_extract(NEW.data_json, '$.cabang_id')
)
BEGIN
  SELECT RAISE(ABORT, 'RESTORE_ROW_BRANCH_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER trg_archive_restore_row_job_update
BEFORE UPDATE OF job_id, data_json ON archive_restore_rows
WHEN NOT EXISTS (
  SELECT 1 FROM archive_restore_jobs j
  WHERE j.id = NEW.job_id AND j.cabang_id IS json_extract(NEW.data_json, '$.cabang_id')
)
BEGIN
  SELECT RAISE(ABORT, 'RESTORE_ROW_BRANCH_MISMATCH');
END;
--> statement-breakpoint
CREATE TRIGGER trg_archive_restore_job_branch_update
BEFORE UPDATE OF cabang_id ON archive_restore_jobs
WHEN NEW.cabang_id IS NOT OLD.cabang_id AND EXISTS (
  SELECT 1 FROM archive_restore_rows r WHERE r.job_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'RESTORE_ROW_BRANCH_MISMATCH');
END;
