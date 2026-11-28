# Runbook Operator — ZatiarasPOS

Prosedur operasi produksi: backup, restore, migrasi, deploy, rollback, dan operasi
cabang. Jalankan dari working tree bersih. Simpan kredensial Cloudflare di luar repo.
Backup aktif membaca referensi file env dari inventaris; prosedur lama memakai file env akun sumber.

## 0. Aturan dasar

- Backup dan verifikasi **sebelum** migrasi, deploy yang mengubah perilaku data, wipe,
  atau restore.
- Satu shard sekali jalan. Berhenti pada kegagalan pertama; jangan mengulang perintah
  secara buta.
- Deploy hanya lewat workflow GitHub **Deploy** dari artifact CI. Jangan deploy output
  build dari laptop.
- Rollback aplikasi tidak mengembalikan schema D1.
- Simpan backup di luar repository, di media berbeda dari sumber.

## 1. Backup tiga D1 aktif

Simpan inventaris tepercaya di luar repo dan workspace. Schema JSON
`zatiaraspos-d1-active-inventory-v1` memiliki `branches` dengan tepat tiga key:
`samarinda`, `balikpapan`, dan `berau`. Setiap cabang berisi `account_id`, `database_id`,
`token_env_file` (path absolut ke file env di luar workspace), dan `token_env_key`
(`CLOUDFLARE_API_TOKEN` atau `BRANCH_CF_TOKEN_<CABANG>`). Jangan isi nilai token dalam
inventaris. Cocokkan inventaris dengan binding D1 pada Worker aktif sebelum menambah atau
mengubah tujuan. Nama database diturunkan dari cabang (`zatiaraspos-<cabang>`).

```powershell
rtk pnpm d1:backup -- --active-inventory "<ABSOLUTE_INVENTORY.json>" --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>"
rtk pnpm d1:backup -- --active-inventory "<ABSOLUTE_INVENTORY.json>" --verify-manifest "<output-dir>\<run-id>\manifest.sha256.json"
```

Ekspor hanya berjalan setelah ketiga identitas D1 terverifikasi. `COMPLETE` berarti ketiga
file SQL dan manifest v2 lulus pembacaan ulang dan SHA-256. Ekspor berturutan saat kasir
aktif bukan snapshot atomik lintas cabang, dan tidak mencakup R2 atau antrean Durable Object.
Simpan inventaris yang sesuai dengan backup untuk verifikasi tanpa kredensial Cloudflare.

Sesudah shift tutup, jalankan workflow **Deploy** dengan `target=branch-account-staging`
dan `branch_backup_readiness_check=true`. Mode baca-saja memakai probe privat yang sudah
ada, bukan men-deploy aplikasi. Hanya bukti shift tertutup dan antrean koordinator nol
berstatus terverifikasi. Respons `503`, gangguan jaringan, atau respons tanpa marker
adalah **belum terverifikasi**, bukan jumlah antrean. Untuk angka persis, pemilik membuka
**Pengaturan → Mode cadangan kasir → Periksa status koordinator** di setiap cabang.
Cek antrean HP terpisah. Status pada satu waktu tidak mengesahkan backup dari waktu lain;
catat waktu pemeriksaan dan backup, dan jangan mengklaim cakupan antrean dari manifest SQL.

`--legacy-source --env-file <file>` hanya untuk mengekspor tiga database lama dari
`wrangler.pages.jsonc`, bukan backup transaksi baru. Untuk manifest lama (v1), verifikasi
tanpa `--active-inventory`.

## 2. Restore

### 2.1 Baseline tepercaya dari DB live

Perintah baseline/restore di bagian ini masih mengacu ke inventaris legacy. Jangan
menggunakannya pada tiga D1 aktif sebelum alur pemulihan lintas akun diuji.

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

### 2.4 Persiapan cutover tiga cabang dalam satu jendela

Pengujian boleh bertahap, tetapi produksi tidak memakai pilot. Samarinda, Balikpapan, dan Berau
beralih dalam satu jendela dan dibuka bersama setelah seluruh pemeriksaan lulus. D1 tujuan tidak
menerima trafik kasir selama persiapan. Mode `branch_production_d1_prepare=true` pada workflow **Deploy** target
`branch-account-staging` hanya menyiapkan tujuan kosong `zatiaraspos-samarinda`,
`zatiaraspos-balikpapan`, dan `zatiaraspos-berau` di akun yang diverifikasi via inventori.
Mode itu tidak memasang binding, mengimpor data, menjalankan migrasi, atau memindahkan URL.
`branch_production_d1_check=true` memeriksa ulang ketiganya tanpa membuat database baru.
Gunakan `branch_production_candidate=true` untuk menyiapkan tiga backend dan gateway kandidat
pada hostname `workers.dev` khusus, tanpa route produksi. Mode ini memerlukan secret khusus
`BRANCH_PRODUCTION_PREP_KEY` (32 byte acak dalam hex), hanya menerima D1 tujuan kosong, dan
menguji penolakan trafik sebelum menyatakan kandidat siap. Tidak ada binding R2 produksi atau
alarm pemeliharaan di tahap ini. Kandidat wajib `BRANCH_CUTOVER_STATE=paused` dan tidak bisa
langsung dibuka lewat konfigurasi kandidat. Pemasangan gateway pada URL kasir produksi yang
sama adalah pekerjaan cutover terpisah; jeda kandidat bukan pengganti penguncian jalur lama.
Jika izin atau slot Free gagal, hentikan dan periksa inventori; jangan hapus database lain
untuk memberi ruang. Setelah pindah akun, gunakan inventaris backup aktif di §1. Untuk
backup sumber lama sebelum cutover, pilih `--legacy-source` secara eksplisit.

