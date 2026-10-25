# Perbaikan hasil review

Tanggal mulai: 24 Oktober 2026. `/code-review high 7263dd1f..main` (33 commit, 135
berkas, pekerjaan 22–24 Oktober) menghasilkan 10 kandidat temuan. Delapan sudah
dicek langsung di kode dan memang ada. Selain itu ada tiga masalah clean code.
Dokumen ini membagi perbaikannya menjadi kartu kecil yang bisa dikerjakan agen
yang lebih murah. Setiap kartu punya resep: berkas, pendekatan, tes, dan gerbang.

## Aturan kerja agent

Ikuti "Aturan kerja agent" nomor 1–10 di
[`FRONTEND-CONSISTENCY.md`](FRONTEND-CONSISTENCY.md) persis. Ada empat perbedaan:

1. ID kartu memakai `R<n>`. Subjek commit diakhiri ID itu, contoh
   `fix(pin): tahan selisih jam perangkat (R1)`. Hash kartu dicari lewat
   `git log --grep='(R1)'`.
2. Tidak ada metrik ratchet di dokumen ini. `pnpm test:frontend-consistency` hanya
   wajib bila kartu menyentuh berkas `.svelte`.
3. R1 boleh mengubah respons `/api/pin/verify`, karena hanya menambah field dan
   tidak mengubah otorisasi. Selain itu, perubahan yang menyentuh otorisasi server
   tetap berhenti dan ditanyakan ke pemilik.
4. Deploy staging dilakukan di akhir grup A dan akhir grup B, bukan per kartu.

## Kartu

Status: Todo, Sedang, Selesai, Tertahan. Model = model terendah yang cukup.

| ID  | Judul                                                | Model  | Status  | Bergantung |
| --- | ---------------------------------------------------- | ------ | ------- | ---------- |
| R0  | Tracker ini                                          | Opus   | Selesai | –          |
| R1  | PIN tahan selisih jam perangkat                      | Sonnet | Selesai | –          |
| R2  | PIN terkunci lagi saat habis, `PIN_REQUIRED` sinkron | Sonnet | Selesai | R1         |
| R3  | Fallback nama toko di struk                          | Haiku  | Selesai | –          |
| R4  | Server lokal: tutup setelah terkirim = sukses        | Sonnet | Selesai | –          |
| R5  | Order offline langsung Diproses                      | Sonnet | Selesai | –          |
| R6  | Gagal simpan nama printer tidak menggagalkan cetak   | Haiku  | Selesai | –          |
| R7  | Cek overflow kontrol Antrean                         | Haiku  | Selesai | –          |
| R8  | Arsip menyimpan `preparation_started_at`             | Sonnet | Selesai | P3         |
| R9  | Buang kode mati `EscPosBuilder`                      | Haiku  | Selesai | –          |
| R10 | Sederhanakan `raster()`                              | Sonnet | Selesai | R9         |
| R11 | Tes PIN tanpa `networkidle`                          | Sonnet | Selesai | –          |
| R12 | Selidiki GET status PIN yang datang terlambat        | Sonnet | Selesai | R11        |

Grup **A** = R1–R6 (bug), lalu staging. Pemilik menjalankan produksi dan P1.
Grup **B** = R7, R9–R11 (perapian, perilaku tidak berubah), lalu staging.
Urutan di grup A: R1 sebelum R2, sisanya bebas.

### Resep

**R1 PIN tahan selisih jam perangkat.**
`src/lib/services/pinAccessService.ts` membandingkan `expiresAt` dari jam server
dengan `Date.now()` perangkat, di `verifyPagePin` (syarat `ok`) dan
`refreshPinAccess`. Kalau jam perangkat lebih cepat 60 detik atau lebih, PIN
yang benar ditolak dan kasir tidak bisa membuka halaman.

- **Server** (`src/routes/api/pin/verify/+server.ts`): GET dan POST menambah
  `expiresInMs: Math.max(0, expiresAt - Date.now())`, dengan `expiresAt` 0
  menghasilkan 0. Jangan ubah `getPageUnlockExpiresAt` atau `requirePageAccess`
  di `src/lib/server/pageAccess.ts`.
