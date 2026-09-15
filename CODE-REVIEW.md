# Review kode ZatiarasPOS

Review pertama: 14 September 2026. Revalidasi: 15 September 2026.

Baseline revalidasi: `88c6436f747c266377ca700aaa513faf688ff225` (14 September 2026, 11.44 WIB). Kode aplikasi tidak berubah selama revalidasi; laporan ini belum di-commit.

## Kesimpulan

Fondasi arsitektur cukup baik. Prioritas perbaikan ada pada kontrak lintas modul dan operasi bersamaan: stok/HPP, void, perubahan metode bayar, arsip/restore, keberhasilan penyimpanan, serta pembayaran campuran ukuran. Kasus-kasus tersebut tetap dapat direproduksi pada kode terbaru.

Pengguna mengonfirmasi **semua fitur dipakai dan beberapa perangkat aktif**. Konkurensi relevan, tetapi void, perubahan metode bayar, dan arsip membutuhkan request pemilik; beberapa perangkat kasir saja tidak otomatis memicu ketiganya. Angka transaksi per sesi dan konfigurasi deployment aktual belum diketahui.

Seluruh 30 butir lama ditriase ulang di bawah. Tidak ditemukan perbaikan tuntas untuk akar masalahnya dalam commit siang yang diperiksa. Beberapa kesimpulan dipersempit atau diturunkan prioritasnya: readback arsip menjadi penguatan integritas, rate limiter dibatasi ke fallback D1, pajak diposisikan sebagai simulasi, dan kesalahan nominal cetak ulang dibedakan berdasarkan jalur printer.

Penilaian berasal dari pembacaan kode dan pengujian langsung. README, panduan pengembang, dan laporan kualitas terdahulu tidak digunakan sebagai bukti.

## Perubahan siang yang sudah diperhitungkan

- `cdf9a8e`, 10.08 WIB: PIN empat digit, bypass lock yang belum dikonfigurasi, dan navigasi tetap tersedia. Ini kebijakan akses eksplisit dalam kode.
- `05a4e1e`, 10.57 WIB: PBKDF2 PIN turun dari 210.000 menjadi 10.000 iterasi untuk batas CPU Cloudflare; validasi PIN mudah ditebak ditambahkan di client. Batas iterasi verifikasi masih menerima hash lama. Pengurangan iterasi dinilai sebagai tradeoff CPU/keamanan, bukan kegagalan login yang terbukti dalam review ini.
- `a6ae54b`, 11.22 WIB: numpad auto-verifikasi dan tombol redundan dihapus.
- `88c6436`, 11.44 WIB: GET buku kas per sesi melewati lock halaman catat; query POS mingguan menerima akses beranda/catat; unlock memicu refresh dashboard.

Perbaikan akses laci kas memang ada. Pengujian endpoint terbaru sebagai kasir menghasilkan HTTP 200 untuk sesi yang diminta, tetapi tetap hanya mengembalikan 200 dari 201 baris. Perbaikan akses tersebut berbeda dari kelengkapan ringkasannya. Effect pemuatan pengaturan kasir juga masih memicu dirinya sendiri setelah perubahan refresh unlock.

## Arti status dan prioritas

- **P1:** dahulukan karena menghalangi alur yang dipakai atau merusak angka uang/stok dalam kondisi pemicunya.
- **P2:** perbaiki pada iterasi berikutnya; dampak lebih terbatas pada laporan, sinkronisasi, fitur tertentu, atau fallback.
- **P3:** penguatan integritas, ketahanan terhadap payload besar, atau umpan balik UI.
- **Direproduksi:** perilaku diamati dalam harness lokal. **Statis:** kontrak kode/caller ditelusuri, tetapi alur penuh belum diuji. **Diperjelas:** kesimpulan/dampak review pertama dikoreksi. Prioritas tidak menyatakan frekuensi kejadian produksi.

## Cakupan

Inventaris review pertama, dihitung ulang saat revalidasi:

- `src/`: 228 file, 49.835 baris.
- `scripts/`: 18 file, 8.728 baris.
- `e2e/`: 8 file, 404 baris.
- `drizzle/*.sql`: 25 file, 620 baris.
- **Total: 279 file, 59.587 baris.**

Review pertama mencatat pemeriksaan source batch demi batch, termasuk halaman Svelte, komponen, stores, layanan, endpoint, database, utilitas, script operasional, dan tes, berikut konfigurasi root/CI/migrasi/seed. Putaran kedua memeriksa diff commit terbaru dan menelusuri ulang 30 temuan beserta caller, guard, kontrak penyimpanan, dan jalur alternatifnya. Angka inventaris bukan klaim seluruh 59.587 baris dibaca ulang pada putaran kedua. Payload gambar/base64 diperlakukan sebagai aset; dependensi pihak ketiga dan hasil build berada di luar cakupan logika aplikasi.

## Metode verifikasi