Sebelum jadwal, jalankan `branch_cutover_preflight=true`. Mode ini membaca identitas sumber,
jumlah shift, bucket R2, dan referensi deployment Pages aktif tanpa menulis data produksi.
Ini juga menguji jeda ingress pada hostname utama project Pages sementara. Relay terotorisasi
khusus uji memakai service binding ke gateway staging: cek autentikasi ketiga cabang, lalu
uji buka shift, penjualan, struk, retry, dan tutup shift dengan data sintetis Samarinda.
Project sementara tidak memiliki binding data dan dihapus setelah uji. Hasil ini tidak
membuktikan jalur langsung project `zatiaraspos`, TLS alias preview, atau akses R2 produksi.
Jika ada pemeriksaan yang belum terverifikasi, jangan menandai gate lulus.

Setelah URL kasir lama dijeda dan backup R2 terverifikasi, jalankan
`branch_production_storage_readonly=true`. Mode ini hanya menyiapkan Worker relay terpisah
pada bucket produksi `zatiaras-assets` di Samarinda. Ia membandingkan byte gambar produksi,
menguji penolakan akses lintas cabang dan penulisan, serta mengecek bahwa URL kasir tetap
jeda. Mode ini tidak menghubungkan gateway atau backend produksi baru, tidak menyalin
objek, dan tidak membuka layanan.

Setelah ketiga impor ekspor-balik lulus dan relay itu terverifikasi, jalankan
`branch_production_connect_paused=true`. Mode ini hanya menyambungkan backend kandidat
yang sudah tertutup ke D1 tujuan dan relay R2. Probe privat membuktikan pembacaan scoped
D1 dan R2, sementara login langsung maupun relay login tetap ditolak. Mode ini tidak
merilis Pages, mengaktifkan alarm maintenance, atau mengizinkan penjualan.

`branch_production_pages_paused=true` baru dijalankan setelah ketiga probe backend tertutup
lulus. Mode ini memasang gateway pada `https://zatiaraspos.pages.dev` menggunakan artefak
CI, tanpa binding D1/R2 di Pages. Dari URL yang sama, verifikasi login publik tetap `503`,
dan probe privat hanya bisa membaca status ketiga backend. Workflow merekam deployment
Pages lama di ringkasan run. Jika verifikasi gagal setelah upload, coba rollback hanya
bila versi aktif berasal dari rilis tersebut; bila rollback tidak terverifikasi, jangan
membuka atau mengulang deploy sebelum status diperiksa. Worker realtime lama tetap dijeda.

`branch_production_storage_writes=true` memerlukan gateway baru tetap dijeda dan ketiga
probe privat lulus. Mode ini hanya mengubah relay R2. Uji baca-tulis memakai objek sintetis
acak per cabang, menolak akses/penghapusan lintas cabang, lalu menghapus dan memverifikasi
hilangnya objek uji. Jika verifikasi gagal, kembalikan relay ke baca-saja; apabila workflow
melaporkan kebutuhan pembersihan manual, hapus hanya key fixture yang dicatat. Mode ini
tidak membuka akses kasir atau mengubah data D1.

`branch_production_operational_prep=true` memasang binding koordinator, kunci harga,
dan binding maintenance untuk setiap backend yang tetap tertutup. Probe privat memastikan
koordinator belum diinisialisasi, antrean proyeksi kosong, dan satu token katalog lolos
verifikasi tanda tangan. Probe tidak menerbitkan katalog, menginisialisasi stok/shift,
menyalakan alarm, atau mencatat transaksi. Uji penjualan dan sinkronisasi tetap memakai
fixture terisolasi, bukan data produksi.

Setelah operator mengonfirmasi stok yang akan dipakai koordinator dan cutoff POS sementara,
catat setiap cabang di luar repo. Jalankan `branch_activation_ack=STOCK_AND_CUTOFF_CONFIRMED`
hanya untuk aktivasi tertutup. Mode ini memverifikasi ketiga kandidat sebelum aktivasi,
lalu memakai use case aktivasi koordinator yang sama (katalog, stok, nomor awal, dan fence
D1). Setiap cabang harus berakhir dengan shift tertutup dan antrean nol. Halaman Pages
berstatus jeda sebelum dan sesudah; alarm belum dinyalakan. Jika terhenti, jangan hapus
fence atau membuka satu cabang; periksa status D1 dan koordinator sebelum memutuskan retry
atau rollback. Pembukaan publik adalah tahap terpisah.

`branch_public_open_ack=ACTIVATION_STOCK_CUTOFF_CONFIRMED` hanya digunakan setelah seluruh
aktivasi lulus dan penyerahan POS sementara dicatat. Workflow lebih dulu membuktikan D1
sudah dipagari dan ketiga backend siap melayani relay ketika Pages masih dijeda. Satu
upload Pages membuka URL yang sama bagi semua cabang. Jika verifikasi URL gagal setelah
upload, rollback hanya ke **gateway cabang yang dijeda**, bukan POS lama. Jika ada trafik
saat itu, pertahankan otoritas D1/DO baru dan lakukan rekonsiliasi; jangan mengandalkan
rollback Pages untuk membatalkan transaksi. Mulai alarm maintenance hanya setelah gateway
publik terverifikasi. Kegagalan alarm dilaporkan tanpa membatalkan pembukaan atau penjualan.

Catat bukti per cabang di luar repo dan jangan isi kolom sebagai lulus tanpa hasil:

| Cabang     | Shift tutup / antrean HP dan DO kosong | Rekap POS sementara cocok | Backup + baseline | Paritas kas, stok, struk, nomor |
| ---------- | -------------------------------------- | ------------------------- | ----------------- | ------------------------------- |
| Samarinda  |                                        |                           |                   |                                 |
| Balikpapan |                                        |                           |                   |                                 |
| Berau      |                                        |                           |                   |                                 |

Sebelum membekukan penulisan, siapkan folder backup di luar repo dengan izin akses terbatas
serta salinan pada media terpisah. Simpan ID rollback Pages yang sudah diperiksa ulang,
konfigurasi binding, dan checksum backup bersama bukti operator; jangan simpan secret.

