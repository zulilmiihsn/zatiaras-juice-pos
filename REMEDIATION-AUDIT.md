# Audit penyelesaian F01–F30

Tanggal: 15 September 2026.

Commit implementasi: `21e5f99f59013538c60f78aff7a61ba3af665893`.

HEAD saat verifikasi akhir: `6c7c1dd91f653ae16d510417c9aafdd9dbfeda31`. Commit tambahan ini hanya memperbarui dokumentasi; kode aplikasi yang diuji sama dengan `21e5f99`.

Referensi: [rencana perbaikan](REMEDIATION-PLAN.md), [bukti review awal](CODE-REVIEW.md).

## Kesimpulan

**Belum selesai semua.** Seluruh F01–F30 mendapat perubahan implementasi, tetapi centang agen terlalu optimistis:

- **18 perbaikan inti lolos pemeriksaan lokal:** F01, F03, F04, F08, F10, F11, F12, F14, F15, F16, F18, F19, F22, F23, F24, F26, F28, F30.
- **12 masih parsial:** F02, F05, F06, F07, F09, F13, F17, F20, F21, F25, F27, F29.
- **B9 belum selesai:** E2E bisnis penuh belum memiliki bukti lulus, dan masih ada kegagalan integritas uang/data yang direproduksi.

Lolos lokal berarti perubahan inti sesuai tujuan dan didukung pembacaan caller serta pengujian terarah yang disebutkan di bawah. Itu bukan klaim seluruh kriteria penerimaan perangkat fisik, deployment produksi, atau semua interleaving sudah teruji. Parsial berarti ada perubahan yang benar, tetapi masih ditemukan kekurangan konkret terhadap kontrak rencana; bukan berarti pekerjaan agen seluruhnya gagal.

**Prioritas tertinggi:** F05 arsip, F07 konflik konfigurasi pajak, F20 restore, F25 retry AI, lalu F02 pecahan jumlah bahan.

## Metode dan cakupan bukti

- Membandingkan 79 file berubah terhadap baseline `88c6436`, lalu menelusuri controller/service/store/caller yang berhubungan dengan semua 30 tugas.
- SQLite in-memory dibangun dari **28 migrasi aktual**. Pengujian memanggil service/handler asli, bukan membuat kalkulator bisnis tiruan.
- D1 lokal melalui Wrangler `getPlatformProxy({ persist: false })`, menggunakan binding audit terpisah. Semua 28 migrasi berhasil pada runtime Workers lokal. State `.wrangler` proyek tidak dihapus/reset.
- Browser Chromium menjalankan route Svelte dan modul client asli melalui Vite port 5189. Respons API berupa fixture terkontrol; bukan transaksi produksi.
- PDF menggunakan generator aplikasi, jsPDF, dan autoTable asli; penyimpanan ditangkap di memori.
- Resolver AI dan fungsi cetak baru yang tidak diekspor diuji dengan deklarasi fungsi asli dari AST, setelah anotasi tipe dihapus. Keluaran eksternal dibuat fixture; tidak ada panggilan model berbayar atau printer fisik.
- Pengujian race menggunakan interleaving terkontrol atau request paralel. Angka hasil menunjukkan keadaan yang dapat terjadi, bukan frekuensi insiden produksi.

Audit ini menghasilkan perubahan dokumentasi. Temuan residual belum diperbaiki dalam putaran audit.

## Matriks semua tugas

### F01 — Schema pengaturan: lolos lokal

Migrasi 0025 mengubah ID menjadi TEXT dan reader utama memakai `kunci IS NULL`. GET asli mengembalikan row `910001`, terpisah dari row pajak, tanpa error phantom column. Seluruh 28 migrasi juga berhasil pada D1 lokal.

Batas rilis: migrasi rebuild membuang kolom fisik `pajak_config` bila deployment memiliki schema berbeda; komentar meminta operator mengonversi data tersebut lebih dahulu. Inspeksi/backup schema aktual tetap prasyarat operator, belum diuji terhadap produksi.