- Backend: modul aplikasi asli dipanggil dengan adapter D1 di atas SQLite in-memory. Seluruh 25 migrasi repository diterapkan sebelum pengujian.
- Fixture penjualan memuat dua transaksi lengkap yang konsisten dengan agregat. Kontrol berurutan membuktikan perubahan metode bayar hanya sekali dan void kedua ditolak 404; interleaving request paralel membuktikan kelemahan read-before-batch. Ini reproduksi interleaving yang mungkin, bukan pengukuran frekuensi di Cloudflare.
- Frontend: halaman Svelte asli dijalankan melalui Vite dan Chromium/Playwright. Respons API dikendalikan untuk menguji kontrak data, keadaan sukses, dan keadaan gagal.
- Arsip diuji dengan readback normal pada schema migrasi asli dan fixture tambahan yang mengizinkan UUID, untuk memisahkan race lock dari masalah schema. Kontrol lock aktif dan resume berurutan juga diuji.
- Restore: generator SQL asli dieksekusi terisolasi, lalu SQL dan laporan asli dijalankan pada SQLite. Fixture mengizinkan UUID untuk melewati blocker schema; CLI Wrangler tidak dijalankan.
- Kontrak AI/password: deklarasi fungsi asli diambil dari AST TypeScript dan dijalankan terisolasi setelah anotasi tipe dihapus. Respons model dibuat terkontrol. PDF memakai modul asli dan jsPDF/autoTable asli; hasil simpan ditahan di memori.
- Pengujian ini memverifikasi kode lokal. Konfigurasi dan data deployment produksi tidak diperiksa.
- Script reproduksi sementara disimpan di `C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-*.mts` dan `zatiaras-review-browser.mjs`.

## Revalidasi temuan 1–11

### 1. Skema hasil migrasi tidak cocok dengan kode pengaturan

**Status: tetap, direproduksi — P1 untuk deployment/pemulihan berbasis migrasi repo.** Schema produksi belum diperiksa; temuan ini tidak membuktikan semua pengaturan produksi sekarang gagal.

**Bukti:** `drizzle/0016_pin_hash.sql:2`, `drizzle/0024_pengaturan_kunci_nilai_key_value.sql:1`, `src/lib/database/schema.ts:341`, `src/lib/server/services/pengaturanService.ts:20`, `src/routes/api/pengaturan/pajak/+server.ts:98`.

Setelah seluruh migrasi, `pengaturan.id` masih `INTEGER PRIMARY KEY`, sedangkan kode memasukkan UUID. Selain itu, schema Drizzle memilih kolom `pajak_config` yang tidak dibuat oleh migrasi.

**Hasil uji:** insert UUID menghasilkan `datatype mismatch`; pemanggilan asli `getPengaturan()` menghasilkan `no such column: pajak_config`. Database baru dari migrasi repository gagal menjalankan alur pengaturan tersebut.

**Perbaikan:** selaraskan migrasi dan schema, lalu uji CRUD pengaturan pada database yang benar-benar dibangun dari migrasi.

### 2. Kontrak satuan pembelian merusak biaya bahan/HPP

**Status: tetap, direproduksi — P1.** Edit bermasalah bila satuan beli berbeda dari satuan dasar. Kulakan memicu salah HPP jika pencatatan kas dan opsi pembaruan HPP aktif. Mutasi stok fisiknya sendiri memakai `baseQty`; kesalahan hitungan biaya bukan bukti setiap kulakan salah stok.

**Bukti:** `src/routes/stok/+page.svelte:273`, `src/routes/stok/+page.svelte:280`, `src/routes/stok/+page.svelte:301`, `src/routes/stok/+page.svelte:607`, `src/lib/stores/bahanHppState.svelte.ts:203`, `src/lib/stores/bahanHppState.svelte.ts:267`, `src/lib/server/services/bahanService.ts:129`.

Alur tambah/edit menyimpan jumlah dalam satuan dasar. Saat diedit kembali, jumlah itu ditampilkan sebagai satuan beli dan dikonversi ulang. Alur kulakan justru mengirim jumlah satuan beli ke field yang digunakan server sebagai jumlah dasar.

**Hasil uji browser:** bahan tersimpan 1.000 gram dengan satuan beli kg; simpan tanpa perubahan mengirim 1.000.000 sebagai jumlah pembelian.

**Hasil uji backend:** kulakan 1 kg seharga Rp20.000 dengan satuan dasar gram menghasilkan biaya server Rp20.000/gram, padahal seharusnya Rp20/gram.

**Perbaikan:** tetapkan satu kontrak jumlah dasar; konversi tampilan dua arah dan hitung biaya server dari satuan yang tervalidasi.

### 3. Pembatalan transaksi bersamaan mengembalikan stok dua kali

**Status: tetap, direproduksi — P1.** Pemicu: dua request pemilik membatalkan transaksi sama dan membaca snapshot sebelum batch pertama selesai. RBAC tidak menserialkan request dari dua tab/perangkat.

**Bukti:** `src/lib/server/services/transaksiKasirService.ts:93`, `src/lib/server/services/transaksiKasirService.ts:123`, `src/lib/server/services/transaksiKasirService.ts:182`.

Kedua request bisa membaca transaksi yang sama sebelum batch masing-masing berjalan. Batch tidak memiliki klaim pembatalan atau pemeriksaan keberadaan transaksi yang mengikat pengembalian stok.

**Hasil uji:** stok awal 8, transaksi berjumlah 2. Dua pembatalan bersamaan menghasilkan stok 12; seharusnya 10. Ringkasan harian juga dikurangi dua kali.

**Kontrol:** pembatalan berurutan mengembalikan stok ke 10 dan request kedua ditolak 404. Batch atomik yang sudah ada benar-benar membantu satu request, tetapi belum menjamin idempotensi lintas request.

**Perbaikan:** pembatalan harus idempoten dengan penanda/klaim atomik, memakai snapshot pengurangan stok transaksi asli.

### 4. Perubahan metode pembayaran bersamaan menggandakan perpindahan omzet

**Status: tetap, direproduksi — P1.** Pemicu: dua request pemilik mengubah transaksi sama dari tunai ke non-tunai. Dampak terbukti pada pembagian agregat tunai/non-tunai; nilai ledger transaksi tidak ditagihkan dua kali.