1. **Bekukan ketiga sumber:** hentikan penerimaan transaksi baru, selesaikan shift dan kuras
   antrean koordinator serta setiap HP. Cocokkan penjualan dari POS sementara secara terpisah;
   jangan impor ulang tanpa memeriksa duplikasi. Setelah itu blokir penulisan pada semua jalur
   lama, termasuk endpoint dan pekerjaan terjadwal yang bisa menghasilkan transaksi. Catat
   waktu, akun dan ID D1 sumber/tujuan, rute aktif, serta identitas backup. Hentikan cutover
   jika satu cabang masih menerima penulisan atau tidak bisa membuktikan antrean kosong.
   Kandidat pagar lama memakai `LEGACY_CUTOVER_STATE=paused` pada **Pages dan Worker realtime**
   secara terpisah. Pages menolak request dinamis sebelum dispatch, sementara Worker realtime
   melewati Cron yang dapat menulis D1. Setelah rilis pagar yang terverifikasi, buktikan penolakan
   dari URL lama dan versi Worker yang aktif. Tunggu request yang sudah terlanjur berjalan dan
   pastikan penulis eksternal, alarm kios bila aktif, serta pekerjaan operator berhenti. Pagar HTTP
   dan Cron saja tidak memblokir kredensial API D1 atau pekerjaan yang sudah berjalan.
2. **Backup dan baseline:** jalankan §1 dan §2.1. Simpan manifest, hash baseline, dan SQL
   di luar repo. Ekspor arsip R2 yang relevan secara terpisah dan verifikasi bisa dibaca;
   dump D1 tidak mencakup arsip maupun antrean Durable Object.
3. **Uji restore:** jalankan §2.2 termasuk `--d1`, lalu §2.3 di akun tujuan tanpa rute kasir.
   Cocokkan jumlah dan hash tabel, stok, buku kas, nomor pesanan, struk, serta shift tertutup.
   Gunakan inventori D1 tujuan yang eksplisit; identifikasi ulang akun dan ID sebelum impor.
   Jangan lanjut jika target sementara, manifest, arsip, atau paritas belum terverifikasi.
4. **Satu penulis, satu pelepasan:** pasang seluruh tujuan pada gateway dalam keadaan jeda,
   verifikasi rute dan backend yang tepat untuk ketiga cabang, lalu buka gateway sekaligus hanya
   jika semuanya lulus. Pastikan jalur langsung maupun lama tak bisa menerima penjualan.
   Observasi versi aktif dari URL produksi dan simpan bukti penjualan, struk, stok, dan
   sinkronisasi D1 pertama tiap cabang. Bila pemeriksaan gagal, pertahankan jeda; jangan buka
   sebagian cabang.

**Rollback sebelum ada penulisan bisnis di tujuan:** tutup akses tulis tujuan dan buktikan
antrean koordinator tujuan kosong serta tidak ada perubahan bisnis sejak baseline. Kembalikan
rute ke sumber, verifikasi login dan stok, lalu buka penulisan sumber. Jangan membuka dua sisi.

**Rollback setelah ada penulisan bisnis di tujuan atau statusnya belum pasti:** jangan sekadar
mengganti rute atau memulihkan dump lama. Bekukan kedua sisi, simpan bukti dan backup tujuan,
kuras antrean jika aman, lalu rekonsiliasi transaksi, stok, shift, nomor pesanan, struk, dan
arsip sejak cutover. Uji pemulihan perubahan itu pada salinan dan verifikasi idempotensi sebelum
membuka satu sisi saja. Jika paritas belum terbukti, pertahankan penutupan dan eskalasi. Jangan
melepas pagar database atau mereset Durable Object untuk memaksa rollback.

#### Latihan cutover dan rollback tanpa gangguan kasir

Jangan menjalankan rollback mode kios pada koordinator staging yang masih dipakai
untuk pengujian kasir. Rollback menandai kebijakan `rolled-back`; aktivasi ulang menolak snapshot yang
sama. Untuk latihan live, sediakan D1 sementara dan namespace koordinator baru, gunakan data
sintetis serta rute uji terpisah, lalu cocokkan ID akun/resource sebelum membuat perubahan.
Jangan jalankan latihan ini melalui gateway kasir yang sedang melayani transaksi.

- **Bukti lokal:** `pnpm test:shift-workerd` mensimulasikan batas D1, membuktikan rollback
  menolak antrean yang belum terproyeksi, lalu memverifikasi sinkronisasi dan pembukaan
  kembali jalur lama di Workerd. `pnpm test:branch-account-compiled` juga memakai tiga D1
  disposable untuk latihan Balikpapan: pagar di sumber, replay snapshot ke backend tujuan,
  satu transaksi melalui gateway, antrean kosong, lalu paritas snapshot tujuan pada salinan
  rollback sebelum jalur lama dibuka di salinan saja. Ini latihan lokal, bukan bukti
  perpindahan rute atau backup produksi di Cloudflare.
- **Latihan rute live:** mode `branch_route_drill=true` memindahkan satu gateway khusus
  latihan dari service binding lokal ke backend lintas akun dan kembali lagi. Fase jeda
  harus teramati dari URL latihan yang sama. Worker sementara tidak punya D1, R2, atau sesi
  pengguna, dan dibersihkan setelah latihan. Hasil ini membuktikan rute, bukan migrasi data.
- **Bukti live yang masih diperlukan:** uji satu cabang pada resource sementara dari backup
  dan baseline awal. Setelah aktivasi tujuan, buktikan sumber tidak menerima penjualan;
  kirim satu transaksi sintetis dua kali di tujuan, tutup shift, dan verifikasi D1, stok, struk,
  nomor pesanan, serta status antrean. Rollback setelah transaksi memerlukan rekonsiliasi ke
  salinan sumber. Buka kembali hanya satu jalur setelah saldo dan jumlah transaksi cocok.
- **Pemeliharaan:** respons aktivasi alarm saat deploy membuktikan jadwal tersimpan, bukan
  pekerjaan selesai. Cek event `[audit-maintenance]` dan hasil audit/retensi per backend pada
  tick pertama sebelum menilai pemeliharaan staging lulus.

### 2.5 Restore sungguhan

