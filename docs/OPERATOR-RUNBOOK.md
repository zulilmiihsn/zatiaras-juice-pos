# Runbook Operator — ZatiarasPOS

Prosedur operasi produksi: backup, restore, migrasi, deploy, rollback, dan operasi
cabang. Jalankan dari working tree bersih. Semua perintah remote memerlukan
`.env` berisi kredensial Cloudflare (lihat `.env.example`).

## 0. Aturan dasar

- Backup dan verifikasi **sebelum** migrasi, deploy yang mengubah perilaku data, wipe,
  atau restore.
- Satu shard sekali jalan. Berhenti pada kegagalan pertama; jangan mengulang perintah
  secara buta.
- Deploy hanya lewat workflow GitHub **Deploy** dari artifact CI. Jangan deploy output
  build dari laptop.
- Rollback aplikasi tidak mengembalikan schema D1.
- Simpan backup di luar repository, di media berbeda dari sumber.

## 1. Backup tiga shard

```powershell
pnpm d1:backup -- --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
pnpm d1:backup -- --verify-manifest <output-dir>\<run-id>\manifest.sha256.json
```

Lulus bila file `COMPLETE` terbit dan ketiga binding (`DB_SAMARINDA_GROUP`,
`DB_BALIKPAPAN_GROUP`, `DB_BERAU_GROUP`) terverifikasi. Durasi terakhir: sekitar 40 detik
untuk tiga shard.

## 2. Restore

### 2.1 Baseline tepercaya dari DB live

Ambil segera setelah backup, saat tidak ada transaksi. Alat ini hanya membaca dan gagal
tertutup bila ada penulisan di antara backup dan capture.

```powershell
node scripts/d1-live-baseline.mjs --shard <BINDING> --backup-manifest <manifest> --output <eksternal\baseline-x.json> --env-file .env
```

Catat SHA-256 yang dicetak di tempat terpisah. Nilai itu dipakai sebagai
`--expect-baseline-sha256`; jangan menghitung ulang dari file baseline.

### 2.2 Drill lokal (tanpa menyentuh produksi)

```powershell
pnpm d1:restore:drill --file "<output-dir>\<run-id>\db_samarinda_group.sql" --shard DB_SAMARINDA_GROUP --expect-baseline "<baseline-samarinda.json>" --expect-baseline-sha256 <SHA>
```

Ulangi untuk `db_balikpapan_group.sql` dan `db_berau_group.sql`. Tambahkan `--d1` untuk
menguji di workerd disposable. Backup lama memerlukan `--expect-migration <nama.sql>`.

### 2.3 Drill ke database sementara

1. Buat DB `zatiaraspos-drill-<cabang>` (`wrangler d1 create`) dan config Wrangler
   terpisah di luar repo.
2. `wrangler d1 execute <scratch> --remote --config <config> --file <backup.sql>`.
3. Verifikasi (hanya menerima nama `zatiaraspos-drill-*`):
   ```powershell
   node scripts/d1-live-baseline.mjs --shard <BINDING> --backup-manifest <manifest> --verify-target <scratch> --target-config <config> --expect-baseline <baseline.json> --expect-baseline-sha256 <hash> --env-file .env
   ```
4. Hapus DB sementara: `wrangler d1 delete <scratch> -y`.

Durasi terakhir: 15–23 detik per shard. Target pemulihan: RTO ≤ 1 jam; RPO = data
sejak backup terakhir.

### 2.4 Restore sungguhan

Destruktif. Hanya dengan persetujuan pemilik untuk target yang disebut eksplisit:

```powershell
CONFIRM_D1_RESTORE=<binding> pnpm d1:restore -- --database <binding> --file <backup.sql>
```

Restore arsip R2 memakai `node scripts/restore-archive.mjs --file <archive.json> --dry-run`
dulu; apply memerlukan `--expect-sha256` yang disetujui.

## 3. Migrasi schema

Migrasi tidak pernah ikut deploy. Untuk setiap file baru di `drizzle/`:

1. Backup dan verifikasi (§1).
2. Tinjau isi SQL. Pastikan aditif atau punya rencana rollback.
3. Terapkan per shard, berurutan, verifikasi di antara shard:
   ```powershell
   pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama.sql --yes
   pnpm exec wrangler d1 execute DB_BALIKPAPAN_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama.sql --yes
   pnpm exec wrangler d1 execute DB_BERAU_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama.sql --yes
   ```
4. Verifikasi tabel/kolom baru dengan `SELECT`/`PRAGMA table_info` per shard.
5. Baru deploy aplikasi yang membutuhkan schema itu.

Rollback schema memakai `node scripts/rollback-migration.mjs --shard <BINDING> --backup-manifest <manifest> --expect-baseline <baseline.json> --expect-baseline-sha256 <hash> --dry-run`
(default dry-run; `--live --apply` hanya dengan persetujuan).

## 4. Deploy aplikasi

1. Pastikan CI hijau pada commit HEAD `main`. Workflow Deploy menolak SHA selain HEAD.
2. GitHub Actions → **Deploy** → `workflow_dispatch` dengan SHA, `ci_run_id` (run CI hijau
   pemilik artifact), dan `dry_run=true`.
3. Bila verifikasi manifest lulus, jalankan lagi dengan `dry_run=false` (perlu approval
   environment `production`).
4. Catat deployment ID Worker realtime dan Pages; keduanya harus dari SHA yang sama.
5. Smoke (§5).