### F02 — Satuan pembelian/HPP: parsial

1 kg tersimpan dan diedit kembali menjadi 1 kg dengan benar. Namun, **500 gram ditampilkan `0,5 kg`, lalu disimpan menjadi 5.000 gram**. Lihat residual R01.

### F03 — Void bersamaan: lolos lokal

Service asli dengan CAS menghasilkan stok 10, bukan 12, dari stok awal 8 dan pembatalan qty2. Request kedua menjadi duplicate tanpa efek tambahan. Pengujian D1/Workers lokal juga menghasilkan stok10; rollback kegagalan tengah batch dan trigger penolakan replay diuji pada SQLite. Marker void mempertahankan identitas pembatalan.

### F04 — Perubahan metode pembayaran: lolos lokal

Pada dua request bersamaan, agregat hanya berpindah sekali. Fixture dua penjualan menghasilkan tunai20.000/non-tunai20.000; D1 lokal mengonfirmasi satu perpindahan. Interleaving pembayaran vs void menghasilkan satu perubahan sah dan konflik409 pada pembacaan basi, dengan total agregat konsisten.

### F05 — Arsip: parsial, prioritas tinggi

Lock untuk tahun yang sama berhasil, tetapi cutoff berbeda, edit saat upload, pembukaan sesi, lease habis, dan request arsip baru setelah completed belum benar. **Kegagalan edit saat upload juga direproduksi pada D1/Workers lokal.** Lihat R02.

### F06 — Hasil simpan catat: parsial

HTTP500 kini mempertahankan isian dan tidak menampilkan sukses palsu. Kegagalan simpan antrean offline masih tanpa pesan error, dan klaim stable intent belum berlaku antar-submit. Lihat R03.

### F07 — Persistensi pajak: parsial, prioritas tinggi

CSRF dan pesan kegagalan UI sudah benar. Namun, CAS masih bisa kehilangan update, expected revision boleh dihilangkan, branch request tidak divalidasi, dan validasi field belum lengkap. Lihat R04.

### F08 — Identitas keranjang: lolos lokal

Key bersama memasukkan porsi dan sorted add-on IDs. Route pembayaran asli merender reguler+jumbo sebagai dua baris tanpa `each_key_duplicate`. Kuantitas tetap bukan identitas item.

### F09 — Loop settings kasir: parsial

Kasir idle sekarang menghasilkan nol GET tambahan dalam jendela1,5 detik. Namun, switch cabang ketika request settings sedang berjalan tidak memuat settings cabang baru. Lihat R05.

### F10 — Ringkasan sesi/riwayat: lolos lokal

Query asli menghitung 501 baris Rp10.000 dengan modal awal100.000 menjadi uang kasir5.110.000. Cursor DESC mengambil seluruh501 ID tanpa duplikat, terbaru dahulu, dan search menemukan row di luar halaman pertama. Caller dashboard/modal memakai ringkasan SQL dan ketiga halaman riwayat memakai pagination baru.

Batas: E2E sesi501 baris melalui seluruh alur buka/transaksi/tutup belum dijalankan pada audit ini; bukti angka/pagination berasal dari service asli dan pemeriksaan caller.

### F11 — Limiter fallback D1: lolos lokal

20 request, limit1 menghasilkan tepat1 allowed untuk key baru dan existing. Kasus ini juga lulus pada D1/Workers lokal dengan UPSERT RETURNING. Jalur DO utama tetap ada; pengujian ini bukan benchmark konkurensi internal DO.

### F12 — Pajak API ganda: lolos lokal

Service laporan asli memberi pajak200 untuk omzet POS40.000 pada tarif0,5%. Kontribusi manual dipisahkan dari POS, sehingga penyebab double-counting awal hilang.

### F13 — YTD dan satu summary laporan: parsial

