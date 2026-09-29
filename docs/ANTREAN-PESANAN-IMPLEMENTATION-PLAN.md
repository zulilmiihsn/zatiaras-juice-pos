# Rencana Implementasi Antrean Pesanan ZatiarasPOS

## 0. Status, sumber, dan batas rencana

- Status: **terimplementasi pada working tree (belum commit); migrasi `0035_order_preparation`, API, offline, UI, dan tes Q01–Q16 selesai lokal**.
- Keputusan produk: satu transaksi POS = satu pesanan; status hanya **Belum selesai** dan **Selesai**; staf boleh **Buka lagi** jika salah menandai selesai. Kasir dan pemilik cabang sama-sama boleh mengerjakannya. Kios memakai satu device bersama, tetapi kontrak data tetap aman terhadap dua tab/perangkat.
- Dokumen utama: `AGENTS.md`, `README.md`, `DEVELOPER-GUIDE.md`, `docs/adr/`, `docs/OPERATOR-RUNBOOK.md`. Ketika isi dokumen historis bertentangan dengan kode sekarang, verifikasi kode dan tes terkini; jangan menganggap angka suite/status dari audit lama masih berlaku.
- Tujuan: daftar kerja produksi jus per **pesanan**, tidak mengubah nominal, stok, HPP, struk, laporan, atau status sinkronisasi transaksi offline.
- Rencana ini menjadi kontrak sebelum coding. Jika implementasi menemukan keterbatasan D1/PWA yang mengharuskan perubahan kontrak, perbarui dokumen dan tes penerimaan dahulu; jangan sisipkan workaround diam-diam.
- **Jangan** commit/push/deploy/migrasi remote tanpa instruksi pemilik. Perintah proyek selalu memakai prefix `rtk`.

## 1. Perilaku yang harus dicapai

### 1.1 Sumber dan transisi

1. Hanya checkout POS yang **berhasil tersimpan** di server membuat pesanan server berstatus `pending`. Checkout tunai, QRIS/non-tunai, pemilik tanpa sesi toko, stok `tracked`/`ignored`, dan replay offline yang diterima memakai aturan sama.
2. Satu checkout menghasilkan satu kartu, berisi semua baris `transaksi_kasir`; bukan satu kartu per gelas. Transaksi manual di `catat` bukan pesanan. Quote, keranjang belum dibayar, checkout gagal, dan retry idempotent tidak membuat kartu baru.
3. Status `pending` -> `done` lewat **Selesai**; `done` -> `pending` lewat **Buka lagi**. Satu ketukan berlaku untuk seluruh pesanan. Tampilkan dua tab: **Belum selesai** (semua umur, tertua dulu) dan **Selesai** (terbaru dulu, paginasi/batas hasil). Tidak ada status ketiga seperti `sedang_dibuat`.
4. Penyelesaian ulang dengan target yang sudah tercapai menghasilkan respons idempotent, tanpa mengubah waktu/aktor/revision. Transisi basi yang berlawanan menghasilkan konflik dan refresh, bukan diam-diam menimpa aksi staf lain.
5. Void pemilik menghapus transaksi POS dari daftar aktif maupun selesai sesuai mekanisme void yang ada; void tidak disamakan dengan Selesai. Tidak ada menu void baru di Antrean.
6. Identitas pelanggan dan rincian persiapan memakai snapshot transaksi, **bukan katalog terkini**. Item jumbo, custom milik pemilik, topping, jumlah, gula, es, catatan, serta nama produk yang berubah setelah pembayaran harus tetap terbaca benar. Waktu disimpan UTC dan ditampilkan WITA.
7. Transaksi POS historis sebelum fitur ini aktif **tidak** otomatis menjadi `pending`; status legacy adalah `NULL`. Tidak ada backfill otomatis/tebakan pesanan lama.
8. Semua cabang harus terisolasi berdasarkan cabang dari session. Status stok hanya menentukan navbar, tidak menentukan apakah Antrean tersedia.