**Bukti:** `src/lib/server/services/bukuKasService.ts:123`, `src/lib/server/services/bukuKasService.ts:149`, `src/lib/server/services/bukuKasService.ts:259`.

Metode lama dibaca sebelum batch. Dua perubahan tunai menjadi non-tunai sama-sama memindahkan nilai transaksi.

**Hasil uji:** perubahan satu transaksi Rp20.000 menghasilkan total non-tunai Rp40.000, sementara transaksi tunai lain ikut kehilangan kontribusinya dalam ringkasan.

**Kontrol:** perubahan identik berurutan menghasilkan tunai Rp20.000 dan non-tunai Rp20.000. Dua transaksi fixture lengkap mendukung agregat awal Rp40.000.

**Perbaikan:** gunakan perubahan bersyarat terhadap versi/metode lama dan kaitkan pembaruan agregat dengan perubahan yang benar-benar terjadi.

### 5. Pengarsipan bersamaan menggandakan kas historis

**Status: tetap, direproduksi — P1.** Pemicu: dua request pemilik pada cabang/periode sama ketika sesi toko sudah tutup. Pemeriksaan sesi aktif, antrean offline, lock lama, dan resume tersedia; semuanya belum menjadi klaim atomik untuk dua request yang mulai bersama.

**Bukti:** `src/routes/api/archive/+server.ts:104`, `src/routes/api/archive/+server.ts:142`, `src/routes/api/archive/+server.ts:341`, `src/routes/api/archive/+server.ts:390`.

Lock menggunakan SELECT lalu UPSERT tanpa klaim eksklusif; kegagalan memasang lock juga diabaikan. Kedua proses dapat mengarsipkan baris sama dan membuat ringkasan berbeda.

**Hasil uji handler asli:** satu pemasukan Rp150.000, dua request arsip sama-sama HTTP 200, menghasilkan kas arsip Rp300.000.

**Revalidasi:** hasil sama ketika R2 mock menyimpan/mengembalikan konten normal, baik pada schema migrasi asli maupun fixture UUID. Jadi race tetap ada setelah blocker ID pengaturan dilewati. Kontrol lock aktif menolak 409; kontrol resume berurutan pada fixture UUID hanya mengunggah satu snapshot. Bug tidak bergantung pada injeksi data R2 rusak.

**Perbaikan:** lock atomik, identitas pekerjaan yang idempoten, serta perlindungan terhadap perubahan baris selama snapshot dibuat.

### 6. UI mengklaim catatan kas berhasil meskipun penyimpanan gagal

**Status: tetap, direproduksi — P1.** Ada antrean offline untuk gangguan jaringan, tetapi HTTP 500 online menghasilkan `Error` biasa dan tidak masuk jalur antrean itu.

**Bukti:** `src/lib/stores/catatState.svelte.ts:164`, `src/lib/stores/catatState.svelte.ts:272`.

`saveTransaksi()` menangkap kegagalan dan kembali tanpa status kegagalan. Pemanggil selalu menampilkan sukses dan mengosongkan formulir.

**Hasil uji browser:** respons POST HTTP 500 tetap diikuti pesan `Transaksi berhasil dicatat!`; deskripsi menjadi kosong.

**Koreksi cakupan:** kode juga mengisi modal error. Masalahnya adalah pesan sukses yang bertentangan dan pengosongan isian, bukan klaim bahwa sama sekali tidak ada pemberitahuan error.

**Perbaikan:** teruskan hasil/error penyimpanan dan kosongkan isian hanya setelah commit atau antrean lokal terkonfirmasi.

### 7. Simpan pajak ditolak CSRF, tetapi UI menampilkan sukses

**Status: tetap, direproduksi — P1 untuk sinkronisasi multi-perangkat.** UI menyebut pajak sebagai simulasi laporan/PDF. LocalStorage memang tersimpan; konfigurasi server tidak ikut tersimpan dan pembacaan server berikutnya dapat menggantikannya. Label sukses tanpa membedakan keduanya menyesatkan.

**Bukti:** `src/lib/services/taxService.ts:176`, `src/lib/services/taxService.ts:190`, `src/lib/stores/taxSettingsState.svelte.ts:30`, `src/hooks.server.ts:39`.

PUT memakai `fetch` tanpa header CSRF, tidak memeriksa status respons, dan langsung mengembalikan keberhasilan penyimpanan lokal.

**Hasil uji browser:** header CSRF tidak ada, respons HTTP 403, pesan `Pengaturan pajak berhasil disimpan.` tetap tampil.

**Perbaikan:** gunakan wrapper CSRF, tunggu hasil server, dan kelola cache lokal sesuai status commit. Kontrak server saat ini juga hanya memuat satu pajak, sementara UI mendukung banyak pajak.

### 8. Menu reguler dan jumbo bersamaan merusak halaman pembayaran

**Status: tetap, direproduksi — P1.** Pemicu: produk sama, tambahan/gula/es/catatan sama, tetapi ukuran berbeda. Satu ukuran berjalan pada kontrol.

**Bukti:** `src/lib/stores/bayarState.svelte.ts:138`, `src/routes/pos/bayar/+page.svelte:155`.

Kunci item pembayaran tidak memasukkan `porsi`, padahal keranjang POS membedakan ukuran.

**Hasil uji Chromium:** dua ukuran menu sama menghasilkan `each_key_duplicate` ketika halaman pembayaran dihidrasi.

