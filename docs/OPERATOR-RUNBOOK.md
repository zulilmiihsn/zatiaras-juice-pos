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

Adapter backup menjalankan Wrangler terpasang melalui `rtk proxy` agar output
identitas `--json` tidak tercampur filter RTK atau lifecycle pnpm. Validasi tiga
identitas shard, hash/readback, dan penolakan operasi di luar allowlist tetap wajib.

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

> Insiden 26 Sep 2026: rantai `pnpm build; wrangler pages deploy` men-deploy
> worker baru dengan aset basi saat build parsial — seluruh JS/CSS 404 di
> production. Jangan pernah rantai build+deploy dengan `;`. Selalu: hapus
> `.svelte-kit`, build penuh sampai `✔ done`, verifikasi isi
> `.svelte-kit/cloudflare/_app/immutable`, baru deploy; lalu verifikasi tiap
> aset rujukan HTML balas 200 dengan MIME benar.
> Artifact CI juga wajib memuat `.svelte-kit/cloudflare-tmp` dan
> `.svelte-kit/output/server`; `_worker.js` merujuk kedua direktori itu.
> Manifest rilis memverifikasi checksum ketiga root sebelum Pages deploy.

1. GitHub Actions → Deploy → `workflow_dispatch`, isi SHA + `dry_run=true` +
   `ci_run_id` (ID angka CI run hijau pemilik artifact, misal dari URL run CI).
2. Verifikasi manifest lulus, lalu dispatch ulang `dry_run=false` (butuh
   approval environment `production`).
3. Catat deployment ID Worker realtime + Pages; keduanya wajib memakai SHA sama.

Workflow saat ini menolak SHA historis bila HEAD `main` sudah bergerak. Rollback
kode normal: revert commit rilis yang relevan, tunggu CI/artifact SHA baru hijau,
lalu ulangi dry-run dan deploy di atas. Ini membutuhkan CI, bukan rollback instan.
Untuk pemulihan darurat, operator/approver boleh memilih deployment Pages dan
versi Worker sebelumnya yang telah terverifikasi di Cloudflare; catat kedua ID
sebelum rollout. Jangan rebuild/deploy artifact workstation atau restore D1 untuk
sekadar rollback aplikasi. Mengamati ID deployment bukan bukti uji rollback.

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

## 10a. Antrean pesanan (operasi cabang)

- Migrasi status Antrean bersifat aditif pada `buku_kas` dan wajib schema-first:
  backup dan verifikasi tiga shard, terapkan file migrasi baru per binding,
  verifikasi kolom, baru deploy aplikasi. Rollback aplikasi tidak mengembalikan
  schema; kolom boleh tetap ada dan transaksi versi lama berstatus legacy.
- Arsip menolak cutoff yang masih memuat pesanan `pending` (409) baik sebelum
  upload maupun pada klaim finalisasi. Selesaikan atau tunggu pesanan beres
  sebelum mengarsipkan; pesanan `done` tetap bisa diarsipkan seperti biasa.
- Smoke kios memakai transaksi disposable: checkout kasir, Lihat Antrean dari modal sukses, Selesai, reload, Buka lagi, badge/navbar menunjukkan sumber hitung yang benar, lalu void cleanup oleh pemilik.
- Smoke offline/failure hanya pada UAT atau D1 terisolasi: muat dua halaman Antrean, putuskan jaringan, reload; kartu dan badge harus menunjukkan cache perangkat, bukan jumlah server. Tandai status saat offline, tutup tab, pulihkan koneksi, lalu buka Antrean lagi; status harus pulih dari intent tersimpan.
- Simulasikan status gagal di UAT dan koneksi pulih: kartu lokal harus tetap berlabel **Belum tersinkron** sampai tombol **Sinkronkan status** berhasil; jangan menyimpulkan antrean kosong dari cache atau jumlah yang belum diketahui.

### 10a.1 Notifikasi pesanan baru

Source fitur ini bukan catatan deployment. Tidak ada perubahan uang/stok atau status persiapan; jangan memakai notifikasi sebagai bukti pembayaran, pesanan selesai, atau operator telah mendengar.

**Prasyarat schema/config**