Jangan pakai `d1:restore --live`, `rollback-migration --live`, atau CLI arsip dari
checkout lama untuk D1 aktif tiga akun: konfigurasi bawaan masih menunjuk shard legacy.
Restore penuh produksi memerlukan prosedur terpisah yang membuktikan identitas akun dan
D1 tujuan, membekukan penulis/koordinator yang relevan, dan melindungi transaksi setelah snapshot.

Untuk arsip JSON, pakai `node scripts/restore-archive.mjs --file <archive.json> --dry-run`.
Apply yang tersedia hanya untuk Workerd lokal dengan skema mutakhir dan `--expect-sha256`
yang disetujui. `--remote --apply` ditolak; kompatibilitas CLI dengan `0051` tidak berarti
jalur restore produksi sudah disertifikasi.

## 3. Migrasi schema

Migrasi tidak pernah ikut deploy. Sumber rilis topologi tiga akun adalah
`release/branch-account-staging`; produksi aktif sudah mencatat `0051`–`0053` di ketiga
D1. Jangan jalankan migrasi dari checkout yang tidak memuat riwayat tersebut. Ledger
`d1_migrations` tetap menjadi sumber versi tiap target:

1. Backup dan verifikasi (§1).
2. Tinjau isi SQL migrasi baru. Pastikan aditif atau punya rencana rollback.
3. Validasi urutan dan checksum semua migrasi terhadap `drizzle/meta` (tanpa menyentuh DB):
   ```powershell
   node scripts/migrate-production.mjs
   ```
   Tanpa `--apply` skrip hanya memvalidasi. `pnpm d1:migrate` menerapkan ke D1 lokal.
4. Terapkan hanya migrasi yang sudah ditinjau dan belum tercatat ke tiga D1 aktif, dengan
   inventaris aktif per akun, satu D1 sekali jalan. Catat SQL dan nama migrasi dalam batch
   D1 yang sama, readback tiap target, dan berhenti pada kegagalan pertama. `pnpm
d1:migrate:live` bawaan mengacu ke konfigurasi legacy, bukan runner tiga akun.
5. Verifikasi tabel/kolom baru dengan `SELECT`/`PRAGMA table_info` per shard, dan pastikan
   `SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1` menunjuk migrasi terbaru.
6. Baru deploy aplikasi yang membutuhkan schema itu.

Jangan terapkan `wrangler d1 execute --file` yang tidak mencatat `d1_migrations` di batch
sama. Untuk rollback D1 aktif, ikuti prosedur khusus migrasi yang sudah diuji; jangan
menimpa penjualan baru dengan snapshot lama.

### 3.1 Kesehatan data sebelum migrasi enforcement

Wajib sebelum menambah constraint apa pun (FK, unique, check); lihat
[ADR 0003](adr/0003-foreign-keys.md). Perintah ini hanya membaca backup dan tidak menyentuh
produksi. Jalankan per shard terhadap file backup hasil §1:

```powershell
pnpm d1:health --file "<output-dir>\<run-id>\db_samarinda_group.sql" --shard DB_SAMARINDA_GROUP
```

Ulangi untuk `db_balikpapan_group.sql` (`DB_BALIKPAPAN_GROUP`) dan `db_berau_group.sql`
(`DB_BERAU_GROUP`). Perintah memeriksa setiap cabang pada shard itu: detail transaksi tanpa header
buku kas, mutasi bahan tanpa bahan induk, dan stok negatif.

- Exit 0: semua cabang bersih, migrasi boleh dilanjutkan untuk shard itu.
- Exit 1: ada temuan. Hentikan. Perbaiki manual; dilarang dedup atau hapus otomatis.
- Exit 2: pemeriksaan tidak dapat dijalankan (argumen, file, atau skema dump). Bukan tanda bersih.
- Daftar temuan dibatasi 100 baris per jenis; bila terpotong, hasilnya diberi catatan.

### 3.2 Migrasi 0045: FK `transaksi_kasir` → `buku_kas` (Fase 1)

Menambah FK komposit `(cabang_id, buku_kas_id)` → `buku_kas(cabang_id, id)` tanpa cascade. Tabel
dibangun ulang, tetapi tidak ada baris yang diubah atau dibuang. Data yatim atau lintas cabang
menggagalkan seluruh migrasi: di D1 satu file dibatalkan utuh (tabel lama, indeks, dan catatan
`d1_migrations` tidak berubah), dan migrasi aman diulang. Pengaman hitung-baris menolak membuang
tabel lama bila salinan tidak lengkap.

Urutan wajib:

1. **Staging dengan salinan produksi.** Backup (§1), muat tiap file ke D1 staging (§4a langkah 2,
   pilihan A), lalu `pnpm d1:migrate:staging`. Latihan ini sekaligus menjadi preflight pada data asli.
2. **Produksi.** Backup terverifikasi, `pnpm d1:health` bersih untuk ketiga shard (§3.1), lalu
   `pnpm d1:migrate:live`. Berhenti pada kegagalan pertama; shard yang belum termigrasi tetap
   berfungsi karena aplikasi berjalan dengan skema lama maupun baru.
3. **Verifikasi per shard** (hitung baris harus sama dengan sebelum migrasi):
   ```sql
   SELECT COUNT(*) FROM transaksi_kasir;
   SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('transaksi_kasir');
   SELECT * FROM pragma_foreign_key_check;
   ```
   Daftar FK harus berisi dua baris ke `buku_kas` dengan `NO ACTION`, dan `foreign_key_check` kosong.

Bila gagal dengan `FOREIGN KEY constraint failed`, ada detail yatim atau lintas cabang.
`pnpm d1:health` menampilkan barisnya. Jangan dedup atau hapus otomatis. Koreksi yang bersifat
menambah (memulihkan header yang hilang) atau keputusan pemilik, lalu ulangi migrasi.

**Rollback:** `scripts/rollback-0045-transaksi-kasir-fk.sql` melepas FK tanpa membuang baris
(dijalankan per shard dengan `wrangler d1 execute --file`, lihat komentar di file). Pakai ini lebih
dulu daripada restore backup, yang membuang transaksi masuk sesudah backup.

### 3.3 Migrasi 0046: FK `bahan_mutasi` → `bahan` (Fase 2)