- **Klien:**
  - Tipe `PinVerificationResult` menambah `expiresInMs?: number`.
  - Buat satu helper lokal di berkas yang sama. Bila `expiresInMs` finite,
    helper mengembalikan `Date.now() + expiresInMs`, atau 0 bila nilainya ≤ 0.
    Bila tidak finite, helper memakai `expiresAt` apa adanya, untuk
    kompatibilitas selama deploy dan mock e2e lama.
  - Pakai helper itu di `refreshPinAccess` dan `verifyPagePin`. Syarat `ok` di
    verify memakai hasil helper.
- **Tes:**
  - `src/tests/pin-service-tests.ts` membandingkan respons dengan `deepEqual`
    (sekitar baris 305, 318, 319, 345, 353, 361, 374). Tambahkan `expiresInMs`
    yang sesuai ke semuanya.
  - E2E baru di `e2e/security-settings.spec.ts`: mock POST `/api/pin/verify`
    mengembalikan `expiresAt` 120 detik di belakang jam halaman dan
    `expiresInMs: 60_000`. Dialog "Akses Terkunci" harus hilang.
- **Gerbang:** `pnpm check`, eslint dan prettier berkas yang diubah,
  `pnpm test:pin-service`, e2e `e2e/security-settings.spec.ts -g "PIN"`.

**R2 PIN terkunci lagi saat habis.**
`hasPinAccess()` di `src/lib/services/pinAccessService.ts` memakai `Date.now()`,
yang tidak reaktif, dan tidak ada timer. Setelah 60 detik halaman tetap terbuka.
Permintaan berikutnya dijawab server 403 `PIN_REQUIRED`, lalu ditelan diam-diam
(`src/lib/stores/laporanState.svelte.ts`, `if (isPinRequiredError(error)) return;`).
Kasir melihat angka lama tanpa pesan apa pun.

1. **Timer kedaluwarsa.**
   - Di `pinAccessService.ts`, buat `setPinAccess(next)` dan pakai di semua
     penulisan `pinAccess.value` di berkas itu.
   - Fungsi itu `clearTimeout` timer lama. Bila `next` ada dan berjalan di
     browser, ia menjadwalkan
     `setTimeout(..., Math.max(0, next.expiresAt - Date.now()))`.
   - Callback hanya mengosongkan `pinAccess.value` bila
     `pinAccess.value?.identity === next.identity` dan `expiresAt` sama. Jangan
     membandingkan objek dengan `===`, karena `$state` membungkus objek dalam proxy.
   - Layout (`src/routes/+layout.svelte`, effect yang mengisi `showPinModal`)
     sudah membaca `pinAccess.value` lewat `hasPinAccess`, jadi modal muncul sendiri.
2. **Sinkron saat server menolak.**
   - Di setiap caller `isPinRequiredError`, panggil `void refreshPinAccess()`
     sebelum `return`. Callernya: `laporanState.svelte.ts`,
     `src/routes/pengaturan/riwayat/+page.svelte`, dan
     `src/routes/pengaturan/kasir/riwayat/+page.svelte`.
   - `dashboardService.ts` juga melempar penanda `PIN_REQUIRED`. Cari caller yang
     menampilkan "Gagal memuat data dashboard" untuk galat itu, lalu perlakukan
     sama: tanpa toast, kemudian refresh.

- **Tes:** E2E baru di `e2e/security-settings.spec.ts` dengan pola
  `page.clock.install` dan `page.clock.runFor`. Contohnya ada di spec yang sama,
  tes yang memakai `page.clock.install({ time: … })`. Buka halaman terkunci,
  masukkan PIN, `runFor(60_001)`, lalu "Akses Terkunci" harus tampil tanpa navigasi.
- **Gerbang:** seperti R1, ditambah `pnpm test:unit`.

**R3 Fallback nama toko.**
`buildSaleReceiptData` di `src/lib/utils/receiptPrint.ts` memakai
`storeName: settings.nama_toko` tanpa fallback. Fallback itu hilang di
`a77d85ff`. Kolom `pengaturan.nama_toko` boleh NULL, dan baris dibaca lewat cast
tanpa validasi (`loadReceiptSettings`). Akibatnya `data.storeName.toUpperCase()`
di `src/lib/utils/receiptLayout.ts` bisa melempar TypeError dan cetak gagal.