### 1.2 Navigasi dan tampilan

- `tracked`: Beranda · Catat · Antrean · **Kasir** · Stok · Laporan · Pengaturan.
- `ignored`: Beranda · Catat · **Kasir** · Antrean · Laporan.

- Tombol Kasir hero tepat di tengah pada kedua mode. Catat tetap. Pengaturan saat `ignored` tetap dapat dibuka dari Beranda. Semua halaman `/pengaturan` tetap **tanpa navbar** dan menggunakan tombol back yang sudah ada; jangan mengubah `showNav` untuk itu.
- Label terlihat dapat dipendekkan menjadi **Atur** pada lebar sempit, tetapi `aria-label` tetap **Pengaturan**. Kartu Antrean tidak memakai nama "Pesanan Kasir" karena nama itu sekarang berarti keranjang.
- Badge Antrean = jumlah pesanan `pending` cabang saat ini (termasuk lokal belum sinkron pada device ini), bukan jumlah gelas dan bukan `layoutSt.pendingCount`. Saat menghitung campuran data, deduplikasi berdasarkan `(cabang_id, idempotency_key)`. Jika hitung server gagal, jangan menyajikan angka basi sebagai pasti; tampilkan status gagal/unknown dan biarkan halaman dicoba ulang.
- Halaman `/antrean`: urutan jelas, target sentuh memadai, loading/error/empty state, nama pelanggan atau identitas stabil, waktu, detail per baris, label **Belum tersinkron** saat lokal, tombol Selesai/Buka lagi dengan disabled saat menyimpan. Jangan taruh harga sebagai fokus utama; jangan hapus informasi varian atau catatan.
- Modal sukses di `/pos/bayar` mempertahankan Cetak Struk dan Kembali ke Kasir, menambah **Lihat Antrean** yang bekerja untuk transaksi online dan offline. Hindari navigasi dari modal sebelum status simpan lokal/server benar-benar sukses.
- Navbar 7 item harus diuji pada 320, 360, 390 px dan tablet: target klik minimal 44×44 px untuk rancangan ini, tidak terpotong/bertumpuk, badge tidak menutupi tetangga, label terbaca, Kasir tetap terpusat (toleransi pembulatan <= 2 px). Atur padding/label responsif bila perlu; jangan buat navbar scroll horizontal atau sembunyikan Catat.

## 2. Model data dan keamanan

### 2.1 Pilihan sumber kebenaran

Gunakan **header `buku_kas` POS** sebagai sumber status kanonik; rincian baca dari `transaksi_kasir` dengan pasangan `buku_kas_id` + `cabang_id`. Jangan membuat tabel order duplikat berisi salinan transaksi atau memakai `pengaturan`, realtime event, localStorage, atau audit log sebagai sumber status.

Migrasi **aditif, nullable untuk legacy**, pada `buku_kas`:

- `preparation_state TEXT NULL`: `NULL` = legacy/bukan pesanan baru; `pending` / `done` hanya transaksi POS baru.
- `preparation_revision INTEGER NOT NULL DEFAULT 0`: CAS khusus Antrean, terpisah dari revision ledger finansial.
- `preparation_completed_at TEXT NULL`: UTC saat Selesai; kembali `NULL` saat Buka lagi.
- `preparation_completed_by TEXT NULL`: `session.userId` saat Selesai; kembali `NULL` saat Buka lagi.

