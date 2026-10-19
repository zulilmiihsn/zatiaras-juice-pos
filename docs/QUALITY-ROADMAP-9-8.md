# Roadmap kualitas ZatiarasPOS menuju 9,8

Tanggal: 19 Oktober 2026.
Baseline kode yang diperiksa: `480ff5861241dfc91ebb33f6839ae1d0862fa26a`.
Status: rencana pelaksanaan berdasarkan validasi ulang; bukan pernyataan bahwa target sudah tercapai.

## 1. Definisi target

Target adalah kualitas engineering mendekati 9,8/10 dalam ruang lingkup POS,
uang dan stok, cabang, autentikasi, offline, arsip/restore, AI, rilis, operasi,
serta alur pengguna utama. Nilai 9,0 dan perkiraan 9,3 yang dibahas sebelumnya
adalah estimasi audit sampel, bukan hasil pengukuran lengkap dengan rubrik ini.

Rubrik di bawah menjadi usulan acuan tetap sebelum implementasi. Perubahan
bobot, cakupan, atau kriteria harus dicatat beserta alasannya sebelum penilaian
akhir. Sebuah area yang belum diperiksa diberi status belum dinilai; skor
total belum diterbitkan selama ada area wajib yang belum dinilai.

| Area                                    | Bobot | Bukti utama yang diperiksa                                                                            |
| --------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Integritas uang, stok, data, dan cabang | 25%   | Paritas ledger/laporan/receipt, isolasi tenant, idempotency, concurrency, restore atomik              |
| Keamanan                                | 20%   | Auth/session/role/PIN, CSRF, validasi payload, rate limit, rendering, upload, perlindungan secret     |
| Ketahanan aplikasi dan offline          | 15%   | Kegagalan storage/jaringan/provider, retry, replay, crash recovery, lifecycle dan perpindahan cabang  |
| Maintainability dan arsitektur          | 15%   | Tanggung jawab modul, kontrak tipe, arah dependensi, kebijakan kanonik, kompleksitas yang beralasan   |
| Performa                                | 10%   | Beban representatif, checkout, laporan, arsip/restore, pengukuran runtime yang relevan                |
| Operasi dan rilis                       | 10%   | Backup/restore drill, monitoring/alert, provenance artefak, migrasi, rollback dan runbook             |
| UX dan aksesibilitas alur utama         | 5%    | Keyboard/focus, mobile, loading/error/empty state, pencegahan transaksi ganda dan pemulihan kegagalan |

Skor setiap area memakai skala 0-10. Skor total adalah jumlah skor area
dikalikan bobotnya. Kualitas dan cakupan tes menjadi bukti lintas area,
bukan angka tambahan yang dihitung dua kali.

Target baru dinyatakan tercapai jika seluruh syarat berikut terpenuhi:

- Seluruh area wajib sudah dinilai dan skor berbobot mencapai minimal 9,8.
- Tidak ada area di bawah 9,5.
- Tidak ada temuan P0/P1 terbuka dan tidak ada P2 terbuka yang mengganggu
  alur utama atau kontrak bisnis kritis.
- Kontrak kritis memiliki bukti positif, negatif, dan kegagalan; race,
  idempotency, dan isolasi cabang diuji ketika relevan.
- Gate lokal dan CI yang relevan lulus pada SHA yang akan dinilai. Bukti
  dari SHA lain tidak menggantikan verifikasi tersebut.
- Tidak ada ketidakpastian material yang belum ditangani dalam ruang
  lingkup penilaian. Bukti lokal, workerd, staging, dan operator dibedakan.
- Tradeoff yang diterima memiliki alasan, mitigasi, serta kondisi kapan
  keputusan tersebut perlu ditinjau kembali.

Rubrik ini adalah acuan audit proyek, bukan standar sertifikasi eksternal.
Kelulusan gate merupakan syarat bukti, bukan pengganti review kualitas kode
dan perilaku.

## 2. Baseline yang sudah diketahui