- **Perbaikan:**
  `storeName: (settings.nama_toko ?? '').trim() || DEFAULT_RECEIPT_SETTINGS.nama_toko`,
  dengan komentar satu baris bahwa kolomnya nullable.
- **Tes:** di `src/tests/receipt-output-tests.ts`, `nama_toko` bernilai `null`
  (lewat cast) dan `'  '` menghasilkan `storeName` "Zatiaras Juice", dan
  `buildReceiptLayout` tidak melempar galat.
- **Gerbang:** `pnpm test:receipt-output`, `pnpm check`, eslint, prettier.

**R4 Server lokal: tutup setelah terkirim.**
`sendToLocalServerWs` di `src/lib/services/printerEngine.ts` memperlakukan
`onclose` sama dengan `onerror`. Server yang menutup socket kurang dari 25 ms
setelah menerima data dianggap gagal, padahal struk sudah tercetak. Kasir lalu
mencetak ulang dan struk jadi dobel.

- **Perbaikan:**
  - `socket.onerror = () => finish(sent ? uncertain() : undefined)`
  - `socket.onclose = () => finish(sent && socket!.bufferedAmount > 0 ? uncertain() : undefined)`
  - Komentar: browser tidak me-reset `bufferedAmount` saat close, jadi 0 berarti
    semua byte sudah keluar dari browser.
- **Tes:**
  - Di `exercisePrinter` (`e2e/security-settings.spec.ts`, kelas mock
    `PrinterSocket`), tambah mode `'flushed-close'`. Saat `send`, set
    `bufferedAmount = 10`, lalu di microtask set `bufferedAmount = 0` dan panggil
    `onclose`.
  - Tambahkan mode itu ke loop tes "receipt server handles …". Harapannya
    `error === ''`, `sockets === 1`, `messages === 1`, `wireParity === true`.
  - Mode `post-send` (lewat `onerror`) tetap berakhir "Periksa struk sebelum mencetak ulang".
- **Gerbang:** e2e `-g "receipt server"`, `pnpm check`, eslint, prettier.
- Kartu ini tidak menyelesaikan teks acak di metode 4 (lihat P2).

**R5 Order offline langsung Diproses.**
`buildLocalCardFromPending` di `src/lib/utils/orderQueueLocal.ts` membuat order
offline dengan `preparation_state: 'pending'` (Masuk). Sejak `7d022124`, server
menyimpan `preparation_started_at = createdAt` saat checkout
(`src/lib/server/checkout/statementBuilder.ts`, INSERT `buku_kas`). Nilai itu
ditampilkan sebagai `processing` (`src/lib/server/orderQueue/types.ts`).
Akibatnya order pindah tab setelah sinkron dan jumlah per tab berbeda.

- **Perbaikan:** ubah ke `'processing'`, dengan komentar yang merujuk statementBuilder.
- Sebelum mengubah, baca cara `src/routes/antrean/+page.svelte` dan
  `mergeQueueWithLocal` menangani kartu `unsynced`: tombol, tab, dan jumlah.
  Kalau ada logika yang mengandalkan `pending` untuk kartu unsynced, berhenti dan
  laporkan.
- **Tes:** di `src/tests/receipt-output-tests.ts`, pada kartu dari
  `buildLocalCardFromPending`, assert `preparation_state === 'processing'`.
- **Gerbang:** `pnpm test:receipt-output`, `pnpm test:antrean`, e2e `e2e/antrean.spec.ts`.

**R6 Gagal simpan nama printer.**
`savePrinterConfig` di `src/lib/services/printerEngine.ts` melempar galat bila
`localStorage` gagal. Fungsi itu dipanggil di jalur cetak, yaitu
`connectBluetoothPrinter` dan `connectUsbPrinter`, sehingga penyimpanan situs
yang diblokir membuat cetak gagal total.

