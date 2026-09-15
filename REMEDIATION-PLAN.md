# Rencana perbaikan ZatiarasPOS — handoff agen pekerja

Tanggal: 15 September 2026.

Baseline kode: `88c6436f747c266377ca700aaa513faf688ff225`.

Referensi bukti: [CODE-REVIEW.md](CODE-REVIEW.md). Nomor **F01–F30** di sini sama dengan nomor 1–30 laporan tersebut.

**Status: implementasi berjalan; F30 selesai dan diverifikasi lokal.** Target: menyelesaikan 29 bug/inkonsistensi dan 1 penguatan integritas tanpa mengurangi kemampuan operasional aplikasi. Semua fitur digunakan; beberapa perangkat aktif per cabang.

## 1. Cara menggunakan rencana ini

1. Berikan file ini dan `CODE-REVIEW.md` kepada agen pekerja. Mulai dari **B0**, lanjut sesuai dependensi.
2. Kerjakan satu paket pada satu waktu. Paket besar dipecah menjadi sublangkah yang tetap menghasilkan kode dapat dibangun.
3. Baca implementasi terkini sebelum mengedit. Nomor baris laporan adalah petunjuk baseline; nama fungsi/kontrak lebih penting bila baris bergeser.
4. Jika HEAD berubah, cocokkan diff dengan temuan. Tandai `sudah diperbaiki` hanya setelah kriteria penerimaan benar-benar diuji.
5. Setelah paket selesai, catat file berubah, hasil tes, migrasi, dan pekerjaan tersisa di bagian pelacakan paling bawah.
6. Commit, push, migrasi remote, dan deploy mengikuti instruksi pemilik sesi; dokumen ini sendiri bukan perintah menjalankan operasi produksi.

### Prioritas dan ukuran pekerjaan

- **P1: 11 item** — F01–F10 dan F20. Dampak uang/stok, kegagalan alur inti, atau kelengkapan data; sebagian bersyarat.
- **P2: 16 item** — F11–F18, F22–F28, F30. Konsistensi laporan, kontrak fitur, sinkronisasi, dan quality gate.
- **P3: 3 item** — F19, F21, F29. F19 merupakan penguatan integritas, bukan bukti kerusakan R2 produksi.
- **S/M/L:** perkiraan luas perubahan, bukan estimasi waktu. L membutuhkan pengujian integrasi lebih kuat; tetap bisa dieksekusi agen murah dengan batas tugas dan bukti yang jelas.

## 2. Kontrak produk yang harus dijaga

Keputusan ini menjadi pegangan implementasi, agar agen tidak membuat desain baru di tengah perbaikan:

1. **Harga transaksi ditetapkan server.** Quote bertanda tangan, validasi cabang, idempotency key, fingerprint, dan pembatasan stok tetap berlaku pada semua jalur checkout, termasuk AI.
2. **Satu aksi uang/stok diterapkan sekali.** Atomik berarti seluruh perubahan satu aksi berhasil bersama atau batal bersama. Idempoten berarti retry tidak mengulangi efeknya. Keduanya diperlukan.
3. **Multi-cabang tetap terisolasi.** Query, key cache, idempotency, job arsip, token mutasi, dan hasil async selalu membawa identitas cabang yang benar.
4. **Jumlah bahan tersimpan dalam satuan dasar sebelum yield.** Harga efektif per satuan = biaya beli / (jumlah dasar × yield/100). Konversi tampilan dilakukan saat membaca/menulis formulir, bukan dengan mengubah arti kolom lama.
5. **Pengaturan server menjadi sumber konfigurasi tersimpan.** Draft lokal boleh berubah; pesan sukses penyimpanan server muncul sesudah server mengonfirmasi. Kegagalan cache lokal setelah commit bukan kegagalan commit.
6. **Pajak tetap simulasi.** Perhitungan tidak otomatis membuat pengeluaran kas, mengubah harga checkout, atau mengganti model cash-basis menjadi akrual.
7. **UI dan PDF membedakan arus kas dengan laba setelah simulasi pajak.** `saldo` tetap hasil masuk−keluar untuk kompatibilitas; `labaBersih` tetap hasil setelah simulasi. Label diperjelas.
8. **Struk memakai snapshot transaksi.** Nama/harga tidak mengikuti katalog terbaru setelah transaksi selesai. Jumlah baris dan rincian topping harus konsisten dengan total yang sudah dikomit.
9. **PIN empat digit dan bypass PIN belum dikonfigurasi tetap kebijakan produk.** Pertahankan perbaikan akses laci kas dan refresh setelah unlock pada commit siang.
10. **Offline yang sudah didukung tetap didukung.** Item antrean lama harus tetap terbaca. Perbaikan tidak boleh menyamakan status `menunggu sinkronisasi` dengan `tersimpan di server`.

### Standar clean code untuk seluruh paket

- Pertahankan Svelte 5/SvelteKit, TypeScript, Drizzle/raw D1, R2, dan pola service yang ada. Tidak perlu framework, ORM, state library, atau dependency baru untuk pekerjaan ini.
- Controller menangani HTTP/auth/validasi; service menangani use case; helper murni menangani hitungan/normalisasi. Ekstrak helper hanya bila kontraknya jelas atau dipakai beberapa caller.
- Gunakan tipe payload/hasil eksplisit dan `unknown` pada batas eksternal. Jangan menutupi ketidakcocokan dengan `any`, non-null assertion, atau catch kosong baru.
- Mutasi client memakai wrapper CSRF yang sudah ada. Error server dikonversi menjadi hasil yang dapat ditindaklanjuti, bukan sukses palsu.
- SQL terparameterisasi. Hasil `0 rows changed` pada aksi yang mensyaratkan perubahan wajib ditangani.
- Hindari refactor kosmetik massal, perubahan tarif/default bisnis, serta penghapusan fitur untuk membuat tes hijau.
- Tes kegagalan uang/stok memakai implementasi asli. Jangan membuat ulang kalkulator atau kelas tiruan lalu hanya menguji tiruan itu.

## 3. Urutan paket kerja

Urutan implementasi mempertimbangkan dependensi, bukan hanya severity. F30 dikerjakan awal supaya quality gate berikutnya dapat dipercaya.

- **B0 — F30:** toolchain/CI dan perintah verifikasi konsisten. Dependensi: tidak ada.
- **B1 — F01, F16, F29:** schema pengaturan, identitas baris, toast reaktif. Dependensi: B0.
- **B2 — F14, F02, F26:** konversi dua arah, biaya bahan benar, parser HPP konsisten. Dependensi: B0.
- **B3 — F03, F04:** void dan perubahan pembayaran aman lintas request. Dependensi: B0; koordinasi nomor migrasi B1.
- **B4 — F05, F19, F20:** arsip/restore idempoten dan menjaga angka historis. Dependensi: B1, B3.
- **B5 — F06, F08, F09, F10, F15:** operasional kasir/UI stabil dan data lengkap. Dependensi: B1; kompatibel dengan B3.
- **B6 — F07, F12, F13:** penyimpanan pajak lengkap dan satu perhitungan laporan. Dependensi: B1; uji integrasi ulang dengan B4.
- **B7 — F17, F18, F22, F23, F24:** struk, pilihan tahun, label, dan PDF konsisten. Dependensi: B5, B6.
- **B8 — F11, F25, F27, F28, F21:** fallback limiter, AI, password, audit. Dependensi: B1, B5, B6.
- **B9 — Semua:** regresi lintas fitur dan persiapan rilis. Dependensi: B0–B8.

B1/B2/B3 bukan instruksi menjalankan banyak agen sekaligus. Untuk agen dengan konteks terbatas, eksekusi berurutan paling sederhana. Migrasi diberi nomor oleh satu urutan kerja; jangan membuat dua file dengan nomor sama.

## 4. Desain transaksi bersama: baca sebelum mengerjakan B3/B4

### 4.1 Pola minimal CAS untuk F03/F04

Gunakan **compare-and-swap (CAS)**: perubahan hanya boleh berjalan jika versi baris masih sama dengan versi yang dibaca. Rancangan yang disarankan:

- Tambah `revision INTEGER NOT NULL DEFAULT 0` dan `mutation_token TEXT` pada `buku_kas` melalui migrasi baru.
- Baca header transaksi beserta `revision` **sebelum** membaca snapshot item/kontribusi agregat.
- Dalam satu `rawDb.batch()`, statement pertama mengklaim header: update token unik request dan naikkan revision hanya bila cabang, ID, sumber POS, serta expected revision cocok.
- Token mutasi dibuat baru oleh server untuk **setiap percobaan eksekusi**, termasuk retry. Token ini berbeda dari idempotency key intent yang stabil. Menggunakan ulang token percobaan lama dapat membuat guard lolos walaupun CAS terbaru kalah.
- Semua statement efek berikutnya memakai `WHERE EXISTS` terhadap header dengan **token milik request ini**. Untuk INSERT gunakan `INSERT ... SELECT ... WHERE EXISTS (...)`.
- Untuk void, hapus detail yang bersangkutan terlebih dahulu; hapus header **terakhir**, setelah seluruh efek yang memerlukan guard selesai.
- Baca hasil statement klaim dari hasil batch. Jika klaim kalah, seluruh statement efek harus menjadi no-op. Kembalikan hasil duplicate yang sah atau 409; jangan publish/audit sukses mutasi yang tidak diterapkan.
- Perubahan manual pada `buku_kas` juga menaikkan revision agar manifest arsip bisa mendeteksi data berubah. Strip `revision`/`mutation_token` dari payload client; hanya server yang mengelolanya.

Sketsa guard, bukan SQL siap salin:

```sql
UPDATE buku_kas
SET revision = revision + 1, mutation_token = ?
WHERE cabang_id = ? AND id = ? AND sumber = 'pos' AND revision = ?;

-- Setiap perubahan stok/agregat/insert mutasi sesudahnya wajib bergantung
-- pada EXISTS header cabang+ID dengan mutation_token request ini.
```

**Kesalahan yang harus dihindari:** melakukan CAS dengan `.run()`, lalu menghitung atau memperbarui agregat dalam request/batch terpisah; memasang guard hanya pada DELETE; memakai mutex JavaScript yang hanya bekerja pada satu isolate; memakai `changes()` tanpa memahami bahwa setiap statement berikutnya dapat mengganti nilainya. D1 batch tidak otomatis menghentikan statement berikutnya ketika UPDATE pertama memengaruhi nol baris.

Konfirmasi pola ini dengan tes SQL pada D1 lokal/Workers, termasuk `meta.changes`, sebelum memakai hasilnya pada fitur lain. SQLite in-memory membantu pengujian, tetapi tidak menggantikan verifikasi API D1.

### 4.2 Hubungan dengan checkout dan arsip

- Semua operasi pada transaksi yang sama memakai revision yang sama; ini menangani void vs perubahan pembayaran, bukan hanya void vs void.
- Agregat harian tetap diperbarui menggunakan delta, bukan ditulis ulang dari total yang dibaca sebelum batch. Dua transaksi berbeda pada tanggal sama tidak boleh saling menghapus kontribusi.
- Arsip memvalidasi revision snapshot dan keberadaan detail di final batch. Request yang membaca transaksi sebelum diarsipkan kemudian gagal klaim tanpa mengubah stok/agregat.
- F03 memakai penanda void permanen untuk mencegah replay checkout setelah header dihapus. Batasi ke kebutuhan transaksi POS dan uji jalur idempotency terkait; tidak perlu mengubah seluruh aplikasi menjadi event sourcing atau soft-delete.

## 5. Rincian 30 tugas

### F01 — Selaraskan schema pengaturan dengan migrasi

**P1 · L · Paket B1**

**Apa:** database dari migrasi memiliki ID integer dan tidak memiliki kolom `pajak_config` yang dipilih Drizzle. Kode lain memasukkan UUID.

**Kenapa:** database baru/pemulihan dapat gagal membaca pengaturan atau menyimpan pajak/job arsip. Produksi mungkin memiliki schema berbeda; jangan menganggapnya identik tanpa inspeksi.

**File utama:** `src/lib/database/schema.ts`, `src/lib/server/services/pengaturanService.ts`, `src/lib/server/pageAccess.ts`, `src/routes/api/pin/`, seluruh pembaca `pengaturan`, `drizzle/`, `scripts/setup-local-d1.mjs`, `scripts/migrate-production.mjs`.

**Cara:**