- Bug kegagalan cache terkonfirmasi pada produk, kategori, tambahan,
  katalog POS, dan statistik dashboard. Respons jaringan yang valid dapat
  terbuang karena pembacaan atau penulisan IndexedDB bermasalah.
- Delapan probe Chromium telah dijalankan: empat kontrol positif lulus,
  empat skenario kegagalan storage menunjukkan bug. Respons API memakai
  fixture lokal; modul aplikasi dan IndexedDB browser merupakan implementasi
  asli.
- Lint lokal melaporkan 127 masalah format pada keluaran Android: 126 di
  `twa/app/`, satu di `twa/build/`. Keduanya memang diabaikan Git.
- Suite coverage menghasilkan 138 hasil lulus dengan exit code 0.
  Laporan terakhir mencatat 50,80% baris, 76,74% percabangan, dan 78,90%
  fungsi. Eksekusi E2E tidak digabung dalam laporan unit tersebut.
- Coverage percabangan unit pada fingerprint sekitar 65%, replay stok
  72%, dan orkestrasi arsip 78% merupakan petunjuk untuk review. Angka
  tersebut belum membuktikan bahwa perilakunya tidak diuji melalui jalur lain.
- Benchmark D1/workerd kecil, dua hari dengan sepuluh penjualan per hari,
  lulus checkout, laporan, arsip, restore, dan paritas. Hasil itu belum
  membuktikan kapasitas beban setahun atau produksi.
- CI baseline sebelumnya lulus static, operations, unit, E2E, build, dan
  smoke artefak terkompilasi. Perubahan berikutnya tetap memerlukan bukti
  pada SHA masing-masing.

Bukti rinci validasi ulang tersimpan pada
`scratch/REVALIDATION-FINDINGS.md` beserta probe dan log terkait. Folder
tersebut merupakan artefak lokal dan tidak boleh menjadi satu-satunya
sumber bukti bagi reviewer CI; skenario yang diperlukan harus dipindahkan
ke suite kanonik saat implementasi.

## 3. Urutan pelaksanaan

### Fase 1: Perbaiki ketahanan cache pada alur yang terkonfirmasi

Tanggung jawab utama berada pada `productService.ts`, helper cache terkait,
`dashboardService.ts`, dan tes browser/state yang sesuai.

Pekerjaan:

1. Tetapkan kontrak pemuatan: hasil jaringan yang valid tetap dapat
   digunakan ketika cache opsional gagal. Cache lama digunakan sesuai
   kebijakan fallback ketika jaringan memang gagal atau perangkat offline.
2. Jadikan reproduksi kegagalan storage sebagai tes regresi di suite
   kanonik sebelum mengubah implementasi.
3. Isolasi kegagalan baca/tulis cache dengan perubahan minimal. Tinjau
   pemanggil cache yang berdekatan untuk pola kegagalan yang sama.
4. Pertahankan validasi payload katalog, namespace cabang, guard generasi,
   invalidasi, dan penolakan respons basi.
5. Pertahankan durabilitas antrean transaksi offline: transaksi belum boleh
   dinyatakan tersimpan lokal jika penulisan antreannya gagal.

Syarat selesai:

- Skenario jaringan sehat dengan cache kosong, cache lama, quota penuh,
  dan storage ditolak memberikan hasil yang sesuai kontrak.
- Fallback jaringan gagal, mode offline, pergantian cabang, dan invalidasi
  tetap lulus.
- Gagal menyimpan antrean offline tidak menghasilkan pemberitahuan sukses.
- Unit/state test dan E2E terkait lulus; tes yang sebelumnya gagal menjadi
  lulus tanpa melemahkan assertion atau menambah retry/skip.

### Fase 2: Rapikan cakupan tooling lokal

Tanggung jawab utama berada pada `.prettierignore` dan dokumentasi tooling
bila perlu.

Pekerjaan:

1. Kecualikan keluaran Android yang memang dihasilkan ulang. Pertahankan
   pemeriksaan manifest dan konfigurasi sumber yang perlu direview.
2. Verifikasi lint pada workspace yang berisi keluaran Android serta
   perilaku pengecualian pada checkout bersih.