FK komposit per cabang tanpa cascade mempertahankan riwayat; penghapusan bahan yang memiliki
mutasi ditolak dengan 409. Sebelum migrasi, pastikan backup baru terverifikasi dan `d1:health`
bersih pada setiap shard. Bila ada orphan, berhenti dan minta keputusan pemilik; jangan hapus
atau perbaiki data otomatis. Perhitungkan kuota bersama sebelum drill atau impor data. Uji staging
terlebih dahulu dan minta persetujuan produksi terpisah.

Bandingkan seluruh isi `bahan_mutasi` sebelum dan sesudah, pastikan dua baris FK `NO ACTION`
ke `bahan`, kedua trigger rekonsiliasi tetap ada, dan `PRAGMA foreign_key_check` kosong per shard.
Uji juga penghapusan bahan tanpa riwayat dan penolakan bahan dengan riwayat pada data uji.

Jika rollback diperlukan, hentikan penulisan, buat backup terverifikasi, dan uji
`scripts/rollback-0046-bahan-mutasi-fk.sql` pada salinan sebelum menjalankannya per shard.
Bandingkan ulang seluruh baris dan trigger. Rollback tidak menghapus catatan `d1_migrations`;
rencanakan forward-fix secara terpisah dan jangan mengaktifkan kembali penulisan sampai verifikasi
selesai.

### 3.4 Migrasi 0052: hapus indeks path telemetri

`0052` hanya menghapus `idx_request_metrics_branch_path`. Kolom, baris, kebijakan
retensi, dan indeks monitoring `idx_request_metrics_branch_created` tetap. Halaman
indeks dapat dipakai ulang; jangan menganggap ukuran file D1 langsung mengecil.

Sebelum rilis: pastikan tidak ada konsumen eksternal yang mengandalkan indeks path,
verifikasi perubahan di D1 staging, dan ambil backup baru ketiga D1 aktif. Cek bahwa
`0051` adalah migrasi terakhir dan indeks path serta indeks waktu ada di setiap target.
Terapkan ke satu D1 aktif pada satu waktu; catat `0052` dalam `d1_migrations` di batch yang
sama. Verifikasi indeks path tidak ada, indeks waktu masih ada, monitoring berjalan, dan
hentikan rollout jika salah satu target gagal. Jangan arahkan migrasi ke shard legacy.

Jika indeks ternyata masih dibutuhkan, pulihkan lewat migrasi lanjutan yang menjalankan
`CREATE INDEX idx_request_metrics_branch_path ON request_metrics(cabang_id, path);`.
Jangan restore seluruh D1 atau hapus catatan `0052` hanya untuk mengembalikan indeks.

### 3.5 Migrasi 0053: hapus indeks duplikat ringkasan penjualan

`0053` hanya menghapus `idx_daily_sales_branch_date_range`. Indeks unik
`idx_daily_sales_branch_date` tetap melayani rentang tanggal dan menjaga satu ringkasan
per cabang/tanggal untuk upsert POS. Tidak ada perubahan baris atau kontrak laporan.

Sesudah `0052`, verifikasi kedua indeks mempunyai key `(cabang_id, tanggal_penjualan)` dan
indeks yang dipertahankan unik; uji laporan rentang tanggal dan upsert POS di D1 staging.
Gunakan backup baru dan verifikasi setiap target aktif. Bila perlu pulihkan indeks lewat
migrasi lanjutan, gunakan:

```sql
CREATE INDEX idx_daily_sales_branch_date_range
ON ringkasan_penjualan_harian(cabang_id, tanggal_penjualan);
```

## 4. Deploy aplikasi

1. Pastikan CI hijau pada commit HEAD `main`. Workflow Deploy menolak SHA selain HEAD.
2. GitHub Actions → **Deploy** → `workflow_dispatch` dengan SHA, `ci_run_id` (run CI hijau
   pemilik artifact), dan `dry_run=true`.
3. Bila verifikasi manifest lulus, jalankan lagi dengan `dry_run=false` (perlu approval
   environment `production`).
4. Catat deployment ID Worker realtime dan Pages; keduanya harus dari SHA yang sama.
5. Smoke (§5).

Manifest wajib memiliki inventori checksum config Cloudflare dan metadata migrasi
yang lengkap. Grup yang hilang/kosong atau hash file yang dihapus tetap ditolak,
meskipun SHA dan byte bundle cocok. Ambil ulang artefak dari CI yang benar atau
bangun ulang melalui CI; jangan mengisi inventori secara manual untuk melewati gate.

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

## 4a. Staging

Staging memakai resource terpisah yang semuanya berakhiran `-staging`: tiga D1
(`zatiaras-*-group-staging`), bucket R2 `zatiaras-assets-staging`, Worker
`zatiaraspos-realtime-staging`, dan proyek Pages `zatiaraspos-staging`
(`https://zatiaraspos-staging.pages.dev`). Config-nya ada di `staging/`; config produksi tidak
dipakai. `test:staging` gagal bila config staging menunjuk resource produksi.

**Setup sekali jalan (pemilik akun Cloudflare):**

1. Buat resource dan isi ID D1 ke `staging/*.jsonc` (idempoten, aman diulang):
   ```powershell
   pnpm staging:setup
   ```
   Commit perubahan `staging/*.jsonc` yang dihasilkan.
2. Isi data. Pilihan A, salinan produksi: ambil backup (§1), lalu muat tiap shard ke D1 staging
   yang masih kosong:
   ```powershell
   pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --remote --config staging/wrangler.realtime.jsonc --file <output-dir><run-id>db_samarinda_group.sql --yes
   ```
   Ulangi untuk `DB_BALIKPAPAN_GROUP` dan `DB_BERAU_GROUP`. Akun dan katalog ikut tersalin, jadi
   login staging sama dengan produksi. Pilihan B, database kosong: `pnpm d1:migrate:staging`, lalu
   seed UAT `scripts/seed-uat-samarinda.sql` ke `DB_SAMARINDA_GROUP` dengan perintah yang sama.