**Revalidasi tambahan:** Vite serve dengan `NODE_ENV=production` dan `isProduction=true` juga memunculkan error yang sama; kontrol satu ukuran merender satu baris. Ini pengujian mode produksi lokal, bukan pengujian bundle Cloudflare yang sudah dideploy.

**Perbaikan:** gunakan identitas item yang sama dan lengkap di seluruh alur keranjang, pembayaran, dan struk.

### 9. Pengaturan kasir dimuat berulang tanpa henti

**Status: tetap, direproduksi — P1.** Pemicu: role kasir dan GET pengaturan berhasil mengembalikan data. Jika GET gagal akibat schema/akses, loop sukses ini dapat tertutupi. Kasir dengan PIN belum dikonfigurasi pun terkena pada fixture yang valid.

**Bukti:** `src/routes/+layout.svelte:62`, `src/routes/+layout.svelte:95`, `src/lib/stores/securitySettings.svelte.ts:34`.

Effect membaca store pengaturan lalu memuat data yang selalu mengganti store dengan objek baru. Perubahan itu memicu effect kembali.

**Hasil uji browser:** selama 1,5 detik tanpa interaksi, revalidasi mencatat 30 request tambahan ke `/api/pengaturan` (run pertama: 32). Latensi fixture memengaruhi jumlah; frekuensi produksi tidak diukur.

**Perbaikan:** pisahkan effect pemuatan berdasarkan identitas/peran dari effect tampilan PIN; hindari menulis ulang state identik.

### 10. Ringkasan tutup toko tidak menghitung transaksi setelah baris ke-200

**Status: tetap, direproduksi — P1 ketika sesi melebihi 200 baris buku kas.** Batas berlaku pada baris buku kas, termasuk pemasukan/pengeluaran manual, bukan hanya jumlah struk POS. Volume harian pengguna belum diketahui.

**Bukti:** `src/lib/components/dashboard/TokoModal.svelte:47`, `src/routes/+page.svelte:173`, `src/lib/server/dataPagination.ts:3`, `src/lib/server/services/bukuKasService.ts:51`.

Pemanggil mengambil satu halaman default dan menjumlahkannya sebagai seluruh sesi. `transactionService.getRows()` memanggil `dbGet()`, bukan `dbGetAll()`; helper pagination lengkap memang ada tetapi tidak dipakai caller ini. Riwayat harian memiliki masalah serupa melalui `src/lib/services/riwayatService.ts:33`: server mengambil baris terawal ASC, lalu client mengurutkan sebagian itu DESC.

**Hasil uji:** 201 pemasukan masing-masing Rp10.000 menghasilkan 200 baris bernilai Rp2.000.000 untuk perhitungan caller, padahal jumlah sebenarnya Rp2.010.000. Handler GET terbaru sebagai kasir juga HTTP 200 dengan 200 baris. Selisih ini diturunkan dari query asli dan formula UI; modal tutup toko dengan 201 baris belum diuji end-to-end browser.

**Perbaikan:** ringkasan sesi dihitung di server; riwayat menggunakan pagination yang terlihat dan urutan yang tepat.

### 11. Rate limiter D1 kehilangan hitungan request paralel

**Status: tetap pada fallback, prioritas diturunkan — P2.** Penggunaan Durable Object utama dan D1 cadangan adalah tradeoff ketersediaan yang disengaja; masalahnya ada pada atomisitas penghitung cadangan.

**Bukti:** `src/lib/server/rateLimit.ts:85`, `src/lib/server/rateLimit.ts:125`.

SELECT dan UPDATE penghitung terpisah. Request bersamaan menulis `nextCount` yang sama.

**Hasil uji:** batas 1 request, 20 request paralel seluruhnya diizinkan; penghitung tersimpan hanya 1.

**Kontrol:** respons penolakan DO dikembalikan oleh `consumeRateLimit()` tanpa satu pun akses D1. Ini memverifikasi pemilihan backend, bukan benchmark konkurensi internal DO. `wrangler.jsonc` mengikat `REALTIME_HUB`; `wrangler.pages.jsonc` tidak mencantumkannya. Binding deployment aktual harus diperiksa sebelum menyatakan fallback ini aktif di produksi. Jika kedua backend gagal, kode sudah fail-closed.

**Perbaikan:** penghitung atomik dengan hasil update sebagai dasar keputusan. Jalur D1 tetap perlu benar ketika binding Durable Object tidak tersedia.

## Revalidasi temuan tambahan 12–30

Nomor 12–30 mengikuti urutan 19 bullet tambahan review pertama.

### 12. Pajak summary API menghitung POS dua kali

**Tetap, direproduksi — P2, kontrak API.** `src/lib/server/reportQueries.ts:175-181`. Omzet Rp40.000, tarif 0,5%, threshold nonaktif: pajak API Rp400, seharusnya Rp200. `pemasukanUsaha` sudah memuat POS, lalu `posGross` ditambahkan lagi.

**Diperjelas:** caller UI aktif di `dashboardService.ts:494-504` mengambil `transactions` dan menghitung ulang summary. Jadi hasil uji ini tidak membuktikan pajak UI atau tagihan pelanggan ganda. Tidak ditemukan konsumen aktif lain yang memakai angka summary API tersebut selain tes. Perbaiki konsistensi kontrak, dengan prioritas di bawah kerusakan uang/stok yang langsung dikonsumsi UI.

### 13. Simulasi pajak UI kehilangan konteks omzet YTD

**Tetap, direproduksi pada fungsi dan ditelusuri ke caller — P2.** `src/lib/services/dashboardService.ts:504`, `src/lib/stores/laporanState.svelte.ts:153-157`, `src/lib/services/taxService.ts:265-270`. Caller tidak meneruskan cumulative YTD.

