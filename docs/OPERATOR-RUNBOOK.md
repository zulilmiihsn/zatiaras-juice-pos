# Runbook Operator Rilis Produksi — ZatiarasPOS

Dokumen eksekusi Fase 7. Jangan ada langkah yang dilewati. Setiap trigger
stop = hentikan rollout, lindungi backup, ikuti rollback. Dilarang SQL
spontan di production.

## 0. Prasyarat go/no-go

- [ ] CI hijau pada SHA rilis (5 job + E2E), link run tercatat.
- [ ] Artifact `release-<sha>` ter-upload + manifest cocok (`deploy:verify`).
- [ ] `RELEASE_COMMIT_SHA` = HEAD = SHA artifact = SHA deploy.
- [ ] Maintenance window, operator, approver, dan kanal komunikasi insiden siap.
- [ ] Tidak ada sesi kasir aktif / antrean offline pending pada cabang target
      untuk operasi yang mensyaratkannya (arsip, migrasi destruktif).

## 1. Backup tiga shard (wajib pertama)

```powershell
pnpm d1:backup -- --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
pnpm d1:backup -- --verify-manifest <output-dir>\<run-id>\manifest.sha256.json
```

Syarat lulus: file `COMPLETE` terbit, ketiga binding
(`DB_SAMARINDA_GROUP`, `DB_BALIKPAPAN_GROUP`, `DB_BERAU_GROUP`) verified.
Simpan backup di media berbeda dari source. Jangan hapus sebelum retention berakhir.

## 2. Restore drill (tanpa DB non-production: drill lokal)

Tanpa database non-production, buktikan dump dapat direstore secara lokal
(read-only, in-memory, tidak menyentuh D1 mana pun):

```powershell
pnpm d1:restore:drill -- --file "<output-dir>\<run-id>\db_berau_group.sql"
pnpm d1:restore:drill -- --file "<output-dir>\<run-id>\db_balikpapan_group.sql"
pnpm d1:restore:drill -- --file "<output-dir>\<run-id>\db_samarinda_group.sql"
```

Syarat lulus: tiap file `PASS restore drill lokal` dengan daftar tabel + row count.
Bila ada DB non-production, drill penuh ke sana:

```powershell
CONFIRM_D1_RESTORE=<binding-nonprod> pnpm d1:restore -- --database <binding> --file <backup.sql>
```

DILARANG restore ke database production untuk sekadar test.

## 3. Schema diff production vs 30 migrasi

```powershell
node scripts/migrate-production.mjs
```

Syarat lulus lokal: 30/30 checksum cocok (sudah hijau di CI via migration-matrix).
Lalu bandingkan schema aktual tiap shard remote sebelum apply. Status 23 Sep 2026:
production 0/30 applied (dibangun di luar rantai) — DILARANG `d1:migrate:live`
rantai penuh (rename/drop/rebuild buta). Gunakan rekonsiliasi §4.

## 4. Rekonsiliasi production per shard (remote live, satu shard sekali jalan)

Hanya `scripts/reconcile-prod-0030.sql` (aditif + rebuild pengaturan preserving,
terverifikasi 11/11 pada salinan backup ketiga shard). Per shard, berurutan,
verifikasi di antara shard:

```powershell
pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --remote --config wrangler.pages.jsonc --file scripts/reconcile-prod-0030.sql --yes
pnpm exec wrangler d1 execute DB_BALIKPAPAN_GROUP --remote --config wrangler.pages.jsonc --file scripts/reconcile-prod-0030.sql --yes
pnpm exec wrangler d1 execute DB_BERAU_GROUP --remote --config wrangler.pages.jsonc --file scripts/reconcile-prod-0030.sql --yes
```

Verifikasi tiap shard sesudah apply:

```sql
SELECT name FROM sqlite_master WHERE type = 'table'
  AND name IN ('archive_jobs','archive_job_items','pos_void_markers','audit_log_quarantine');
PRAGMA table_info(buku_kas); -- wajib ada revision, mutation_token
PRAGMA table_info(pengaturan); -- id wajib TEXT
SELECT COUNT(*) FROM pengaturan; -- sama dengan sebelum apply
```