1. Ikuti backup tiga shard, verifikasi manifest, dan restore drill §1–2. Production dibangun melalui schema manual; `wrangler d1 migrations list` dapat menampilkan seluruh histori lama sebagai pending meskipun schema operasional sudah ada. **Jangan jalankan `wrangler d1 migrations apply` atau migrator penuh**: itu mencoba mengulang migrasi historis.
2. Verifikasi kolom prerequisite secara read-only, lalu terapkan **hanya** `0037_antrean_notifications.sql`, satu shard per command, berurutan. File ini aditif; jangan rerun bila ada shard gagal—periksa ulang tabel sebelum tindakan:
   ```powershell
   rtk pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --remote --config wrangler.pages.jsonc --file drizzle/0037_antrean_notifications.sql --yes
   rtk pnpm exec wrangler d1 execute DB_BALIKPAPAN_GROUP --remote --config wrangler.pages.jsonc --file drizzle/0037_antrean_notifications.sql --yes
   rtk pnpm exec wrangler d1 execute DB_BERAU_GROUP --remote --config wrangler.pages.jsonc --file drizzle/0037_antrean_notifications.sql --yes
   ```
   Sesudah setiap apply, pastikan tiga tabel notifikasi dan tiga indeks `idx_notification_*` tersedia; registry hanya dipakai pada `DB_SAMARINDA_GROUP`, event/delivery pada shard cabang. Hentikan rollout pada kegagalan pertama.
3. Simpan `VAPID_PUBLIC_KEY` dan `VAPID_PRIVATE_KEY` sebagai **GitHub Environment secrets** `production`; simpan subject sebagai environment variable `VAPID_SUBJECT`. Deploy workflow yang sudah memverifikasi artifact menyalin ketiganya ke secret store kedua runtime setelah approval environment, tanpa mencatat nilainya di log/argv/repo. Jangan melakukan `wrangler secret put` manual yang dapat membuat Worker version di luar release workflow. Subject contact cabang ini: `https://github.com/zulilmiihsn/zatiaras-juice-pos/issues` (issue tracker repository operator).
4. Jalankan `rtk pnpm deploy:check -- --require-antrean-push` di preflight aman. Gate membuktikan config/keypair, bukan penerimaan handset.
5. Deploy Pages dan Worker dari SHA/artifact yang disetujui. Pastikan cron `* * * * *` aktif untuk pemulihan delivery dan cron cleanup harian tetap terpisah. Jangan deploy output workstation atau mengubah production untuk smoke palsu.

**Aktivasi perangkat**

1. Login exact role kasir/pemilik pada cabang benar. Pada iOS/iPadOS yang mendukung, install PWA Home Screen dahulu. Terima update `/sw.js` melalui prompt aplikasi; tutup/reload tab lama bila diminta, lalu warm `/pos` dan `/antrean`.
2. Buka Pengaturan > Antrean. Sound default ON hanya preferensi. Tekan **Tes suara** dan pastikan status audio benar-benar siap; verifikasi volume perangkat, Focus/DND, mute, dan speaker fisik.
3. Pastikan **Service worker: Siap**. Worker lama tanpa handler push menahan aktivasi; terima update aplikasi lalu muat ulang, bukan membuat registrasi kedua atau melewati prompt. Tekan **Aktifkan notifikasi perangkat** melalui gesture, beri izin OS/browser, lalu periksa izin, subscription server, dan readiness terpisah. Permission denied diperbaiki melalui pengaturan browser; jangan mengulang prompt otomatis. HTTPS/localhost dan SW aktif diperlukan.
4. Sound OFF menghentikan chime profil itu pada semua tab, tetapi banner dan push silent tetap boleh muncul. Profil/browser lain tidak ikut berubah. Data browser dibersihkan berarti identitas baru; aktivasi dapat melepas native subscription lama dan membuat yang baru.

**Smoke penerimaan (UAT atau transaksi operasional sah)**

- A checkout; B/C dengan akun sama/cabang sama menerima banner, A dan tab A lain tidak. B pada halaman lain mempunyai satu loop tiga chime sekitar 5 detik setelah izin audio, bukan satu loop per pesanan.
- B membuka Antrean **terlihat dan lolos akses/PIN**: semua tab B berhenti/banner hilang/notifikasi ditutup; C tetap belum melihat. Tab Antrean tersembunyi bukan ACK. Keluar halaman tidak menghidupkan event lama; order baru sesudahnya boleh memanggil lagi.
- OFF pada B tersimpan setelah reload dan semua tab B berhenti; C dan peringatan stok tidak berubah. Warm/reload offline `/pos` dan `/antrean`, satu SW/manifest, nol respons API privat dalam CacheStorage.
- Tutup receiver PWA dan kunci **HP fisik yang dipakai kasir**. Buktikan encrypted Web Push provider nyata muncul dan klik menuju Antrean melewati auth/PIN normal. Catat OS/browser, instalasi, permission, Focus/DND, jaringan, hasil tampilan dan suara operator. Smoke sintetis/desktop/workerd/provider 201 tidak menggantikan bukti ini. Tidak ada jaminan alarm berulang/custom sound saat tertutup atau membangunkan orang.

**Batas bukti implementasi lokal (bukan rilis)**