- CHECK untuk nilai state dan konsistensi waktu/aktor bila kompatibel dengan migrasi aditif SQLite; lakukan tes D1 sebelum mengunci SQL. `revision` ledger existing tetap dinaikkan setiap perubahan status agar manifest arsip mendeteksi perubahan selama upload; **jangan** mengubah `mutation_token`, total uang, agregat, stok, atau receipt.
- Index yang didahului `cabang_id` untuk filter `sumber='pos'`, `preparation_state`, `waktu`, `id` jika pengukuran query menunjukkan dibutuhkan. Hindari index berlebih. Gunakan cursor `(waktu, id)` untuk daftar yang berpotensi besar; count server memakai `COUNT(*)` pada header, tidak join semua item.
- Endpoint GET dan PATCH/POST mutasi: `requireSessionBranch(locals)` + pemeriksaan role **tepat** `kasir`/`pemilik`, `getD1Database` di route tipis sesuai pola checkout, SQL hanya di repository/use case. `requireAnyRole` mengizinkan `admin` secara implisit; jangan pakai jika kontrak role ini harus eksklusif. Jangan percaya `branch`, role, harga, nama item, atau status finansial dari payload browser. Mutasi memakai `fetchWithCsrfRetry`; `hooks.server.ts` sudah mewajibkan CSRF untuk API mutasi.
- Endpoint transisi menerima identitas transaksi **idempotency key checkout** dan target `pending|done` serta `expected_preparation_revision`. Batasi panjang/jenis body; query selalu `cabang_id = ? AND sumber = 'pos' AND idempotency_key = ?`. Validasi row bukan legacy/void/arsip. CAS pada status + revision; lakukan reread ter-scope cabang untuk klasifikasi: target sudah sama = idempotent, target berlawanan + revision basi = 409, row tak ada = 404. Jalankan atomik; jangan menyebut sukses jika `changes = 0` tanpa memastikan keadaan final. Gunakan pesan error Indonesia; bila menambah `code`, perbarui registry dan tes kompatibilitas.
- Masukkan `preparation_state='pending'` ke INSERT header pada `checkout/statementBuilder.ts`, di batch checkout yang sudah ada. Gagal menulis status harus membatalkan **seluruh** checkout, bukan menjual diam-diam tanpa kartu. Retry/replay memanfaatkan `(cabang_id, idempotency_key)` yang sudah unik; tidak menambah status ke fingerprint checkout.
- Event realtime hanya **setelah commit**, tidak menyalurkan detail pelanggan; cukup ID/event invalidate. UI refetch saat event, kembali fokus, koneksi pulih, serta refresh manual. Realtime gagal tidak boleh membatalkan checkout/transisi yang sudah commit; ikuti ADR 0002.

### 2.2 Isolasi data offline