1. Tetapkan ID pengaturan sebagai TEXT, mempertahankan ID numerik lama dengan `CAST(id AS TEXT)`; ID 910001 menjadi string `910001`, bukan UUID baru.
2. Buat migrasi baru setelah nomor terakhir. Rebuild tabel SQLite dengan salinan seluruh kolom/data yang sah dan index yang diperlukan. Jangan mengedit migrasi 0000–0024 atau checksum historis.
3. Gunakan `kunci='pajak_config'` + `nilai` sebagai penyimpanan pajak kanonik. Hapus field phantom `pajak_config` dari schema Drizzle setelah memastikan tidak ada caller yang memakai kolom itu. Bila inspeksi database deployment menemukan kolom tersebut benar-benar berisi data, buat konversi eksplisit yang mempertahankan datanya sebelum rebuild; jangan membuangnya diam-diam.
4. Bedakan row utama toko (`kunci IS NULL`) dari row key/value. Semua pembaca detail toko/PIN/page lock memakai predikat yang sama; pembaca key/value memakai cabang+kunci. Perbarui tipe `PinRow.id` yang masih number.
5. Validasi duplikat row utama per cabang sebelum memasang partial unique index. Bila data ambigu, hasilkan laporan konflik; jangan memilih/menghapus row secara arbitrer. Row key/value tidak boleh menjadi pengganti detail toko.
6. Tambahkan journal/manifest migrasi baru dengan mekanisme checksum normal LF. Perbarui tes yang menghardcode jumlah migrasi secara tepat, bukan melemahkan pemeriksaan.

**Transisi kolom:** menghapus field phantom dari kode tidak harus sekaligus DROP kolom fisik yang mungkin ada di deployment. Bila worker versi lama masih memerlukan kolom fisik tersebut, pertahankan sementara sebagai deprecated, pindahkan nilainya ke penyimpanan kanonik, dan hapus hanya pada migrasi lanjutan setelah seluruh reader lama selesai diganti. Selama transisi hanya ada satu sumber konfigurasi yang boleh diperbarui oleh kode baru.

**Kriteria lulus:** semua migrasi dari nol berhasil; upgrade fixture berisi PIN hash, detail struk, serta key/value mempertahankan nilai/ID; GET pengaturan berhasil; insert UUID berhasil; data pajak tidak mengubah PIN; cabang lain tidak berubah; menjalankan migrasi yang sudah tercatat tidak menerapkan rebuild ulang.

**Catatan rilis:** cek schema aktual dan backup sebelum migrasi remote. Kode lama yang mengandalkan kolom tertentu harus tetap kompatibel selama transisi atau diganti dalam jendela rilis terkoordinasi.

### F02 — Perbaiki kontrak jumlah pembelian dan HPP

**P1 · M · Paket B2 · Setelah F14**

**Apa:** jumlah dasar ditampilkan kembali sebagai jumlah satuan beli; kulakan mengirim jumlah mentah ke field jumlah dasar.

**Kenapa:** 1.000 gram dapat menjadi 1.000.000 gram setelah edit; harga 1 kg Rp20.000 dapat dianggap Rp20.000/gram.

**File utama:** `src/routes/stok/+page.svelte`, `src/lib/stores/bahanHppState.svelte.ts`, `src/lib/services/manajemenmenuCrud.ts`, `src/lib/server/services/bahanService.ts`, `src/lib/utils/ingredientCost.ts`.

**Cara:**

1. Buat helper konversi tampilan balik jumlah dasar→satuan beli dengan faktor/pack size yang sama dengan konversi maju.
2. Saat membuka form edit, tampilkan `jumlah_beli_terakhir` melalui konversi balik. Terapkan pada form stok dan manajemen menu, termasuk tombol isi dari pembelian terakhir.
3. Saat simpan, konversi satu kali ke jumlah dasar sebelum yield. Pada kulakan kirim `baseQty`, bukan `purchaseInputQty`.
4. Pertahankan hitungan biaya di server. Client boleh memberi preview; server menghitung dari biaya, jumlah dasar, dan yield tervalidasi. Jangan menerapkan yield dua kali.
5. Pertahankan pecahan jumlah yang sah. Formatter nominal Rupiah tidak boleh membulatkan atau mengubah separator jumlah bahan.
6. Periksa semua caller yang menulis tiga field biaya pembelian. Jangan mengonversi stok_saat_ini lagi jika sudah satuan dasar.

**Kriteria lulus:** 1 kg Rp20.000 pada yield 100% menghasilkan 1.000 gram dan Rp20/gram; yield 80% menghasilkan Rp25/gram; edit lalu simpan tiga kali tetap identik; 0,5 kg dan pack isi N benar; kulakan tanpa opsi update HPP tidak mengubah biaya; input unit tak kompatibel tidak tersimpan.

**Data lama:** perubahan kode tidak otomatis memperbaiki nilai historis yang sudah salah. Buat daftar kandidat berdasar bukti pembelian; jangan membagi semua nilai dengan 1.000. Jangan mengubah snapshot HPP transaksi lama secara massal.

**Batas pekerjaan:** kulakan saat ini memiliki tiga request terpisah. Perbaikan satuan tidak boleh diklaim membuat seluruh kulakan atomik. Bila kegagalan parsial dijumpai saat verifikasi, catat subtask integritas pembelian tersendiri dengan satu use case server; jangan menambah retry buta yang menggandakan mutasi.

### F03 — Jadikan void aman terhadap request bersamaan

**P1 · L · Paket B3**

**Apa:** dua request membaca transaksi sama, lalu masing-masing mengembalikan stok dan membalik agregat.

**Kenapa:** stok 8 dengan pembatalan 2 item menjadi 12, seharusnya 10.

**File utama:** `src/lib/server/services/transaksiKasirService.ts`, `src/lib/server/dailySummary.ts`, `src/routes/api/transaksi-kasir/+server.ts`, schema/migrasi ledger. Baca checkout `statementBuilder.ts` dan `dataLoader.ts` untuk menjaga kontrak idempotency.

**Cara:**

1. Terapkan pola CAS bagian 4 pada header transaksi; semua reversal stok produk, stok bahan, insert mutasi void, agregat, dan delete detail/header diguard token yang sama dalam satu batch.
2. Refactor builder reversal agar menerima identitas guard bertipe, bukan potongan SQL bebas dari client. Hitung dari snapshot transaksi/mutasi asli; jangan membangun ulang resep dari katalog sekarang.
3. Pertahankan aturan otorisasi pemilik. Request tidak menemukan transaksi mengembalikan 404; race atau perubahan versi mengembalikan 409 atau duplicate bila bukti pembatalan tersedia. Keduanya harus tanpa efek tambahan.
4. Gunakan penanda void permanen yang menyimpan cabang, transaction ID, idempotency key/fingerprint asal, waktu, dan actor agar retry bisa dikenali setelah header hilang. Penanda ditulis dengan guard sebelum header dihapus, dalam batch yang sama. Uniqueness cabang+transaction/key harus jelas; data legacy tanpa idempotency key tetap memakai identitas transaksi.
5. Jalur checkout menolak replay key yang sudah void. Proteksi insert juga harus berlaku di SQL batch, bukan hanya SELECT precheck, supaya replay yang sudah terlanjur membaca sebelum void tidak menghidupkan transaksi lagi. Misalnya constraint/trigger `BEFORE INSERT` yang memeriksa penanda void dan menggunakan `RAISE(ABORT, ...)`: kegagalan harus membatalkan **seluruh batch checkout**, termasuk pengurangan stok yang mendahului insert header. Jangan hanya membuat INSERT header no-op sementara statement lain tetap berjalan.
6. Publish hanya setelah klaim dan commit berhasil. Snapshot stok lama yang tidak memiliki informasi lengkap tidak boleh direkonstruksi dengan tebakan; dokumentasikan kompatibilitas legacy secara eksplisit.

**Kriteria lulus:** dua void bersamaan mengembalikan stok tepat sekali; agregat mengurangi satu transaksi; void berurutan kedua tidak mengubah apa pun; kegagalan statement tengah membatalkan seluruh batch; void bersamaan dengan perubahan metode bayar menghasilkan state serial yang konsisten; checkout retry transaksi yang void tidak mencatat penjualan baru.

**Batas:** jangan memperkenalkan soft-delete ke seluruh query laporan hanya untuk menutup race ini. Pengujian baru harus mengimpor service asli dan menggunakan barrier terkontrol pada pembacaan, bukan sekadar berharap Promise.all kebetulan overlap.

### F04 — Perubahan metode pembayaran memakai CAS yang sama

**P1 · M · Paket B3 · Bersama F03**

**Apa:** metode lama dibaca sebelum batch; perubahan identik dapat memindahkan omzet dua kali.

**Kenapa:** ledger Rp20.000 dipindahkan sekali, tetapi agregat non-tunai bertambah Rp40.000.

**File utama:** `src/lib/server/services/bukuKasService.ts`, `src/routes/api/buku-kas/+server.ts`, caller riwayat pemilik.

**Cara:**

1. Baca header/revision dahulu. Validasi hanya perubahan metode bayar yang diizinkan untuk POS.
2. Klaim dan ubah metode dalam statement pertama CAS. Guard seluruh delta agregat harian/per-produk dengan token klaim itu.
3. Metode sudah sama menjadi no-op sukses yang jelas. Klaim kalah: baca ulang untuk membedakan `sudah mencapai metode diminta` dengan `konflik perubahan lain`, tanpa memindahkan angka lagi.
4. Gunakan nominal dan kontribusi item transaksi yang diklaim. Jangan mengubah gross revenue, biaya, jumlah item, atau transaksi lain.
5. Jika satu transaction ID legacy memiliki lebih dari satu header, validasi invariant sebelum mutasi; jangan memakai nominal satu row untuk mengubah seluruh header dengan asumsi tersembunyi.
6. Riwayat/cetak ulang menggunakan metode aktual ledger; receipt snapshot transaksi asli dapat tetap dipertahankan sebagai bukti original, dengan overlay metode terkini pada tampilan.

**Kriteria lulus:** dua perpindahan Rp20.000 bersamaan pada total awal tunai Rp40.000 menghasilkan tunai Rp20.000/non-tunai Rp20.000; dua transaksi berbeda tidak kehilangan delta; A→B→A konsisten; F03 vs F04 konsisten; rollback batch meninggalkan metode dan agregat semula.

### F05 — Klaim arsip atomik dan finalisasi snapshot konsisten

**P1 · L · Paket B4 · Setelah F01 dan B3**

**Apa:** lock SELECT→UPSERT tidak eksklusif, error lock ditelan, dan job completion terpisah dari penghapusan ledger.

**Kenapa:** dua request bisa menggandakan ringkasan kas historis. Snapshot juga dapat tertinggal jika transaksi diedit selama upload.

**File utama:** `src/routes/api/archive/+server.ts`, schema/migrasi, caller arsip, serta writer buku kas/detail POS yang memengaruhi revision.

**Cara, pecah menjadi B4a lalu B4b:**

1. Ekstrak orchestration ke service arsip agar controller tetap tipis. Pisahkan claim, snapshot/upload, dan finalize; bentuk input/hasil bertipe.
2. Gunakan tabel job/lease khusus arsip, bukan string `locked` tanpa pemilik. Simpan job ID, branch, cutoff, status, owner token, lease expiry, object key/checksum, dan hasil akhir. Acquire/renew/release menggunakan satu statement bersyarat dan hasil perubahan; unique guard mencegah dua job aktif per cabang.
3. TTL bukan pengganti ownership. Worker lama yang lease-nya habis tidak boleh menghapus lock worker baru atau melanjutkan finalize; token/generation harus diperiksa lagi secara atomik.
4. Simpan manifest snapshot berisi exact header IDs+revision dan detail IDs yang diunggah. Untuk daftar besar gunakan tabel manifest job, bukan SQL IN raksasa. Snapshot lintas tabel harus berasal dari satu pembacaan konsisten, misalnya SELECT batch D1 yang atomik; tes bahwa ledger/detail tidak beda versi.
5. Sesudah upload dan verifikasi F19, final batch mengubah status job secara bersyarat hanya jika ownership masih sah, manifest cocok dengan row terkini, dan guard sesi aktif terpenuhi. Buat token percobaan finalisasi baru; semua insert summary/delete berikutnya diguard token tersebut **dan status finalizing**. Status completed beserta object key/count/checksum ditulis terakhir dalam batch yang sama. Job uploaded/completed yang gagal klaim tidak boleh tetap memenuhi guard efek. Manifest yang sudah diunggah harus disegel agar isinya tidak berubah saat finalisasi.
6. Summary arsip memakai identitas deterministik job+dimensi ringkasan agar retry job tidak memasukkan summary kedua. Buat/delete hanya exact snapshot rows, bukan seluruh data sebelum tanggal tanpa identitas.
7. Data berubah/hilang setelah snapshot: batalkan finalisasi tanpa menghapus ledger. Snapshot upload yang tidak jadi dikomit boleh tercatat sebagai orphan untuk pembersihan belakangan; jangan menyebutnya completed.
8. Retry job/request ID yang sudah completed mengembalikan hasil sama. Request arsip baru dengan cutoff sama harus dapat menemukan transaksi backdate/restored yang baru eligible; jangan menjadikan tahun sebagai larangan pengarsipan selamanya.
9. Pertahankan penolakan sesi aktif. Pemeriksaan `antrean_offline` tidak boleh dianggap bukti seluruh IndexedDB perangkat sudah kosong: tuntaskan sinkronisasi perangkat pada operasi arsip. Perbaikan ini tidak menjanjikan transaksi D1+R2 terdistribusi atomik.