Kasus normal omzet periode300 juta setelah300 juta menghasilkan pajak500.000. Kegagalan query YTD masih berubah menjadi0, dan UI mengambil breakdown/label dari lokasi objek yang salah. Lihat R06.

### F14 — Konversi sendok cairan: lolos lokal

1sdm→15ml, 1sdt→5ml, kg/gram roundtrip dan pack bekerja pada utility asli. Konversi berat→volume tanpa konteks ditolak. Bug parsing input pecahan berada pada F02, bukan pada faktor utility ini.

### F15 — Refresh katalog: lolos lokal

Fingerprint parsial dihapus. Setelah server fixture mengirim `Nama Baru`, halaman POS asli menampilkan nama baru. Guard generation/cabang tersedia untuk membuang respons basi.

### F16 — ID detail struk: lolos lokal

Browser membaca910001 dan mengirim PATCH910001. Service update asli menyimpan nilai baru dan menolak ID tidak ditemukan404. Row main dibatasi cabang dan `kunci IS NULL`.

### F17 — Cetak ulang: parsial

Nama snapshot biasa dan subtotal qty sudah diperbaiki. Namun, nama numerik dibuang dan HTML cetak ulang mencetak subtotal inklusif kemudian topping sekali lagi. Lihat R07.

### F18 — Rincian struk transaksi baru: lolos lokal untuk receipt lengkap saat ini

Fungsi cetak baru asli yang diekstrak dengan snapshot lengkap menghasilkan baris dasar20.000+topping6.000=total26.000 pada HTML dan payload ESC/POS. Ini membuktikan perbaikan jalur receipt baru; tidak menutup bug cetak ulang F17.

Batas: fallback receipt legacy tanpa `harga_dasar` dan cetak perangkat fisik belum diuji; belum boleh mengklaim seluruh variasi receipt lama terverifikasi.

### F19 — Checksum readback: lolos lokal

Handler kini benar-benar membaca body dan membandingkan checksum/ukuran. Readback yang rusak menolak proses dan mempertahankan ledger; readback normal lolos. Masalah finalisasi F05 tetap dapat terjadi meskipun readback normal.

### F20 — Restore: parsial, prioritas tinggi

Sumber POS sekarang dipertahankan dan normal roundtrip menjaga pendapatan40.000. Namun, helper konflik tidak dipanggil CLI dan preflight agregat hanya berupa teks log. Lihat R08.

### F21 — JSON audit: parsial

Payload metadata besar kini menjadi JSON valid dan berhasil masuk audit log. Penanganan payload invalid lama bukan karantina yang dijanjikan, dan cron tetap bisa tersangkut pada100 row invalid pertama. Lihat R09.

### F22 — Tahun laporan: lolos lokal

Browser menampilkan2026. Utility asli pada `2026-12-31T16:00:00Z` memasukkan2027 sesuai WITA. Kedua selector memakai daftar yang sama. Perilaku tab yang dibiarkan terbuka melewati tahun baru tanpa perubahan state belum diuji.

### F23 — Label kas vs simulasi laba: lolos lokal

Browser menampilkan `Hasil Kas Periode` dan `Estimasi Laba Setelah Simulasi Pajak` sebagai label berbeda. Perbaikan ini tidak mengubah ledger atau memaksakan pajak simulasi menjadi kas keluar.

### F24 — PDF net kas: lolos lokal

Generator PDF asli menghasilkan net kas70.000 untuk masuk100.000/keluar30.000; dengan simulasi pajak500, baris estimasi menjadi69.500 dan kas tetap70.000. PDF dibentuk di memori; ini lebih kuat daripada hanya menguji group helper.

Catatan kosmetik: sebagian header bagian PDF masih memakai istilah lama `SALDO AKHIR`; angka net yang menjadi bug inti sudah benar. Selaraskan istilah saat penyempurnaan label berikutnya.

### F25 — Apply rekomendasi AI: parsial, prioritas tinggi