Pemicu: opsi fasilitas Rp500 juta aktif dan periode terpilih hanya bagian tahun, dengan omzet terdahulu yang memengaruhi batas. Contoh periode Rp300 juta setelah omzet Rp300 juta: tanpa YTD hasil 0, dengan YTD Rp600 juta hasil Rp500.000. Default fasilitas ini nonaktif; bila nonaktif atau laporan mencakup seluruh tahun dari Januari, contoh tersebut tidak berlaku. Ini kesalahan simulasi sesuai konfigurasi aplikasi, bukan audit kepatuhan pajak usaha.

### 14. Konversi sendok cairan jatuh ke faktor 1

**Tetap, direproduksi — P2.** `src/lib/utils/unitConversion.ts:25-43`, `src/lib/utils/unitConversion.ts:147-157`, `src/lib/utils/unitConversion.ts:184-194`. Daftar cairan sendiri menawarkan `sdm (15 ml)`, tetapi deteksi kategorinya menjadi berat. Strict converter menolak, safe converter mengembalikan 1 untuk 1 sdm ke ml.

Masalahnya inkonsistensi dengan faktor yang dipilih aplikasi; asumsi fisik satu sendok bahan padat bukan tuntutan review ini. kg ke gram berjalan benar. Tentukan kategori berdasarkan satuan dasar saat nama satuan ambigu dan hindari fallback diam-diam yang mengubah hitungan stok/HPP.

### 15. Optimasi fingerprint membuang pembaruan katalog yang sah

**Tetap, direproduksi — P2, penting untuk multi-perangkat.** `src/lib/stores/posState.svelte.ts:53-83`. Dua fetch berhasil; server mengirim nama baru, halaman tetap menampilkan nama lama. Nama, gambar, isi resep, token, dan flag tidak tercakup fingerprint jika field yang dibandingkan tetap sama.

Harga/stok yang tercakup fingerprint masih memicu pembaruan. Quote online juga mengambil ulang harga server di `bayarState.svelte.ts:247-304`; temuan ini bukan bukti checkout menerima harga usang tanpa validasi. Optimasi deduplikasi sah, kriteria kesamaannya perlu mencakup data yang memengaruhi UI/perilaku.

### 16. Detail struk selalu disimpan ke ID 1

**Tetap, direproduksi — P2.** `src/routes/pengaturan/printer/+page.svelte:63-71`, `src/routes/pengaturan/printer/+page.svelte:96-106`, `src/lib/server/services/pengaturanService.ts:77-85`. Fixture membaca ID `910001` seperti seed UAT, tetapi PATCH meminta ID `1`. Service membatasi cabang+ID dan mengembalikan sukses tanpa memeriksa jumlah baris berubah.

Pemicu: baris pengaturan cabang bukan ID 1. Cabang yang memang menggunakan ID 1 tidak membuktikan kasus ini. Asumsi satu baris per cabang tidak berarti primary key seluruh cabang selalu 1; simpan ID yang benar-benar dibaca.

### 17. Nama cetak ulang salah; nominal berbeda menurut jalur printer

**Tetap dengan koreksi cakupan, direproduksi untuk HTML — P2.** `src/lib/utils/receiptPrint.ts:139-141`, `src/routes/pengaturan/pemilik/riwayat/+page.svelte:155-188`, `src/lib/server/services/transaksiKasirService.ts:56-69`.

Endpoint mengembalikan snapshot `nama_produk`, tetapi builder membaca `nama_kustom` atau relasi `produk.nama`. Nama menjadi `Produk Custom`. Caller aktif meneruskan respons detail tanpa mengisi relasi tersebut.

HTML/print-intent menampilkan harga satuan Rp10.000 pada baris `x2`, bukan subtotal Rp20.000, tanpa penanda harga satuan. Total transaksi tetap Rp20.000. Ini ketidakjelasan/ketidakkonsistenan rincian, bukan penagihan kurang. **Klaim nominal salah pada semua jalur dicabut:** caller pemilik untuk USB/Bluetooth sudah memakai `harga * jumlah` pada `:175`, meskipun nama produknya masih salah. Sepakati format subtotal atau penanda harga satuan yang jelas.

### 18. Rincian topping struk baru ambigu setelah memakai receipt server

**Tetap, statis lintas modul; dampak diperjelas — P2.** `src/lib/stores/bayarState.svelte.ts:590-605`, `src/lib/utils/receiptPrint.ts:177-197`, `src/routes/api/pos/transaction/+server.ts:68-79`.

Harga receipt sudah inklusif topping, dipetakan ke `product.harga`, lalu baris topping dicetak lagi dengan awalan `+` dan nominal. Contoh base Rp10.000+topping Rp3.000 menghasilkan rincian Rp13.000 dan `+ Rp3.000`, dengan total tetap Rp13.000. Ledger dan total pembayaran tidak bertambah Rp3.000 lagi. Gunakan `harga_dasar` untuk rincian aditif, atau nyatakan topping sebagai informasi yang sudah termasuk. Perangkat printer fisik belum diuji.

### 19. Readback arsip hanya memeriksa keberadaan objek

**Direklasifikasi menjadi penguatan integritas — P3.** `src/routes/api/archive/+server.ts:269-290`. Kode menunggu `put()`, mencatat SHA-256 di metadata, dan menolak jika `get()` tidak menemukan objek; body readback tidak dibandingkan dengan checksum.