- Dalam browser, gunakan IndexedDB untuk snapshot daftar Antrean dan **intent status persisten** (nilai target terakhir per `(cabang_id, idempotency_key)`). Jangan ubah arti `PendingTransaction.status` (`pending|syncing|failed`) atau schema queue POS lama. Data lokal hanya proyeksi; server tetap otoritatif saat online.
- Cache snapshot Antrean harus di-namespace per cabang **dan identitas sesi/user**; pada logout, pergantian cabang/user, atau sesi kedaluwarsa, tutup tampilan/bersihkan cache snapshot privat. **Jangan** hapus transaksi POS offline yang belum terkirim atau intent status yang belum dikonfirmasi hanya karena logout: simpan terpisah, jangan tampilkan tanpa sesi cabang valid, dan pastikan recovery setelah login yang sesuai.
- `selectedBranch` di localStorage bukan bukti otorisasi. `/api/session` saat ini tidak mengembalikan `branch`, padahal validasi sesi online memperbarui snapshot offline. Tambahkan cabang terverifikasi ke respons session + snapshot (kompatibel dengan caller lama), lalu tes pemuatan ulang, relogin, switch cabang dan snapshot legacy tanpa cabang. Untuk Antrean offline, snapshot tanpa cabang valid **fail closed** (minta online/login); POS offline lama tidak boleh rusak.
- Antrian transaksi offline `pos_transaction` pada device ini digabung dengan snapshot server menggunakan kunci stabil. Ambil nama/detail dari receipt lokal dan request yang tersimpan; receipt lokal saja belum selalu memuat penanda jumbo, sementara request memuat `porsi`, sehingga parser harus memadukan keduanya dengan validasi shape, batas ukuran, dan escaping Svelte. Jangan memakai nomor `JUSxxxxx` dari localStorage sebagai primary key lintas device; gunakan nama pelanggan + identitas transaksi stabil untuk disambiguasi.
- Saat offline, sentuh Selesai/Buka lagi hanya dianggap berhasil setelah intent IndexedDB tersimpan; jika storage penuh/gagal, tetap pada status lama dan beri pesan. Intent untuk transaksi checkout yang belum tersinkron boleh berubah berulang di device: simpan **target terakhir**, bukan dua request saling berlomba. Setelah respons server diterima, hapus intent hanya bila versi/target intent yang dikirim masih sama; jangan hapus aksi Buka lagi yang terjadi saat Selesai sedang in-flight. Snapshot browser yang gagal/korup tidak boleh dibaca sebagai server sudah menerima penjualan.
- Saat koneksi pulih: replay checkout memakai idempotency lama -> terima respons server -> kirim target status (jika ada) dengan key yang sama -> konfirmasi/bersihkan intent. Jika checkout gagal 428/409, status tetap lokal dan butuh review, **jangan** menyatakan penjualan server selesai; jika status gagal sesudah checkout sukses, transaksi tidak dikirim ulang dengan key berbeda dan intent tetap tertahan untuk retry. Intent status dari transaksi online juga disinkronkan lewat jalur yang sama. Uji crash di tiap sela, response checkout hilang sesudah commit, timeout sesudah status commit, duplicate retry, dan operasi server yang berbeda saat offline (409 + refresh/review, jangan menimpa).
- Jangan menandai otomatis Selesai hanya karena kasir menutup sesi toko atau pelanggan membayar. Antrean lokal belum sync tidak boleh ditampilkan di device lain.
- PWA: `vite.config.ts` hanya cache navigasi `/pos`; `auth/offlineSession.ts`/`utils/authGuard.ts` hanya izinkan POS saat offline. Perluas secara **terbatas** untuk `/antrean` dengan sesi offline valid + warm-up online dan cache navigasi route yang tidak berisi respons API/data privat. Jangan cache respons GET `/api/antrean` lintas user/cabang di service worker; data lokal berada di IndexedDB ber-scope.

### 2.3 Archive, restore, dan void

- `archiveUseCase.ts` memakai `SELECT * FROM buku_kas` dan guard manifest revision. Status persiapan ikut snapshot arsip. Preview harus menampilkan jumlah pesanan `pending` dalam cutoff sebagai blocker; eksekusi menolak 409 yang jelas. Penolakan wajib diuji **sebelum upload** dan di guard klaim finalisasi **dalam batch**: bila status berubah saat upload, tidak boleh ada ledger yang terhapus. Pesanan selesai masih dapat diarsipkan seperti biasa.
- `scripts/restore-archive-lib.mjs`: tambahkan kolom status/revision persiapan/waktu/aktor ke field restore dan pemeriksaan paritas bisnis; snapshot versi lama tanpa field baru memakai default legacy (`NULL`, revision 0), tanpa menciptakan kartu pending. Normalisasi `preparation_revision` legacy yang hilang menjadi 0 pada preflight maupun INSERT; jangan membuat nilai `NULL` untuk kolom NOT NULL. Perluas validasi pasangan status–waktu–aktor dan preflight konflik. Restore lama/baru tetap utuh dan idempoten.
- Void pada `transaksiKasirService.ts` menghapus detail/header dalam batch. Karena status ada di header, kartu otomatis hilang. Uji void pending, void done, serta race void vs Selesai/Buka lagi tanpa mengubah mutasi stok/agregat. Hindari tabel status terpisah yang meninggalkan orphan setelah void/arsip.

## 3. Peta file dan perubahan yang direncanakan