- **Perbaikan:**
  - Bungkus dua pemanggilan `savePrinterConfig({ deviceName, method })` dengan
    `try { … } catch { … }` lokal.
  - Komentarnya: nama perangkat hanya kenyamanan, jadi gagal simpan tidak boleh
    menggagalkan cetak.
  - Di jalur USB, pastikan catch yang baru tidak ikut menutup perangkat.
  - `savePrinterConfig` sendiri tetap melempar galat, untuk halaman Pengaturan Printer.
- **Gerbang:** `pnpm check`, eslint, prettier, e2e `-g "receipt"`.

**R7 Cek overflow kontrol Antrean.**
Grid `.queue-controls` di `src/routes/antrean/+page.svelte` totalnya 100% ditambah
5%×(100% − 6rem), karena kolom tengah 1,05×. Lebar 1,05× itu permintaan pemilik
dan dikunci tes di `e2e/antrean.spec.ts` (`previousWidth * 1.05`).

- **Langkah:** di loop lebar viewport `e2e/antrean.spec.ts`
  (`for (const width of [320, 390, 600, 768, 1280])`), tambah
  `expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)`.
- Kalau lulus di semua lebar: commit tesnya saja, status Selesai, dan catat
  "tidak ada scroll horizontal, CSS tetap".
- Kalau gagal: jangan ubah CSS. Status Tertahan, lalu tanya pemilik.
- **Gerbang:** e2e `e2e/antrean.spec.ts`.

**R8 Arsip `preparation_started_at` (disetujui pemilik di P3).**
`ARCHIVE_BUKU_KAS_FIELDS` di `src/lib/server/archiveSnapshot.ts` tidak memuat
kolom itu. Order yang di-restore dan belum selesai akan kembali ke Masuk.
Memperbaikinya mengubah format arsip:

- `ARCHIVE_SCHEMA_VERSION` jadi 4.
- `SUPPORTED_ARCHIVE_VERSIONS` jadi `[1, 2, 3, 4]`.
- `BK_FIELDS` di jalur restore ikut diubah.
- Arsip v3 dibaca dengan nilai `null`.
- `src/tests/archive-version-tests.ts` diperbarui.

Dampaknya kecil. Pemilik menyetujui di P3 pada 25 Oktober 2026.

**R9 Buang kode mati `EscPosBuilder`.**
Sejak `a77d85ff`, struk selalu dikirim sebagai raster. Bagian berikut di
`src/lib/utils/escposBuilder.ts` tidak dipakai kode produksi: `text`, `line`,
`divider`, `twoColumn`, `bold`, `size`, `lineWidth`, `encoder`, `EscPosOptions`,
dan import `cleanReceiptText` serta `wrapReceiptText`.

- Cek dulu dengan Grep
  `\.(twoColumn|bold|size|line|divider|text)\(|lineWidth|EscPosOptions` di `src`
  dan `e2e`. Satu-satunya pemakai seharusnya blok `twoColumn` di
  `src/tests/receipt-output-tests.ts`.
- **Perbaikan:**
  - Hapus semua yang tercantum di atas.
  - Yang tersisa: `init`, `align`, `feed` (dipakai `cut`), `raster`, `feedDots`,
    `cut`, `toBytes`.
  - `buildReceiptEscPos` memakai `new EscPosBuilder()`.
  - Di tes, hapus hanya blok `twoColumn`. Assertion layout di loop yang sama tetap ada.
- **Gerbang:** `pnpm test:receipt-output`, `pnpm check`, eslint, prettier, e2e
  `-g "receipt renderer"` (`wireParity` harus tetap `true`).

**R10 Sederhanakan `raster()`.**
Loop bersarang di `raster()` (`src/lib/utils/escposBuilder.ts`) memanggil
`isBlank` berulang untuk baris yang sama.

- **Perbaikan:**
  - Hitung `blank = new Uint8Array(height)` sekali.
  - Pakai satu loop. Run kosong dengan panjang ≥ `MIN_FEED_ROWS` menjadi
    `feedDots`. Selain itu, band berjalan sampai run kosong panjang berikutnya,
    maksimal 128 baris.
  - Buffer `number[]` tetap, supaya konsisten dengan builder. Biayanya beberapa
    milidetik untuk sekitar 760 baris.