Quote awal sudah diminta. Namun, requote dapat mengubah nominal tanpa review ulang dan retry hasil parsial menggandakan rekomendasi kas manual yang sebelumnya berhasil. Lihat R10.

### F26 — Parser HPP: lolos lokal

Parser asli menerima nama kanonik `nama` dan alias `name`. Qty1kg menjadi1.000gram dengan biaya20/gram untuk pembelian20.000. Prompt memakai field kanonik yang sama. Respons model eksternal tidak dipanggil dalam audit.

### F27 — Resolver periode AI: parsial

`bulan lalu` sudah benar dan tanggal numerik tak terselesaikan dapat jatuh ke analyzer. Namun, nama bulan/tahun relatif masih ditimpa periode default bulan ini. Lihat R11.

### F28 — Password: lolos lokal

Browser mengirim string fixture mengandung `Script` dan karakter sudut tanpa perubahan. Login/change server memiliki aturan trim tepi yang sama. Audit ini memverifikasi transport dan membaca verifikasi bcrypt; login akun produksi tidak diuji.

### F29 — Toast: parsial, prioritas rendah

Toast printer benar-benar muncul dalam browser. Lifecycle cleanup baru terpasang pada printer; caller lainnya belum membuang timer saat navigasi. Lihat R12.

### F30 — Toolchain/CI: lolos pemeriksaan lokal konfigurasi

Workflow mengikuti `.node-version` dan `packageManager`; script format tersedia. Check/lint/unit/operations/build terbaru lulus lokal. Perubahan F30 dikerjakan sebelum agen melanjutkan paket lain. Pipeline GitHub Actions remote tetap belum diverifikasi.

## Residual yang harus dituntaskan

### R01 / F02 — Pecahan jumlah masih diparse sebagai Rupiah

- **Bukti:** `src/lib/utils/currency.ts:21-27`, `src/routes/stok/+page.svelte:306-308`, `src/lib/stores/bahanHppState.svelte.ts` pada `saveBahan()`.
- `parseRupiah()` menghapus koma dan titik, sehingga `0,5` menjadi5. Reverse conversion baru tidak cukup karena hasil tampilan diparse kembali dengan parser salah.
- **Browser asli:** stored500gram → form`0,5`kg → PATCH`jumlah_beli_terakhir:5000`. Kontrol1.000gram →1kg →1.000gram lulus.
- **Perbaikan:** pisahkan parser quantity desimal Indonesia dari parser uang. Terapkan pada purchase quantity, stok, minimum stok, pack size, dan yield sesuai kontraknya; jangan hanya mengganti satu field. Uji edit berulang termasuk0,5kg dan pecahan stok.

### R02 / F05 — Guard arsip belum menjadi guard seluruh commit

- **Bukti:** `drizzle/0027_archive_jobs.sql:20`, `src/lib/server/archiveService.ts:93-113`, `src/routes/api/archive/+server.ts:119-157`, `:338-451`.
- Unique lock berlaku per **cabang+tahun**, padahal dua cutoff berbeda dapat mengambil row yang sama. Dua request2026/2027 atas kas150.000 menghasilkan summary300.000 dan keduanya200.
- Claim finalisasi tidak memeriksa lease expiry, sesi aktif, atau kesesuaian seluruh manifest. Kondisi sesi/revision hanya membatasi sebagian DELETE; INSERT summary dan status completed tetap berjalan.
- **Edit saat upload:** nominal150.000 diubah menjadi200.000/revision+1. Hasil200, ledger200.000 tetap ada, summary arsip150.000 juga masuk: total historis350.000. Kasus ini lulus reproduksi pada **D1/Workers lokal asli**.
- **Toko dibuka saat upload:** ledger150.000 dan summary150.000 sama-sama tersisa, job completed.
- **Lease expired:** finalisasi tetap200. **Row baru eligible setelah completed:** request berikutnya sekadar resume berdasarkan tahun dan mengabaikan row baru.
- **Perbaikan:** satu klaim eksklusif per cabang; validasi ownership+expiry+seluruh manifest+sesi pada claim finalisasi dalam batch; semua efek tergantung claim itu. Status completed hanya sesudah semua efek sah. Gunakan identitas request/job untuk retry, bukan tahun sebagai pembatas permanen.
- Audit juga menemukan bump revision manual memakai `(existing.revision ?? 0)+1` dari snapshot (`bukuKasService.ts:330-336`); ubah menjadi increment atomik agar dua update tidak memiliki versi sama. Ini penting sebelum mengandalkan revision sebagai guard arsip.