1. `docs/ANTREAN-PESANAN-IMPLEMENTATION-PLAN.md`: kunci keputusan, acceptance matrix, release/rollback; koreksi jika desain berubah.
2. `src/lib/database/schema.ts`, `drizzle/0035_*.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/manifest.json` (nama final sesuai urutan nyata): tambah kolom/check/index aditif, update manifest checksum, tes migrasi pada fresh + schema produksi yang telah diaudit. Jangan edit SQL migrasi lama.
3. `src/lib/server/checkout/statementBuilder.ts`: tulis `pending` bersamaan dengan header checkout; tes batch rollback, retry, quote, stok.
4. `src/lib/server/orderQueue/` (mis. `repository.ts`, `useCase.ts`, `types.ts`): query count/list header + detail snapshot per cabang; CAS transisi, normalisasi data dan konflik; modul baru fokus satu domain, bukan duplikasi checkout. Nama folder akhir boleh `antrean/` jika mengikuti konvensi lokal.
5. `src/routes/api/antrean/+server.ts`, `src/routes/api/antrean/status/+server.ts`: route tipis GET/POST/PATCH sesuai kontrak dipilih; auth, parse, delegasi, respons. Jangan import `schema`/Drizzle dari route baru.
6. `src/lib/server/realtimePublisher.ts`, `src/lib/realtime/realtimeManager.ts` (hanya bila perlu): gunakan satu event tabel yang jelas, mis. `buku_kas` update/insert/delete; prefer event existing, tidak membangun channel baru. Subscribe/refetch count dan list.
7. `src/lib/auth/offlineSession.ts`, `src/lib/utils/authGuard.ts`, `src/routes/api/session/+server.ts`, `src/lib/auth/auth.ts`, `vite.config.ts`: tambah cabang ke sesi offline tervalidasi, izinkan dan warm-up route Antrean; cegah cache data privat lintas user.
8. `src/lib/utils/idbStores.ts`, modul lokal baru mis. `src/lib/utils/orderQueueLocal.ts`, `src/lib/services/offlineSync.ts`, `src/lib/utils/offlineQueue.ts` **hanya jika perlu kompatibilitas**: snapshot+intent Antrean durable, merge dedup, checkout-sebelum-status, retry dan failure path; pertahankan queue v2 lama.
9. `src/lib/services/orderQueueService.ts`, `src/lib/stores/orderQueueState.svelte.ts`: client typed fetch/CSRF, loading/refetch, badge, pending count per cabang, cleanup listener; satu orchestrator bersama navbar dan halaman.
10. `src/routes/antrean/+page.svelte`, `src/lib/components/shared/bottomNav.svelte`, `src/routes/pos/bayar/+page.svelte`, `src/lib/stores/bayarState.svelte.ts`: halaman, urutan navbar 7/5, tombol modal sukses, respons error/empty/offline. `src/routes/+layout.svelte` hanya bila perlu konsumsi state badge; aturan `showNav` Pengaturan tidak diubah.
11. `src/lib/server/archiveUseCase.ts`, `scripts/restore-archive-lib.mjs`, `docs/OPERATOR-RUNBOOK.md`, `README.md`: guard arsip dan restore status; petunjuk operasi, migrasi, smoke, dan penggunaan staf.
12. `src/tests/antrean-tests.ts`, `e2e/antrean.spec.ts`, `src/tests/offline-pos-tests.ts`, `src/tests/migration-matrix-tests.ts`, `src/tests/tenant-scope-tests.ts`, `src/tests/archive-restore-tests.ts`, `src/tests/archive-guard-tests.ts`, `e2e/stock-policy.spec.ts`, `package.json`, `.github/workflows/ci.yml`: tes perilaku asli, script `test:antrean` di `test:unit` + step CI; E2E otomatis ikut `test:e2e:all`. Update tes lama sesuai kontrak baru tanpa mengurangi assertion/skip.

Peta adalah daftar sasaran, bukan izin merombak semua file sekaligus. Periksa path dan caller aktual sebelum mengedit; bagi implementasi menjadi perubahan/commit atomik per tujuan sesuai `AGENTS.md`.

