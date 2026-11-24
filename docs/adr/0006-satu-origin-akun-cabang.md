# Satu alamat kasir, layanan data per cabang

Status: usulan untuk uji lokal; bukan persetujuan migrasi atau perubahan produksi.

## Keputusan yang diusulkan

Pertahankan origin dan URL aplikasi yang sekarang. Jangan gunakan API token D1 lintas akun untuk SQL per transaksi. Gunakan satu build aplikasi dengan deployment backend per cabang. Setiap backend memiliki satu binding D1, namespace koordinator, secret, dan jadwal pemeliharaan untuk cabangnya. Gateway bersama tetap titik kegagalan bersama, tetapi tidak membutuhkan D1 untuk memilih backend. Sasaran isolasi adalah kuota D1, bukan ketersediaan Cloudflare secara keseluruhan.

## Batas kepercayaan

- Aset statis dan formulir login tersedia di origin bersama. Saat login, cabang dari formulir hanya memilih tujuan yang ada di daftar server; nama cabang bukan bukti otorisasi. Tolak tujuan tak dikenal. Jangan menerima URL backend dari browser.
- Backend autentikasi memeriksa username/password dan cabang terhadap deployment lokalnya. Gateway hanya menyimpan petunjuk rute bertanda tangan setelah login berhasil; cookie sesi aplikasi tetap bukti akses yang diverifikasi backend. Jangan mencoba semua database untuk mencari sesi. Sesi lama tanpa petunjuk rute memerlukan jalur transisi eksplisit atau login ulang terjadwal.
- Tentukan rute sebelum `src/hooks.server.ts` membaca sesi. Semua permintaan yang butuh sesi, termasuk SSR, form actions, CSRF, SSE dan logout, harus menuju backend yang sama. Pertahankan origin publik, `Set-Cookie` terpisah, dan identitas IP tepercaya untuk rate limit. Gateway harus membuang header internal dari klien. Backend antar-akun memerlukan autentikasi antarlayanan; URL publik backend bukan batas keamanan.
- `branchResolver.ts` dan setiap handler tetap membatasi query ke cabang sesi. Batasi cron di `realtimeWorker.js` ke cabang deployment. Inventarisasi juga arsip R2, notifikasi, akses pemilik lintas cabang, backup, dan restore; jangan diam-diam mengembalikan data parsial untuk laporan gabungan.

## Bukti minimum sebelum migrasi

1. Jalankan satu gateway dan tiga backend lokal dengan tiga D1 serta koordinator terpisah. Satu origin browser; jangan mock keputusan autentikasi atau berbagi binding lintas backend.
2. Login di tiap cabang. Simulasikan kuota baca, tulis, lalu keduanya pada Samarinda saja. Balikpapan dan Berau harus tetap bisa login, bertransaksi, mencetak struk dan tutup shift. Ulangi dengan target gangguan digilir. Verifikasi hasil di ledger tiap cabang, bukan hanya HTTP 200.
3. Tolak cookie rute rusak, sesi cabang lain, target backend tak dikenal, akses langsung tanpa autentikasi antarlayanan dan CSRF tidak valid. Uji logout, perpindahan cabang pada HP yang sama, dan sesi kedaluwarsa tanpa pencarian lintas database.
4. Simulasikan gangguan gateway secara terpisah. Dokumentasikan dampak bersama. Jangan menghabiskan kuota sungguhan untuk uji.

## Bukti prototipe lokal

Jalankan `pnpm build` lalu `pnpm exec node scripts/coordinated-shift.test.mjs --branch-origin`. Harness meneruskan login, SSR, dan form kasir ke tiga instans aplikasi dari satu origin lokal. Tiap instans aplikasi hanya menerima binding D1 dan koordinator cabangnya sendiri. Tes memutus baca, tulis, dan keduanya pada Samarinda; Balikpapan dan Berau masuk, mencatat dan mencetak struk lewat browser, menutup shift, lalu merekonsiliasi transaksi di D1 masing-masing. Tes juga menolak cabang tak dikenal dan cookie rute palsu.

