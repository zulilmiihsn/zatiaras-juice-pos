# Audit ulang klaim R01–R12 tuntas

Tanggal: 16 September 2026.

Commit yang diuji: `75785ad9eda5fd042184b0ad53dc9c7299f500b6` — `fix(remediation): tuntaskan residual audit R01-R12`.

Referensi: [audit sebelumnya](REMEDIATION-AUDIT.md), [rencana dan checklist](REMEDIATION-PLAN.md).

## Keputusan

**Klaim semua residual tuntas belum benar.** Dari 12 residual:

- **7 lolos pemeriksaan lokal:** R03, R05, R06, R07, R09, R10, R12.
- **5 belum tuntas:** R01, R02, R04, R08, R11.
- Gabungan status audit sebelumnya dan pemeriksaan ini: **25 perbaikan inti memiliki bukti lokal, 5 masih parsial** — F02, F05, F07, F20, F27.
- **B9 tetap belum selesai.** Masih ada bug nyata, termasuk regresi arsip normal; E2E bisnis penuh dan CI remote belum terverifikasi.

Status Git pada pemeriksaan:

- Working tree awal bersih; perubahan sudah di-commit, bertentangan dengan feedback “belum commit”.
- `git ls-remote origin refs/heads/main` mengembalikan SHA `75785ad...`: commit tersebut **sudah berada di remote main**.
- Tidak ada dasar menyetujui klaim siap rilis hanya dari check/lint/unit/build yang hijau. Prioritaskan commit perbaikan baru untuk R02 dan R08, kemudian R04/R01/R11.

Audit ini memverifikasi dan memperbarui dokumentasi; bug di bawah belum diperbaiki oleh putaran audit ini.

## Status seluruh residual

### R01 / F02 — Pecahan input: belum tuntas

Parser baru memperbaiki `parseQuantityInput('0,5')` dan roundtrip data yang sudah tersimpan. Namun, interaksi mengetik belum benar:

- **Browser asli:** kosongkan jumlah beli, ketik `0,5` satu karakter setiap kali. Hasil field menjadi`5`, lalu PATCH mengirim5.000gram, bukan500gram.
- Penyebab: `handleRupiahFormat()` memformat ulang pada setiap `oninput`. Ketika pengguna baru mengetik `0,`, parser mengubahnya menjadi0 dan formatter menghapus koma sebelum digit5 diketik.
- Parser juga membaca `0.125` sebagai125, bukan0,125. Aturan titik ribuan menerima tiga digit setelah titik tanpa membedakan awalan nol. Ini memperjelas bahwa dukungan desimal titik belum konsisten.

**Bukti:** `src/routes/stok/+page.svelte:684-701`, `src/lib/utils/currency.ts:35-61`, binding `#modal-bahan-beli-qty`.

**Perbaikan yang diperlukan:**

1. Pertahankan string draft termasuk keadaan sementara seperti`0,`,`0.`, dan separator terakhir ketika pengguna mengetik.
2. Normalisasi/format pada blur atau commit, bukan memaksa format numerik pada setiap tombol.
3. Tetapkan parsing titik/koma dengan aturan eksplisit, termasuk0.125. Jangan memakai heuristik yang mengubah pecahan menjadi ratusan.
4. Tes DOM dengan `pressSequentially('0,5')`, bukan hanya `.fill('0,5')` atau tes fungsi parser. Sertakan paste, backspace, edit berulang, dan pecahan kemasan.

### R02 / F05 — Arsip normal mengalami regresi: belum tuntas, blocker utama

Klaim cabang tunggal dan penolakan edit/sesi/lease saat upload sudah membaik. Namun, guard manifest diterapkan kembali **sesudah proses sendiri menghapus row yang ada di manifest**.

**Hasil pada handler asli, juga dikonfirmasi pada D1/Workers lokal:**

- Arsip1 row×Rp1.000, tanpa konkurensi: respons409, ledger terhapus, summary1.000 tersimpan, job menjadi`orphan`.
- Arsip45 row×Rp1.000: chunk pertama menghapus20 row.25 row tersisa, tetapi summary seluruh45.000 sudah tersimpan. Respons409 tetap mengklaim “ledger utuh”.
- Retry atas25 row tersisa:20 row lagi terhapus; summary kumulatif menjadi70.000 dan ledger5.000 masih ada. Awalnya data hanya45.000.

**Penyebab:**