Berhenti di shard pertama yang gagal; JANGAN lanjut atau rerun buta (2x ALTER
TABLE gagal bila kolom sudah ada — comment 2 baris itu bila retry terverifikasi).
Rollback: `node scripts/rollback-migration.mjs --shard=<SHARD> [--live] [--apply]`
atau restore dari backup langkah 1. Rollback Pages TIDAK mengembalikan schema D1.

## 5. Deploy aplikasi (workflow Deploy, bukan dari laptop)

1. GitHub Actions → Deploy → `workflow_dispatch`, isi SHA + `dry_run=true` +
   `ci_run_id` (ID angka CI run hijau pemilik artifact, misal dari URL run CI).
2. Verifikasi manifest lulus, lalu dispatch ulang `dry_run=false` (butuh
   approval environment `production`).
3. Catat deployment ID Worker realtime + Pages; keduanya wajib memakai SHA sama.

## 6. Smoke per cabang target (OPS-T01–T11)

Login valid/invalid, role/PIN + elevasi, buka/tutup sesi, checkout tunai dan
non-tunai (cocokkan total/cash/change/ledger/stok/summary/receipt), offline
replay satu kali tanpa duplikat, void + ubah metode (CAS/stok/summary/audit),
pajak YTD + PDF + paritas arsip, archive preview→finalisasi→parity, restore
drill conflict fail-closed, realtime dua browser per group cabang.

## 7. Printer fisik (OPS-T12–T13, perangkat yang dipakai operasional)

Browser: layout, topping, subtotal, nama numerik (`123`), reprint receipt lama.
ESC/POS USB/network: encoding, cut, koneksi gagal + retry + fallback.
Satu jalur gagal = release ditahan untuk cabang tersebut.

## 8. Monitoring (OPS-T14)

Snapshot error rate/latency/audit sebelum vs sesudah deploy, tanpa data sensitif.
Batas: melewati baseline yang disetujui = trigger rollback.

## 9. Stop/rollback trigger

Checksum backup/artifact mismatch; schema drift; migrasi satu shard gagal;
login/isolasi cabang gagal; selisih uang/pajak/stok/summary/receipt; replay
duplikat; realtime lintas cabang; artifact SHA tak terbukti.

## 10. Toggle monitoring stok (operasi cabang)

- Perubahan mode hanya oleh pemilik cabang lewat `/pengaturan/pemilik/stok`.
  Rollout gate berbasis D1 (`stock_feature_rollout`, feature `stock_monitoring`)
  membatasi cabang yang tombolnya aktif. Jangan pakai env var: env dashboard
  tidak sampai ke runtime Pages. Ubah via SQL per shard, tanpa redeploy:
  `UPDATE stock_feature_rollout SET branches = '<cabang>' WHERE feature = 'stock_monitoring'`.
- Sebelum menonaktifkan: pastikan antrean offline semua perangkat cabang kosong
  (perangkat online + replay selesai). Sistem tidak dapat membuktikan IndexedDB
  kosong; antrean sisa akan dikarantina dan butuh persetujuan pemilik (HTTP 428).
- Aktivasi ulang wajib rekonsiliasi fisik di halaman yang sama: mulai job, isi
  seluruh item, simpan, selesaikan review antrean, lalu finalisasi. Tanpa ini
  server menolak (409).
- Rollback aplikasi ke versi lama DILARANG selama ada cabang `ignored`: aplikasi
  lama tidak mengenal policy dan akan mengurangi stok lagi. Kembalikan semua
  cabang ke `tracked` dulu (via versi baru + rekonsiliasi), baru rollback.

## 11. Release record (wajib diisi tiap rilis)

Commit SHA, artifact SHA + checksum manifest, link CI, manifest backup +
hasil verify/restore drill, diff schema + hasil migrasi per shard, checklist
smoke per cabang/perangkat, deployment IDs + waktu, snapshot monitoring,
keputusan go/no-go + nama approver.