- **Bukti keluaran identik:** sebelum mengedit, jalankan skrip scratch (tidak
  di-commit) yang mencetak SHA-256 `buildReceiptEscPos` untuk bitmap tes yang ada
  (pola 257 baris, round-trip 700 baris, blank 600). Setelah mengedit, hash-nya
  harus sama persis.
- **Gerbang:** sama dengan R9.

**R11 Tes PIN tanpa `networkidle` (opsional).**
`settled()` di tes "cashier shares one PIN … fixed 60 seconds"
(`e2e/security-settings.spec.ts`) memakai `waitForLoadState('networkidle')`, yang
tidak disarankan dokumentasi Playwright.

- **Perbaikan:** catat request `/api/pin/verify` lewat `page.on('request')` dan
  `page.on('requestfinished')` / `page.on('requestfailed')`. Lalu tunggu sampai
  tidak ada request yang masih terbuka, dengan `expect.poll`.
- **Bukti:** `--repeat-each=10` lulus semua. Kalau tidak stabil, kembalikan
  perubahannya dan tutup kartu sebagai "tidak dikerjakan".

**R12 Selidiki GET status PIN yang datang terlambat.**
R11 gagal karena sesekali ada GET `/api/pin/verify` yang datang lebih dari 500 ms
setelah navigasi, saat tes sudah mengubah state mock. Dugaannya layout menjalankan
ulang `refreshPinAccess()` karena efek di `src/routes/+layout.svelte` bergantung pada
`pinAccessIdentity()` (membaca `userRole`, `userProfile`, `selectedBranch`) dan
`pinAccess.request`. Dugaan itu belum dibuktikan. Dugaan lain: transisi halaman
menahan klik. Kartu ini mencari pemicu sebenarnya sebelum mengubah apa pun.

- **Langkah 1, selidiki (tidak di-commit):** pasang pencatat sementara di
  `refreshPinAccess()` (`new Error().stack`), di efek layout (path, identity, ada
  tidaknya `request`), dan teruskan console halaman ke terminal di tes. Jalankan tes
  "fixed 60 seconds" minimal 6 kali. Catat pemicu tiap GET, termasuk pada ulangan yang lulus.
- **Langkah 2, putuskan:**
  - GET ulang tanpa perubahan identity atau path: perbaiki di layout supaya tidak
    memanggil ulang, dengan tes.
  - Pemicunya lain atau tidak bisa dihindari: tulis ulang tes dengan
    `page.clock.install` dan `runFor` seperti tes R2, tanpa `setFixedTime`.
- **Langkah 3:** kembalikan semua pencatat. Hapus `networkidle` hanya bila
  `--repeat-each=20` lulus semua.
- **Gerbang:** seperti R2, ditambah `pnpm test:frontend-consistency` bila `.svelte` berubah.

### Kartu pemilik

- **P1:** setelah grup A ada di produksi, tes cetak lewat metode 1 (BLE) di MTP-II
  dan JZ-MP250. Cek kecepatan, kejelasan huruf, jarak antar baris (`ESC J`), dan
  apakah cetak tersendat di jarak kosong.
- **P2:** data untuk teks acak di metode 4 (Server Lokal di PC Windows): nama dan
  versi program server, isi `server.json` (`PrintConnector.Type` dan `Params`),
  koneksi printer beserta driver Windows, dan foto hasil cetak.
- **P3:** setujui atau tolak R8. Disetujui pada 25 Oktober 2026.

## Verifikasi akhir

- `pnpm lint`, `pnpm check`, `pnpm test:unit`, dan `pnpm test:static` hijau di lokal.
- CI hijau di HEAD. Deploy staging sukses, `/login` dan `/api/csrf` di staging
  menjawab 200.
- **R1 dan R2:** e2e PIN yang baru lulus dengan `--repeat-each=5`.
- **R4:** mode `flushed-close` lulus, `post-send` tetap "Periksa struk".
- **R9 dan R10:** `wireParity` e2e tetap `true`, dan hash SHA-256 keluaran ESC/POS
  sama dengan sebelum refactor.