1. `manifestIntactSql()` mengharuskan seluruh header snapshot masih ada.
2. DELETE chunk pertama membuat kondisi itu false untuk chunk berikutnya.
3. UPDATE completed menggunakan kondisi yang sama, sehingga arsip non-kosong normal tidak mencapai completed setelah header dihapus.
4. Pengecekan status dan error409 dilakukan **setelah `rawDb.batch()` sudah commit**. Throw setelah commit tidak mengembalikan perubahan database.

**Bukti:** `src/lib/server/archiveService.ts:218-219`, `src/routes/api/archive/+server.ts:419-449`, `:452-479`.

**Perbaikan yang diperlukan:**

1. Pindahkan validasi keseluruhan manifest ke **statement klaim finalisasi pertama**, bersama ownership, lease, dan sesi tutup.
2. Setelah klaim sah di dalam batch atomik, semua INSERT/DELETE/UPDATE completed bergantung pada **token job yang stabil**, bukan keberadaan header yang memang akan dihapus oleh operasi itu sendiri.
3. Jika klaim kalah, seluruh efek menjadi no-op. Jika statement gagal, batch rollback. Jangan memakai pemeriksaan setelah commit sebagai pengganti rollback.
4. Cleanup saat klaim kalah harus menggunakan owner yang benar; jangan menganggap `finalizeToken` sudah tersimpan jika UPDATE klaim menghasilkan0 row.
5. Tambah tes handler penuh untuk1/20/21/45 row, sukses normal, retry, dua cutoff, edit saat upload, dan failure tengah batch. Pastikan respons, ledger, summary, serta job status konsisten.

Tes `archive-guard-tests.ts` sekarang menyalin fragmen SQL dan memeriksa beberapa penolakan. Tes itu tidak menjalankan urutan handler normal dengan beberapa DELETE chunk, sehingga tetap hijau pada regresi ini.

### R03 / F06 — Error antrean dan retry intent: lolos kasus residual lokal

Browser kini menampilkan pesan gagal penyimpanan antrean dan mempertahankan isian ketika IndexedDB gagal. `lastFailed` menjaga ID untuk submit ulang payload gagal yang sama, lalu dibersihkan setelah sukses/queued. Bukti mencakup browser untuk pesan queue dan pembacaan jalur intent; persistensi lintas reload bukan klaim pengujian ini.

### R04 / F07 — CAS server benar, draft client masih hilang: belum tuntas

Perbaikan server lolos pemeriksaan handler asli:

- Dua expected revision sama menghasilkan200 dan409.
- Revision v2 hilang ditolak400.
- Branch request berbeda dari sesi ditolak403.
- Validator menolak boolean/threshold tidak sah yang dilaporkan sebelumnya.

Tetapi klaim “draft aman” belum terpenuhi:

1. Pengguna mengubah tarif menjadi1%; save pertama tertunda.
2. Pengguna mengubahnya lagi menjadi2%; save kedua masuk antrean.
3. Save pertama berhasil dan mengembalikan1%. Store menimpa draft terbaru menjadi1% serta menghapus dirty flag.
4. Save kedua gagal500. **Draft akhir tetap1%, bukan2% yang terakhir diketik pengguna.**

Kasus ini direproduksi melalui `createTaxSettingsState()` dan service client asli di browser, dengan respons API terkontrol.

**Bukti:** `src/lib/stores/taxSettingsState.svelte.ts:42-65`, terutama`:53-55`; `src/lib/services/taxService.ts:207-225`.

**Perbaikan yang diperlukan:** berikan versi/generation pada setiap edit dan snapshot immutable pada setiap save. Respons lama boleh memperbarui persisted result, tetapi hanya boleh mengganti draft/dirty jika tidak ada edit yang lebih baru. Kegagalan save terbaru harus mempertahankan draft terbaru. Status saving mengikuti seluruh pekerjaan tertunda, bukan boolean yang dimatikan oleh respons pertama.

### R05 / F09 — Refresh identitas yang tertunda: lolos kasus residual lokal

Browser menahan GET settings cabang pertama, melakukan switch ke cabang kedua, lalu mengamati GET cabang kedua berjalan setelah in-flight selesai. Request tidak lagi hilang. Identitas role/cabang/user dan antre refresh tersedia. Pemeriksaan ini tidak mengklaim semua skenario pergantian sesi telah diuji.

### R06 / F13 — Propagasi error dan bundle rincian: lolos lokal

Query omzet/YTD wajib kini mempropagasi kegagalan. Service asli menolak ketika pembacaan wajib gagal. Browser menampilkan label pajak server yang sebelumnya hilang karena store membaca lokasi objek yang salah. Tes permanen laporan memakai modul asli, meskipun fixture query masih dapat diperkuat untuk seluruh rentang tanggal.