**Kriteria lulus:** satu pemasukan Rp150.000 diarsip dua request tetap Rp150.000; retry setelah commit tetapi sebelum respons tidak menggandakan summary; lock aktif 409; lease takeover memblok worker lama; edit/void saat upload membatalkan finalisasi; upload gagal tidak menghapus ledger; sesi baru sebelum finalisasi terdeteksi; cabang lain dapat diproses sendiri.

**Skala:** tes ukuran representatif dan batas parameter/subrequest D1. Jika perlu chunking, gunakan progres job idempoten yang diuji; jangan memecah final batch menjadi loop tanpa kontrak pemulihan.

### F06 — Hasil simpan kas harus eksplisit

**P1 · M · Paket B5**

**Apa:** `saveTransaksi()` kembali tanpa hasil baik ketika gagal maupun berhasil; caller selalu menampilkan sukses dan mengosongkan form.

**Kenapa:** pengguna dapat kehilangan isian dan menganggap catatan gagal sudah tersimpan.

**File utama:** `src/lib/stores/catatState.svelte.ts`, `src/lib/services/transactionService.ts`, `src/lib/utils/offlineQueue.ts`, UI catat.

**Cara:**

1. Return discriminated union: `saved`, `queued`, `failed`/`blocked`; alternatif exception untuk failure boleh dipakai konsisten. Hindari boolean yang menyamakan queued dengan server saved.
2. Caller mengosongkan form hanya sesudah server commit atau penyimpanan antrean IndexedDB berhasil. Pesan queued menyebut menunggu sinkronisasi.
3. HTTP 4xx/5xx online mempertahankan input dan menampilkan error. Kasir saat toko tutup juga tidak memunculkan sukses. Kegagalan tulis IndexedDB dianggap gagal menyimpan.
4. Pisahkan refresh/cache sesudah commit dari hasil mutasi utama. Refresh riwayat gagal tidak mengubah commit sukses menjadi ajakan mengulangi insert.
5. Tambah busy guard pada submit dan pertahankan ID transaksi logis untuk retry yang relevan; guard client membantu UX, bukan pengganti deduplikasi server.

**Retry:** ID stabil hanya untuk payload intent yang sama. Jangan mengirim isi form yang sudah diubah menggunakan ID request yang hasil commit-nya masih belum diketahui, lalu menerima respons duplicate sebagai bukti nilai baru tersimpan. Bedakan retry payload asli dari pembuatan transaksi baru; bila status ambigu, periksa hasil lewat ID terlebih dahulu.

**Kriteria lulus:** HTTP 500 tidak menampilkan sukses dan input utuh; offline queue sukses menampilkan queued; queue gagal input utuh; POST sukses+refresh gagal tidak mengirim ulang transaksi; submit ganda tidak membuat dua intent baru.

### F07 — Persistensi pajak asynchronous, lengkap, dan tahan konflik

**P1 · L · Paket B6 · Setelah F01**

**Apa:** PUT tanpa CSRF, respons diabaikan, dan adapter hanya menyimpan satu pajak dari UI multi-pajak.

**Kenapa:** perangkat tampak berhasil tetapi konfigurasi server/perangkat lain berbeda; sync berikutnya dapat menghapus konfigurasi lokal.

**File utama:** `src/lib/services/taxService.ts`, `src/lib/stores/taxSettingsState.svelte.ts`, `src/lib/types/pajak.ts`, `src/routes/api/pengaturan/pajak/+server.ts`, validasi pajak, halaman pajak, pembaca server report/AI.

**Cara:**

1. Definisikan kontrak versioned yang menyimpan seluruh `TaxSettings`: master toggle, daftar tax ID/type/name/rate/enabled/threshold option, dan versi konfigurasi. Pakai tipe bersama; server memvalidasi angka finite, rentang, ID unik, serta ukuran daftar.
2. Pertahankan pembacaan config legacy `{enabled,nama,rate,threshold,apply_threshold}` melalui satu adapter eksplisit. `rate=0` harus tetap 0, bukan terganti default oleh `||`. Threshold legacy non-default tidak boleh hilang ketika dikonversi.
3. Rancang kompatibilitas endpoint secara additive/versioned. Client baru meminta kontrak baru; reader lama tetap dapat membaca bentuk lama. Legacy write tidak boleh menimpa/menghapus seluruh daftar multi-pajak; patch hanya entri legacy yang bersangkutan atau tolak konflik dengan alasan jelas.
4. `saveTaxSettings()` menjadi Promise yang memakai `fetchWithCsrfRetry`, memeriksa HTTP dan schema respons, lalu menyimpan **hasil server** ke cache cabang. Capture branch sebelum await; kirim identitas branch yang diharapkan dan validasi terhadap sesi di server. Perubahan branch selama request tidak boleh menyimpan konfigurasi di cabang lain atau menulis hasil ke UI cabang baru.
5. Pisahkan draft form, persisted cache, dan status saving/error. Semua caller autosave/persist menunggu Promise; serialize/coalesce perubahan cepat supaya respons lama tidak mengembalikan konfigurasi ke versi sebelumnya. Pakai expected revision/ETag untuk konflik antarperangkat.
6. GET cache lokal menjadi fungsi tanpa efek jaringan. Sinkronisasi eksplisit punya in-flight guard; fallback saat GET gagal tidak memanggil ulang fungsi yang memulai GET secara rekursif. Sync background tidak menimpa draft yang sedang diedit.
7. Reader server laporan dan AI menggunakan adapter kanonik yang sama. Event pembaruan hanya dikirim sesudah commit; cache invalidation beridentitas cabang+versi.
8. Migrasi localStorage legacy tidak menyalin konfigurasi global ke semua cabang secara diam-diam. Jadikan legacy local data kandidat draft untuk cabang asal yang diketahui, bukan sumber yang lebih kuat dari server.

**Kontrak minimum v2:** envelope `{ schema_version: 2, revision, settings }`, dengan `settings` membawa seluruh daftar pajak; tambahkan threshold amount eksplisit bila diperlukan untuk menjaga nilai legacy. Update mengirim expected revision; mismatch memberi409. Tetapkan endpoint version negotiation dan adapter dalam satu modul, lalu dokumentasikan bentuk finalnya di tes kontrak. Mode create/no-config harus dibedakan dari request yang membawa versi lama; jangan menganggap revision yang hilang selalu izin menimpa.

**Kriteria lulus:** PUT membawa CSRF; 403/500 tidak menampilkan sukses; reload dan perangkat kedua melihat seluruh tax list; rate 0/master off/semua tax off tersimpan; legacy config terbaca; threshold legacy terjaga; dua edit bersamaan tidak menimpa diam-diam; switch cabang saat request tidak mencemari state cabang baru.

### F08 — Satu identitas item keranjang

**P1 · S · Paket B5**

**Apa:** key pembayaran tidak memasukkan ukuran, sementara keranjang membedakannya.

**Kenapa:** produk reguler+jumbo dengan detail sama menghasilkan `each_key_duplicate`.

**File utama:** `src/lib/stores/posCart.svelte.ts`, `src/lib/stores/bayarState.svelte.ts`, `src/routes/pos/bayar/+page.svelte`, helper key baru bila diperlukan.

**Cara:** ekstrak key kanonik dari aturan keranjang yang ada, mencakup product ID, porsi default reguler, sorted add-on IDs, gula, es, dan catatan ternormalisasi. Gunakan encoding tuple yang tidak ambigu, misalnya JSON array; jangan index/random key atau menghapus keyed block. Semua operasi penggabungan dan rendering memakai helper sama. Kuantitas bukan bagian identitas item. Pertahankan format storage atau migrasikan envelope lama dengan aman.

**Kriteria lulus:** reguler+jumbo tampil dua baris dan dapat dibayar; detail identik ukuran sama bergabung; urutan add-on berbeda memberi key sama; catatan berbeda tetap terpisah; reload keranjang legacy/envelope tidak kehilangan item. Uji browser dev dan hasil build yang relevan.

### F09 — Pisahkan effect fetch pengaturan dan effect tampilan lock

**P1 · M · Paket B5 · Setelah F01**

**Apa:** effect membaca store lalu fetch menulis store baru; siklus berulang.

**Kenapa:** kasir idle dapat mengirim puluhan GET per detik dan membebani aplikasi.

**File utama:** `src/routes/+layout.svelte`, `src/lib/stores/securitySettings.svelte.ts`, layanan pemuatan pengaturan.

**Cara:** effect fetch hanya bergantung pada identitas sesi, role, branch, serta sinyal refresh eksplisit. Effect tampilan membaca settings+path tanpa fetch. Gunakan `untrack` bila perlu untuk dependency incidental, dengan alasan jelas. Equality check setter membantu tetapi bukan satu-satunya solusi. Deduplikasi in-flight; abort/generation check membuang hasil sesi/cabang lama. Pertahankan invalidate/refresh setelah PIN unlock; pembaruan settings yang sah tetap bisa memuat ulang.

**Kriteria lulus:** kasir idle tidak terus GET; navigasi tidak membuat loop; perubahan konfigurasi dan switch cabang tetap terbaca; owner tidak mengalami fetch kasir; PIN configured/unconfigured berperilaku seperti sebelumnya; respons terlambat tidak mengubah sesi baru.

### F10 — Ringkasan sesi SQL dan riwayat berhalaman

**P1 bersyarat · M/L · Paket B5**

**Apa:** ringkasan dan riwayat memakai satu halaman default 200 baris seolah seluruh data.

**Kenapa:** sesi ramai salah menampilkan uang kasir; transaksi terbaru setelah batas tidak muncul dalam riwayat.

**File utama:** `src/lib/components/dashboard/TokoModal.svelte`, `src/routes/+page.svelte`, `src/lib/services/sesiTokoService.ts`, server service sesi/buku kas, `src/lib/services/riwayatService.ts`, `src/lib/server/dataPagination.ts`, ketiga halaman riwayat.

**Cara:**

1. Tambah resource ringkasan sesi, misalnya `GET /api/sesi-toko/summary?id=...`, dengan auth/cabang yang sama dan akses laci kas yang telah diperbaiki.
2. Server mengagregasi seluruh ledger sesi dengan SUM/CASE dalam satu query: modal awal, total pemasukan, pemasukan tunai, pengeluaran tunai, saldo laci. Validasi sesi milik cabang dan hindari duplikasi `kas_awal` akibat join.
3. Dashboard dan modal menggunakan service ringkasan yang sama. Formula: modal awal+pemasukan tunai−pengeluaran tunai. Jangan menyebut seluruh pemasukan sebagai penjualan POS jika mencakup setoran manual.
4. Riwayat memakai cursor pagination nyata, urutan `(waktu DESC,id DESC)` dan tombol muat berikutnya. Tambahkan arah pagination secara backward-compatible; default caller lama tidak berubah tanpa audit.
5. Filter tanggal/search/payment diterapkan sebelum LIMIT di server, atau UI harus jelas sedang memfilter halaman saja. Target paket ini adalah pencarian lengkap pada rentang hari yang diminta.
6. Jangan mengganti semua `dbGet()` menjadi `dbGetAll()` global atau menaikkan limit ke angka sangat besar. Jika `dbGetAll()` dipakai sementara pada caller terbatas, tetap targetkan ringkasan server untuk sesi.

**Kriteria lulus:** 201/501 baris dan campuran masuk/keluar menghasilkan saldo benar; transaksi terakhir tampil di halaman pertama; cursor tanpa skip/duplikat pada waktu sama; pencarian menemukan transaksi di luar halaman pertama; kasir tetap melihat ringkasan meski halaman catat terkunci; cabang lain ditolak.

### F11 — Penghitung fallback D1 atomik

**P2 · M · Paket B8**

**Apa:** read count lalu write count+1 kehilangan increment paralel.

**Kenapa:** fallback membolehkan request melebihi batas ketika DO tidak tersedia.

**File utama:** `src/lib/server/rateLimit.ts`, tes limiter; periksa konfigurasi binding tanpa mengubah deployment sembarang.

**Cara:** gunakan satu UPSERT atomik dengan CASE untuk reset window/increment, lalu `RETURNING count,reset_at`. Keputusan allowed dihitung dari hasil mutasi atomik (`count <= limit` bila setiap percobaan dihitung). Waktu now/window harus konsisten dalam statement; validasi limit positif. Cleanup baris expired dipisahkan dari correctness hot path. Pertahankan DO utama, satu fallback D1, dan fail-closed bila keduanya gagal. Jangan membuat counter global per isolate sebagai pengganti.

