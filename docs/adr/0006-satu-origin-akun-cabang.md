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

`staging/branch-account-worker.mjs` membungkus adapter hasil build SvelteKit. Mode `gateway` melayani aset publik, login, dan CSRF tanpa binding data; mode `backend` memvalidasi relay lalu menjalankan aplikasi dengan satu D1 sesuai `BRANCH_ACCOUNT_IDENTITY` dan koordinator lokal. IP dari header edge diteruskan lewat relay terautentikasi untuk rate limit. Cron staging hanya menguras proyeksi cabang backend; pemeliharaan selain POS belum dipindahkan.

Wrapper lolos `wrangler deploy --dry-run` secara lokal. Deployment Cloudflare masih memerlukan konfigurasi staging terisolasi yang mengikat aset publik saja, secret unik untuk tiap relay, D1 dan koordinator per cabang, serta data uji. Sebelum rilis, uji alur aplikasi dengan cookie dan redirect aktual di Worker, bukan hanya stub transport.

## Prasyarat produksi

Pastikan kelayakan penggunaan beberapa akun Free untuk satu usaha dengan Cloudflare. Uji backup/restore per akun dan cocokkan stok, nomor pesanan, omzet, serta struk. Pindahkan satu cabang setelah shift tutup dan semua antrean HP serta koordinator kosong. Jangan biarkan deployment lama dan baru menerima penjualan cabang yang sama. Setelah transaksi pertama di tujuan, rollback bukan sekadar mengganti tujuan gateway: rekonsiliasi perubahan dulu. Belum ada resource atau kredensial akun baru yang diperlukan untuk tahap lokal.