### R07 / F17 — Nama numerik dan topping cetak ulang: lolos kasus residual lokal

Nama snapshot`123` dipertahankan. HTML asli menghasilkan baris dasar20.000+topping6.000 dengan total26.000. Tes render topping kini ditambahkan ke suite, bukan hanya arithmetic adapter. Smoke printer fisik tetap pekerjaan operator.

### R08 / F20 — Preflight restore belum menutup seluruh konflik: belum tuntas

CLI sekarang benar-benar memanggil preflight target dan memeriksa keberadaan tanggal agregat POS. Itu kemajuan, tetapi masih ada dua gap:

- `BK_FIELDS` tidak membandingkan `metode_bayar`, receipt/fingerprint, jumlah, dan beberapa field yang ikut direstore. Target dengan nominal sama tetapi metode pembayaran berbeda masih dinyatakan identik. `TK_FIELDS` juga hanya membandingkan sebagian field detail.
- Preflight dan apply terpisah tanpa pemeriksaan versi/isi atomik. Jika row konflik muncul setelah preflight, builder tetap melakukan `WHERE NOT EXISTS(id)`, melewatkan row itu dan melanjutkan penghapusan summary arsip.

**Reproduksi:** preflight kosong menyatakan satu insert; row target dengan ID sama dan nominal9.999 muncul; SQL apply asli selesai, melewatkan row, dan menghapus summary arsip tanpa menyatakan conflict.

**Bukti:** `scripts/restore-archive-lib.mjs:103-104`, `:110-130`, `scripts/restore-archive.mjs:187-248`.

**Perbaikan yang diperlukan:** bandingkan seluruh field bisnis relevan dengan normalisasi yang eksplisit; lakukan validasi target yang menentukan izin restore dalam unit atomik yang sama dengan efeknya, atau gunakan mekanisme claim/version yang menjamin tidak ada perubahan di antaranya. Konflik harus menggagalkan seluruh apply, termasuk pembersihan summary.

Catatan koreksi: keberadaan `BEGIN TRANSACTION;` saja tidak dijadikan bug. Wrangler terpasang memiliki `trimSqlQuery()` yang menghapus wrapper BEGIN/COMMIT. Kekurangan yang terbukti adalah cakupan konflik dan jeda preflight→apply; tes CLI/D1 lengkap tetap perlu ditambahkan.

### R09 / F21 — Karantina dan kelanjutan antrean: lolos kasus residual lokal

Schema karantina sudah ada. Pengujian scheduler asli memindahkan100 payload invalid, lalu event valid sesudahnya dapat diproses pada siklus berikutnya. `flushAuditLogOutbox()` juga mempertahankan payload invalid dalam karantina.101 payload test berhasil disimpan, bukan dihapus diam-diam. Worker dan helper masih mempunyai implementasi terpisah; samakan kontraknya melalui tes bersama agar tidak menyimpang lagi.

### R10 / F25 — Requote dan retry parsial: lolos dua kasus residual lokal

Browser dengan modul client asli mengonfirmasi:

- Quote pertama10.000 kedaluwarsa, quote kedua20.000: hanya satu percobaan commit awal; harga baru ditolak untuk review, tidak langsung dikomit.
- Satu rekomendasi kas manual sukses dan satu penjualan gagal, lalu retry: hanya satu POST kas manual total; hasil sukses sebelumnya dilewati.

Stable ID manual dan daftar applied per cabang tersedia. Ini bukan klaim seluruh recovery lintas reload/perangkat atau penerimaan tunai nyata telah diverifikasi; otorisasi/harga server tetap wajib.

### R11 / F27 — Nama bulan dikenali, tanggal tertentu masih diabaikan: belum tuntas

`bulan Agustus 2026` kini dipilih dengan benar. Tetapi pertanyaan **“menu terlaris tanggal 15 Agustus 2026”** dipetakan resolver asli ke1–31Agustus, bukan15Agustus atau fallback analyzer.

Penyebab: begitu nama bulan ditemukan, resolver langsung mengembalikan rentang sebulan tanpa memeriksa qualifier hari/rentang lain.

**Bukti:** `src/lib/server/aiPeriod.ts` pada cabang `namedMonth`, dipanggil `fastResolveRequirements()` di `src/routes/api/aichat/+server.ts`.