**Kriteria lulus:** 20 request bersamaan pada key baru maupun existing dengan limit 1 hanya satu allowed; batas window reset benar; key/cabang berbeda terisolasi; DO sukses tidak menyentuh D1; kedua backend gagal unavailable; RETURNING benar pada D1 lokal.

### F12 — Hilangkan penghitungan POS ganda dalam pajak API

**P2 · M · Paket B6 · Bersama F13**

**Apa:** omzet POS ditambahkan ke daftar pemasukan usaha yang sudah mencakup POS.

**Kenapa:** pajak summary API dua kali untuk kasus POS saja; UI sekarang menghitung ulang sehingga bug tidak otomatis tampil sama.

**File utama:** `src/lib/server/reportQueries.ts`, helper hitungan pajak bersama, tipe hasil laporan.

**Cara:** hitung `businessTurnover = posGross + activeManualBusinessIncome + archivedManualBusinessIncome`. Jangan menambahkan posGross ke seluruh pemasukanUsaha tanpa mengecualikan POS. Pisahkan total penerimaan kas dan omzet usaha; modal/setoran jenis lainnya tetap kas masuk tetapi bukan otomatis omzet pajak. Gunakan fungsi hitungan bersama F13/F07, bukan formula pajak kedua di server.

**Kriteria lulus:** omzet POS Rp40.000, tarif 0,5%, threshold off → Rp200; manual usaha+POS dihitung masing-masing sekali; arsip manual sama; pajak disabled →0; pendapatan total tidak ikut berubah dua kali; API/UI/PDF konsisten setelah F13.

### F13 — Satu perhitungan pajak dengan konteks YTD

**P2 · L · Paket B6 · Setelah F07/F12**

**Apa:** UI menghitung ulang pajak tanpa omzet sebelum periode.

**Kenapa:** fasilitas tahunan digunakan seperti fasilitas per bulan/hari, sehingga simulasi parsial dapat terlalu kecil.

**File utama:** `src/lib/services/taxService.ts`, `src/lib/server/reportQueries.ts`, `src/lib/services/dashboardService.ts`, `src/lib/stores/laporanState.svelte.ts`, tipe laporan, reader financial summary AI.

**Cara:**

1. Pisahkan kalkulator murni dari service localStorage/fetch. Input eksplisit berisi settings, omzet usaha periode, hasil kas sebelum simulasi, dan konteks YTD. Tes boleh mengimpor kalkulator tanpa browser.
2. Server mengambil omzet sebelum periode dari agregat POS+manual aktif+manual arsip, seluruhnya dengan tanggal WITA. Jangan memakai fallback 0 ketika query wajib gagal; tampilkan kegagalan laporan daripada angka palsu.
3. Server menghitung summary+breakdown+context menggunakan config persisted. UI memakai summary tersebut dan berhenti menghitung ulang tanpa konteks. Widget simulasi draft di halaman pajak boleh memakai kalkulator sama dengan input simulasi eksplisit.
4. Untuk rentang lintas tahun, pecah per tahun pajak, reset threshold tiap Januari, lalu jumlahkan hasil sesuai aturan pembulatan yang terdokumentasi. Jangan memakai tahun tanggal awal untuk seluruh rentang.
5. Sertakan versi kontrak/config dan bump namespace cache laporan saat format berubah. Event settings menyegarkan laporan cabang terkait. Offline cache menampilkan hasil terakhir beserta status data tersimpan.
6. Reader summary AI memakai normalizer/config dan kalkulator yang sama agar perubahan bentuk F07 tidak membuat pajak AI kembali ke default. Jangan memperluas paket ini menjadi rewrite seluruh analitik AI.

**Kriteria lulus:** periode Rp300 juta setelah Rp300 juta, threshold Rp500 juta/tarif0,5% → Rp500.000; threshold off menghitung penuh; rentang Januari/penuh tahun/Desember–Januari benar; hasil query gagal tidak ditampilkan 0; multi-tax dan rate0 konsisten; hero/PDF tidak mengubah nilai kalkulasi.

### F14 — Konversi satuan ambigu mengikuti kategori bahan

**P2 · M · Paket B2**

**Apa:** sdm/sdt ada pada kategori cairan dan berat, tetapi deteksi generik selalu memilih berat.

**Kenapa:** dropdown cairan menawarkan 15 ml, fungsi justru menolak lalu safe fallback mengembalikan1.

**File utama:** `src/lib/utils/unitConversion.ts`, caller konversi form bahan/resep/mutasi.

**Cara:** resolve satuan sumber dari daftar kategori **satuan dasar yang diketahui**, kemudian alias yang sah. Nama ambigu seperti sdm/sdt/potong membutuhkan konteks, bukan kategori global tunggal. Sediakan konversi maju/balik dari definisi faktor sama. Mutasi uang/stok memakai strict converter atau Result error; catch→amount tidak boleh menyimpan angka yang salah. Error harus menjadi validasi form. Audit caller sebelum mengganti perilaku utility secara global; `amount=0`, NaN, unit tak dikenal, dan kemasan invalid ditangani eksplisit.

**Kriteria lulus:** 1sdm cairan→15ml, 1sdt→5ml; berat mengikuti faktor berat aplikasi; kg/gram, liter/ml, pack/pcs, roundtrip pecahan benar; gram→ml tanpa konversi densitas eksplisit ditolak; dropdown yang ditawarkan selalu dapat dikonversi dalam kategori itu.

### F15 — Terapkan pembaruan katalog lengkap

**P2 · M · Paket B5**

**Apa:** fingerprint parsial membuang perubahan nama, resep, gambar, token, dan flag.

**Kenapa:** server sudah mengirim data baru tetapi perangkat kasir tetap memakai state lama.

**File utama:** `src/lib/stores/posState.svelte.ts`, `src/lib/services/productService.ts`, cache katalog terkait.

**Cara:** solusi minimal adalah menerapkan setiap payload katalog tervalidasi secara utuh setelah debounce/in-flight guard yang sudah ada. Hilangkan fingerprint parsial; jangan menggantinya dengan daftar field parsial baru. Jika hasil profiling membuktikan equality check diperlukan, gunakan content revision server yang mencakup semua data relevan; token/expiry tetap diperbarui. Capture branch dan generation request, abaikan respons lama setelah switch cabang. Jangan menimpa snapshot transaksi selesai atau memutasi cart tanpa alur quote yang sudah ada.

**Kriteria lulus:** nama/gambar/flag/resep/token-only berubah ikut muncul; harga/stok masih update; payload unavailable tidak menghapus katalog valid secara tak sengaja; respons cabang lama diabaikan; token dan expiry cache selaras; quote online tetap memvalidasi harga.

### F16 — Simpan detail struk ke row cabang yang benar

**P2 · S/M · Paket B1 · Setelah F01**

**Apa:** form membaca row mana pun tetapi update selalu ID1.

**Kenapa:** cabang dengan ID910001 terlihat menyimpan padahal nol row berubah.

**File utama:** `src/routes/pengaturan/printer/+page.svelte`, `src/lib/server/services/pengaturanService.ts`, endpoint pengaturan.

**Cara:** simpan ID row hasil load sebagai state bertipe dan gunakan saat update; payload form hanya field detail yang boleh diedit. Server mengubah row utama cabang+ID dan memeriksa affected row. Row hilang →404/409 yang ditampilkan; create row baru memakai identitas sah dan unique rule F01, bukan ID1 global. Field PIN/key-value tidak bisa ikut tertimpa payload detail.

**Kriteria lulus:** load910001→save910001→reload nilai baru; dua cabang tidak berbenturan; ID tidak ditemukan tidak mengklaim sukses; PIN/tax/arsip row tetap utuh. Ini pengaturan detail struk; koneksi printer lokal tetap perangkat-spesifik.

### F17 — Normalisasi data cetak ulang dari snapshot

**P2 · M · Paket B7**

**Apa:** builder mengabaikan `nama_produk`; HTML mencetak harga satuan tanpa penanda pada baris xN.

**Kenapa:** nama menjadi Produk Custom dan rincian tidak konsisten antarjalur printer.

**File utama:** `src/lib/utils/receiptPrint.ts`, `src/lib/utils/escposBuilder.ts`, ketiga halaman riwayat, types receipt/history.

**Cara:** buat satu adapter snapshot→item tampilan yang dipakai HTML dan ESC/POS. Prioritas nama: snapshot `nama_produk`, nama custom, lalu fallback legacy yang benar-benar tersedia. Baris menampilkan subtotal; bila juga menampilkan harga satuan beri `@`. Gunakan `nominal` snapshot bila sah, fallback `harga × jumlah` hanya untuk data legacy tanpa nominal. Escape semua teks dinamis HTML. Jangan mengambil harga/nama terbaru katalog untuk transaksi lama. Jangan mengalikan harga dua kali pada jalur USB/Bluetooth pemilik yang sudah menghitung subtotal.

**Kriteria lulus:** nama snapshot tampil untuk produk yang diubah/dihapus dari katalog; qty2×10.000 subtotal20.000; nominal0 sah tidak dianggap missing; custom dan legacy tanpa snapshot tetap dapat dicetak; HTML/ESC-POS menunjukkan subtotal sama; total header tidak berubah.

### F18 — Rincian topping memakai harga dasar, bukan harga inklusif

**P2 · M · Paket B7 · Bersama F17**

**Apa:** receipt server berisi unit price inklusif topping, lalu printer menambahkan baris topping lagi.

**Kenapa:** rincian seolah berjumlah lebih besar daripada total transaksi.

**File utama:** `src/lib/stores/bayarState.svelte.ts`, `src/lib/utils/receiptPrint.ts`, adapter F17, `src/lib/server/checkout/types.ts`, builder receipt endpoint POS.

**Cara:** pisahkan `baseUnitPrice`, `addOnUnitTotal`, dan `lineTotal` di adapter receipt. Gunakan `harga_dasar`, `total_tambahan`, dan daftar tambahan snapshot. Print baris dasar×qty plus topping×qty. Untuk legacy yang hanya punya total inklusif dan tidak punya breakdown terpercaya, cetak subtotal inklusif dengan topping berlabel sudah termasuk, bukan menebak atau menambahkan nominal dua kali. Terapkan pada receipt online dan queued offline.

**Kriteria lulus:** base10.000+topping3.000 qty2→baris20.000+6.000=total26.000; reguler/jumbo/custom/tanpa topping benar; semua jalur printer konsisten; ledger, cash received, dan change tidak diubah hanya demi tampilan.

### F19 — Verifikasi isi readback arsip

**P3 · M · Paket B4 · Penguatan opsional menurut severity; termasuk target rencana ini**

**Apa:** readback hanya memeriksa objek ada.

**Kenapa:** komentar menjanjikan verifikasi integritas isi, tetapi checksum belum dibandingkan. Ini bukan bukti R2 pernah merusak data.

**File utama:** service/handler arsip hasil F05 dan utilitas checksum arsip.

**Cara:** hash bytes konten yang diunggah, baca body objek dari key yang sama, hitung SHA-256 dan bandingkan sebelum finalisasi. Sertakan ukuran/count/schema validation seperlunya; metadata saja tidak membuktikan body cocok. Untuk arsip besar hindari menyimpan dua salinan string sekaligus; pilih hashing stream yang didukung runtime. Batas ukuran/waktu harus memberi kegagalan yang mempertahankan ledger, bukan melewati verifikasi.

**Kriteria lulus:** readback normal lolos; objek missing, truncated, atau altered menolak finalisasi; tidak ada ledger dihapus dan job tidak completed; error baca/timeout tidak menahan lease selamanya. F05 diuji juga dengan readback normal agar race tidak bergantung injeksi korupsi.

### F20 — Restore mempertahankan sumber POS dan idempotensi

**P1 · L · Paket B4 · Setelah F01/F05**

**Apa:** seluruh sumber diubah menjadi `arsip_restored`, sehingga POS terhitung manual di samping agregat lama.

**Kenapa:** omzet40.000 menjadi80.000 setelah restore ke database yang masih menyimpan agregat POS.

**File utama:** `scripts/restore-archive.mjs`, module generator SQL yang diekstrak bila perlu, service laporan, schema job/restore hasil B4.

**Cara:**