Syarat selesai: `rtk pnpm lint` lulus tanpa mengubah format massal keluaran
Android atau mengecualikan sumber aplikasi dari pemeriksaan. Perubahan
ini memiliki commit terpisah dari perbaikan perilaku cache.

### Fase 3: Perkuat bukti pengujian sesuai risiko

Pekerjaan:

1. Buat pemetaan kontrak ke tes untuk uang/HPP/pajak, fingerprint dan
   idempotency, cabang/role/session/CSRF, replay stok/offline, serta
   arsip/restore.
2. Tinjau percabangan unit yang belum terukur bersama bukti integration,
   E2E, dan workerd. Tambah tes untuk skenario bisnis yang belum memiliki
   bukti, bukan hanya untuk menaikkan persentase.
3. Pisahkan pelaporan cakupan kebijakan/domain kritis dari kode klien
   yang dijaga E2E. Catat baseline yang dapat direproduksi dan cegah
   penurunan tanpa alasan yang direview.
4. Uji kekuatan beberapa assertion kritis dengan mutasi terarah pada
   kondisi uang, cabang, atau idempotency di lingkungan uji terisolasi.
   Assertion harus mendeteksi perilaku salah tersebut.
5. Simpan laporan dan hasil pengujian sebagai artefak CI pada SHA yang
   diuji. Daftarkan suite baru sesuai aturan `test:docs-drift` jika perlu.

Syarat selesai: seluruh kontrak kritis yang disepakati memiliki bukti jalur
normal dan kegagalan; baseline cakupan yang relevan dapat diaudit; tidak
ada penurunan assertion, skip tambahan, atau retry buta untuk membuat gate
hijau. Ambang global sembarang tidak dipakai untuk menyamakan coverage
unit dengan cakupan seluruh aplikasi.

### Fase 4: Audit keamanan dan maintainability secara menyeluruh

Pekerjaan:

1. Audit boundary auth/session/role/PIN, tenant, CSRF, body size, rate
   limit dan fallback, upload, rendering konten, serta gateway AI.
2. Pastikan payload klien tidak dapat menetapkan field milik server atau
   mengalihkan cabang/otoritas. Periksa kegagalan konfigurasi dan provider.
3. Tinjau kontrak tipe antar-service dan store, terutama penggunaan cast
   ganda, decode data eksternal, serta duplikasi aturan bisnis.
4. Tinjau kompleksitas dan lifecycle hotspot berdasarkan bukti perubahan
   dan risiko. Refactor hanya ketika mengurangi tanggung jawab bercampur,
   coupling yang merugikan, atau duplikasi kebijakan.
5. Catat keputusan arsitektur beserta konsekuensinya. Struktur modul,
   jumlah file, dan ketiadaan `any` tidak menggantikan review semantik.

Syarat selesai: tidak ada temuan keamanan/integritas prioritas tinggi;
tes negatif otoritas dan input lulus; perubahan refactor memiliki bukti
paritas; keputusan yang diterima memiliki alasan dan mitigasi yang jelas.

### Fase 5: Buktikan performa dan kemampuan pemulihan

Pekerjaan:

1. Tentukan workload representatif serta pertumbuhan yang diuji. Default
   benchmark saat ini adalah 365 hari dengan 500 penjualan per hari per
   dataset cabang; kapasitas serentak memerlukan skenario tersendiri.
2. Jalankan workload besar dan pengujian concurrency pada runtime yang
   relevan. Pisahkan latensi checkout, query laporan, orkestrasi arsip,
   restore, dan penggunaan resource.
3. Gunakan budget proyek yang sudah ada sebagai titik awal: checkout
   p95 di bawah 2 detik dan laporan setahun di bawah 5 detik, lalu periksa
   kesesuaiannya dengan kebutuhan operasional yang disepakati.
4. Bedakan waktu wall-clock Node, CPU Worker, serta memori masing-masing
   proses. Ukur melalui harness yang sesuai atau nyatakan batas alat ukur
   sebagai keterbatasan bukti yang masih perlu ditutup.