3. Secret Pages staging (kunci harga berbeda dari produksi):
   ```powershell
   pnpm exec wrangler pages secret put POS_PRICE_SIGNING_KEY --project-name zatiaraspos-staging
   ```
   `OPENROUTER_API_KEY` opsional, dengan cara yang sama.
4. GitHub → Settings → Environments → buat environment `staging` (tanpa reviewer), lalu isi
   secret `CLOUDFLARE_API_TOKEN`. Secret produksi tersimpan di environment `production`, bukan
   level repository, jadi staging tidak mewarisinya. Dari token di `.env` tanpa menampilkannya:
   ```powershell
   grep '^CLOUDFLARE_API_TOKEN=' .env | cut -d= -f2- | gh secret set CLOUDFLARE_API_TOKEN --env staging
   ```
   VAPID staging opsional.

**Setiap rilis:**

1. Migrasi baru ke staging dulu: `pnpm d1:migrate:staging`.
2. Workflow **Deploy** dengan `target=staging` (dry-run tidak perlu; artifact diverifikasi di job
   verify). `staging_ref` boleh `main` (default) atau branch `release/*`. Untuk preview branch,
   jalankan workflow dari ref yang memuat perubahan workflow dan isi `staging_ref` dengan nama
   branch release itu. SHA wajib HEAD ref terpilih, dan `ci_run_id` wajib menunjuk workflow CI
   hijau pada SHA yang sama. Ref lain, SHA yang sudah bergeser, dan CI yang belum hijau ditolak
   sebelum deploy. Produksi tetap wajib HEAD `main`; `staging_ref` diabaikan untuk produksi.
3. Smoke di staging (§5). Bila lolos, migrasi produksi (§3) dan Deploy `target=production`.

Staging berbagi kuota akun Cloudflare dengan produksi; pantau pemakaian D1/Workers di dashboard.

## 5. Smoke per cabang

Login valid/invalid; kunci PIN; buka/tutup sesi; checkout tunai dan non-tunai (total,
kembalian, ledger, stok, ringkasan, struk); satu replay offline tanpa duplikat; void dan
ubah metode bayar; laporan dan pajak; realtime di dua browser; cetak struk di printer
yang dipakai cabang.

### Pemeriksaan struk

Di **Pengaturan > Pengaturan Printer > Tampilan Struk**, pilih ukuran kertas yang
sama dengan printer. 58 mm memakai area cetak 48 mm (384 titik), 80 mm memakai
72 mm (576 titik), untuk printer thermal 203 dpi. **Mode cetak Gambar** mengirim
seluruh struk sebagai satu gambar monokrom (Bluetooth/USB membutuhkan dukungan
raster ESC/POS). **Mode cetak Teks printer** memakai font bawaan printer dan hanya
mengirim logo sebagai gambar, sekitar 8× lebih sedikit data; huruf beraksen
dicetak tanpa aksen. Pilihan printer tersimpan otomatis di perangkat ini.
Samakan ukuran kertas pada aplikasi helper Android atau RawBT Print Server;
matikan penyesuaian ukuran yang mengubah skala gambar.
Izinkan akses jaringan lokal jika browser meminta izin untuk server printer.
Untuk Android, pilih aplikasi yang terpasang: **RawBT** atau **Helper print-intent**.
Konfigurasi lama tetap memakai print-intent sampai pilihan aplikasi diubah.

1. Cetak contoh dari aplikasi. Pastikan logo, nama/alamat panjang, topping,
   catatan, total Rp39.000, uang Rp50.000, dan kembalian Rp11.000 terbaca utuh.
   Blok **NOMOR PESANAN** menampilkan nomor resmi dalam angka besar, misalnya
   **007**. Nomor di atas 999 tetap utuh; transaksi offline yang belum mendapat
   nomor resmi menampilkan **Menunggu sinkronisasi**.
2. Cetak transaksi tunai, non-tunai, dan cetak ulang. Nilai dan identitas toko
   pada cetak ulang tetap mengikuti snapshot transaksi.
3. Uji metode yang benar-benar dipakai cabang: Bluetooth BLE, USB, helper
   Android, atau server lokal. Bluetooth klasik memakai helper Android.
4. Putuskan koneksi saat uji cetak. Aplikasi harus berhenti menunggu dan
   menampilkan kegagalan. Periksa kertas sebelum mencoba lagi: pengiriman
   yang terputus mungkin sudah mencetak sebagian struk.

Server RawBT resmi memakai WebSocket pada port 40213 dengan paket ESC/POS
`intent:base64,...#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`.
Endpoint HTTP `/print` bukan bagian protokol server ini.
Fallback alamat hanya terjadi sebelum data dikirim; kegagalan setelah pengiriman tidak diulang otomatis. Status
"terkirim" menyatakan penyerahan data, bukan konfirmasi bahwa kertas sudah
keluar. Tes browser memakai perangkat/server simulasi; penerimaan hardware
tetap memerlukan cetak fisik pada model printer cabang.