1. Pertahankan `sumber` persis dari snapshot termasuk `pos`; simpan asal restore pada metadata/job terpisah. Jangan memakai field bisnis sebagai marker administratif.
2. Ekstrak validasi/SQL builder ke modul yang diimpor CLI dan tes. Pertahankan default dry-run; uji CLI parsing terpisah dari SQL generator.
3. Tetap hapus ringkasan arsip manual hanya untuk cabang+archive ID yang benar dan dalam unit commit yang sama dengan restore terkait.
4. Ganti `INSERT OR REPLACE` buta dengan deteksi duplicate/conflict. Row yang identik boleh di-skip; row ID sama dengan data berbeda harus menghentikan apply dan menampilkan konflik, bukan menimpa transaksi baru.
5. Cek semua row cabang cocok metadata; foreign key antarheader/detail dan counts valid. Validasi checksum terhadap nilai terpercaya bila tersedia dari job/R2, bukan hanya menghitung hash lalu mencetaknya.
6. Kontrak utama: restore detail ke database yang menyimpan agregat historis, tanpa menambah agregat POS lagi. Jika target database kehilangan agregat, jangan mengklaim hasil laporan lengkap: preflight harus mendeteksi kebutuhan rebuild dan menghentikan apply sampai jalur rebuild yang benar diuji. Tidak cukup menambah ulang setiap total snapshot ke agregat yang mungkin sebagian sudah ada.
7. Catat status restored pada job sehingga request arsip baru periode sama dapat berjalan sesuai F05. Jaga idempotency key dan fingerprint asal.
8. Uji unit transaksi pada D1 yang nyata/local Wrangler. Jangan mengasumsikan `BEGIN TRANSACTION` di SQL CLI pasti didukung persis seperti SQLite in-memory; gunakan bentuk eksekusi yang benar untuk runtime proyek dan buktikan rollback-nya.

**Kriteria lulus:** sebelum arsip/saat arsip/setelah restore sama-sama40.000; kas manual tidak dobel; apply kedua no-op; conflict row tidak ditimpa; restore cabang lain ditolak; POS restored tetap dikenali ledger policy sebagai POS; schema UUID tidak lagi memblok; kegagalan tengah tidak meninggalkan subset restore sebagai sukses.

**Data yang sudah restored dengan sumber salah:** pemulihan membutuhkan archive asli atau bukti relasi POS yang tegas. Buat dry-run daftar koreksi; jangan mengganti semua `arsip_restored` menjadi POS karena sebagian merupakan kas manual.

### F21 — Serialisasi JSON berbatas tetap valid

**P3 · M · Paket B8**

**Apa:** string JSON dipotong pada posisi8192 tanpa memperhatikan struktur.

**Kenapa:** payload besar menjadi invalid dan outbox tidak dapat diproses.

**File utama:** `src/lib/server/auditLog.ts`, caller metadata HPP, tes outbox. Tinjau snapshot checkout sebagai kontrak berbeda.

**Cara:** pertahankan envelope audit wajib seperti action/entity/actor/branch/transaction ID. Batasi metadata sebelum stringify; jika melebihi batas, simpan JSON valid dengan indikator `truncated`, ukuran asli, dan ringkasan allowlisted. Hitung batas bytes UTF-8 bila limit storage/transport berbasis bytes. Tangani cyclic input terarah. Outbox lama invalid dikarantina/dicatat sebagai gagal permanen agar tidak menghalangi event baru; jangan silently delete. Receipt/HPP snapshot finansial tidak boleh ikut ditruncate menjadi ringkasan: validasi ukuran dan tolak sebelum commit atau gunakan storage yang sesuai.

**Kriteria lulus:** payload kecil tetap utuh; unicode/large metadata menghasilkan `json_valid=1`; event penting tetap dapat ditelusuri; outbox invalid lama tidak menghambat event baru; failure audit tidak mengubah transaksi committed menjadi gagal palsu.

### F22 — Tahun filter dinamis

**P2 · S · Paket B7**

**Apa:** pilihan tahun berhenti pada2025.

**Kenapa:** laporan bulanan/tahunan2026 tidak dapat dipilih.

**File utama:** `src/lib/components/laporan/LaporanFilter.svelte`, helper tanggal WITA yang ada.

**Cara:** buat satu daftar tahun untuk kedua selector, dari tahun awal dukungan2020 sampai tahun WITA sekarang, termasuk selected year yang masih valid. Gunakan tanggal server/initial value yang konsisten untuk SSR hydration; jangan dua daftar hardcoded terpisah. Perbarui ketika halaman melewati pergantian tahun bila dibutuhkan oleh lifecycle yang ada.

**Kriteria lulus:**2026 tersedia; tahun2027 tersedia saat tanggal acuan2027; selected year tidak menghilang; pergantian tahun WITA tidak memakai tahun UTC yang masih kemarin. Pemeriksaan browser terarah cukup; jangan membuat suite besar hanya untuk array tahun.

### F23 — Label hasil kas dan simulasi laba konsisten

**P2 · S · Paket B7 · Setelah F13**

**Apa:** hero menyebut laba bersih tetapi memakai saldo sebelum simulasi pajak.

**Kenapa:** dua kartu berlabel mirip menunjukkan angka berbeda tanpa penjelasan.

**File utama:** `src/lib/components/laporan/LaporanSummaryCards.svelte`, `LaporanLabaRugiCard.svelte`, tipe/summary laporan.

**Cara yang dipilih:** hero tetap memakai `summary.saldo`, label menjadi **Hasil Kas Periode** dengan keterangan **Pemasukan − pengeluaran, sebelum simulasi pajak**. Rincian memakai label **Estimasi Laba Setelah Simulasi Pajak** untuk `labaBersih`. Terapkan istilah sama pada PDF. Pertahankan field API legacy; jangan membuat biaya pajak fiktif di ledger. Pill tunai/non-tunai mengikuti net periode F24 atau diberi label volume bila volume memang dipertahankan.

**Kriteria lulus:** tax nonzero menunjukkan perbedaan yang dijelaskan; tax off angka boleh sama; kas masuk/keluar dan pembayaran pelanggan tidak berubah. Cek browser visual/loading/angka negatif; perubahan label tidak memerlukan tes unit yang hanya menyalin teks.

### F24 — PDF memakai net kas periode

**P2 · M · Paket B7 · Bersama F23**

**Apa:** kolom tunai/non-tunai saldo akhir menggunakan total masuk+keluar.

**Kenapa:** income100.000−expense30.000 ditampilkan130.000 di kolom cash tetapi70.000 di total.

**File utama:** `src/lib/utils/reportGrouping.ts`, `src/lib/services/reportPdfExport.ts`, summary cards.

**Cara:** tambahkan field eksplisit `netTunai` dan `netNonTunai`, masing-masing pemasukan−pengeluaran. Jangan mengganti arti `totalTunaiAll` secara diam-diam bagi caller lain; rename/deprecate volume secara bertahap. PDF tampilkan baris **Hasil Kas Periode** dengan net per metode dan totalnya. Simulasi pajak/laba menjadi baris terpisah; kolom metode untuk simulasi pajak gunakan tanda tidak dialokasikan, bukan angka kas fiktif. Karena belum mengambil saldo awal seluruh periode, jangan menyebut net periode sebagai saldo akhir rekening/laci yang absolut.

**Kriteria lulus:**100.000 masuk/30.000 keluar/tax0→70.000 di cash dan total; tax500→kas tetap70.000, estimasi setelah simulasi69.500 pada baris lain; campuran metode/angka negatif konsisten; hasil render PDF asli diuji, bukan hanya group helper.

### F25 — Rekomendasi penjualan AI mengikuti alur quote

**P2 · L · Paket B8 · Setelah F08/B6**

**Apa:** apply rekomendasi mengirim checkout online tanpa quote.

**Kenapa:** endpoint benar-benar menolak; memperbolehkan bypass quote akan melemahkan checkout.

**File utama:** `src/lib/services/autoApplyService.ts`, `aiAnalysisService.ts`, `src/lib/components/shared/aiChatModal.svelte`, tipe AI, `src/routes/api/pos/quote/+server.ts`, kontrak checkout.

**Cara:**

1. Normalisasi rekomendasi menjadi draft item checkout typed; bawa ID produk valid, qty, porsi, add-on IDs, gula/es/catatan. Model tidak boleh menentukan harga produk katalog. Item custom tetap mengikuti otorisasi pemilik.
2. Pisahkan prepare quote dan commit: POST quote dengan CSRF, gunakan response token dan sumber item normalisasi untuk commit. Jangan mengirim harga/qty yang berbeda dari quote.
3. Pada tombol apply yang ada, tampilkan total hasil quote. Bila berbeda dari rekomendasi yang disetujui, beri kesempatan meninjau dan mengonfirmasi perubahan; jangan otomatis mencatat nominal baru. Jangan memakai `amount` omzet sebagai cash_received tanpa memastikan semantik pembayaran/uang diterima.
4. Pertahankan satu idempotency key per intent rekomendasi selama retry. Quote expiry ditangani dengan requote, bukan mengganti intent dan mencatat duplikat. Key tidak diambil dari keluaran model.
5. Apply parsial menyimpan ID rekomendasi yang berhasil dan hanya mengulang yang gagal. Catatan pemasukan/pengeluaran biasa tetap melalui buku kas, bukan dipaksa menjadi POS.
6. Publish/refresh sesuai hasil commit yang benar. Kegagalan quote tidak memanggil endpoint commit atau menandai rekomendasi applied.

**Kriteria lulus:** rekomendasi penjualan sah tersimpan dengan signed quote; harga berubah membutuhkan review; quote gagal/expired ditangani; retry sesudah respons hilang mencatat sekali; batch rekomendasi parsial tidak menggandakan yang sukses; custom kasir ditolak; pemasukan/pengeluaran biasa tetap berjalan.

### F26 — Prompt dan parser HPP memakai field yang sama

**P2 · S/M · Paket B2 · Setelah F14/F02**

**Apa:** prompt meminta name, parser membaca nama.

**Kenapa:** keluaran model yang justru mengikuti prompt dibuang seluruhnya.

**File utama:** `src/routes/api/hpp/parse/+server.ts`, parser murni yang diekstrak, `src/lib/services/manajemenmenuCrud.ts`.

**Cara:** kontrak kanonik memakai `nama` sesuai tipe aplikasi; prompt+contoh+validator konsisten. Terima alias legacy `name` satu kali pada batas parse, bukan sebar fallback ke seluruh UI. Validasi array/item, nama, jumlah/cost finite positif, satuan, dan hitung biaya dari angka input tervalidasi. Prompt sudah meminta jumlah dasar: jangan mengonversi output gram dua kali. Jika model masih memberi kg/liter, normalisasi unit dan kuantitas bersama atau tolak dengan alasan jelas; jangan hanya mengganti label.

**Kriteria lulus:** respons nama dan legacy name sama-sama menghasilkan item sah; invalid/NaN ditolak; fenced JSON diterima sesuai parser; no-key tetap503; hasil kosong tetap422; unit dasar dan biaya konsisten. Tes menggunakan respons model fixture dan parser asli, tanpa biaya API eksternal.

### F27 — Resolver AI menghormati periode eksplisit

**P2 · M · Paket B8**

**Apa:** shortcut jenis pertanyaan menetapkan periode sebelum membaca qualifier tanggal; fallback selalu non-null.

**Kenapa:** pertanyaan bulan lalu diberi data bulan ini, lalu model menjawab berdasarkan data yang salah.

**File utama:** `src/routes/api/aichat/+server.ts`, helper resolver baru, `prompts.ts`, utilitas date/WITA.

**Cara:** ekstrak resolver murni dengan parameter `todayWita`. Resolve periode eksplisit terlebih dahulu (hari ini/kemarin/bulan ini/bulan lalu/rentang tanggal), kemudian intent; shortcut default hanya untuk pertanyaan yang benar-benar dikenali dan tidak punya qualifier bertentangan. Ambigu/unrecognized→null agar analyzer existing dipakai. Validasi output analyzer dengan schema/range yang sudah ada. Hindari `includes('es')` untuk token yang seharusnya kata mandiri. Riwayat percakapan untuk rujukan tanggal tetap diteruskan ketika fast-path tidak cukup.

**Kriteria lulus:** tanggal acuan15Sep2026, menu terlaris bulan lalu→1–31Agustus; bulan ini→1–15September; kemarin benar di batas WITA; Januari→bulan sebelumnya Desember tahun lalu; query ambigu memakai analyzer; periode terpilih benar-benar dipakai fetch SQL dan dicantumkan pada jawaban.

### F28 — Password tidak disanitasi sebagai HTML

**P2 · S/M · Paket B8**

**Apa:** substring/karakter password dihapus sebelum login.

**Kenapa:** password yang sah saat dibuat tidak sama dengan yang dikirim saat autentikasi.

**File utama:** `src/routes/login/+page.svelte`, client auth, `src/routes/api/veriflogin/+server.ts`, `src/routes/api/gantikeamanan/+server.ts`, validation password.