Harness lokal bukan proxy produksi. Skenario kuota untuk prototipe ini belum digilir ke tiap cabang. Printer fisik tidak diuji.

## Bukti koneksi Cloudflare antar-akun

Gateway Worker sementara di akun utama berhasil membaca dua penanda sintetis dari Worker di dua akun berbeda, masing-masing dengan binding D1 lokal ke akun backend. Backend menolak permintaan tanpa autentikasi, dan gateway menolak rute di luar daftar. Saat Worker uji Berau dihapus, gateway mengembalikan 502 untuk Berau, sementara rute Balikpapan tetap membaca penandanya. Semua Worker dan D1 uji sementara dibersihkan. Konfigurasi `workers.dev` akun uji dipertahankan.

Ini membuktikan transport HTTPS dan isolasi kegagalan backend untuk probe baca-saja. Belum membuktikan login aplikasi, kompatibilitas sesi, penulisan transaksi, atau migrasi lintas akun di Cloudflare.

## Implementasi bertahap

`src/lib/server/branchIngress.ts` memuat pemilihan tujuan dari konfigurasi, petunjuk rute bertanda tangan yang terikat ke cookie sesi, dan autentikasi antarlayanan dengan secret HTTPS berbeda per backend. Backend mengembalikan URL internal ke origin publik sebelum aplikasi memeriksa sesi dan CSRF. Gateway tidak mencoba backend lain ketika tujuan gagal. Jalankan `pnpm test:branch-ingress` untuk kontrak tersebut.

`staging/branch-account-worker.mjs` membungkus adapter hasil build SvelteKit. Mode `gateway` melayani aset publik, login, dan CSRF tanpa binding data; mode `backend` memvalidasi relay lalu menjalankan aplikasi dengan satu D1 sesuai `BRANCH_ACCOUNT_IDENTITY` dan koordinator lokal. IP dari header edge diteruskan lewat relay terautentikasi untuk rate limit. Staging lintas akun tidak menambah Cron. Koordinator menjadwalkan alarm bersama commit antrean, memproyeksikan hanya cabangnya, dan menjadwalkan ulang bila D1 belum tersedia. Ketika antrean kosong, alarm per jam menjaga katalog tetap mutakhir. Jadwal lama di produksi tidak berubah; pemeliharaan selain POS belum dipindahkan.

Jalankan `pnpm build` lalu `pnpm test:branch-account-compiled` untuk membundel wrapper dengan dry-run Wrangler dan menjalankan gateway serta tiga backend dengan D1 dan koordinator terpisah di Workerd lokal. Tes mengirim login dan formulir kasir lewat satu origin, memeriksa cookie rute, penolakan akses langsung ke backend, respons struk, serta stok, laporan, dan status shift yang masuk ke D1 lewat alarm, tanpa panggilan sinkronisasi manual. Transport antar-host diarahkan secara lokal; printer dan deployment lintas akun tidak diuji oleh suite ini. Deployment Cloudflare masih memerlukan konfigurasi staging terisolasi yang mengikat aset publik saja, secret unik untuk tiap relay, D1 dan koordinator per cabang, serta data uji. Sebelum rilis, uji alur aplikasi dengan cookie dan redirect aktual di Worker, bukan hanya stub transport.

`scripts/branch-account-staging-config.mjs` menghasilkan empat konfigurasi Wrangler staging dari inventori yang diberikan operator. Gateway tidak punya binding data; backend harus berada di tiga akun berbeda dan masing-masing hanya membawa satu D1 dan satu koordinator. Secret tidak dimasukkan ke konfigurasi. Sebelum menerapkan konfigurasi, cocokkan ID dan nama D1 dengan inventori resource uji di akun tujuan; validasi format ID saja bukan bukti bahwa database aman dipakai.