## 4. Urutan eksekusi dan exit criteria tiap fase

### Fase A — spesifikasi dan tes merah

1. Bekukan payload API, model status, keputusan penamaan, default legacy, halaman UI, dan perilaku offline/arsip.
2. Tambah tes deterministik untuk transisi/revision, checkout -> satu kartu, izolasi cabang, data snapshot, navigasi, offline intent, migrasi fresh, dan restore. Gunakan tes terhadap handler/service asli, bukan hanya regex file.
3. Jalankan tes terarah: gagal karena fitur belum ada, bukan karena fixture rusak. Catat exit code.

**Selesai A bila:** test yang akan melindungi kasus utama terbukti merah beralasan, kontrak tidak ambigu, tidak ada implementasi lama yang perlu dihapus.

### Fase B — database dan server online

1. Tambah migrasi aditif dan schema; jalankan semua migrasi fresh, index/check/CAS di SQLite dan D1/workerd. Inspeksi schema remote sebelum menulis prosedur migrasi produksi; jangan anggap production sama dengan fresh DB.
2. Tulis status pending di batch checkout yang sama; implementasikan query count/list dan dua transisi di use case/repository branch-scoped.
3. Tambah GET dan mutasi API dengan auth/role/CSRF; event realtime post-commit; hubungkan void/arsip/restore, termasuk konflik arsip saat status berubah.

**Selesai B bila:** checkout sukses persis satu pending, retry tidak ganda; status berubah idempotent, stale ditolak, tidak ada mutasi uang/stok; pending arsip mencegah deletion, completed archive+restore mempertahankan status.

### Fase C — offline dan lintas sesi

1. Perbaiki kontrak session cabang tanpa merusak caller lama; validasi snapshot offline dan rute PWA.
2. Tambahkan snapshot + intent status durable di IndexedDB, merge dengan transaksi pending lokal; panggil sync pada koneksi pulih dan dari jalur retry yang sudah ada.
3. Reconcile idempotency, hapus intent hanya sesudah acknowledgment; hindari data lintas cabang/user dan hilangnya antrean ketika reload.

**Selesai C bila:** sekali checkout offline lalu Selesai/Buka lagi tetap tampil benar setelah reload, sinkron tepat sekali, tidak muncul ganda; dua jenis kegagalan (checkout/status) tetap dapat dipulihkan tanpa sukses palsu.

### Fase D — halaman, navbar, badge

1. Buat halaman Antrean mengikuti pola Svelte 5 runes; bagi komponen hanya saat reuse/kompleksitas nyata. Ambil GET dari service, subscriber realtime/refetch, cache offline ter-scope.
2. Navbar 7/5 mengikuti policy dan mempertahankan hero Kasir center. Tambah badge angka pending, tanpa mencampur badge keranjang atau banner transaksi offline.
3. Tambah Lihat Antrean di modal sukses dan akses via back Kasir; pertahankan halaman Pengaturan, struk, harga, dan PIN yang tidak terkait.

**Selesai D bila:** alur staf dapat dilakukan dengan satu device, satu ketuk pindah Kasir–Antrean, Selesai/Buka lagi mudah disentuh, tidak ada overflow/label saling tindih pada viewport uji.

### Fase E — regresi, dokumentasi, dan kesiapan rilis

1. Jalankan matriks §5, pemeriksaan penuh §6, tinjau diff/rahasia/scope, perbarui README dan runbook sesuai perilaku yang benar-benar lolos.
2. Berikan panduan migrasi **schema-first**: backup+verify tiga shard, preflight schema per binding, apply migrasi baru per shard, verifikasi hasil, baru app baru/artifact CI. Tidak melakukan migrasi dari build/deploy. Jika app baru tanpa kolom, checkout bisa gagal; cegah lewat gate rollout dan verifikasi sebelum rilis.
3. Rollback aplikasi tidak otomatis mengembalikan schema D1. Kolom aditif boleh tetap ada saat rollback ke kode lama; transaksi yang dibuat versi lama berstatus legacy `NULL` sampai fitur aktif lagi. Tidak ada downgrade destruktif; restore dari backup hanya prosedur operator sesuai runbook. Smoke tiap cabang dan device kios, catat batas bukti.