### R03 / F06 — Queue failure diam dan intent retry belum stabil

- **Bukti:** `src/lib/stores/catatState.svelte.ts:170-205`, `:293-320`.
- Catch gagal IndexedDB mengembalikan `failed/queue_gagal` tanpa menulis notifikasi; caller hanya menangani saved/queued. Komentar bahwa error sudah ditampilkan tidak benar untuk cabang ini.
- **Browser:** injeksi gagal transaction IndexedDB pending mempertahankan form, tetapi tidak menampilkan alasan gagal menyimpan. HTTP500 kontrol sudah benar.
- `trx.id` masih `crypto.randomUUID()` di setiap pemanggilan `saveTransaksi()`. Komentar “ID intent stabil per pemanggilan” bukan jaminan ID yang sama pada retry submit hasil ambigu.
- **Perbaikan:** tampilkan failure berdasarkan typed result di caller; pertahankan intent+payload selama status commit belum diketahui dan pisahkan dari transaksi baru. Pertahankan pemisahan keberhasilan commit vs refresh.

### R04 / F07 — CAS pajak membandingkan pembacaan yang salah

- **Bukti:** `src/routes/api/pengaturan/pajak/+server.ts:104-120`, `:169-200`, `src/lib/tax/engine.ts:23-45`.
- `loadEnvelope()` membaca revision/settings, tetapi `currentNilai()` membaca lagi **sesudah** menghitung payload berikutnya. Jika request lain commit di antaranya, request pertama menerima nilai baru sebagai expected value lalu menimpanya memakai revision/payload lama.
- **Reproduksi handler asli:** dua penulis membawa expected revision3; keduanya200, revision akhir4, salah satu edit hilang. Kontrol request stale yang benar-benar berurutan ditolak409.
- Expected revision boleh undefined pada v2, bertentangan dengan kontrak compare-and-swap. Body branch dikirim client tetapi diabaikan server: permintaan intended `balikpapan` dengan sesi `samarinda` malah menulis `samarinda` dan200. Ini bukan bypass isolasi sesi; ini ketidakcocokan intent cabang yang dapat menghasilkan cache/konfigurasi salah.
- Validator menerima `isEnabled: 'false'` serta `thresholdAmount: -1` karena kedua field tidak divalidasi dengan benar.
- **Perbaikan:** return raw expected nilai bersama envelope dari pembacaan pertama, lalu CAS nilai/revision itu; wajibkan expected revision v2; validasi requested branch terhadap sesi; validasi seluruh boolean/threshold/ID dan batas payload.
- Tinjau juga sinkronisasi draft: `taxSettingsState.syncWithServer()` mengganti draft tanpa dirty/generation guard. Jangan mengklaim background sync sudah menjaga draft hanya karena service menulis cache terpisah.

### R05 / F09 — Switch cabang ketika fetch aktif kehilangan refresh

- **Bukti:** `src/routes/+layout.svelte` pada `loadKasirSecuritySettings()` dan effect fetch.
- `isLoadingSecuritySettings` membuat fetch cabang baru return lebih awal. Respons cabang lama kemudian dibuang karena identitas berbeda, tetapi tidak ada request berikutnya untuk cabang baru.
- **Browser terkontrol:** request samarinda ditahan; branch diubah menjadi samarinda2; setelah respons selesai, tidak ada GET pengaturan samarinda2. Kontrol kasir idle menghasilkan0 request berulang, jadi loop awal memang sudah fixed.
- **Perbaikan:** invalidasi generation/abort request lama pada perubahan identitas lalu mulai request baru; atau antrekan refresh terbaru sampai in-flight selesai. Sertakan identitas sesi, bukan hanya role dan branch.