## Deploy staging lintas akun

Gunakan workflow **Deploy** dengan target `branch-account-staging`, SHA dan run CI dari `release/branch-account-staging`. Jalankan `dry_run=true` untuk memverifikasi artefak, lalu `dry_run=false` untuk menerapkannya. Environment GitHub `branch-account-staging` memerlukan variabel `BRANCH_STAGING_INVENTORY` serta secret `BRANCH_STAGING_KEY` (32 byte acak dalam hex) dan `BRANCH_CF_TOKEN_SAMARINDA`, `BRANCH_CF_TOKEN_BALIKPAPAN`, `BRANCH_CF_TOKEN_BERAU`. Gunakan token terbatas ke akun masing-masing. Jangan ganti kunci antar-deploy biasa; kunci itu menurunkan secret relay, cookie rute, dan tanda tangan harga staging secara terpisah.

Workflow memverifikasi identitas D1 dari API sebelum deploy, menyalin hanya aset publik, lalu memasang backend terlebih dahulu dan gateway terakhir. Tidak ada perubahan skema atau penghapusan database di workflow. Apabila deploy terhenti sebagian, periksa Worker yang sudah terpasang lalu ulangi SHA yang sama dengan inventori dan kunci yang sama. Jangan jalankan target `staging` biasa untuk stack lintas akun.

## Audit kesiapan sebelum migrasi produksi

Audit kode dan konfigurasi, bukan bukti smoke produksi. Hasil ini **belum meluluskan cutover**:

- **Arsip dan aset R2 — blocker:** konfigurasi backend staging hanya mengikat D1 dan
  koordinator; tidak ada `STORAGE`. `archiveUseCase.ts` memerlukan bucket untuk menyimpan,
  membaca kembali, dan mengunduh arsip; endpoint upload juga memerlukannya. Akses lintas
  akun, inventaris objek, pemindahan, otorisasi cabang, backup dan restore R2 harus dirancang
  serta diuji sebelum mengalihkan cabang. Dump D1 tidak mencadangkan objek R2.
- **Laporan dan pemilik — belum terbukti:** `reportQueries.ts` menerima konteks cabang,
  dan backend hanya punya satu binding D1. Ini mendukung laporan per cabang, tetapi bukan
  bukti laporan gabungan lintas cabang maupun perpindahan sesi pemilik. Inventarisasi kontrak
  UI dan uji login/pergantian cabang pada gateway. Jangan menampilkan hasil sebagian sebagai
  gabungan lengkap jika satu cabang gagal.
- **Antrean — blocker operasional:** alarm koordinator mencatat penundaan dan mencoba lagi;
  `rollbackKioskPilot.ts` memeriksa `projection:tail === projection:ack` secara atomik sebelum
  membuka jalur lama. Namun belum ada pemeriksaan status antrean read-only untuk operator pada
  gateway lintas akun. Menutup shift atau melihat transaksi terbaru di D1 bukan bukti bahwa
  seluruh antrean kosong. Jangan memicu rollback atau menghapus data sebagai cara memeriksanya.
- **Monitoring dan pekerjaan terjadwal — blocker:** staging mencatat kegagalan proyeksi di log,
  tetapi belum ada dashboard/alert terverifikasi untuk umur antrean, kegagalan alarm, kuota,
  backend, dan gateway. Wrapper staging tidak menjalankan `scheduled` pada
  `realtimeWorker.js`; pekerjaan notifikasi dan retensi perlu inventaris, penjadwalan yang
  scoped per cabang, serta uji pemulihan dan deduplikasi sebelum produksi.
- **Backup dan restore — parsial:** drill staging 24 November 2026 berhasil mengekspor dan
  restore masing-masing D1 ke D1 sementara di akun terkait, membandingkan isi tabel serta
  schema, lalu menghapus target sementara. Ini bukan backup produksi yang dapat dipulihkan;
  belum mencakup R2 atau state Durable Object. Alat backup produksi saat ini memvalidasi
  tiga shard dari konfigurasi lama dan belum diuji untuk tiga akun. Backup produksi baru dan
  restore drill dengan baseline terverifikasi tetap wajib menjelang cutover.