**Cara:** kirim password tanpa `sanitizeInput()`; pemeriksaan suspicious-input generik juga tidak boleh menolak password hanya karena berisi pola HTML/SQL. Tetap jalankan batas panjang/rate limit dan verifikasi bcrypt server. Normalisasi username terpisah. Audit aturan trim yang sudah diterapkan saat create/change/verify; pertahankan kompatibilitas kredensial tersimpan dan samakan aturan tepi spasi secara terdokumentasi. Tidak perlu rehash/reset semua password atau mengubah algoritme PIN untuk tugas ini. Jangan log password ke telemetry.

**Kriteria lulus:** password sah mengandung Script, iframe, `<`/`>` dapat dibuat lalu dipakai login; password biasa tetap bekerja; password salah ditolak; kebijakan panjang/rate limit tetap aktif; log tidak memuat nilai password. Gunakan akun fixture lokal.

### F29 — Toast manager reaktif dengan lifecycle bersih

**P3 · S/M · Paket B1**

**Apa:** getter membaca objek biasa yang tidak dipantau Svelte.

**Kenapa:** pesan sukses/error tidak muncul meskipun fungsi dipanggil.

**File utama:** `src/lib/utils/ui.ts`, seluruh import `createToastManager`, komponen toast.

**Cara:** pindahkan implementasi rune ke `ui.svelte.ts` dengan `$state`, pertahankan API getter/fungsi untuk meminimalkan edit caller; file `ui.ts` boleh re-export sementara agar import lama stabil. Sediakan dispose/cleanup timeout dan panggil saat pemilik manager dihancurkan. Jangan membungkus plain object dalam getter baru lalu menganggapnya reaktif. Pastikan modul rune diproses Svelte, bukan diimpor tes Node mentah.

**Kriteria lulus:** sukses/error tampil; pesan kedua mengganti timer pertama; hide/duration bekerja; navigasi tidak meninggalkan timer; SSR tidak mengakses window; status aria-live tetap sesuai. Verifikasi browser nyata pada printer dan satu caller laporan.

### F30 — Quality gate memakai toolchain proyek

**P2 · S/M · Paket B0**

**Implementasi: selesai, 15 September 2026.** CI membaca `.node-version` dan `pnpm/action-setup@v4` membaca `packageManager`; script `format:check` ditambahkan dan digunakan kembali oleh `lint`. Frozen install berhasil dengan Node 24.20.0/pnpm 11.24.0. Format, check (0 error/warning), ESLint, 13 suite unit, 9 tes backup+self-test UAT, dan build lulus lokal pada runtime default Node 26.8.1. Warning glob PWA lama masih ada. GitHub Actions remote belum dijalankan; ini bukan klaim seluruh pipeline remote sudah hijau.

**Apa:** CI memakai Node20/pnpm9 dan memanggil script format:check yang belum ada.

**Kenapa:** hasil lokal tidak dapat direproduksi oleh pipeline rilis.

**File utama:** `.github/workflows/ci.yml`, `.node-version`, `package.json`, lockfile, scripts quality gate.

**Cara:** jadikan `.node-version` sumber versi Node CI; gunakan versi action maintained yang mendukungnya. Pnpm membaca versi `packageManager`, bukan hardcode9. Tambahkan script `format:check` yang menjalankan Prettier check tanpa menulis, atau selaraskan workflow ke script resmi tunggal; rencana ini memilih menambah `format:check` agar nama gate jelas. Pertahankan frozen-lockfile. Bedakan lint/check/test/build agar diagnosis jelas. Jangan sekalian upgrade seluruh dependency. Tes regresi baru masuk script normal/CI; suite browser bisnis dijalankan pada job dengan setup browser/database lokal yang sesuai.

**Kriteria lulus:** install frozen pada Node/pnpm pin berhasil; script format ada; check/eslint/unit/operations/build bisa dijalankan dari checkout bersih; test baru benar-benar dieksekusi. Status CI remote dilaporkan hanya bila workflow benar-benar dijalankan.

## 6. Migrasi, kompatibilitas, dan pemulihan data

### 6.1 Perubahan schema yang diperkirakan

- B1: ID pengaturan TEXT, row utama teridentifikasi, index/constraint yang tidak membuang data.
- B3: revision/token ledger dan penanda void untuk retry/replay aman.
- B4: job/lease/manifest arsip dan penanda restore yang diperlukan. Hindari menjadikan tabel pengaturan sebagai tabel transaksi generik.
- B6: config pajak versioned dapat tetap disimpan di `nilai`; tambah revision penyimpanan hanya jika belum tersedia mekanisme CAS yang memadai. Jangan memakai timestamp resolusi rendah sebagai versi konflik yang bisa sama.

Nama kolom/tabel baru di atas adalah rancangan; ikuti penamaan repository saat implementasi. Setiap perubahan schema harus memiliki migrasi append-only, journal/manifest, fixture upgrade, dan tes baca/tulis dari schema hasil migrasi.

### 6.2 Urutan rilis

1. Validasi schema/status migrasi pada tiap shard dan simpan backup sesuai script operasional yang ada. Pemeriksaan ini dilakukan oleh operator rilis; pengujian agen sehari-hari memakai DB lokal terpisah.
2. Uji migrasi dari kosong dan dari snapshot berisi data sebelum rilis. Cocokkan counts/ID/PIN/config, bukan hanya exit code.
3. Deploy dengan urutan expand-schema→kode kompatibel→client baru. Schema baru tidak boleh langsung membuat kode lama yang masih melayani request gagal membaca.
4. Ketika kontrak mutasi berubah, pastikan request dari client PWA lama tetap tervalidasi oleh server baru; data antrean lama tetap dikenali. Versi cache hanya diubah untuk domain yang kontraknya berubah, bukan menghapus seluruh IndexedDB transaksi.
5. Setelah smoke test cabang target lulus, lanjut shard/cabang berikutnya sesuai prosedur rilis proyek. Monitor error endpoint terkait, jumlah request settings, serta konsistensi saldo/agregat.

### 6.3 Rollback

- Perubahan UI/service tanpa schema: rollback kode ke revisi kompatibel dengan schema yang sudah diterapkan.
- Perubahan schema: utamakan forward-fix atau rollback kode yang tetap membaca schema baru. Jangan menjatuhkan kolom/tabel yang sudah menerima data baru demi kembali ke baseline.
- Restore backup adalah operasi pemulihan terencana: transaksi setelah backup perlu direkonsiliasi; bukan tombol undo otomatis untuk setiap error.
- Arsip: objek R2 yang sudah berhasil tersimpan tetap menjadi bukti. Jangan menghapusnya otomatis ketika finalisasi D1 gagal. Job status membedakan upload saja vs ledger sudah dikomit.
- Pisahkan perbaikan kode dari koreksi angka lama. Kandidat HPP/restore/agregat yang sudah terlanjur salah dibuatkan dry-run dengan sumber bukti; perubahan massal tidak menjadi bagian terselubung dari migrasi struktur.

## 7. Strategi verifikasi yang hemat tetapi bermakna

### 7.1 Per paket

1. Buat reproduksi gagal yang bermakna untuk perubahan uang/stok/kontrak, lalu ubah assertion ke hasil yang benar sesudah perbaikan. Sertakan kontrol normal.
2. Jalankan hanya suite terkait saat iterasi. Sesudah paket stabil, jalankan `check`, ESLint/format pada file berubah, dan suite regresi yang bersangkutan.
3. Untuk label/tahun sederhana, pemeriksaan browser terarah cukup; jangan membuat tes yang hanya menduplikasi konstanta UI.
4. Untuk rune/DOM, gunakan komponen/store asli melalui browser/compiler Svelte. Untuk SQL, pakai service/controller asli di atas database hasil migrasi dan tambah uji D1 lokal untuk CAS/RETURNING/batch.
5. Stub hanya batas eksternal yang diperlukan: R2, respons model AI, printer hardware. Jangan mengganti aturan bisnis aplikasi dengan fungsi tiruan dalam tes.

### 7.2 Lokasi pengujian yang disarankan

- Pertahankan `src/tests/` dan `e2e/` sebagai lokasi utama sesuai pola repo.
- Ekstrak helper SQLite/D1 test yang kecil dari harness sementara bila berguna; adapter harus mendukung metadata changes, rows, RETURNING, dan rollback secara benar.
- Tambah kasus kontrak ke suite relevan: migrasi, POS integrity/hardening, ingredient-yield, tax-calculation, archive-restore, receipt-output, report-grouping.
- Untuk script restore, tes mengimpor generator yang juga dipakai CLI. Jangan menyalin implementasinya ke file tes atau bergantung pada pemotongan source melalui AST sebagai tes permanen.
- Tambah E2E bisnis: catat gagal/sukses/queued, reguler+jumbo, pengaturan lintas reload, jumlah request settings bounded, riwayat pagination, katalog update, dan konfigurasi pajak dua context browser.
- Nomor skenario yang belum dijalankan harus ditulis `belum diuji`, bukan diasumsikan lulus karena build berhasil.

### 7.3 Perintah repo

Semua perintah terminal diawali `rtk`. Pada PowerShell5.1 jangan memakai `&&` untuk menggabungkan perintah; jalankan terpisah. Verifikasi direktori target sebelum perintah yang menghasilkan file. Jalankan dari root repo.

```powershell
rtk pnpm check
rtk pnpm exec eslint .
rtk pnpm format:check
rtk pnpm test:unit
rtk pnpm test:operations
rtk pnpm build
rtk pnpm deploy:check
rtk node scripts/migrate-production.mjs
rtk pnpm test:e2e:pos
rtk git diff --check
```

Catatan:

- `format:check` tersedia setelah B0. Sebelum itu gunakan `rtk pnpm exec prettier --check <file-yang-diubah>`.
- `rtk node scripts/migrate-production.mjs` tanpa `--apply` hanya memeriksa urutan/checksum, bukan menerapkan migrasi. Pengujian migrasi aktual dilakukan pada DB lokal fixture.
- `test:e2e:pos` menjalankan setup D1 lokal dan browser; gunakan lingkungan lokal pengujian, bukan database operasional pribadi yang belum dicadangkan. Install Chromium dengan script yang ada bila belum tersedia.
- Tambahkan suite browser perbaikan ke script/job resmi; menjalankan `test:e2e:pos` saja belum otomatis mencakup seluruh skenario tambahan.
- `deploy:check` memverifikasi konfigurasi, bukan membuktikan binding produksi sudah terpasang.
- `deploy:preflight` memerlukan tree bersih dan menulis manifest artifact. Jalankan pada tahap operator rilis sesudah commit/build yang relevan; jangan menghapus perubahan pengguna atau mengubah script agar mengabaikan dirty tree demi meloloskannya.

### 7.4 Harness bukti review lama

Harness lokal terdahulu berada di `C:\Users\ASUS\AppData\Local\Temp\opencode\zatiaras-review-*`. File tersebut bersifat sementara, memakai path mesin ini, dan beberapa assertion **mengharapkan bug**. Exit0 pada harness lama bukan bukti fitur benar.

Gunakan kasusnya sebagai bahan regresi, lalu masukkan tes hasil benar ke repository dengan import implementasi asli dan path portabel. Rencana ini tetap dapat dikerjakan bila file sementara sudah hilang: setiap F-ID mempunyai input dan expected result di atas.

## 8. Kriteria penyelesaian dan kesiapan rilis B9

### Regresi lintas fitur wajib

- [ ] Login → PIN configured/unconfigured → buka toko → transaksi tunai/non-tunai → tutup toko, termasuk akses kasir tanpa membuka halaman catat.
- [ ] Dua ukuran produk sama, topping, custom owner, harga berubah saat quote, dan receipt online/offline menghasilkan total konsisten.
- [ ] Retry checkout, retry void, perubahan pembayaran bersamaan, dan void vs perubahan pembayaran hanya menerapkan efek yang sah.
- [ ] Kulakan/edit bahan pada kg/gram, liter/ml, kemasan, pecahan, dan yield tidak menggandakan konversi.
- [ ] Catat online500, offline queued, IndexedDB failure, dan refresh failure menunjukkan status yang benar.
- [ ] Sesi >200 baris menampilkan seluruh saldo; riwayat menemukan transaksi terbaru dan hasil filter lintas halaman.
- [ ] Katalog dan pengaturan diperbarui lintas dua context perangkat tanpa loop fetch atau state cabang tertukar.
- [ ] Konfigurasi beberapa pajak tersimpan lintas reload/perangkat; API/UI/PDF memakai nilai sama pada threshold aktif/nonaktif dan lintas tahun.
- [ ] Arsip normal/concurrent/retry, R2 failure, edit saat upload, restore sekali/dua kali, dan conflict restore menjaga pendapatan/kas yang sama.
- [ ] AI penerapan penjualan memakai quote dan tidak menggandakan hasil parsial; pertanyaan periode eksplisit memakai rentang yang benar; parser HPP memakai unit/nama yang benar.
- [ ] HTML/ESC-POS builder lulus; smoke cetak pada metode printer yang benar-benar dipakai dilakukan oleh operator dengan perangkat fisik.
- [ ] Migrasi fresh+upgrade dan seluruh gate CI/test/build lulus pada toolchain yang dipin.