### R06 / F13 — Data gagal berubah menjadi nol dan breakdown salah sumber

- **Bukti:** `src/lib/server/reportQueries.ts:217-251`, `src/lib/stores/laporanState.svelte.ts:153-169`, `src/lib/services/dashboardService.ts:533-539`.
- Query omzet/YTD wajib masih memakai `.catch(() => ({gross:0/total:0}))`. Saat pembacaan omzet sebelum periode gagal, report tetap berhasil dan simulasi pajak yang seharusnya500.000 menjadi0.
- Dashboard menyimpan breakdown/label di `data.summary`, tetapi store mencari `reportDataContent.taxBreakdown/taxLabel` pada root. Akibatnya nilai pajak server dipakai tetapi penjelasan/label jatuh ke hitungan lokal tanpa YTD.
- **Browser:** nominal pajak server dipertahankan, label `PPh server YTD` dari fixture tidak tampil. Source menunjukkan fallback tersebut mengabaikan breakdown di summary.
- **Perbaikan:** propagasikan query wajib gagal; baca breakdown/label dari `rawSummary`; pastikan nilai dan rincian berasal dari satu hasil kanonik. Uji multi-tax, YTD, cache contract version, dan lintas tahun.

### R07 / F17 — Rincian cetak ulang masih salah

- **Bukti:** `src/lib/utils/receiptLines.ts:41-49`, `src/lib/utils/receiptPrint.ts:138-162`.
- Nama snapshot diuji dengan `num(item.nama_produk)`. Nama sah numerik seperti`123` diabaikan dan menjadi`Produk Custom`.
- HTML menampilkan `line.subtotal` inklusif26.000, kemudian baris topping`+6.000`, sementara total header26.000. Jalur ESC/POS pemilik memakai base20.000, sehingga kedua renderer kembali berbeda.
- **Perbaikan:** pilih nama berdasarkan tipe string/non-empty, bukan bisa tidaknya menjadi angka; saat breakdown terpercaya tampilkan base×qty+topping×qty, atau jelaskan topping sudah termasuk tanpa menjumlahkan ulang.
- Tes baru agen memeriksa arithmetic adapter tetapi tidak merender HTML untuk fixture topping tersebut. Hash HTML yang lulus memakai kasus tanpa topping dan tidak menangkap bug ini.

### R08 / F20 — Deteksi konflik restore tidak tersambung ke CLI

- **Bukti:** `scripts/restore-archive-lib.mjs:84-129`, `scripts/restore-archive.mjs:141-147`.
- `diffAgainstExisting()` dibuat, tetapi CLI tidak mengimpor atau memanggilnya dan tidak membaca target rows. Builder hanya memakai `WHERE NOT EXISTS(id)`.
- **Reproduksi SQL asli:** target memiliki ID sama dengan nominal berbeda; apply tetap berhasil dan diam-diam melewatkan row tersebut. Ini bukan hasil conflict yang diwajibkan rencana.
- “Preflight agregat” pada CLI hanya `console.log`; tidak menghentikan apply ketika agregat hilang. Status job/pointer arsip juga tidak diperbarui saat restore, sehingga request arsip lagi dapat kembali ke completed pointer lama.
- **Perbaikan:** sambungkan validasi target+conflict dan preflight agregat nyata, sertakan guard atomic pada apply agar race sesudah preflight tidak lolos; sinkronkan status restored. Uji unit commit/rollback melalui bentuk eksekusi D1 yang benar, bukan menganggap `BEGIN TRANSACTION` file SQL pasti didukung Wrangler.