Harness yang mengembalikan objek rusak adalah **injeksi kegagalan**, bukan bukti R2 mengubah objek pada operasi normal atau data produksi hilang. Klaim lama terlalu kuat bila dibaca sebagai bukti kerusakan arsip nyata. Jika kontrak yang diinginkan adalah verifikasi isi end-to-end seperti komentar kode, tambahkan validasi checksum; jika cukup mengandalkan keberhasilan storage, perjelas klaim readback-nya. Pisahkan dari race arsip nomor 5 yang tetap terjadi dengan konten normal.

### 20. Restore POS menggandakan pendapatan ketika agregat tetap ada

**Tetap, kini direproduksi pada generator SQL dan laporan asli — P1.** `scripts/restore-archive.mjs:140-161`, `src/lib/server/reportQueries.ts:69-71`. Script sudah menghapus ringkasan arsip manual untuk `archive_id` terkait; perlindungan itu tidak menghapus agregat POS yang memang dipertahankan saat arsip.

Generator mengganti `sumber='pos'` menjadi `arsip_restored`. Laporan lalu menghitung ledger restored sebagai manual, di samping agregat POS. Hasil uji: pendapatan Rp40.000 sebelum arsip, Rp40.000 saat hanya agregat tersisa, Rp80.000 setelah restore. Pemicu: restore ke database yang masih mempunyai agregat POS. Restore ke database kosong adalah konteks berbeda.

Fixture mengizinkan UUID pada pengaturan agar SQL restore dapat selesai. Pada schema migrasi asli, blocker nomor 1 dapat menggagalkan restore lebih dahulu; ini tidak diklaim sebagai eksekusi CLI sukses di produksi. Pertahankan sumber bisnis asli dan simpan penanda restore terpisah.

### 21. JSON audit besar menjadi invalid setelah dipotong

**Tetap, direproduksi dengan payload terarah; dampak dibatasi — P3.** `src/lib/server/auditLog.ts:20-24`, `src/lib/server/auditLog.ts:109-154`. Payload melampaui 8.192 karakter dipotong mentah, menghasilkan `malformed JSON` dan tertinggal di outbox.

Payload kecil bukan pemicu; kegagalan audit ini juga tidak otomatis menggagalkan transaksi utama karena error ditangkap. Test memakai metadata panjang sintetis, belum mereproduksi lewat klik operasional biasa. `security-events` membatasi data 4.096 byte; jangan memakai endpoint itu sebagai bukti payload 9.000 karakter pasti lolos. Batasi field sebelum serialisasi atau simpan JSON ringkas yang tetap valid. Pemotongan snapshot checkout perlu pengujian batas tersendiri sebelum dampaknya disamakan dengan audit.

### 22. Pilihan tahun laporan berhenti di 2025

**Tetap, direproduksi — P2.** `src/lib/components/laporan/LaporanFilter.svelte:170-171`, `src/lib/components/laporan/LaporanFilter.svelte:190-191`. Pilihan bulanan/tahunan dibuat dari `2020 + i` untuk enam tahun; 2026 tidak tersedia. Filter harian/rentang tanggal masih memberi jalur alternatif. Buat pilihan tahun dinamis, setidaknya mencakup tahun aktif.

### 23. Dua tampilan memakai label laba bersih untuk angka berbeda

**Diperjelas menjadi inkonsistensi label — P2, statis.** `src/lib/components/laporan/LaporanSummaryCards.svelte:35-45`, `src/lib/components/laporan/LaporanLabaRugiCard.svelte:94-95`, `src/lib/stores/laporanState.svelte.ts:159-165`.

Hero memakai `summary.saldo` (masuk-keluar), sementara rincian memakai `summary.labaBersih` (dikurangi simulasi pajak). Saldo kas tidak harus berkurang oleh pajak yang belum dibayar; pilihan cash-basis itu dapat dibenarkan. Yang perlu diselaraskan adalah label hero dan rincian saat simulasi pajak nonzero. Rename hero menjadi saldo/hasil kas sebelum simulasi, atau tampilkan laba bersih simulasi secara konsisten. Review ini tidak menetapkan akuntansi akrual/HPP sebagai kewajiban aplikasi.

### 24. Kolom kas akhir PDF memakai volume transaksi

**Tetap, kini direproduksi pada generator PDF asli — P2.** `src/lib/services/reportPdfExport.ts:543-590`, `src/lib/utils/reportGrouping.ts:81-88`.

Pemasukan tunai Rp100.000, pengeluaran tunai Rp30.000, pajak 0: baris berlabel `SALDO AKHIR KAS / LABA BERSIH (A - B - Pajak)` mencetak tunai Rp130.000 tetapi total Rp70.000. Modul PDF asli dan jsPDF/autoTable menghasilkan bukti di memori. Ini tetap salah meskipun memilih model cash-basis dan mematikan pajak; total masuk+keluar sah sebagai volume, bukan sebagai saldo pada label itu. Perjelas pula saldo periode vs saldo akhir dengan saldo awal.

### 25. Penerapan rekomendasi penjualan AI tidak membuat quote

**Tetap, statis lintas caller/endpoint — P2.** `src/lib/services/autoApplyService.ts:109-141`, `src/routes/api/pos/transaction/+server.ts:139-157`. Rekomendasi `create_transaction` bertipe `penjualan` mengirim POST tanpa `quote_token`; mode default online mewajibkan token.

Jalur ini aktif melalui `topBarAiAssistant.svelte` → `aiChatModal.svelte` → `autoApplyService`; service analisis memang dapat menghasilkan rekomendasi penjualan. Rekomendasi pemasukan/pengeluaran biasa memakai buku kas dan tidak terkena persyaratan quote ini. Endpoint menolak, bukan menerima transaksi tanpa harga terverifikasi. Ambil quote lalu ikuti konfirmasi yang sesuai. Penerapan rekomendasi AI penuh belum diuji browser pada putaran ini.