**Perbaikan yang diperlukan:** fast-path hanya menerima bentuk yang seluruh qualifier-nya sudah terselesaikan. Untuk tanggal tertentu, range, atau kombinasi qualifier yang belum didukung, return null agar analyzer menangani. Tambahkan kasus15Agustus,1–15Agustus, dan dua bulan dalam satu pertanyaan, bukan hanya nama bulan tunggal.

### R12 / F29 — Lifecycle toast: lolos kasus residual lokal

Cleanup bersama `onDestroy` dan dispose pemilik yang sebelumnya hilang sudah dipasang. Browser membuktikan timer toast milik halaman printer benar-benar menerima `clearTimeout` saat navigasi client-side. Pemeriksaan source juga menemukan cleanup di pemilik lain yang dilaporkan sebelumnya.

## Quality gate dan batas bukti

Hasil dijalankan ulang pada commit `75785ad`:

- `rtk pnpm check`:0 error/0 warning.
- `rtk pnpm lint`: format dan ESLint lulus.
- `rtk pnpm test:unit`:18 suite lulus.
- `rtk pnpm test:operations`:9 tes backup+self-test UAT lulus.
- `rtk summary pnpm build`: exit0. Ringkasan RTK menandai nama artifact `error.svelte.js` dan `errorHandling.js` sebagai error; itu bukan kegagalan build. Warning glob PWA lama tetap ada.
- `rtk pnpm deploy:check`: pemeriksaan konfigurasi lulus.
- **30 migrasi** berhasil pada SQLite in-memory dan **D1/Workers lokal ephemeral**.

Gate hijau tidak menutup bug handler yang tidak dijalankan tes. Khusus tes baru:

- `archive-guard-tests.ts`: SQL fragmen, bukan alur handler normal penuh; melewatkan regresi paling berat.
- `tax-cas-tests.ts`: menggandakan fungsi SQL CAS dalam tes; handler asli diuji terpisah pada audit ini, client draft belum tercakup suite itu.
- `restore-apply-tests.ts`: validasi/helper dan bentuk string SQL; belum menguji preflight→apply bersamaan melalui CLI/target.

E2E bisnis penuh tetap belum memiliki hasil lulus. Audit tidak mereset state `.wrangler` pengguna atau menghentikan dev server mereka. D1 audit menggunakan `persist:false` dan binding terpisah. CI remote belum terverifikasi: percobaan `gh run list` gagal karena executable `gh` tidak tersedia; status “antre” dari feedback bukan bukti yang berhasil dikonfirmasi.

## Reproduksi audit putaran ini

Lokasi script sementara: `C:\Users\ASUS\AppData\Local\Temp\opencode`.

```powershell
rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\residual-verification.mts"
rtk pnpm exec tsx "C:\Users\ASUS\AppData\Local\Temp\opencode\residual-verification-d1.mts"
rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-browser.mjs" R
rtk node "C:\Users\ASUS\AppData\Local\Temp\opencode\remediation-audit-browser.mjs" R12
```

Script memakai implementasi aplikasi asli. Browser memakai API fixture; resolver privat diambil dari deklarasi fungsi asli melalui AST. Tidak ada transaksi produksi, panggilan AI berbayar, atau printer fisik dalam audit.

Koreksi harness: fixture sesi awal kurang `kas_awal`, kemudian diperbaiki; pemeriksaan timer awal menghitung timer baru milik halaman tujuan, kemudian dibatasi ke ID timer toast asal dan pemanggilan clearTimeout-nya. Keduanya dibedakan dari bug aplikasi. Run final script backend/D1 dan pengulangan R12 menyelesaikan assertion audit; label FAIL CONTRACT berarti residual yang terbukti, bukan kegagalan setup harness.

## Handoff lanjutan

1. **R02 dahulu:** perbaiki penempatan guard dan perilaku batch, dengan tes sukses normal1/20/21/45 row serta retry.
2. **R08:** preflight lengkap dan guard apply atomik, termasuk perubahan metode bayar dan row muncul di antara preflight/apply.
3. **R04:** generation edit/save dan snapshot immutable; latest draft tetap utuh saat save terbaru gagal.
4. **R01:** input desimal sementara tidak diformat terlalu dini; tes ketikan nyata.
5. **R11:** qualifier tanggal tertentu tidak disederhanakan menjadi sebulan; fallback analyzer bila belum terselesaikan.
6. Setelah tiap tugas benar-benar lulus, tandai statusnya saat itu, lalu lanjut. Akhiri dengan B9 pada lingkungan E2E terisolasi yang dapat direproduksi.