- `/code-review` pada rentang commit perbaikan tidak menemukan regresi baru.

## Menyerahkan ke agent

Sesi baru cukup diberi prompt ini:

> Baca `docs/REVIEW-REMEDIATION.md`. Kerjakan kartu berstatus Todo paling atas
> yang sesuai modelmu dan dependensinya sudah Selesai. Ikuti "Aturan kerja agent"
> persis, perbarui tracker (status dan Log), lalu berhenti dan laporkan. Jangan
> kerjakan kartu Tertahan.

## Log

- 24 Oktober 2026: R0 selesai. Tracker dibuat dari `/code-review high 7263dd1f..main`.
  Delapan temuan sudah diverifikasi di kode. Satu temuan (BLE tanpa jeda) masih
  berupa risiko yang menunggu P1. Satu temuan (performa `raster()`) dilebih-lebihkan
  dan dijadikan perapian di R10.
- 25 Oktober 2026: R1 selesai. `/api/pin/verify` (GET dan POST) menambah
  `expiresInMs`; klien memakai `localExpiresAt()` di `pinAccessService.ts`, dan
  tanpa `expiresInMs` jatuh ke `expiresAt` lama. Tes baru "device clock runs ahead
  of the server" gagal tanpa perbaikan dan lulus dengannya. `test:pin-service`,
  e2e `-g "PIN"`, `pnpm check`, eslint lulus.
- 25 Oktober 2026: R2 selesai. `pinAccessService.ts` punya satu penulis
  `setPinAccess()` yang memasang timer kedaluwarsa, jadi layout mengunci ulang
  saat 60 detik habis tanpa navigasi. `handlePinRequired()` (baru) menggantikan
  `isPinRequiredError` di `laporanState`, dua halaman riwayat, dan `dashboardState`
  (yang sebelumnya menampilkan "Gagal memuat data dashboard"); ia memanggil
  `refreshPinAccess({ fresh: true })`, karena request status yang sedang berjalan
  bisa membawa jawaban lama. Re-export `isPinRequiredError` di `riwayatService`
  dibuang (tidak dipakai). Dua tes e2e baru; yang kedua gagal tanpa perubahan
  `dashboardState` dan lulus 8/8 dengannya. `test:unit` 170 lulus.
- 25 Oktober 2026: R3 selesai. `buildSaleReceiptData` memakai
  `(nama_toko ?? '').trim() || DEFAULT_RECEIPT_SETTINGS.nama_toko`. Tes di
  `receipt-output-tests.ts` mencakup `null`, `undefined`, `''`, `'   '`, dan nama
  yang dipangkas; gagal di `nama_toko null` tanpa perbaikan.
- 25 Oktober 2026: R4 selesai. `onclose` di `sendToLocalServerWs` kini sukses bila
  `bufferedAmount` sudah 0; `onerror` tetap "Periksa struk". Mode e2e baru
  `flushed-close` gagal tanpa perbaikan dengan galat "Periksa struk sebelum
  mencetak ulang" (jalur cetak dobel) dan lulus dengannya; `pre-send` dan
  `post-send` tidak berubah. Teks acak di metode 4 tetap menunggu P2.
- 25 Oktober 2026: R5 selesai. `buildLocalCardFromPending` memulai kartu offline di
  `processing`, sama dengan server (`preparation_started_at` diisi saat checkout).
  Tab, jumlah, dan tombol Antrean semuanya diturunkan dari `preparation_state`,
  jadi tidak ada logika lain yang perlu diubah. `test:receipt-output`,
  `test:antrean`, dan seluruh `e2e/antrean.spec.ts` (28 tes) lulus.
- 25 Oktober 2026: R6 selesai. Helper privat `rememberPrinter()` di
  `printerEngine.ts` membungkus `savePrinterConfig` di jalur sambung Bluetooth dan
  USB; `savePrinterConfig` sendiri tetap melempar galat untuk halaman Pengaturan
  Printer (tes "report blocked storage" tetap lulus). Mode e2e `blocked-storage`
  (Bluetooth dan USB) gagal tanpa perbaikan dengan "Pengaturan printer tidak dapat
  disimpan" dan lulus dengannya. Semua 20 tes `-g "receipt"` lulus.