### Keputusan R2 bersama akun Samarinda

Pemilik menerima bahwa R2 menjadi sumber kegagalan dan pemakaian bersama; database D1
cabang tetap di akun masing-masing. R2 bersama **belum diterapkan**. Gunakan satu Worker
penyimpanan internal di akun Samarinda, dengan binding ke bucket privat; gateway kasir tetap
bebas binding data. Worker backend tiap cabang memanggil boundary penyimpanan lewat koneksi
terautentikasi dan kredensial berbeda per cabang. Layanan penyimpanan menentukan identitas
cabang dari kredensial, bukan parameter atau nama key yang diberikan pemanggil.

Operasi hanya `get`, `put`, dan `delete` yang diperlukan aplikasi. Batasi key gambar ke
`produk/<cabang>/...` sesuai `r2ObjectPolicy.ts`; batasi key arsip ke bentuk kanonik
`arsip/<cabang>/<tahun>/...` yang dihasilkan `archiveSnapshot.ts`. Dilarang `list`, key
legacy tanpa cabang, namespace lain, dan akses antar-cabang. Relay tidak menerima URL tujuan
arbitrer. Backend tetap memeriksa auth pengguna sebelum mengunduh arsip atau mengubah objek;
akses gambar anonim terbatas ke format gambar publik dan cabang pada key. Batasi ukuran
request dan jaga streaming, metadata MIME, serta hasil readback arsip. Jika R2 atau relay
mati, arsip tidak boleh menghapus ledger dan transaksi kasir yang sudah sah tetap sah.

Untuk staging, buat bucket khusus sintetis di akun Samarinda saja setelah verifikasi nama,
akun, izin dan kondisi billing. Jangan memberi akses worker uji ke bucket produksi. Uji
isolasi antar-cabang, spoof/replay, objek hilang, R2 gagal/tidak cocok saat readback, stream
terputus, serta archive/restore dengan D1 dan Workerd; bersihkan hanya objek dan resource uji
yang identitasnya terverifikasi. Key lama tanpa cabang memerlukan inventaris dan migrasi
referensi terpisah sebelum cutover, bukan fallback yang melemahkan isolasi. Pantau biaya dan
pemakaian agregat seluruh cabang; jatah Free bukan batas otomatis dan tanpa mekanisme batas
keras yang terbukti tidak ada jaminan tagihan nol.

### Verifikasi lanjutan dan rancangan perbaikan

- **R2:** menambah binding saja belum cukup. `GET /api/upload?key=...` melayani gambar
  katalog publik, tetapi ingress tanpa sesi hanya menyediakan login, CSRF, dan aset build.
  Gunakan boundary penyimpanan bersama yang dijelaskan di atas, tanpa memberikan binding
  bucket produksi langsung kepada backend di akun lain. Migrasikan objek dengan key, checksum, dan metadata
  tetap; rekonsiliasi referensi `archive_jobs.object_key` dan katalog sebelum cutover.
  Untuk gambar publik, hanya rutekan GET dengan key gambar yang lolos kebijakan yang sudah
  ada. Pisahkan pemeriksaan ini dari akses unduh arsip, yang tetap membutuhkan sesi cabang.
  Staging menerima `backends.<cabang>.bucketName` opsional dengan nama tepat
  `zpos-<cabang>-assets-staging`. Deploy memeriksa bucket yang sudah ada di akun terkait,
  bukan membuatnya. Gambar dengan key lama `produk/<id>.<ext>` tidak memiliki identitas
  cabang dan tidak dirutekan; inventarisasi, salin ke key bercabang dan perbarui referensinya
  sebelum live. Jangan memilih bucket fallback untuk key lama.