**Selesai E bila:** semua gate relevan hijau dengan exit code, diff bersih, bukti pada commit yang sama di CI remote bila rilis diusulkan, migrasi/rollback/smoke terdokumentasi. Jangan menyebut selesai produksi dari tes lokal saja.

## 5. Matriks tes dan hasil wajib

- **Q01 — migrasi fresh + schema lama dengan POS/legacy:** kolom/check/index ada; baris lama `NULL`, jumlah/nominal/receipt tidak berubah; `PRAGMA quick_check=ok`; D1/workerd cocok.
- **Q02 — checkout tunai + QRIS, jumbo/reguler/add-on/custom, policy stok dua mode:** tepat satu header `pending`, detail snapshot sesuai commit; saldo, stok/HPP, summary, receipt tetap sama dengan baseline.
- **Q03 — checkout invalid/DB batch gagal, quote basi:** tidak ada status tanpa penjualan; seluruh batch rollback; tidak ada sukses UI palsu.
- **Q04 — retry dua request checkout bersamaan dan replay key sama vs fingerprint beda:** satu sale/satu kartu; fingerprint beda tetap 409 tanpa mutasi.
- **Q05 — GET daftar/count, nama katalog diubah, POS kemarin, manual/legacy:** snapshot original; tertua dulu lintas hari; completed terbaru dulu; manual/legacy diabaikan; pagination tanpa ganda/hilang.
- **Q06 — POST Selesai, ulang, Buka lagi, ulang, dua request bersamaan:** status/aktor/waktu/revision sesuai transisi terakhir sah; retry target sama no-op; stale lawan 409 tanpa perubahan finansial.
- **Q07 — auth/role/cabang/CSRF/payload:** 401 anonim; 403 role tak sah (termasuk `admin` bila tidak diberikan akses eksplisit) dan lintas cabang (termasuk cabang berbagi binding); CSRF invalid 403; body invalid 400; tidak bocor data/metadata tenant.
- **Q08 — realtime down, request timeout sesudah commit:** server commit tetap sah; refetch memulihkan badge/list; retry idempotent; tidak melaporkan gagal jualan karena DO gagal.
- **Q09 — void pending/done dan race void vs status:** kartu terhapus hanya bila void sukses; void stok/agregat/marker benar; transisi ke row void ditolak.
- **Q10 — arsip pending cutoff, perubahan status saat R2 upload, completed archive, restore lama/baru:** preview menunjukkan blocker; eksekusi pending -> 409 tanpa delete; race -> guard menolak tanpa partial delete; completed tersimpan/restore dengan status dan metadata benar; arsip lama tetap bisa restore tanpa pending palsu.
- **Q11 — offline fresh dengan katalog hangat, POS tunai -> Selesai/Buka lagi:** local tersimpan, detail termasuk jumbo/topping, label belum sync; reload `/antrean` tetap bisa diakses dengan sesi valid; offline QRIS tetap ditolak.
- **Q12 — offline checkout sukses tetapi sync status gagal; response checkout hilang; 428 review:** intent tidak hilang, jumlah penjualan tetap satu, offline status tidak diklaim server selesai, penyelesaian retry setelah masalah selesai.
- **Q13 — Antrean online lama dicache -> internet putus -> Selesai/Buka lagi -> pulih:** intent persisted; server ter-update sekali; kartu tidak kembali pending sesaat karena refetch/realtime; konflik server disampaikan jelas.
- **Q14 — session/branch/logout, cache legacy/corrupt, storage penuh:** data tenant lain tidak tampil, cache salah sesi tidak dipakai; pending sale tidak dihapus diam-diam; storage gagal tidak memalsukan sukses.
- **Q15 — navbar mode stok aktif/nonaktif, 320/360/390/tablet, Pengaturan:** urutan 7/5 tepat, Kasir center <=2px, Catat tetap, Atur via Beranda saat stok off, back Pengaturan dan showNav tidak berubah, tidak overflow/overlap.
- **Q16 — E2E browser D1 terisolasi, transaksi nyata sampai selesai:** login -> checkout -> Lihat Antrean -> Selesai -> reload -> Buka lagi -> Kasir; badge konsisten, satu kartu, cleanup semua data/sesi temporer.