- 25 Oktober 2026: grup A (R1–R6) selesai di `main`. Berikutnya: deploy staging
  untuk grup A, lalu grup B.
- 25 Oktober 2026: CI grup A (`561c3aa0`) gagal di dua tes E2E, keduanya tes lama yang
  mengunci perilaku sebelum R2, bukan galat kode. (1) `dashboard-branch.spec.ts`
  mengharapkan pesan "Gagal memuat data dashboard" di balik layar PIN; R2 sengaja
  menghapusnya, jadi asersinya dibalik menjadi `toHaveCount(0)`. (2)
  `security-settings.spec.ts` "fixed 60 seconds" membekukan `Date` tetapi tidak
  `setTimeout`, sehingga sisa 1 ms membuat timer kedaluwarsa R2 menguncinya seketika.
  Sisa dibuat 50 detik, batas 59,999/60,000 ms diperiksa lewat `hasPinAccess()`, dan
  langkah pencabutan memakai `page.reload()` karena klik tautan terhalang transisi
  halaman. 10/10 lulus berurutan; dua spec penuh 42 tes lulus.
- 25 Oktober 2026: grup A di staging (`e417c29d`, deploy `40135010648`, `/login` dan
  `/api/csrf` 200). Produksi menunggu pemilik.
- 25 Oktober 2026: R7 selesai. Asersi `scrollWidth <= width` ditambahkan di loop lebar
  viewport `e2e/antrean.spec.ts` (320, 390, 600, 768, 1280). Lulus di semua lebar,
  jadi tidak ada scroll horizontal dan CSS `.queue-controls` tetap. Seluruh
  `antrean.spec.ts` (28 tes) lulus.
- 25 Oktober 2026: R9 selesai. `EscPosBuilder` kini hanya `init`, `align`, `feed`,
  `raster`, `feedDots`, `cut`, `toBytes`. Dibuang: `text`, `line`, `divider`,
  `twoColumn`, `bold`, `size`, `lineWidth`, `encoder`, `EscPosOptions`, dan impor
  `receiptLayout`. Satu-satunya pemakai di luar kelas adalah blok `twoColumn` di
  `receipt-output-tests.ts`, dan hanya blok itu yang dibuang. `pnpm check` 0 galat,
  `test:receipt-output` lulus, e2e `-g "receipt renderer"` (`wireParity`) 6 tes lulus.
- 25 Oktober 2026: R10 selesai. `raster()` menghitung `blankRun` (jumlah baris kosong
  berurutan dari tiap baris) sekali dengan satu pass mundur, lalu memakainya di loop
  maju; `isBlank` tidak lagi dipanggil ulang untuk baris yang sama. Bukti keluaran
  identik: skrip scratch (tidak di-commit) mencetak SHA-256 `buildReceiptEscPos` untuk
  153 bitmap (tiga pola dari tes, celah 1–600 baris di sekitar ambang 8, batas band
  128, dan batas `ESC J` 255, di 384 dan 576 px, serta 60 bitmap acak). TOTAL
  `bab3b745…2b349` sama sebelum dan sesudah. Mengubah batas band 128 menjadi 127
  membuat hash berbeda, jadi pembanding ini peka. `pnpm check` 0 galat,
  `test:receipt-output` dan e2e `wireParity` (6 tes) lulus.
- 25 Oktober 2026: R11 ditutup sebagai tidak dikerjakan. `settled()` diganti dengan
  pelacakan `request`/`requestfinished`/`requestfailed` untuk `/api/pin/verify`; 9 dari
  10 ulangan lulus, satu gagal (klik "Kios Tutup" terhalang kunci yang datang
  terlambat), jadi perubahan dikembalikan sesuai resep. Penyebabnya: yang perlu
  ditunggu adalah GET status yang dipicu ulang oleh layout saat store sesi berubah dan
  belum dimulai, sehingga menghitung request yang sedang berjalan tidak cukup.
  `networkidle` memberi jeda tenang yang dibutuhkan; tes tetap memakainya.