### 26. Parser HPP meminta `name`, membaca `nama`

**Tetap, kini direproduksi pada fungsi parser asli — P2.** `src/routes/api/hpp/parse/+server.ts:49`, `src/routes/api/hpp/parse/+server.ts:72-81`. Respons model yang sesuai prompt (`name`) menghasilkan 0 item; kontrol dengan `nama` menghasilkan 1 item. Caller `manajemenmenuCrud.ts:131-139` memakai endpoint ini.

Model kadang dapat mengembalikan field Indonesia sehingga terlihat berhasil; itu bukan kontrak yang konsisten. Alur memberi 422 ketika hasil kosong dan masih memungkinkan input manual, sehingga bukan kegagalan seluruh fitur HPP. Tidak ada panggilan model eksternal dalam pengujian.

### 27. Shortcut AI menimpa periode eksplisit

**Tetap, kini direproduksi pada resolver asli — P2.** `src/routes/api/aichat/+server.ts:246-299`, `src/routes/api/aichat/+server.ts:512-526`, `src/routes/api/aichat/+server.ts:1133-1176`.

Dengan hari acuan 15 September 2026, pertanyaan `menu terlaris bulan lalu` memilih 1–15 September, bukan 1–31 Agustus. Kontrol `bulan ini` memilih periode yang benar. Fast-path tanpa panggilan model adalah optimasi yang sah; kegagalan menghormati periode eksplisit bukan tradeoff yang harus diterima. Default resolver selalu non-null, sehingga analyzer lanjutan yang seharusnya menangani pertanyaan lain tidak dipakai di jalur ini. Respons jawaban akhir model tidak diuji.

### 28. Password sah berubah sebelum dikirim saat login

**Tetap, kini direproduksi pada fungsi validasi/sanitasi — P2.** `src/routes/login/+page.svelte:68-83`, `src/lib/utils/validation.ts:19-28`, `src/routes/api/gantikeamanan/+server.ts:151-206`.

String uji sintetis yang mengandung `Script` lolos kebijakan password baru dan validasi login, tetapi substring itu hilang setelah `sanitizeInput()`. Jalur perubahan password hanya trim, tidak melakukan transformasi tersebut. Password tanpa pola yang dihapus lolos kontrol tanpa perubahan. Pertahankan password sebagai nilai autentikasi; sanitasi HTML seharusnya diterapkan pada output, bukan mengubah password. Tidak ada kredensial pengguna yang dipakai atau diubah dalam tes.

### 29. Toast manager tidak mengirim perubahan reaktif

**Tetap, statis + observasi browser printer — P3.** `src/lib/utils/ui.ts:7-14`, `src/lib/utils/ui.ts:47-59`. Getter membaca objek biasa yang dimutasi, tanpa `$state`/store. Setelah fixture PATCH sukses, halaman printer tidak menampilkan toast.

Cakupan adalah caller utility ini yang mengandalkan getter tersebut; bukan semua notifikasi aplikasi. Snackbar/modal lain terbukti tampil pada uji catat dan pajak. Uji printer juga tidak membuktikan penyimpanan DB nyata karena respons API berupa fixture.

### 30. Konfigurasi CI tidak cocok dengan toolchain

**Pembaruan implementasi 15 September 2026: diperbaiki.** Workflow memakai `.node-version` dan pnpm dari `packageManager` melalui action v4; `format:check` tersedia. Frozen install Node 24.20.0/pnpm 11.24.0 berhasil. Format, check, ESLint, unit, operations, dan build lulus lokal. Hasil remote GitHub Actions belum diverifikasi. Uraian berikut adalah bukti baseline sebelum perbaikan.

**Tetap, statis — P2.** `.github/workflows/ci.yml:20-25`, `.github/workflows/ci.yml:37`, `package.json:6-8`, `package.json:10-61`. Workflow meminta Node 20/pnpm 9; repo meminta Node >=22/pnpm 11.24.0. Perintah `pnpm format:check` tidak mempunyai script yang sesuai.

Ini masalah reproduksibilitas quality gate, bukan bukti aplikasi lokal gagal build. GitHub Actions belum dijalankan atau diperiksa status remotenya pada revalidasi. Selaraskan versi dan nama script dengan kontrak proyek.

## Kualitas pengujian

Beberapa suite bernama kuat, tetapi tidak menjalankan implementasi fitur:

- `src/tests/store-state-tests.ts` membuat ulang fungsi kalkulasi dan perpindahan mode; store Svelte asli tidak diimpor.
- `src/tests/archive-restore-tests.ts` membuat kalkulator laporan sendiri; handler arsip dan script restore tidak dijalankan.
- `src/tests/menu-atomic-tests.ts` menguji validator buatan file tes, tanpa menjalankan batch penyimpanan menu.
- `src/tests/realtime-fanout-tests.ts` menguji kelas `RealtimeChannelManager` buatan tes, bukan manager aplikasi atau Durable Object.
- `src/tests/a11y-focus-tests.ts` menguji `MockFocusTrapManager`, bukan DOM modal.
- Sebagian E2E hanya memeriksa redirect login atau utilitas tanggal; tidak menjalankan proses bisnis sesuai nama suite.

Ada pengujian yang berguna: token harga, fingerprint, kalkulasi biaya, backup, playback migrasi, serta checkout browser. Cakupannya perlu diarahkan ke kontrak UI–API–database dan kasus kegagalan/konkurensi.