Tes API negatif harus menjalankan handler sesungguhnya; concurrency/migrasi jalankan pada SQLite **dan** D1/workerd `--d1` untuk kasus yang menulis ledger. Tes offline memakai IndexedDB/PWA browser asli untuk ketahanan reload, bukan hanya memanggil fungsi normalisasi. Semua waktu dalam tes dibekukan; jangan menambah skip atau retry buta agar lolos.

## 6. Gate, evidence, dan Definition of Done

Perintah lokal yang relevan, catat exit code per perintah:

```powershell
rtk pnpm test:antrean
rtk pnpm test:offline
rtk pnpm test:pos-integrity
rtk pnpm test:tenant-scope
rtk pnpm test:migration-matrix
rtk pnpm test:archive-restore
rtk pnpm test:archive-guard
rtk pnpm exec tsx src/tests/antrean-tests.ts --d1
rtk pnpm check
rtk pnpm lint
rtk pnpm test:unit
rtk pnpm test:operations
rtk pnpm build
rtk pnpm deploy:check
rtk pnpm test:e2e:all
rtk git diff --check
```

`rtk pnpm test:antrean` dan suite `--d1` baru tersedia **setelah** fase tes dibuat. Pastikan runner D1 non-production terisolasi dan cleanup aman; jangan menjalankan `d1:setup:local --fresh` terhadap state dev. Jika perubahan menyentuh batas rilis, `test:release`, artifact manifest, dan CI remote pada SHA yang sama mengikuti runbook.

**Definition of Done — semua wajib:**

- [ ] Kontrak §1–2 disetujui dan ditautkan ke tes merah beralasan; tidak ada backfill tanpa keputusan.
- [ ] Query, badge, status, offline intent, dan cache hanya untuk cabang/sesi berwenang; GET/POST negatif, CSRF, dan payload error teruji.
- [ ] Checkout online/offline idempoten dan atomik; snapshot item stabil; **tidak** ada selisih uang/stok/HPP/summary/receipt setelah Selesai/Buka lagi.
- [ ] Dua status, undo, transaksi di-void, arsip/restore, retry/crash/realtime down, dan concurrency memenuhi Q01–Q16, termasuk workerd D1 dan browser offline.
- [ ] Antrean tetap operasional di satu device saat jaringan putus, termasuk reload setelah warm-up dan intent status yang gagal disinkron; pesan membedakan lokal vs server.
- [ ] Navbar 7/5 dan Pengaturan/back memenuhi keputusan pengguna; target sentuh/aksesibilitas dan viewport diuji.
- [ ] Tes baru terdaftar di `package.json`, `test:unit`, CI; semua gate §6 relevan exit 0, tanpa assertion diturunkan, skip, atau retry buta.
- [ ] Migrasi forward-only diverifikasi fresh+workerd dan diperiksa terhadap schema target; backup dan prosedur apply/rollback dicatat sebelum remote.
- [ ] `README.md`, runbook, dan kontrak error/API yang berubah tersinkron; diff direview untuk secret, scope creep, dan whitespace.
- [ ] Batas bukti ditulis jujur: lokal ≠ CI remote ≠ smoke perangkat kios/production. Commit terpisah per tujuan hanya jika diminta; rilis hanya setelah CI/artifact/smoke operator sesuai runbook.