### R09 / F21 — Karantina sebenarnya DELETE; cron masih rawan macet

- **Bukti:** `src/lib/server/auditLog.ts:210-240`, `src/lib/server/realtimeWorker.js:61-100`.
- `flushAuditLogOutbox()` menghapus row invalid sesudah attempt>=5; tidak ada penyimpanan payload/diagnostik karantina. Pengujian langsung membuktikan row hilang.
- Tidak ditemukan caller produksi fungsi flush tersebut. Cron memiliki implementasi sendiri, mengambil100 tertua dan menyimpan kegagalan tanpa menaikkan attempt/quarantine;100 poison rows dapat tetap menahan event setelahnya.
- **Perbaikan:** satu implementasi outbox worker yang benar-benar dipakai; status/tabel karantina menyimpan row invalid dan alasan; filter hanya retryable rows saat mengambil batch. Pertahankan serialisasi JSON valid yang sudah benar.

### R10 / F25 — Requote tanpa konfirmasi dan retry parsial menggandakan kas

- **Bukti:** `src/lib/services/autoApplyService.ts:50-68`, `:115-130`, `:239-277`.
- Total quote pertama dibandingkan dengan rekomendasi. Setelah409 quote expired, quote kedua langsung dikomit tanpa membandingkan total lagi.
- **Modul client asli di browser:** nominal disetujui10.000, quote kedua20.000, request commit kedua mengirim cash_received20.000 dan service melaporkan sukses.
- `deduplicateRecommendations()` hanya bekerja dalam satu array pemanggilan. Re-apply setelah hasil parsial mengulangi pemasukan manual sukses menggunakan UUID baru.
- **Browser:** satu manual sukses + satu sale gagal; retry menghasilkan dua POST manual dengan ID berbeda.
- **Perbaikan:** setiap requote divalidasi dan perubahan nominal perlu review kembali; simpan hasil per recommendation ID dan stable intent untuk seluruh jenis transaksi, bukan hanya penjualan POS. Retry hanya item gagal/unknown dengan deduplikasi server. Jangan menganggap total quote sebagai bukti uang tunai yang benar-benar diterima tanpa kontrak pembayaran yang jelas.

### R11 / F27 — Periode eksplisit yang belum dikenali tetap dipaksa bulan ini

- **Bukti:** `src/lib/server/aiPeriod.ts:36-64`, `src/routes/api/aichat/+server.ts:246-269`.
- `hasPeriodQualifier()` mengenali beberapa frasa, tetapi bukan nama bulan atau `tahun lalu`. Intent terlaris tetap dikenali, sehingga fallback menjadi bulan berjalan.
- **Resolver asli, today15Sep2026:** `menu terlaris bulan Agustus 2026` dan `menu terlaris tahun lalu` sama-sama memilih1–15September2026.
- **Perbaikan:** deteksi adanya qualifier periode lebih luas daripada resolver cepat; jika tidak bisa diselesaikan dengan yakin, return null untuk analyzer. Jangan mengasumsikan tidak adanya frasa yang dikenal berarti pengguna tidak meminta periode.

### R12 / F29 — Cleanup toast hanya dipasang pada printer

- **Bukti:** `src/lib/utils/ui.svelte.ts:5-56`; pencarian `toastManager.dispose()` hanya menemukan `src/routes/pengaturan/printer/+page.svelte:196`.
- Reaktivitas sudah benar, dibuktikan toast printer terlihat. Namun, riwayat, laporan, keamanan, dashboard, layout, dan store lain memakai manager tanpa cleanup timer saat pemilik dihancurkan.
- Ini kekurangan lifecycle prioritas rendah, bukan alasan menyatakan semua toast masih rusak.
- **Perbaikan:** hubungkan dispose pada lifecycle setiap pemilik atau sediakan mekanisme cleanup bersama yang sesuai konteks Svelte. Uji navigasi ketika toast aktif dan pergantian pesan/timer.

## Quality gate yang dijalankan ulang