## Pemeriksaan dijalankan

Hasil review pertama; pemeriksaan umum ini tidak dijalankan ulang karena revalidasi tidak mengubah kode aplikasi:

- `rtk pnpm check`: lulus, 0 error dan 0 warning.
- `rtk pnpm exec eslint .`: lulus.
- `rtk pnpm test:unit`: seluruh 13 suite lulus.
- `rtk pnpm test:operations`: 9 tes backup + self-test UAT lulus.
- `rtk pnpm build`: lulus; ada warning pola glob PWA tidak menemukan manifest.

Reproduksi yang benar-benar dijalankan ulang/ditambahkan pada baseline di atas:

- `rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-backend.mts"`: 12 kasus bukti, ditambah kontrol void/metode bayar berurutan dan pemilihan DO; selesai exit 0. Pagination juga lewat handler GET kasir terbaru; restore lewat generator SQL asli.
- `rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-archive.mts"`: race arsip direproduksi pada dua kondisi schema, kontrol lock/resume lulus; selesai exit 0. Injeksi readback rusak dicatat sebagai penguatan integritas, bukan insiden produksi.
- `rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-browser.mjs"`: kedelapan skenario selesai dalam satu run, exit 0. API fixture; bukan suite E2E terhadap database produksi.
- `rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-contracts.mts"`: empat kasus resolver AI, parser HPP, password, dan PDF; selesai exit 0. PDF disimpan di memori, tanpa panggilan model eksternal.
- `rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-browser.mjs" production-cart`: kontrol satu ukuran lulus; dua ukuran memunculkan `each_key_duplicate` dengan `isProduction=true`; run final exit 0. Vite serve lokal dengan mode produksi, bukan bundle deployment.

Assertion harness terutama memeriksa bahwa perilaku bermasalah masih dapat direproduksi. Exit 0 pada harness berarti reproduksinya berhasil, bukan fitur yang diuji sudah benar.

Koreksi harness ikut dilakukan: fixture penjualan dibuat konsisten; R2 normal dipisahkan dari injeksi korupsi; seed/control ditambahkan; browser menunggu hydration atau error yang diharapkan. Percobaan awal mode produksi membaca DOM terlalu dini, kemudian percobaan berikutnya timeout karena menunggu UI yang gagal dirender. Keduanya tidak dihitung sebagai bukti run sukses; run final menggunakan kontrol halaman normal dan menunggu error yang spesifik. `/sw.js` 404 pada Vite serve mode produksi adalah keterbatasan setup lokal ini, bukan temuan deployment baru.

## Bagian yang baik

- Harga transaksi diverifikasi di server menggunakan token bertanda tangan dan terikat cabang.
- Checkout menggunakan batch D1, unique idempotency key, dan fingerprint permintaan.
- Perubahan password dan pencabutan sesi ditulis dalam satu batch.
- Query utama memakai parameter; pemeriksaan peran dan cabang tersedia di backend.
- Pengurangan stok memiliki trigger database untuk mencegah nilai negatif.
- Upload memeriksa tipe/signature gambar dan membatasi kunci objek.
- Agregat harian dan pembagian modul backend memberikan fondasi pemeliharaan yang berguna.

## Urutan perbaikan

1. Selaraskan schema/migrasi dan pulihkan kontrak satuan stok/HPP.
2. Buat void, perubahan pembayaran, dan klaim arsip aman terhadap request tumpang tindih; pertahankan sumber POS saat restore.
3. Perbaiki pembayaran campuran ukuran, pesan sukses palsu pencatatan kas, dan sinkronisasi konfigurasi pajak multi-perangkat.
4. Pisahkan effect pemuatan pengaturan kasir dan pastikan ringkasan sesi/riwayat mengambil seluruh data yang dimaksud.
5. Selaraskan rincian laporan/PDF/struk, perhitungan YTD, sinkronisasi katalog, serta kontrak AI/HPP dan password.
6. Perbaiki fallback D1/CI, lalu penguatan integritas readback, JSON audit, dan reaktivitas toast sesuai prioritas.
7. Tambahkan regresi pada modul asli, database hasil migrasi, dan browser, termasuk kontrol sukses/gagal serta interleaving; lengkapi suite yang saat ini menguji logika tiruan.

## Kandidat yang tidak dijadikan bug operasional

- Edit pengaturan HPP melalui PATCH: helper memang memiliki cabang PATCH, tetapi caller aktif `bahanHppState.svelte.ts:398` tidak meneruskan ID, sehingga memakai POST yang didukung endpoint. Menilai alur aktif gagal karena PATCH adalah keliru.
- PIN empat digit dan bypass sebelum PIN dikonfigurasi: kebijakan eksplisit pada commit `cdf9a8e`. Keputusan ini berbeda dari kegagalan effect pemuatan nomor 9.
- Cash-basis dan pajak simulasi: tidak otomatis salah karena tidak menerapkan akuntansi akrual. Temuan laporan mempertahankan fokus pada label atau hitungan yang bertentangan dengan kontrak tampilan sendiri.
- Heuristik AI, fingerprint cache, serta fallback DO→D1: pendekatan optimasi/ketersediaannya sah. Yang perlu diperbaiki adalah periode yang tertimpa, perbandingan payload tidak lengkap, dan hitungan fallback yang tidak atomik.
- Dugaan larangan zoom menyeluruh: ada metadata viewport tambahan dari layout; tanpa pemeriksaan hasil efektif lintas perangkat, klaim itu belum cukup kuat.