Commit dokumentasi yang di-push sesudah CI membuat SHA lama gagal "Assert Release SHA";
deploy HEAD terbaru dengan run CI miliknya.

Jangan merangkai build dan deploy manual dari laptop: build parsial pernah menghasilkan
worker baru dengan aset basi (semua JS/CSS 404). Artifact CI memuat seluruh
`.svelte-kit/cloudflare`, `.svelte-kit/cloudflare-tmp`, dan `.svelte-kit/output/server`.

Verifikasi artifact membandingkan hash byte. Checkout Windows lama yang masih CRLF gagal
dengan pesan "Hanya beda akhir baris CRLF"; perbaiki dengan checkout ulang setelah
memastikan tidak ada perubahan lokal: `git rm --cached -r . && git reset --hard`.

**Rollback kode**: revert commit rilis, tunggu CI hijau, lalu deploy seperti di atas.
Darurat: pilih deployment Pages dan versi Worker sebelumnya di dashboard Cloudflare
dan catat ID-nya.

## 5. Smoke per cabang

Login valid/invalid; kunci PIN; buka/tutup sesi; checkout tunai dan non-tunai (total,
kembalian, ledger, stok, ringkasan, struk); satu replay offline tanpa duplikat; void dan
ubah metode bayar; laporan dan pajak; realtime di dua browser; cetak struk di printer
yang dipakai cabang.

## 6. Pemicu stop/rollback

Checksum backup/artifact tidak cocok; schema berbeda antar shard; migrasi satu shard
gagal; login atau isolasi cabang gagal; selisih uang/pajak/stok/ringkasan/struk; replay
duplikat; event realtime lintas cabang.

## 7. Monitoring stok per cabang

- Diubah pemilik di `/pengaturan/pemilik/stok`. Cabang yang boleh memakai fitur diatur
  di tabel `stock_feature_rollout` (tanpa redeploy):
  `UPDATE stock_feature_rollout SET branches = '<cabang>' WHERE feature = 'stock_monitoring'`.
- Sebelum menonaktifkan, pastikan antrean offline semua perangkat cabang kosong. Sisa
  antrean akan dikarantina (428) dan perlu persetujuan pemilik.
- Mengaktifkan ulang wajib rekonsiliasi fisik di halaman yang sama sampai finalisasi.
- Jangan rollback ke versi aplikasi yang belum mengenal kebijakan stok selama ada cabang
  `ignored`.

## 8. Antrean dan notifikasi push

- Prasyarat: migrasi `0037_antrean_notifications.sql` di tiga shard; secret
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, dan variabel `VAPID_SUBJECT` di GitHub
  Environment `production` (workflow Deploy menyalinnya ke Pages dan Worker realtime);
  cron `* * * * *` aktif di Worker realtime.
- Cek config: `pnpm deploy:check -- --require-antrean-push`.
- Aktivasi perangkat: login kasir/pemilik, (iOS: pasang PWA di Home Screen), buka
  Pengaturan → Antrean, tekan **Tes suara**, pastikan service worker **Siap**, lalu
  **Aktifkan notifikasi perangkat**.
- Arsip menolak cutoff yang masih memuat pesanan Belum selesai.
- Menghentikan push: nonaktifkan config di kedua runtime lewat rilis; jangan menghapus
  tabel notifikasi atau ledger. Push yang sudah terkirim tidak bisa ditarik.

## 9. Wipe riwayat transaksi uji (satu cabang)

Destruktif; rollback satu-satunya adalah restore dari backup.

```powershell
pnpm d1:backup -- --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
pnpm d1:backup -- --verify-manifest <output-dir>\<run-id>\manifest.sha256.json
pnpm d1:wipe-history --branch <cabang> --backup-manifest <manifest> --expect-baseline <baseline.json> --expect-baseline-sha256 <hash> --dry-run
# Sesudah persetujuan pemilik:
pnpm d1:wipe-history --branch <cabang> --backup-manifest <manifest> --expect-baseline <baseline.json> --expect-baseline-sha256 <hash> --live --apply --confirm <cabang>
```

- Default lokal; `--live` untuk remote. `--apply` wajib disertai `--confirm` dengan nama
  cabang yang sama.
- Tabel yang dihapus: lihat `WIPE_TABLES` di `scripts/wipe-branch-history.mjs`. Katalog,
  pengaturan, kebijakan stok, log audit, dan riwayat rekonsiliasi stok dipertahankan.
- Skrip membaca ulang jumlah baris tiap tabel sesudah apply; sisa baris berarti wipe
  sebagian dan harus dipulihkan dari backup.
- Sesudahnya: hitung fisik stok dan finalisasi rekonsiliasi bila monitoring stok aktif,
  periksa katalog/pengaturan, dan lakukan satu smoke checkout.

## 10. Rotasi kredensial

`pnpm security:rotate-production -- --live --output-dir <ABSOLUTE_PATH_OUTSIDE_WORKSPACE> --env-file .env`
membuat password baru untuk akun kasir dan pemilik di semua cabang dan menulis file serah
terima di luar repo. Verifikasi file itu dengan `--live --verify-handoff <file>`. Untuk kunci harga POS,
isi `POS_PRICE_SIGNING_KEY_PREVIOUS`/`_PREVIOUS_ID` dengan kunci lama agar antrean offline
yang masih membawa token lama tetap terverifikasi, lalu hapus setelah antrean kosong.