- Smoke actual Chrome `154.0.8037.58`, tiga profil kasir pada cabang sama, memakai D1/Pages/Worker realtime terisolasi dan checkout nyata fixture. A serta tab A lain tetap tenang; B/C mempunyai banner dan AudioContext `running`, tiga nada dengan interval sekitar 5 detik. Antrean terlihat pada B menghapus alarm seluruh tab B; C tetap berbunyi dan order tetap belum selesai.
- Worker published lama benar-benar dipasang: capability tidak tersedia dan aktivasi push ditahan. Tombol **Perbarui aplikasi** menerima worker waiting; setelah reload readiness menjadi Siap dengan satu registrasi, tanpa cutover otomatis sebelum klik.
- Subscription native ke `fcm.googleapis.com` berhasil diaktifkan. Checkout kedua ketika C tidak mempunyai client aplikasi (browser tetap berjalan, tab `about:blank`) menghasilkan notifikasi generik yang teramati melalui API notifikasi native worker. Tidak ada injeksi event push untuk bukti ini. Deaktivasi lewat UI berhasil melepas subscription native.
- Navigasi warm offline POS menampilkan produk tersimpan; Antrean menampilkan dua pesanan tersimpan belum selesai. Satu SW, satu manifest pada dokumen, nol entri `/api/` di CacheStorage. Banner 320 px tidak overflow dan CTA setinggi 44 px.
- Bukti desktop tersebut **tidak** membuktikan tampilan/suara OS, klik notifikasi pada handset, browser benar-benar dihentikan, Focus/DND, atau baterai HP kasir. UAT HP fisik di atas tetap wajib. Tidak ada deployment, mutasi data production, CI remote, commit, atau push dari smoke ini.

**Diagnosis/stop/rollback**

- Banner/audio hilang setelah login/logout/expiry/rebind adalah lifecycle yang disengaja; masuk/aktifkan ulang pada scope sah. Baseline baru tidak memutar histori. Bila audio diblokir, gunakan Tes suara/gesture; jangan menganggap boolean ON sebagai bukti bunyi.
- Subscription 404/410 dilepas; aktivasi ulang lewat UI. Timeout/429/5xx dipulihkan relay dengan lease 60 detik, maksimal 8 attempt, backoff 30 detik–1 jam dan timeout provider 15 detik. Provider 201 hanya accepted, bukan dibaca/didengar.
- Inspeksi agregat state delivery (`pending`, `leased`, `sent`, `cancelled`, `failed`) dan usia `next_attempt_at` per cabang melalui tooling berizin; jangan dump token, endpoint, encryption key, atau payload pelanggan. Lease macet pulih setelah expiry. Investigasi konfigurasi/cron/provider sebelum tindakan; tidak menghapus/replay checkout untuk memperbaiki delivery. Pending event/delivery tidak dipangkas otomatis; pantau pertumbuhan metadata.
- Salah scope, alarm asal, private API dicache, secret bocor, schema satu shard gagal, atau bukti finansial berubah = STOP. Untuk menghentikan push, nonaktifkan pengiriman/config pada **kedua runtime** melalui proses rilis berizin; jangan menghapus ledger atau tabel notifikasi. Rollback Pages/Worker bersama mengikuti provenance/revert di atas, biarkan schema aditif. Versi lama tidak menangkap event baru; ini penghentian fitur, bukan retry pembayaran.
- Push yang sudah in-flight tidak dapat ditarik kembali. Generic content dan dedup/seen state membatasi race; tidak menjanjikan zero-flash OS notice. Roll-forward dapat memulihkan pending delivery, sehingga tinjau usia/backlog sebelum mengaktifkan kembali.

## 10b. Wipe riwayat pra-operasional (satu cabang sekali jalan)

Mengosongkan data transaksi uji agar operasional mulai dari nol. Destruktif:
rollback satu-satunya adalah restore dari backup langkah 1.

```powershell
pnpm d1:backup -- --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
pnpm d1:backup -- --verify-manifest <output-dir>\<run-id>\manifest.sha256.json
pnpm d1:wipe-history -- --branch <samarinda|balikpapan|berau> --backup-manifest <output-dir>\<run-id>\manifest.sha256.json
pnpm d1:wipe-history -- --branch <cabang> --backup-manifest <manifest> --apply --confirm <cabang>
```

Syarat lulus per cabang: tiap tabel `before -> 0`, tanpa error; script berhenti
total bila arsip berisi atau verifikasi nol gagal. Setelah wipe: hitung fisik
stok + rekonsiliasi finalisasi per cabang (level stok tak bisa direkonstruksi
dari mutasi yang dihapus), verifikasi katalog/pengaturan utuh, smoke checkout
satu kali. Katalog, pengaturan, policy aktif, dan audit log dipertahankan.

## 11. Release record (wajib diisi tiap rilis)

Commit SHA, artifact SHA + checksum manifest, link CI, manifest backup +
hasil verify/restore drill, diff schema + hasil migrasi per shard, checklist
smoke per cabang/perangkat, deployment IDs + waktu, snapshot monitoring,
keputusan go/no-go + nama approver.