Rujukan protokol: [server RawBT resmi](https://github.com/402d/rawbt_ws_server/blob/master/src/server.php)
dan [RawbtPrintConnector](https://github.com/mike42/escpos-php/blob/development/src/Mike42/Escpos/PrintConnectors/RawbtPrintConnector.php).

### Pembayaran tunai lambat atau terputus

Tekan **Selesai** sekali. Selama tombol menampilkan **Memproses…**, jangan tutup
halaman atau membuat transaksi pengganti; pesan tunggu muncul bila proses melewati
8 detik. Jika respons terputus dan aplikasi menyatakan transaksi tersimpan di
perangkat, biarkan antrean tersinkron dan periksa riwayat cabang sebelum mengulang.
Jangan logout atau menghapus data situs/IndexedDB untuk memperbaiki koneksi: antrean
offline dapat hilang. Apabila status masih tidak jelas, cocokkan dengan pemilik sebelum
membuat transaksi baru.

### Arsip berdasarkan periode

Di **Pengaturan Pemilik > Arsip**, pilih **Sepanjang [tahun]** atau **Rentang tanggal
sendiri**, lalu isi tanggal mulai dan akhir. Tahun berjalan berakhir pada hari ini;
kedua tanggal termasuk dalam rentang berdasarkan WITA, bukan zona waktu perangkat.
Tekan **Periksa Periode Arsip** untuk melihat jumlah transaksi/detail dan pesanan
Antrean yang belum selesai sebelum konfirmasi. Preview hanya membaca dan tidak
menjamin data tetap sama; server tetap memeriksa konflik saat apply.

Tutup sesi toko dan sinkronkan antrean offline seluruh perangkat cabang terlebih
dahulu. Hanya transaksi dalam rentang yang dipindahkan, setelah snapshot cloud
berhasil dibaca ulang dan diverifikasi. Rentang besar diproses per bagian; jangan
menghapus file unduhan. Jika terputus, pilih rentang yang sama untuk melanjutkan;
bila tidak ada transaksi aktif tersisa, bagian arsip rentang yang sama tersedia
untuk diunduh ulang. Arsip lama berbasis batas tahun tetap dapat dipulihkan.

#### Persiapan retensi arsip (tanpa penghapusan)

Gunakan backup R2 lengkap yang disimpan di luar bucket dan di luar workspace. Proses
`verify` mencocokkan byte salinan, checksum SHA-256, cabang, dan kontrak restore, lalu
menyimpan bukti pertama. `preview` memeriksa ulang salinan; 24 jam dihitung sejak bukti
itu dibuat, bukan sejak arsip dibuat atau diunduh.

```powershell
rtk pnpm r2:archive-retention verify "<ABSOLUTE_BACKUP_PATH>\manifest.r2.json"
rtk pnpm r2:archive-retention preview "<ABSOLUTE_BACKUP_PATH>\manifest.r2.json"
```

Manifest backup yang diterima berskema `zatiaraspos-r2-backup-v1` dan memerlukan `COMPLETE`
tanpa `FAILED.json`. Jangan edit manifest atau `archive-retention-proof.json`. Bukti lokal
ini hanya menandai arsip untuk review dan tidak menambah jadwal Windows atau Cloudflare.
Pembanding untuk smoke R2 staging membaca metadata sebelum dan sesudah membaca byte.
Key, ukuran, ETag, waktu modifikasi, dan SHA-256 harus cocok. Objek yang berubah atau
hilang, kegagalan baca, dan bukti sebelum 24 jam tidak menghasilkan kecocokan. Ini tetap
bukan izin menghapus: saat penghapusan diterapkan, versi juga harus terlindungi dari
pergantian **setelah** pemeriksaan terakhir, dan salinan terpisah harus masih dapat
dipulihkan.

**Jangan gunakan `DELETE` REST R2 dengan `If-Match` sebagai pengaman.** Pada uji bucket
staging, objek sintetis ditimpa dengan payload berukuran sama dan ETag berbeda. `DELETE`
dengan ETag lama mengembalikan HTTP 200 dan menghapus objek pengganti. Uji hanya memakai satu
key sintetis yang unik dan memastikan key tersebut tidak tersisa; produksi tidak disentuh.
Daftar [operasi kondisional R2 S3](https://developers.cloudflare.com/r2/api/s3/conditional-operations/)
juga tidak mencantumkan `DeleteObject`. Jangan menggantinya dengan pola `HEAD` lalu `DELETE`:
penulisan masih bisa terjadi di antaranya. Sebelum menambah hapus manual, buktikan bahwa
jalur penulisan dan penghapusan dikendalikan bersama dan tidak ada jalur tulis lain yang
bisa mengganti objek yang sedang diproses.

Untuk jalur aplikasi, snapshot baru dibuat dengan syarat atomik bahwa key belum ada.
Relay menolak overwrite, termasuk upload dengan byte yang sama, dan tetap melarang hapus
arsip. Tabrakan key membatalkan chunk tanpa menghapus detail transaksi dari D1. Perlindungan
ini tidak mengunci dashboard/API R2 bagi admin, tidak mencegah penggunaan ulang key setelah
objek dihapus di luar aplikasi, dan belum menjadi prosedur hapus manual. Saat perubahan ini
dirilis, perbarui relay R2 sebelum backend cabang agar backend dengan adapter tidak bergantung
pada relay lama yang masih mengizinkan overwrite.

Untuk relay produksi yang **sudah aktif**, jalankan **Deploy** dari artifact CI yang hijau
pada `release/branch-account-staging`, dengan `target=branch-account-staging` dan
`branch_production_storage_writes=harden`. Jalankan dry-run dahulu. Mode ini memeriksa kasir
`branch-open`, bucket dan mode relay, serta mencatat ID versi relay lama di ringkasan run
sebelum update. Mode ini tidak menulis atau menghapus objek R2, tidak mengganti secret,
dan tidak men-deploy Worker kasir, Pages, atau D1. Jika pemeriksaan sesudah deploy gagal
setelah versi berubah, cek kesehatan relay dan pulihkan versi sebelumnya di **Workers →
`zatiaraspos-storage` → Deployments**; jangan rollback gateway kasir atau mengaktifkan
penulis legacy. Jangan jalankan deploy relay lain bersamaan.

### Dashboard saat PWA dibuka kembali

Dashboard meminta data terbaru saat halaman kembali terlihat/fokus, dipulihkan browser,
koneksi internet kembali, atau koneksi realtime tersambung ulang. Event yang berdekatan
digabung; event saat refresh berjalan memicu pembacaan lanjutan, bukan dibuang. Refresh
ini membaca data, tidak mengulang transaksi. Saat offline, aktivasi tidak memaksa request;
jika refresh gagal, angka terakhir tetap dipertahankan dan kegagalan ditampilkan.
Jangan hapus cache/IndexedDB sebagai langkah pemulihan karena antrean offline harus utuh.

### Pemeriksaan akses kasir

Untuk memeriksa akses kasir, buka **Pengaturan > Riwayat**. Daftar pesanan POS
hari ini/7 hari dan detail/cetak ulang harus tersedia pada cabang kasir meskipun
halaman Catat atau Beranda dikunci. Buku kas manual, laporan admin, dan data cabang
lain tetap mengikuti izin sebelumnya. Kunci Pengaturan tetap melindungi halaman
konfigurasi (misalnya printer), sedangkan menu navigasi dan riwayat pesanan
operasional dapat dibuka kasir.

## 6. Pemicu stop/rollback

Checksum backup/artifact tidak cocok; schema berbeda antar shard; migrasi satu shard
gagal; login atau isolasi cabang gagal; selisih uang/pajak/stok/ringkasan/struk; replay
duplikat; event realtime lintas cabang.

## 7. Monitoring stok per cabang

- Diubah pemilik di `/pengaturan/pemilik/stok`. Tersedia untuk semua cabang; gate pilot
  `stock_feature_rollout` sudah dihapus (migrasi 0047).
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
- Arsip menolak cutoff yang masih memuat pesanan Masuk atau Diproses.
- Menghentikan push: nonaktifkan config di kedua runtime lewat rilis; jangan menghapus
  tabel notifikasi atau ledger. Push yang sudah terkirim tidak bisa ditarik.

## 8a. Alert operasional ke HP pemilik

- Cron Worker realtime tiap menit memeriksa `request_metrics` 5 menit terakhir per cabang.
  Alert terpicu bila ada minimal 5 respons 5xx, atau p95 latensi di atas 3 detik dengan minimal
  20 request. Satu cabang paling banyak satu alert tiap 30 menit.
- Penerima: perangkat akun **pemilik** cabang itu yang notifikasi pushnya aktif (prasyarat sama
  dengan §8). Perangkat kasir tidak menerima alert.
- Isi alert: cabang, jumlah error dan/atau p95. Klik membuka aplikasi. Detail ada di halaman
  monitoring (khusus admin) atau tabel `error_events`/`request_metrics`.
- Saat alert masuk: cek apakah kasir masih bisa checkout; bila tidak, ikuti §6 (stop/rollback) dan
  hubungi pengembang. Alert tidak menghentikan atau mengubah transaksi apa pun.

## 8b. Pembaruan aplikasi PWA setelah deploy

- Banner **Versi baru siap dipakai** berarti worker baru sudah terpasang dan menunggu
  persetujuan. Selesaikan pesanan aktif, lalu tekan **Perbarui**. **Nanti** menunda pada tab itu.
- Klik mengirim `SKIP_WAITING`; halaman dimuat ulang satu kali setelah worker mengambil
  alih atau selesai berstatus `activated`. Tab yang belum dikontrol worker dapat menerima
  update tanpa event `controlling`; status aktivasi worker juga dipantau langsung.
- Aktivasi dari tab lain menampilkan **Aplikasi sudah diperbarui** dan tombol **Muat ulang**,
  tanpa memuat ulang tab kasir otomatis.
- Bila belum ada konfirmasi dalam 5 detik, banner tetap tersedia dengan pesan
  **Pembaruan belum selesai** dan tombol **Coba lagi**. Bila worker masih menunggu, klik mengulang permintaan aktivasi, bukan sekadar memuat ulang halaman. Pengguna tetap dapat bekerja atau
  menunda; aktivasi yang terlambat menunggu klik baru agar tidak memotong transaksi.
- Tab yang masih menjalankan kode updater lama perlu sekali muat ulang setelah rilis
  perbaikan. Jangan menghapus data situs untuk memperbarui: antrean offline dan identitas
  notifikasi tersimpan di perangkat.
- Bukti lokal: `pnpm test:pwa-updater` dan
  `node scripts/run-playwright-local.mjs e2e/pwa-updater.spec.ts e2e/offline.spec.ts`.
  Suite browser memakai worker fixture di loopback untuk menguji siklus dua tab,
  aktivasi tanpa controller, reload nyata, dan pemulihan timeout; bukan smoke produksi.

## 9. Wipe riwayat transaksi uji (satu cabang)

Destruktif; rollback satu-satunya adalah restore dari backup. Perintah berikut hanya
untuk konfigurasi lama; jangan jalankan pada D1 aktif lintas akun.

```powershell
rtk pnpm d1:backup -- --legacy-source --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
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

## Pesanan web (zatiarasjuice) di tab Masuk

Pesanan dari situs pesan menunggu di tab Masuk sebagai "menunggu cek QRIS". Belum menjadi penjualan.
Kasir mencocokkan nominal (harga menu + kode unik) dengan notifikasi QRIS, lalu menekan Terima
(checkout QRIS biasa, kartu pindah ke Diproses) atau Tolak.

- Secret Cloudflare Pages POS: `WEB_ORDERS_URL` (alamat HTTPS situs pesan) dan `WEB_ORDERS_TOKEN`
  (minimal 24 karakter, nilainya sama dengan `POS_API_TOKEN` di situs pesan). Tanpa keduanya fitur mati
  dan Antrean kasir tidak berubah.
- Pemetaan cabang: samarinda = juanda, berau = merah-delima, balikpapan = mt-haryono.
- Nama menu di web harus sama dengan nama produk aktif di POS (huruf besar/kecil diabaikan). Nama yang
  tidak cocok atau ganda membuat Terima ditolak dengan pesan jelas.
- Harga web harus sama dengan harga POS; beda = Terima ditolak (Tolak lalu kembalikan uang manual).
- Omzet tercatat sebesar harga menu. Kode unik (Rp1-99) tidak masuk POS.
- Tes: `pnpm test:web-orders`.

### Menu hidup untuk situs pesan

`GET /api/public/menu?outlet=<id outlet>` (Bearer `WEB_ORDERS_TOKEN`) mengembalikan nama, harga, harga jumbo,
dan ketersediaan produk aktif per cabang. Produk dengan stok dilacak dan stok 0 dianggap tidak tersedia.
Situs pesan menyimpan hasilnya di cache 2 menit per outlet, jadi bacaan D1 POS kecil. Di situs pesan isi
`POS_MENU_URL` (alamat HTTPS POS) dan `POS_API_TOKEN` (nilai sama dengan `WEB_ORDERS_TOKEN`).