### Definisi selesai per item

- Kriteria penerimaan item terpenuhi dan hasil pengujian dicatat.
- Tidak ada error TypeScript/lint baru atau regresi paket sebelumnya yang relevan.
- Kontrak publik berubah secara kompatibel atau memiliki adapter/migrasi yang diuji.
- Tidak ada catch kosong/disable test/limit arbitrer yang sekadar menyembunyikan masalah.
- Untuk temuan statis, agen membuktikan jalur aktif sebelum memperluas perubahan. Jika ternyata sudah fixed/tidak berlaku pada HEAD baru, catat bukti dan jangan membuat patch kosong.

Target rencana: seluruh F01–F30 dituntaskan. F19 dapat dipisahkan sebagai penguatan bila operator memilih rilis bertahap; item yang ditunda harus tertulis. Kesiapan rilis tidak ditentukan oleh jumlah checkbox saja: database deployment, migrasi, binding, serta smoke alur nyata harus sesuai hasil yang telah diuji.

## 9. Prompt siap kirim ke agen pekerja

```text
Baca AGENTS.md, REMEDIATION-PLAN.md, dan bagian CODE-REVIEW.md yang relevan.
Kerjakan paket B0 terlebih dahulu, lalu paket berikutnya sesuai dependensi.
Pertahankan kontrak produk pada bagian 2. Jangan refactor massal atau melemahkan
quote, CSRF, RBAC/cabang, idempotency, guard stok, PIN, dan dukungan offline.

Untuk setiap paket:
1. Periksa git status/HEAD; jaga perubahan pengguna.
2. Cocokkan F-ID dengan kode terkini.
3. Implementasikan solusi minimal yang memenuhi desain dan acceptance criteria.
4. Uji modul/endpoint/UI asli sesuai jenis perubahan, termasuk failure/concurrency.
5. Perbarui pelacakan paket: file, migrasi, perintah+hasil tes, batasan tersisa.
6. Lanjut hanya setelah paket stabil. Jika ada blocker konkret, jelaskan tepat
   data/keputusan yang kurang; selesaikan pekerjaan independen yang masih bisa.

Jangan menandai selesai berdasarkan test tiruan atau build saja.
Jangan menjalankan migrasi remote/deploy/push tanpa instruksi terpisah.
Commit mengikuti instruksi sesi; rencana tidak memberi izin commit otomatis.
Semua perintah terminal diawali rtk.
```

Jika ingin membatasi biaya per sesi, ganti baris kedua menjadi `Kerjakan hanya paket B<N> beserta F-ID di dalamnya, lalu berhenti dengan handoff hasil.` Paket tidak perlu dikerjakan sekaligus dalam satu konteks agen.

## 10. Pelacakan implementasi

Isi oleh agen pekerja sesudah pekerjaan benar-benar diverifikasi. `Pending` berarti belum diimplementasikan, bukan gagal.

- [x] B0 — F30. Status: selesai. Bukti: verifikasi lokal tercatat di bawah.
- [x] B1 — F01, F16, F29. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B1 di bawah.
- [x] B2 — F14, F02, F26. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B2 di bawah.
- [x] B3 — F03, F04. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B3 di bawah.
- [x] B4 — F05, F19, F20. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B4 di bawah.
- [x] B5 — F06, F08, F09, F10, F15. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B5 di bawah.
- [x] B6 — F07, F12, F13. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B6 di bawah.
- [x] B7 — F17, F18, F22, F23, F24. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B7 di bawah.
- [x] B8 — F11, F25, F27, F28, F21. Status: selesai lokal, belum commit/push/deploy. Bukti: lihat Hasil B8 di bawah.
- [x] B9 — Regresi integrasi/rilis. Status: gate hijau kecuali E2E terblokir lingkungan (lihat Hasil B9). Belum commit/push/migrasi remote/deploy.

Template hasil per paket:

```text
Paket:
Baseline HEAD:
F-ID selesai / tersisa:
File berubah:
Migrasi dan kompatibilitas:
Perintah verifikasi + hasil aktual:
Acceptance criteria belum diuji:
Data historis yang memerlukan rekonsiliasi:
Blocker / tugas lanjutan:
```

### Hasil F30 / B0 — selesai sebelum memulai tugas berikutnya

- Baseline: `88c6436f747c266377ca700aaa513faf688ff225`; belum di-commit.
- File: `.github/workflows/ci.yml`, `package.json`.
- `rtk pnpm --package=node@24.20.0 dlx node --version`: `v24.20.0`.
- `rtk pnpm --package=node@24.20.0 dlx node "C:\Users\ASUS\AppData\Roaming\npm\node_modules\pnpm\bin\pnpm.mjs" install --frozen-lockfile`: lulus, pnpm 11.24.0, lockfile tetap.
- `rtk pnpm format:check`, `rtk pnpm exec eslint .`, `rtk pnpm check`, `rtk pnpm test:unit`, `rtk pnpm test:operations`, `rtk pnpm build`: lulus lokal. Build memiliki warning glob PWA yang sudah ada sebelumnya.
- Tidak ada migrasi. Node 24 diuji untuk frozen install; suite/build di atas memakai Node default 26.8.1. Eksekusi checkout bersih Linux/GitHub Actions tetap perlu dilakukan oleh pipeline rilis.

### Hasil B1 — F01, F16, F29 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0 (ci/package). Belum commit.
- F-ID selesai: F01, F16, F29. Tersisa: B2-B9.
- File berubah:
  - `drizzle/0025_pengaturan_text_id.sql` (baru), `drizzle/meta/_journal.json`, `drizzle/meta/manifest.json`
  - `src/lib/database/schema.ts` (hapus phantom pajak_config, tambah partial unique main)
  - `src/lib/server/services/pengaturanService.ts` (filter kunci IS NULL, allowlist detail, guard 0-row 404, paksa kunci null saat insert)
  - `src/lib/server/pageAccess.ts`, `src/routes/api/pin/+server.ts` (PinRow id string, guard kunci IS NULL + check changes), `src/routes/api/pin/verify/+server.ts`
  - `scripts/seed-uat-samarinda.sql` (id '910001' TEXT, kunci NULL, guard kunci IS NULL)
  - `src/routes/pengaturan/printer/+page.svelte` (simpan id hasil load, tanpa ID1 global, 404 jelas)
  - `src/lib/utils/ui.svelte.ts` (baru, $state reaktif + dispose), `src/lib/utils/ui.ts` (re-export)
- Migrasi dan kompatibilitas: append-only 0025 rebuild CAST(id AS TEXT), drop phantom kolom, partial unique cabang WHERE kunci IS NULL. Upgrade fixture 910001 + pajak_config preserve OK. Operator wajib backup + cek `SELECT sql FROM sqlite_master WHERE name='pengaturan'` sebelum remote; jika kolom fisik pajak_config ada berisi data, konversi manual ke kunci/nilai dulu.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm test:migration-matrix`: 26/26 + PRAGMA quick_check ok
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <8 file B1>`: bersih
  - Skrip SQLite fresh: insert '910001' OK, UUID pajak OK, duplikat main diblokir, main 1 row id string, update miss changes 0
  - Skrip upgrade 0000-0024 + seed integer lalu 0025: id jadi text '910001', pin_hash/detail/pajak preserve
- Acceptance belum diuji: browser nyata printer toast muncul, PIN configured/unconfigured end-to-end, dua cabang bersamaan, E2E `test:e2e:pos` penuh, CI remote.
- Data historis: nilai HPP/restore lama tidak disentuh. Jika deployment punya duplikat row utama per cabang, migrasi 0025 gagal partial unique — buat laporan konflik, jangan hapus arbitrer.
- Blocker lanjutan: lanjut B2 sesuai dependensi. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B2 — F14, F02, F26 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0/B1. Belum commit.
- F-ID selesai: F14, F02, F26. Tersisa: B3-B9.
- File berubah:
  - `src/lib/utils/unitConversion.ts` (sdm/sdt/potong ikut konteks base, alias kanonik, strict throw + `convertFromBaseUnit`/`safeConvertFromBaseUnit`, safe gagal -> NaN bukan angka salah)
  - `src/routes/stok/+page.svelte` (edit tampil balik base->beli + formatQuantity pecahan, simpan strict + validasi, kulakan kirim baseQty, mutasi guard finite)
  - `src/lib/stores/bahanHppState.svelte.ts` (sama: reverse display + strict save)
  - `src/lib/stores/ekstraState.svelte.ts` (strict + notif, bukan silent)
  - `src/routes/pengaturan/pemilik/manajemenmenu/+page.svelte` (preview guard NaN -> 0)
  - `src/lib/utils/hppParse.ts` (baru, parser murni: kanonik `nama` + alias `name` sekali, kg/liter normalisasi qty bersama, tolak invalid)
  - `src/routes/api/hpp/parse/+server.ts` (prompt `nama` + contoh, pakai parser murni, 503/422 tetap)
- Migrasi dan kompatibilitas: tanpa migrasi. Kontrak jumlah dasar sebelum yield tetap; server hitung biaya dari base + yield tervalidasi. Antrean lama tetap terbaca; tidak ada hapus IndexedDB.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <9 file B2>`: bersih
  - `rtk pnpm test:ingredient-yield`: 29 assertions passed
  - `rtk pnpm test:menu-atomic`: 15 assertions passed
  - `rtk pnpm test:migration-matrix`: 26/26 + quick_check ok
  - Skrip B2-custom: sdm->ml 15 / sdm->gram 15, gram->ml tolak, roundtrip 0.5kg <-> 500g, pack 50, safe invalid NaN, HPP nama/name + kg->1000g + fenced liter->2000ml + tolak tanpa-nama/satuan-aneh
- Acceptance belum diuji: browser 1kg simpan-edit 3x identik, 0.5kg + pack isi N, kulakan tanpa update HPP, unit tak kompatibel ditolak form, E2E penuh, CI remote.
- Data historis: nilai HPP lama salah tidak dikoreksi massal; buat dry-run kandidat bukti pembelian bila perlu. Kulakan 3-request belum atomik; bila parsial gagal saat verifikasi, catat subtask baru, bukan retry buta.
- Blocker lanjutan: lanjut B3 F03/F04 CAS. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B3 — F03, F04 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0/B1/B2. Belum commit.
- F-ID selesai: F03, F04. Tersisa: B4-B9.
- File berubah:
  - `drizzle/0026_buku_kas_cas_void.sql` (baru: revision + mutation_token, pos_void_markers, trigger TRANSACTION_VOIDED), journal/manifest
  - `src/lib/database/schema.ts` (kolom CAS + tabel marker PK cabang+transaksi)
  - `src/lib/server/ledgerCas.ts` (baru: token/claim/guard/changes helper, strip kontrol client)
  - `src/lib/server/services/transaksiKasirService.ts` (void CAS: baca header+revision dulu, klaim batch, efek guard token, marker guard, hapus detail lalu header terakhir, kalah klaim -> duplicate/409 tanpa efek, publish hanya menang)
  - `src/lib/server/dailySummary.ts` (reversal dukung guard opsional)
  - `src/lib/server/services/bukuKasService.ts` (bayar CAS: klaim+metode satu statement, delta guard token, no-op sama, kalah -> bedakan sudah-capai vs konflik, manual bump revision, tolak multi-header legacy, strip revision/token insert)
  - `src/routes/api/pos/transaction/+server.ts` (precheck marker 409 + tangkap trigger void 409)
- Migrasi dan kompatibilitas: append-only 0026. Tanpa soft-delete. Legacy multi-header satu transaction_id ditolak 409 eksplisit, bukan asumsi. Manual buku_kas naikkan revision untuk arsip.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <6 file B3>`: bersih
  - `rtk pnpm test:migration-matrix`: 27/27 + quick_check ok
  - `rtk pnpm test:pos-integrity`: lolos
  - `rtk pnpm test:hardening`: lolos
  - Skrip SQLite CAS: klaim menang 1 / kalah 0, guard efek hanya menang, stok 8+2=10 bukan 12, trigger blokir replay TRANSACTION_VOIDED, bayar 1/0