### 11.1 Rilis hardening Antrean — 3 Oktober 2026

- **Source SHA production:** `47781c903814cece3fff867a0097b2586872bdbf`.
- **CI:** [37121261849](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37121261849), sukses pada SHA tersebut. Gate lokal `check`, `test:release` (termasuk E2E **64/64**), `lint`, `deploy:check`, dan `git diff --check` exit 0. Antrean dan restore apply juga lulus pada workerd D1 terisolasi dengan `--d1`; bukan restore production.
- **Artifact CI:** `release-47781c903814cece3fff867a0097b2586872bdbf`, ID `11273119483`, digest GitHub `sha256:2d143286654a6a0cf5e2aa1403503d5549566add66dddb318da69555ee8bf635`. SHA-256 berkas `build-artifacts.json`: `9bda82c9e84b08852228506a1318f93034d32ed69a88b95c41abad843cbe4a1e`. Manifest mencatat 169 file Pages; checksum tiga runtime root diverifikasi. Builder CI Node `v24.20.0`, pnpm `11.24.0`.
- **Dry-run:** [37121891389](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37121891389), verifikasi provenance lulus; job deploy dilewati sesuai `dry_run=true`.
- **Deploy:** [37122002582](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37122002582), job production sukses **2026-10-03 12:11:15 UTC**. Pages berasal dari artifact CI tanpa rebuild workstation. Worker realtime dibundle Wrangler di runner CI dari checkout SHA yang sama, bukan klaim checksum byte Worker identik dengan bundle Pages.
- **Provider:** Pages `2a06d56a-5fc7-4a01-90b6-aeb65229c9ea` (source `47781c9`), URL tetap <https://zatiaraspos.pages.dev>; versi Worker realtime `27708e94-b75d-4142-9453-c2a397cd4be6`.
- **Approver/window:** pengguna/pemilik dalam percakapan rilis menyetujui production dan menyatakan “Sekarang, saya approver”. Inspeksi awal menemukan satu sesi toko aktif di Samarinda; tidak ada operasi destruktif atau migrasi yang diperlukan.
- **Backup:** `D:/ZatiarasPOS-Backups/backup-2026-10-03T08-57-56-390Z-8eff3846-978e-4d74-9db0-60848477b49c/manifest.sha256.json`, penanda `COMPLETE`, verify manifest tiga shard exit 0. Restore drill lokal: Samarinda 35 tabel/22.714 baris, Balikpapan 34/1.656, Berau 34/826; ketiganya exit 0. Backup dipertahankan di luar workspace.
- **Schema:** kolom preparation/nomor, tabel `pos_nomor_harian`, indeks nomor, dan trigger pasangan nomor/tanggal sudah ada pada ketiga shard. Tidak ada migration apply, backfill, restore, atau perubahan uang/stok/pesanan uji di production.
- **Smoke otomatis production:** login owner dan Antrean scope Samarinda HTTP 200; anonim 401, cabang lain 403. Sebanyak **61 asset** cocok byte-for-byte dengan artifact CI; **59 JS/CSS** rujukan mempunyai HTTP 200/MIME benar. Tampilan aktual 390×844 tanpa overflow. Cache service worker memuat tepat satu manifest dan nol API privat; tidak ada page error/HTTP 5xx tak diharapkan selama smoke. Login/logout hanya memakai sesi autentikasi smoke sendiri.
- **Smoke operator:** pengguna memilih **“Lulus seluruh smoke”** untuk perangkat Samarinda: kios/PWA setelah menutup tab lama, reload offline setelah warm-up dan kembali online, serta cetak/reprint struk operasional yang sah dengan nomor/tanggal/nominal/kembalian sesuai snapshot. Ini pernyataan operator, bukan observasi printer/kios fisik oleh agen. Tidak ada bukti smoke fisik cabang lain.
- **Monitoring:** snapshot 10 menit saat smoke: Samarinda 53 request, HTTP 5xx 0, error 0, rata-rata 55,57 ms; Balikpapan/Berau masing-masing 0 request/error, sehingga 5xx/latensi bernilai `NULL`. Baseline sebelumnya tanpa trafik; angka ini bukan bukti statistik performa stabil dan mencakup request smoke.
- **Rollback reference:** Pages sebelumnya `684af3a4-1703-4c18-b4b6-4dcc66a54250` (source `fca84a0`); Worker sebelumnya `82cf1d06-209a-465c-852e-5b5bc15df338`. ID diamati sebelum rollout; rollback tidak dijalankan atau diklaim teruji.
- **Keputusan:** GO; gate teknis dan pernyataan smoke operator Samarinda lulus. Catatan sesudah deployment adalah dokumentasi saja; SHA source production di atas tetap menjadi acuan artifact dan provenance.