- `rtk pnpm check`: lulus,0 error/0 warning.
- `rtk pnpm lint`: lulus format dan ESLint.
- `rtk pnpm test:unit`:13 suite lulus, termasuk playback28 migrasi.
- `rtk pnpm test:operations`:9 tes backup dan UAT safety self-test lulus.
- `rtk summary pnpm build`: exit0, build berhasil. Ringkasan RTK menandai nama file `error.svelte.js`/`errorHandling.js` sebagai “errors”; itu nama artifact, bukan kegagalan build. Warning glob PWA lama tetap ada.
- `rtk pnpm deploy:check`: konfigurasi dinyatakan ready; bukan pemeriksaan binding produksi.

**Mengapa tes hijau belum cukup:** banyak acceptance penting hanya tertulis sebagai skrip custom sementara dan belum masuk regression suite repo. `store-state-tests` masih logika buatan tes; `archive-restore-tests` masih kalkulator terpisah; hanya dua file unit test yang berubah dalam commit implementasi. E2E baru untuk seluruh residual juga belum ditambahkan.

## Reproduksi tambahan audit

File sementara di `C:\Users\ASUS\AppData\Local\Temp\opencode`:

- `remediation-audit-backend.mts`: service/handler asli, SQL28 migrasi, kontrol normal/concurrent/failure;10 grup kasus selesai, exit0 setelah perbaikan fixture timestamp outbox.
- `remediation-audit-d1.mts` + `remediation-audit-wrangler.jsonc`: D1/Workers lokal ephemeral;28 migrasi, limiter20 request, pembayaran, void, dan arsip edit-during-upload. Semua assertion audit selesai, termasuk bukti residual F05.
- `remediation-audit-browser.mjs`: route Svelte/API fixture. Run pertama menyelesaikan seluruh skenario sebelum login; login awal terlalu cepat sebelum hydration, kemudian diulang dengan `form[data-hydrated=true]` dan lulus. Kasus queue failure dijalankan tersendiri dan mengonfirmasi error tidak tampil.
- `remediation-audit-contracts.mts`: resolver AI, fungsi cetak receipt baru, serta PDF asli. Semua assertion audit selesai.

Perintah:

```powershell
rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-backend.mts"
rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-d1.mts"
rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-browser.mjs"
rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-browser.mjs" F28
rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-browser.mjs" "F06 queue"
rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-contracts.mts"
```

Assertion audit sengaja memeriksa beberapa perilaku yang masih salah. `FAIL CONTRACT` adalah residual yang terbukti; exit0 berarti harness selesai merekam bukti, bukan seluruh fitur lulus.

## Keputusan B9 dan langkah berikutnya

**B9 dibuka kembali.** Catatan worker sendiri mengakui `test:e2e:pos` gagal pada setup state D1 lokal. Audit ini tidak menghapus state lokal pengguna atau mengklaim suite tersebut sudah lulus. Namun, D1 ephemeral yang bersih berhasil menjalankan28 migrasi, sehingga ada jalur aman untuk membuat ulang verifikasi tanpa reset destruktif.

Urutan tindak lanjut:

1. Tuntaskan R02/F05, R04/F07, R08/F20, dan R10/F25 dengan regresi pada handler/service asli.
2. Tuntaskan R01/F02, R03/F06, R05/F09, R06/F13, dan R07/F17.
3. Tuntaskan R09/F21, R11/F27, dan R12/F29 sesuai scope rencana.
4. Masukkan reproduksi menjadi tes permanen portabel yang mengharapkan hasil benar. Tambahkan E2E bisnis baru, kemudian jalankan B9 pada database pengujian bersih/terisolasi.
5. Operator melakukan verifikasi schema/backup, migrasi deployment, binding, dan smoke printer/cabang. Jangan menyatakan aplikasi siap diluncurkan hanya dari commit berjudul “tuntaskan F01–F30” atau centang dokumentasi.