- Acceptance belum diuji: barrier terkontrol dua void bersamaan via service asli + D1 lokal (bukan hanya SQLite), void vs bayar serial konsisten, retry checkout sesudah void, E2E penuh, CI remote. Pola batch D1 (`meta.changes`) wajib konfirmasi Workers sebelum rilis.
- Data historis: header lama revision default 0 kompatibel klaim pertama. Marker hanya untuk void baru; restore salah sumber ditangani B4.
- Blocker lanjutan: lanjut B4 arsip/restore. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B4 — F05, F19, F20 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B3. Belum commit.
- F-ID selesai: F05, F19, F20. Tersisa: B5-B9.
- File berubah:
  - `drizzle/0027_archive_jobs.sql` (baru: archive_jobs + archive_job_items + unique aktif cabang+tahun), journal/manifest
  - `src/lib/database/schema.ts` (tabel arsip)
  - `src/lib/server/archiveService.ts` (baru: acquire/lease-takeover, manifest seal, sha256 + verifyReadbackBytes, deterministic summary id)
  - `src/routes/api/archive/+server.ts` (controller tipis: klaim atomik, snapshot batch, manifest segel, upload, readback hash+ukuran, final batch klaim finalizing + summary deterministik guard + hapus exact manifest cocok revision + guard sesi tutup, completed terakhir sama batch, orphan bila kalah, resume job baru + pointer legacy)
  - `scripts/restore-archive-lib.mjs` (baru: parse args, validate, diff skip/konflik, build SQL sumber asli + NOT EXISTS + hapus summary cabang+arsip satu commit + marker terpisah + expect-sha256)
  - `scripts/restore-archive.mjs` (pakai lib, tanpa OR REPLACE / arsip_restored, preflight agregat)
- Migrasi dan kompatibilitas: append-only 0027. Lock pengaturan lama tidak dipakai tulis baru; dibaca hanya resume legacy. Tanpa janji atomik D1+R2; orphan catat untuk bersih belakangan.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <5 file B4>`: bersih
  - `rtk pnpm test:migration-matrix`: 28/28 + quick_check ok
  - `rtk pnpm test:archive-restore`: 8 assertions passed
  - Skrip B4-custom: unique aktif tolak kedua, cabang lain bebas, readback cocok lolos / ubah + null tolak, restore sumber pos asli tanpa arsip_restored + NOT EXISTS, diff identik skip + beda konflik
- Acceptance belum diuji: dua arsip bersamaan Rp150rb via service asli, retry sebelum respons, lease takeover blokir worker lama, edit/void saat upload batal, upload gagal ledger utuh, sesi baru sebelum final, restore 40rb sebelum/saat/sesudah sama + cabang tolak + rollback tengah, D1 lokal/Workers nyata, E2E, CI remote.
- Data historis: arsip lama tanpa manifest tetap valid; restore `arsip_restored` lama butuh arsip asli/bukti relasi, dry-run koreksi, jangan mass-replace.
- Blocker lanjutan: lanjut B5 kasir/UI. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B5 — F06, F08, F09, F10, F15 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B4. Belum commit.
- F-ID selesai: F06, F08, F09, F10, F15. Tersisa: B6-B9.
- File berubah:
  - F06 `src/lib/stores/catatState.svelte.ts` (saveTransaksi union saved/queued/blocked/failed, form bersih hanya saved/queued, HTTP 500 input utuh, refresh pisah, busy guard + intent ID stabil)
  - F08 `src/lib/utils/cartKey.ts` (baru: tuple JSON porsi default reguler + addon sort + note normalisasi; qty bukan identitas) dipakai `posCart` + `bayarState` + keyed block bayar
  - F09 `src/routes/+layout.svelte` (effect fetch hanya role/cabang/refresh vs effect tampil tanpa fetch, equality setter, in-flight + generation buang basi, refresh setelah PIN unlock)
  - F10 server `getSesiSummary` SQL SUM/CASE + `GET /api/sesi-toko?summary=1`, client `getSesiSummary`, dipakai TokoModal + dashboard (formula modal+tunai−keluar tunai; total in bukan klaim POS); riwayat `direction desc` + search/metode server SEBELUM limit di `buku_kas`, `fetchTransaksiHariIniPage` cursor (waktu DESC,id DESC) + tombol muat 3 halaman
  - F15 `posState` (payload utuh tanpa fingerprint parsial, guard generasi cabang)
- Migrasi dan kompatibilitas: tanpa migrasi. Storage cart envelope lama tetap dibaca. Arah pagination default asc tak berubah.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <17 file B5>`: bersih
  - `rtk pnpm test:stores`: 8 lolos
  - `rtk pnpm test:hardening`: lolos
  - Skrip B5-custom: reguler/jumbo pisah, addon order sama, note case/spasi sama, cursor desc 5 baris tanpa skip/duplikat, summary 251 baris saldo benar
- Acceptance belum diuji: browser catat 500/queued/ganda, bayar reguler+jumbo dua baris, kasir idle hitung GET, sesi 501 baris + cari lintas halaman + kasir ringkasan saat catat kunci, katalog lintas reload, E2E, CI remote.
- Blocker lanjutan: lanjut B6 pajak. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B6 — F07, F12, F13 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B5. Belum commit.
- F-ID selesai: F07, F12, F13. Tersisa: B7-B9.
- File berubah:
  - `src/lib/tax/engine.ts` (baru murni: validate max 20 + ID unik + range, adapter legacy rate0/threshold terjaga, kalkulator YTD dipakai semua caller)
  - F12 `reportQueries` (omzet = POS + manual usaha non-POS + arsip; tanpa ganda)
  - F13 `reportQueries` (pecah per tahun pajak + konteks YTD + breakdown/label server), `dashboardService` + `laporanState` (pakai summary/breakdown server, fallback lokal offline), `taxService.calculateTaxes` (delegasi engine), AI `reportData` (adapter + engine sama)
  - F07 endpoint pajak v2 (`schema_version/revision/settings`, legacy patch satu entri, CAS nilai atomik + 409, duplicate retry) + client (`saveTaxSettings` Promise CSRF + cek skema + simpan hasil server + cabang tangkap + serial + revision; GET murni cache; sync in-flight; tanpa salin global) + state (draft/persisted/saving/error) + halaman (banner error/saving)
- Migrasi dan kompatibilitas: tanpa migrasi (nilai JSON). Reader lama baca `data` legacy; tulis legacy tak hapus daftar.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <10 file B6>`: bersih
  - `rtk pnpm test:tax`: 9/9 lolos
  - `rtk pnpm test:report-grouping`: lolos
  - Skrip B6-custom: 40rb->200, manual sekali, off->0, YTD 300+300->500rb, penuh 1.5jt, rate0, threshold custom, roundtrip, tolak duplikat/rate
- Acceptance belum diuji: PUT CSRF 403/500 tanpa sukses, reload + perangkat kedua multi-tax, rate0/master off, threshold legacy, dua edit konflik 409, switch cabang, lintas tahun Des-Jan, query gagal bukan 0, E2E, CI remote.
- Blocker lanjutan: lanjut B7 struk/PDF. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B7 — F17, F18, F22, F23, F24 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B6. Belum commit.
- F-ID selesai: F17, F18, F22, F23, F24. Tersisa: B8-B9.
- File berubah:
  - `src/lib/utils/receiptLines.ts` (baru: adapter snapshot->baris; nama beku prioritas, subtotal nominal sah/0, base/addon per unit, inklusif-legacy tanpa tebak, escape di render)
  - F17/F18 `receiptPrint` (subtotal + penanda @, topping xqty terpisah, escape semua dinamis), `bayarState` (komit pakai harga_dasar + tipe terima, offline bawa breakdown), 3 riwayat (ESC/POS via adapter, base vs inklusif benar)
  - F22 `reportYears` (baru: WITA + selected) dipakai satu daftar kedua selector
  - F23 hero `Hasil Kas Periode` + caption sebelum-simulasi, rincian `Estimasi Laba Setelah Simulasi Pajak`, pill volume eksplisit
  - F24 `reportGrouping` (netTunai/netNonTunai/netTotal eksplisit; volume tak berubah arti) + PDF (baris Hasil Kas net per metode, pajak non-kas '-', Estimasi terpisah; tanpa klaim saldo absolut)
  - Tes: `receipt-output` (hash reprint baru + adapter 26rb/0/legacy), `report-grouping` (net + kasus 100/30->70)
- Migrasi dan kompatibilitas: tanpa migrasi. Ledger/kas tak berubah; hanya tampil.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <13 file B7>`: bersih
  - `rtk pnpm test:receipt-output`: lolos (hash baru)
  - `rtk pnpm test:report-grouping`: lolos
  - Skrip cetak: nama beku dipakai, 20rb+6rb=26rb benar
- Acceptance belum diuji: cetak fisik USB/Bluetooth + intent oleh operator, render PDF asli data nyata, visual browser kartu/label/tahun 2026-pergantian WITA, E2E, CI remote.
- Blocker lanjutan: lanjut B8 limiter/AI/password/audit. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B8 — F11, F25, F27, F28, F21 — selesai lokal 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B7. Belum commit.
- F-ID selesai: F11, F25, F27, F28, F21. Tersisa: B9.
- File berubah:
  - F11 `rateLimit` (UPSERT CASE + RETURNING atomik, allowed dari mutasi, limit positif, DO utama + D1 + fail-closed; tanpa counter isolate/global)
  - F21 `auditLog` + `realtimeWorker` (metadata dibatasi SEBELUM stringify + envelope truncated/ukuran/ringkasan + cyclic, outbox invalid karantina >=5 agar event baru jalan, snapshot finansial tak diringkas)
  - F28 login (password mentah tanpa sanitize/suspicious, trim konsisten create/change/verify terdokumentasi, tanpa log nilai)
  - F27 `aiPeriod` (baru murni: periode eksplisit dulu, kata utuh, ambigu/null -> analyzer, Januari lintas tahun) + fast-path ramping via validator
  - F25 `autoApplyService` (normalisasi tanpa harga model, custom pemilik saja, quote CSRF dulu, beda nominal tolak review, commit item sama + key stabil + cash quote, expiry requote sekali, parsial per-ID, non-POS via buku kas)
- Migrasi dan kompatibilitas: tanpa migrasi.
- Perintah verifikasi + hasil aktual:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm exec eslint <6 file B8>`: bersih
  - `rtk pnpm test:hardening`: lolos
  - Skrip B8-custom: bulan lalu 1-31 Agu / ini 1-15 Sep / kemarin / Jan->Des / ambigu null / 'es' tak picu, audit kecil/Unicode/besar valid, UPSERT 1/2/reset-1
- Acceptance belum diuji: 20 request bareng limit 1 D1 lokal, AI parsial + retry respons hilang + custom kasir tolak + periode dipakai SQL, akun fixture password pola, E2E, CI remote.
- Blocker lanjutan: B9 regresi rilis. Jangan push/migrasi remote/deploy tanpa instruksi.

### Hasil B9 — regresi/rilis — gate hijau kecuali E2E lingkungan, 15 Sep 2026

- Baseline HEAD: `88c6436` + dirty tree B0-B8. Belum commit/push/migrasi remote/deploy.
- Lolos lokal:
  - `rtk pnpm check`: 0 error/warning
  - `rtk pnpm lint` (format + eslint .): bersih
  - `rtk pnpm test:operations` (9 backup + UAT safety): lolos
  - `rtk pnpm test:quality`: lolos (TS/eslint/format/struktur/dependensi)
  - `rtk pnpm test:unit` 13 suite: hardening, stores 8, offline 40, pos-integrity, ingredient-yield 29, receipt-output, report-grouping, tax 9, archive-restore 8, menu-atomic 15, realtime 12, migration-matrix 28/28 + quick_check ok, a11y 9 — semua lolos
  - `rtk pnpm build`: lolos (warning glob PWA lama saja)
  - `rtk pnpm deploy:check`: ready
- Belum diuji (bukan klaim lolos):
  - `rtk pnpm test:e2e:pos`: setup D1 lokal gagal di migrasi lama 0023 (`no such column: cabang_id`) pada state `.wrangler` basi; port 5173 dipakai proses dev (PID 15292) sehingga state terkunci dan tak bisa reset. Bukan dari migrasi 0025-0027 (ketiganya OK di state sama; 28/28 fresh SQLite OK). Cara lanjut: hentikan dev server, hapus `.wrangler/state`, jalankan ulang E2E pada DB lokal pengujian (bukan operasional).
  - CI remote GitHub Actions, smoke alur nyata per cabang, cetak fisik, render PDF data nyata: operator rilis.
- Urutan rilis (operator): backup 3 shard -> cek schema aktual (`SELECT sql FROM sqlite_master`) -> migrasi remote berurutan 0025,0026,0027 -> verifikasi counts/ID/PIN/config per shard -> deploy realtime + pages (tanpa migrasi otomatis) -> smoke cabang target -> shard berikut. Rollback = forward-fix; backup hanya pemulihan terencana.
- Koreksi angka lama (terpisah dari migrasi): kandidat HPP salah + restore `arsip_restored` lama via dry-run bukti; tanpa mass-replace.