- 25 Oktober 2026: R12 selesai. Dugaan R11 ternyata separuh benar. Pencatat sementara
  (stack di `refreshPinAccess()`, nilai di efek layout) menunjukkan pada setiap muat
  penuh (goto, reload) efek PIN di `+layout.svelte` berjalan dua kali dengan path dan
  identity yang sama persis, selisih sekitar 150 ms, dan keduanya memanggil GET status.
  Jadi bukan identity yang berubah: ada dependensi yang terinvalidasi tanpa perubahan
  isi. Perbaikan: `pinIdentity` dan `pagePath` kini `$derived` (hanya memberi tahu efek
  saat nilainya berubah), dan `pinAccess.request` dibaca dengan `untrack`. Navigasi ke
  path lain tetap membaca status ulang. Tes baru "layout reads the PIN status once per
  page load and once per navigation": gagal 3 dari 3 tanpa perbaikan (GET 2 saat
  harusnya 1), lulus 5 dari 5 dengan perbaikan. Tes "fixed 60 seconds" lulus 20 dari 20.
  Percobaan kedua mengganti `networkidle` dengan pelacakan request gagal 1 dari 20
  karena GET yang dibatalkan `reload()` tidak pernah memicu `requestfinished` atau
  `requestfailed`, jadi penghitung bocor; `networkidle` dipertahankan di tes itu. Dua
  spec PIN penuh (43 tes), `pnpm check`, dan `test:frontend-consistency` lulus.
- 25 Oktober 2026: R8 selesai setelah pemilik menyetujui P3. Arsip kini versi 4:
  `ARCHIVE_BUKU_KAS_FIELDS` dan `BK_FIELDS` memuat `preparation_started_at`,
  `SUPPORTED_ARCHIVE_VERSIONS` menjadi `[1, 2, 3, 4]`, dan `validateDates` memeriksa
  kolom baru. Counts kini wajib mulai v3 (sebelumnya hanya `=== 3`, jadi v4 lolos
  tanpa counts). Arsip v3 yang sudah tersimpan tetap valid dan dipulihkan dengan
  `null`; versi 5 tetap ditolak. Tes baru di `restore-apply-tests.ts`: order belum
  selesai v4 mempertahankan waktu mulai, v4 tanpa kolom dan v3 menjadi `null`, dan
  tanggal rusak ditolak. Mutasi (kolom dibuang dari `BK_FIELDS`) membuat tes itu
  gagal. `test:unit` 170 lulus, `archive-*` dan `restore-*` lulus, e2e
  `archive-download.spec.ts` (5 tes) lulus, `pnpm check` 0 galat. Rollback: kode lama
  menolak arsip v4 lewat gerbang versi, jadi arsip yang ditulis setelah ini hanya bisa
  dipulihkan oleh kode v4.
- 25 Oktober 2026: grup A + B + R12 di produksi (`5acce7ee`, deploy `40157258231`),
  lalu R8 (`03762976`, CI `40157412376`) di staging (deploy `40158762620`) dan produksi
  (deploy `40160079245`). Di keduanya `/login` dan `/api/csrf` menjawab 200. Semua
  kartu selesai kecuali verifikasi pemilik P1 dan P2.
- 25 Oktober 2026: R11 dikerjakan ulang setelah R12. `settled()` di tes "fixed 60
  seconds" tidak lagi memakai `networkidle`; sisa pekerjaannya hanya menunggu
  `inFlight` (hitungan di handler route) kembali 0. Alasan boleh: percobaan R11 gagal
  karena GET kedua yang muncul sekitar 150 ms setelah muat, dan R12 sudah menghapusnya
  (dijaga tes "layout reads the PIN status once per page load and once per navigation").
  Tes lulus 30 dari 30 (`--repeat-each=30 --workers=1`), seluruh `security-settings.spec.ts`
  lulus (34 tes), eslint dan prettier bersih. `networkidle` di tes R12 sengaja dipertahankan:
  tes itu membuktikan ketiadaan GET, dan ketiadaan tidak punya kejadian untuk ditunggu.