- **Laporan:** `GET /api/reports/aggregate` mengakses satu `BranchContext`; pemilik biasa
  tidak dapat meminta cabang berbeda dari sesi. `admin` dapat melewati pemeriksaan itu,
  tetapi backend tetap tidak memiliki binding cabang lain. Pertahankan kontrak laporan
  per cabang melalui login ke cabang tujuan. Inventarisasi pemakaian override admin lama;
  jangan membuat agregasi lintas akun atau memperluas izin sebagai efek samping migrasi.
- **Antrean:** sediakan pemeriksaan internal read-only pada koordinator yang membaca status
  shift dan `projection:tail`/`projection:ack` dalam satu snapshot. Gunakan ulang helper
  yang sama untuk rollback dan gate cutover, dengan perubahan kebijakan rollback tetap
  atomik. Paparkan hanya ringkasan yang dibutuhkan dan lindungi lewat jalur operator yang
  terotorisasi untuk cabang itu. Ini tidak membuktikan antrean IndexedDB HP kosong; periksa
  keduanya sesudah penulisan dibekukan. Implementasi pertama menyediakan tombol
  **Periksa status koordinator** pada pengaturan pemilik (`GET /api/perangkat-kasir`),
  dengan hasil tanpa cache dan terikat ke sesi cabang. Jika autentikasi atau koordinator
  tidak tersedia, status tidak diketahui, bukan kosong. Hasil adalah snapshot, bukan kunci
  cutover. Backend staging mengaktifkan Workers Logs untuk log aplikasi; filter
  `event=kiosk_projection_deferred` per cabang membedakan `d1_daily_limit` dan
  `projection_failed`. Alert otomatis dan sinyal dari gateway masih terpisah.
- **Notifikasi dan maintenance:** selain handler terjadwal yang belum dijalankan wrapper,
  `orderNotifications/repository.ts` memakai registry perangkat di `DB_SAMARINDA_GROUP`
  (atau `DB`). Ini tidak tersedia di backend Balikpapan dan Berau. Selesaikan semantik
  satu perangkat yang berpindah cabang dan delivery satu peristiwa sebelum memindahkan
  registry; jangan menambahkan binding Samarinda ke backend lain. Pisahkan penjadwalan
  notifikasi/retensi dari alarm kasir dan gunakan kembali fungsi maintenance yang ada.
  Log terstruktur dari koordinator dan gateway perlu tetap berguna saat D1 gagal,
  tanpa menjadikan notifikasi atau observability syarat commit.
- **Backup:** pertahankan validasi ketat alat lama. Perluas input inventori untuk
  memverifikasi identitas akun dan D1 per cabang dengan kredensial terbatas; gunakan ulang
  verifikasi manifest, checksum, dan drill restore. Drill staging menguji paritas struktur
  dan isi tabel aplikasi, bukan pemulihan R2, state koordinator, atau promosi backup ke
  penyimpanan jangka panjang. Jangan memakai Time Travel sebagai satu-satunya cara
  memindahkan data antar akun.

Urutan pengerjaan: status antrean dan monitoring minimum; R2 dan uji gambar/arsip;
kontrak laporan serta notifikasi/retensi; lalu simulasi migrasi satu cabang lengkap
beserta backup, restore, dan rollback. Kegagalan di salah satu gate menghentikan cutover.

## Prasyarat produksi

Pastikan kelayakan penggunaan beberapa akun Free untuk satu usaha dengan Cloudflare. Uji backup/restore per akun dan cocokkan stok, nomor pesanan, omzet, serta struk. Pindahkan satu cabang setelah shift tutup dan semua antrean HP serta koordinator kosong. Jangan biarkan deployment lama dan baru menerima penjualan cabang yang sama. Setelah transaksi pertama di tujuan, rollback bukan sekadar mengganti tujuan gateway: rekonsiliasi perubahan dulu. Belum ada resource atau kredensial akun baru yang diperlukan untuk tahap lokal.