5. Jalankan restore drill pada lingkungan sementara dengan inventory dan
   sumber yang disetujui; verifikasi paritas field bisnis, receipt,
   idempotency, dan isolasi cabang.
6. Periksa apakah monitoring, alert, dan runbook benar-benar mendukung
   diagnosis dan pemulihan. Simpan bukti hasil, identitas environment,
   dataset, dan SHA secara teredaksi.

Syarat selesai: budget workload yang disepakati terpenuhi; kegagalan dan
pemulihan terbukti; tidak ada operasi destruktif terhadap produksi sebagai
bagian benchmark.

Strategi CI: pemeriksaan cepat dan deterministik pada PR; workload besar
dijalankan terjadwal, manual, atau sebelum rilis sesuai biayanya. Bukti
benchmark harus dapat dikaitkan ke SHA dan tetap berlaku bagi area kode
yang akan dirilis. Benchmark arsip sekitar 40 menit tidak otomatis
dimasukkan ke setiap push.

### Fase 6: Verifikasi pengalaman pengguna dan audit akhir

Pekerjaan:

1. Periksa alur login, buka/tutup toko, pilih menu, pembayaran, retry,
   offline/reconnect, antrean, receipt, laporan, stok, dan pemulihan error
   pada viewport mobile dan desktop.
2. Verifikasi keyboard/focus, loading/error/empty state, status data basi,
   status transaksi ambigu, dan pencegahan submit ganda.
3. Jalankan gate rilis lengkap, smoke artefak terkompilasi, verifikasi
   provenance, serta dry-run sesuai runbook. Staging dan produksi memakai
   resource yang terpisah; keberhasilan lokal tidak diberi label produksi.
4. Audit ulang menggunakan rubrik tetap. Terbitkan temuan yang masih
   terbuka, tradeoff yang diterima, bukti per area, SHA, dan skor aktual.

Syarat selesai: seluruh ketentuan target pada bagian 1 terpenuhi. Jika
nilai belum mencapai 9,8, backlog berikutnya diturunkan dari temuan audit
tersebut; skor tidak dinaikkan hanya karena keenam fase telah dikerjakan.

## 4. Aturan pelaksanaan

- Ikuti gate per jenis perubahan dalam `AGENTS.md`. Setiap perubahan
  perilaku diawali reproduksi gagal dan ditutup verifikasi positif,
  negatif, serta failure path yang relevan.
- Satu commit untuk satu tujuan dan satu fase; perubahan harus dapat
  di-revert secara mandiri. Artefak CI dinilai pada SHA yang sama.
- Pertahankan modular monolith dan kontrak data. Migrasi arsitektur besar
  bukan syarat otomatis untuk memperoleh nilai tinggi.
- [ADR 0001](adr/0001-money-storage.md) menerima penyimpanan uang `REAL`
  dengan normalisasi pada boundary tulis. Perubahan tipe membutuhkan
  bukti masalah, ADR, backup, serta rehearsal migrasi.
- [ADR 0002](adr/0002-realtime-outbox.md) menerima best-effort untuk
  invalidasi realtime umum. Audit durable dan notifikasi pesanan memiliki
  kontrak berbeda yang tetap harus dipenuhi.
- [ADR 0003](adr/0003-foreign-keys.md) menunda enforcement FK legacy
  sampai preflight data dan persetujuan migrasi tersedia. Menutup seluruh
  ketidakpastian integritas perlu bukti data dan mitigasi yang memadai;
  menghapus tradeoff dari dokumen tidak menyelesaikan risikonya.
- Nilai akhir mengikuti hasil audit dan batas buktinya. Target 9,8 tidak
  menjadi alasan untuk melonggarkan definisi lulus atau menyembunyikan
  masalah yang masih terbuka.

## 5. Langkah pelaksanaan pertama

Mulai dari fase 1, kemudian fase 2. Kedua pekerjaan tersebut mempunyai
masalah yang sudah direproduksi dan syarat selesai yang jelas. Keduanya
merupakan fondasi sebelum memperluas penilaian dan bukti untuk target
9,8. Estimasi kenaikan nilai belum dipakai sebagai janji hasil implementasi.
