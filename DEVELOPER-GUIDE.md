# ZatiarasPOS — Developer Guide

Panduan teknis dan referensi domain arsitektur untuk tim pengembang (termasuk junior engineer).

---

## 1. Domain Glossary (Istilah Bisnis)

| Istilah                               | Definisi                                                                                                                                                                         |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cabang (`cabang_id`)**              | Unit operasional fisik independen (contoh: `samarinda`, `balikpapan`, `berau`). Seluruh data transaksi, kas, stok, dan gambar diisolasi per cabang.                              |
| **Bahan (`bahan`)**                   | Komponen mentah inventaris (contoh: gula, teh, cup, sedotan).                                                                                                                    |
| **Yield (`yield_persen`)**            | Persentase bahan mentah yang dapat digunakan secara efektif ($0 < \text{yield} \le 100\%$). Digunakan untuk menghitung HPP efektif.                                              |
| **HPP (`biaya_per_satuan`)**          | Harga Pokok Penjualan efektif = $\frac{\text{Harga Beli}}{\text{Jumlah Usable}}$, presisi 4 desimal.                                                                             |
| **Resep (`resep_produk`)**            | Komposisi bahan baku per varian porsi (`biasa`, `jumbo`) untuk satu produk.                                                                                                      |
| **Idempotency Key**                   | Kunci unik `(cabang_id, idempotency_key)` untuk memastikan 1 transaksi penjualan POS hanya dicatat 1 kali di ledger kas dan inventaris.                                          |
| **Receipt Snapshot**                  | Snapshot struk permanen (`buku_kas.receipt_snapshot`) yang dibentuk sekali saat transaksi berhasil, menjamin struk cetak ulang tidak berubah bila harga katalog kemudian diedit. |
| **Omzet Usaha (`omzetUsaha`)**        | Total omzet bruto operasional (penjualan POS + kas masuk kategori `pendapatan_usaha`). Menjadi dasar pengenaan PPh Final UMKM 0.5% (PP 55/2022).                                 |
| **Ambang Batas PPh (Threshold 500M)** | Fasilitas pembebasan pajak untuk omzet kumulatif tahunan $\le$ Rp 500 Juta per cabang.                                                                                           |
| **Outbox Log / Queue**                | Pola resilience untuk audit log & sinkronisasi offline (D1 outbox / IndexedDB queue).                                                                                            |

---

## 2. Alur Dependensi Arsitektur (Dependency Flow)

```text
Svelte Page / Component (UI)
   │
   ▼
Typed Store / Orchestrator ($lib/stores/*.svelte.ts)
   │
   ▼
Typed Client Service ($lib/services/*.ts)
   │
   ▼ (HTTP Fetch / CSRF Token)
API Route Boundary Validation (src/routes/api/*/+server.ts)
   │
   ▼
Domain Utilities & Helpers ($lib/utils/* & $lib/server/*)
   │
   ▼
Cloudflare Adapters (D1 via Drizzle, R2 Object Storage, Durable Objects Realtime)
```

---

## 3. Peta Alur Kritis (Critical Flow Maps)

### A. Alur Checkout POS (Kasir)

1. **Penyusunan Pesanan**: `posCart.svelte.ts` menghitung total item & opsi (biasa/jumbo/tambahan).
2. **Pembayaran (`/pos/bayar`)**: `bayarState.svelte.ts` memilih metode bayar & mengisi nominal uang tunai.
3. **Kirim Transaksi (`POST /api/pos/transaction`)**:
   - Validasi runtime `body.mode` (`'online'` atau `'offline_replay'`).
   - Baca `stock_policy` cabang: mode `ignored` melewati seluruh mutasi inventaris tetapi HPP tetap dihitung.
   - Replay offline membawa token epoch; replay basi dikarantina (HTTP 428) untuk review pemilik.
   - Cek `(cabang_id, idempotency_key)`: jika sudah ada, kembalikan `receipt_snapshot` lama tanpa mutasi ulang stok.
   - Deduksi stok bahan sesuai resep produk secara atomik.
   - Catat jurnal kas masuk di `buku_kas` & simpan `receipt_snapshot`.
   - Update agregat harian di `ringkasan_kas_harian`.
   - Simpan event `order_created` dalam batch D1 yang sama; idempotency tidak menciptakan event kedua. Metadata perangkat berada di luar fingerprint uang/struk.
4. **Cetak & Tampilan Struk**: Menggunakan `committedReceipt` yang diarsip permanen.

### B. Alur Transaksi Offline & Replay

1. **Deteksi Offline**: Saat offline, transaksi disimpan ke IndexedDB `pending-transactions`.
2. **Snapshot Struk Offline**: `bayarState.svelte.ts` membuat `committedReceipt` lokal sebelum cart dibersihkan.
3. **Replay Sinkronisasi**: Saat koneksi kembali, `offlineSync.ts` memutar ulang request dengan `mode: 'offline_replay'` dan `idempotency_key` asli.
   - Metadata asal disimpan bersama request; queue legacy memperoleh identitas profil saat replay. Snapshot receipt memakai `$state.snapshot` sebelum structured cloning IndexedDB.

### C. Alur Manajemen Menu & Resep

1. **Input Data**: Pemilik memasukkan nama produk, harga, kategori, dan resep bahan baku.
2. **Ekstraksi ID**: Menyimpan produk dan resep terhubung dengan `result?.data?.[0]?.id || result?.id`.
3. **Mutasi Stok Realtime**: Perubahan menu/bahan memicu broadcast event via `realtimeManager.ts`.

### D. Alur Pengarsipan Data (Archive)

1. **Preview**: `GET /api/archive` mengkalkulasi jumlah baris di bawah cutoff tanggal (WITA UTC+8).
2. **Eksekusi Snapshot**: Serialisasi transaksi terpilih ke format JSON unik di Cloudflare R2 (`arsip/<branch>/<year>/<uuid>.json`).
3. **Batch Deletion Anti-TOCTOU**: Menghapus baris dari D1 aktif hanya untuk exact ID yang telah terverifikasi tersimpan di snapshot R2 (chunked per 50 item).
4. **Restore**: Menggunakan script CLI [scripts/restore-archive.mjs](file:///d:/Projects/zatiaraspos/scripts/restore-archive.mjs).

### E. Alur Autentikasi & Otorisasi Peran (Auth Flow)

1. **Login Kasir / Pemilik (`POST /api/veriflogin`)**:
   - Rate limiting per IP dan per username.
   - Verifikasi hash password (PBKDF2/Argon2) against D1 database cabang terkait.
   - Validasi whitelist role ketat: hanya `'kasir'` dan `'pemilik'`.
   - Penerbitan HTTP-only cookie session dengan `SameSite=Lax`, `Secure`, `HttpOnly`.
2. **Boundary Gate (`hooks.server.ts` & `apiAuth.ts`)**:
   - `requireAuthSession(locals)`: Memeriksa integritas session ID.
   - `requireSessionBranch(locals, queryBranch)`: Mencegah user mengakses cabang selain yang diotorisasi.
   - `requireAnyRole(session.role, allowedRoles)`: Memblokir endpoint sensitif (contoh: hapus menu, laporan finansial, ubah PIN).
3. **Elevasi PIN Supervisor**:
   - Kasir memerlukan PIN pemilik (`POST /api/pin/verify`) untuk transaksi void, diskon manual, atau akses laporan ringkas.

### F. Alur Realtime Event Fanout (Realtime Flow)

1. **Penerbitan Event (Publish)**:
   - Backend mutasi memanggil `publish(branch, { table, action, id, data })`.
   - Menggunakan fanout multiplexer `realtimePublisher.ts` ke subscriber cabang terkait.
2. **Langganan Klien (Subscription)**:
   - Klien mendaftar melalui `realtimeManager.subscribe(table, callback)`.
   - Manager mencatat set subscriber per cabang tanpa bentrok lintas modul.
   - Mengembalikan closure disposer unik `() => void` untuk pembersihan aman saat komponen unmount.
3. **Pemberhentian Sambungan (Teardown)**:
   - Panggilan `unsubscribeAll()` hanya dieksekusi saat pergantian sesi atau window `beforeunload`.

### G. Alur Konfigurasi Pajak & Agregasi Laporan (Tax & Report Flow)

1. **Sinkronisasi Konfigurasi**:
   - Klien membaca konfigurasi cabang dari D1 melalui `/api/pengaturan/pajak`.
   - Migrasi otomatis dari key legacy jika belum tersinkronisasi.
   - State dikelola oleh `taxSettingsState.svelte.ts` dengan background auto-sync single-flight.
2. **Kalkulasi Pajak PP 55/2022**:
   - Laba kotor bukan dasar pengenaan pajak; pajak dihitung dari `omzetUsaha` (bruto operasional).
   - Ambang batas kumulatif YTD Rp 500.000.000 dihitung secara berurutan: omzet di bawah batas dikenakan 0%, omzet di atas batas dikenakan tarif efektif (default 0.5%).
3. **Agregasi Paritas Finansial**:
   - Laporan laba rugi menggabungkan data aktif dari `buku_kas` dengan ringkasan arsip `ringkasan_kas_arsip_harian` sehingga hasil laporan sebelum dan sesudah pengarsipan identik (100% parity).

### H. Notifikasi Pesanan Antrean

1. `orderNotifications/repository.ts` mencatat event cabang dalam checkout batch. Realtime hanya membangunkan pembaca feed cursor; monitor menghabiskan semua halaman, bukan menghitung kenaikan pending atau mempercayai payload WebSocket terakhir.
2. Registry perangkat global berada di `DB_SAMARINDA_GROUP`; event dan delivery berada di shard cabang masing-masing. UUID bukan kredensial: token perangkat di-hash, registrasi/rebind atomik, endpoint push hanya memiliki satu identitas aktif. Route tetap mewajibkan session, exact role kasir/pemilik, cabang, dan CSRF mutasi.
3. `orderNotificationLocal.ts` adalah state IndexedDB bersama page/SW: identitas, setting, feed cursor, push dedup, dan acknowledgement per perangkat. Push out-of-order tidak memajukan cursor feed. ACK pengguna melihat Antrean berbeda dari delivery ACK dan status persiapan pesanan.
4. `orderNotificationState.svelte.ts` memasang banner/audio pada root berizin. Mount/realtime/focus/online/session/SW memulihkan feed; timer lokal 5 detik bukan polling HTTP. Web Locks/lease membatasi pemilik audio antartab. Antrean tersembunyi atau tertutup PIN bukan acknowledgement.
5. `delivery.ts` berjalan best-effort setelah commit dan melalui cron satu menit, dengan lease CAS 60 detik, maksimal 8 percobaan, backoff 30 detik–1 jam, dan timeout provider 15 detik. Status 404/410 melepas subscription; role/session/source/ACK diperiksa kembali sebelum send. Event/delivery belum dipangkas otomatis; pekerjaan pending tidak dihapus diam-diam.
6. `src/sw.ts` menggantikan generateSW, tetap satu `/sw.js` dengan update prompt, cache navigasi POS/Antrean dan NetworkOnly untuk API. Push asli memiliki jalur notifikasi user-visible generik; duplicate/foreground meminta silent. Klik menuju Antrean melalui auth/PIN normal. Provider 201 bukan bukti operator melihat/mendengar; pesan in-flight tidak dapat ditarik kembali.

Keputusan dan batas: [ADR 0004](docs/adr/0004-antrean-notifications.md). Realtime umum tetap mengikuti ADR 0002.

---

## 4. Lokasi Aturan Kanonikal (Canonical Rule Locations)

| Domain Aturan                  | File Sumber Kanonikal                       | Baris / Fungsi Kunci                                        |
| :----------------------------- | :------------------------------------------ | :---------------------------------------------------------- |
| **Idempotensi & Fingerprint**  | `src/routes/api/pos/transaction/+server.ts` | `computeTransactionFingerprint`, `getExistingByIdempotency` |
| **Pencegahan Fail-Open POS**   | `src/routes/api/pos/transaction/+server.ts` | `body.mode === 'offline_replay'`, fail-closed signature     |
| **Validasi Yield & HPP**       | `src/lib/utils/unitConversion.ts`           | `calculateEffectiveHpp`, `reject cross-category`            |
| **Isolasi R2 per Cabang**      | `src/lib/server/r2ObjectPolicy.ts`          | `isPublicProductImageKey`, `extractBranchFromProductKey`    |
| **Fanout Realtime Multi-Sub**  | `src/tests/realtime-fanout-tests.ts`        | `RealtimeChannelManager`, individual disposer pattern       |
| **Kalkulasi Pajak PP 55/2022** | `src/lib/services/taxService.ts`            | `calculateTaxes`, `calculateReportTaxMetrics`               |
| **Konsistensi Migrasi D1**     | `drizzle/meta/manifest.json`                | Checksum SHA-256 seluruh migrasi SQL kanonikal              |

---

## 5. Catatan Verifikasi Uji Independen (Independent Review & Evidence)

- Seluruh 28 task perancangan diverifikasi menggunakan test behavioral tanpa mengandalkan mock regex mentah (`readFileSync`).
- Total 13 berkas test pengujian (`src/tests/`) mencakup unit, integritas data POS, yield resep, paritas arsip, validasi migrasi, dan aksesibilitas focus trap.
- Pipeline `pnpm test:all` memvalidasi seluruh gerbang operasi, kualitas tipe data, dan fungsionalitas aplikasi.

---

## 6. Entry Point & Lokasi Uji (Test Entry Points)

| Kategori Pengujian                 | Perintah                                                                                | File Skrip Utama                                 |
| :--------------------------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------- |
| **Tipe Data & Diagnostik Svelte**  | `pnpm check`                                                                            | `svelte-check`                                   |
| **Formatting & Linting**           | `pnpm lint`                                                                             | `.prettierrc`, `eslint.config.js`                |
| **Unit & Hardening Test**          | `pnpm test:unit`                                                                        | `src/tests/*-tests.ts`                           |
| **Kalkulasi Yield & HPP**          | `pnpm test:yield`                                                                       | `src/tests/ingredient-yield-tests.ts`            |
| **Kalkulasi Pajak PP 55/2022**     | `pnpm test:tax`                                                                         | `src/tests/tax-calculation-tests.ts`             |
| **Aksesibilitas & Focus Trap**     | `pnpm test:a11y`                                                                        | `src/tests/a11y-focus-tests.ts`                  |
| **Realtime Fanout Multi-Sub**      | `pnpm test:realtime`                                                                    | `src/tests/realtime-fanout-tests.ts`             |
| **Matriks Integritas Migrasi**     | `pnpm test:migration-matrix`                                                            | `src/tests/migration-matrix-tests.ts`            |
| **Operasi D1 Backup & UAT Safety** | `pnpm test:operations`                                                                  | `scripts/d1-backup.test.mjs`                     |
| **Playwright Browser E2E**         | `pnpm test:e2e:pos`                                                                     | `e2e/pos.spec.ts`                                |
| **Notifikasi Antrean SQLite/D1**   | `rtk pnpm test:antrean-notifications` / `rtk pnpm test:antrean-notifications -- --d1`   | `src/tests/antrean-notification-tests.ts`        |
| **Notifikasi Antrean Browser**     | `rtk pnpm exec node scripts/run-playwright-local.mjs e2e/antrean-notifications.spec.ts` | `e2e/antrean-notifications.spec.ts`              |
| **Verifikasi Menyeluruh Kualitas** | `pnpm test:quality`                                                                     | `src/tests/code-quality-tests.ts`                |
| **Production Build**               | `pnpm build`                                                                            | `vite.config.ts`, `@sveltejs/adapter-cloudflare` |

---

## 7. Jebakan Umum Pengembang (Common Developer Traps)

1. ⚠️ **Jangan gunakan `(window as any).__refreshXxx`**: Gunakan `refreshBus` dari `$lib/utils/refreshBus`.
2. ⚠️ **Jangan panggil `unsubscribeAll()` pada lifecyle komponen**: `realtimeManager.subscribe(table, cb)` mengembalikan fungsi `dispose()`. Panggil `dispose()` pada `onDestroy` / `$effect` teardown.
3. ⚠️ **Jangan hitung pajak dari laba kotor**: Sesuai PP 55/2022, PPh Final UMKM dihitung dari `omzetUsaha` (bruto) setelah memperhitungkan threshold Rp 500 Juta kumulatif tahunan.
4. ⚠️ **Jangan gunakan `result.id` secara naif**: Respon mutation D1 dari backend membungkus data dalam array; selalu gunakan helper `result?.data?.[0]?.id || result?.id`.
5. ⚠️ **Jangan hardcode URL upload R2**: Selalu gunakan namespace per cabang (`produk/<branch>/<uuid>.<ext>`) agar tidak terjadi konflik lintas cabang.

---

## 8. Standar & Konvensi Kode (Engineering Conventions)

### A. Svelte 5 Runes Only

- Seluruh komponen wajib menggunakan runes: `$state()`, `$derived()`, `$effect()`, `$props()`, `$bindable()`.
- Dilarang menggunakan store Svelte 4 (`writable()`, `$store`) untuk state baru.
- Dilarang reassign ke ekspresi `$derived`.

### B. Format Uang & Tanggal

- Uang: Wajib menggunakan `$lib/utils/currency` (`formatRupiah`, `parseRupiah`).
  - Tampilan: `Rp {formatRupiah(nominal)}` (prefix "Rp " di markup, angka diformat util).
  - Dilarang `x.toLocaleString('id-ID')` secara inline.
- Tanggal: Wajib menggunakan `$lib/utils/dateTime` untuk standarisasi zona waktu WITA (UTC+8).

### C. Kontrak API Server (2-Tier Architecture)

- **Tier A (Resource Routes / CRUD default)**:
  - Sukses: `{ ok: true, data }` atau list `{ items, nextCursor }`.
  - Error: `throw kitError(status, message)` (`@sveltejs/kit`).
- **Tier B (Auth & Telemetri - `csrf`, `veriflogin`, `security-events`, `aichat`)**:
  - Error/Status: `json({ success, code, message })` — field `code` wajib dipertahankan karena dikonsumsi client untuk mekanisme retry (mis. CSRF token refresh).

### D. Cetak Struk

- Cetak struk POS dan riwayat wajib melewati `$lib/utils/receiptPrint` (`buildReceiptHtml`, `printViaIntent`).

### E. Error Handling Frontend

- Tangani error via `$lib/utils/errorHandling` (`ErrorHandler.extractErrorMessage(e)`, `getApiErrorMessage(res)`).
- Dilarang `catch {}` tanpa logging atau fallback yang aman bagi user.

---

## 9. Operasional & Prosedur Backup D1

### A. Backup Production (3 Shard D1)

- Jalankan backup terisolasi (output di luar repo):
  ```bash
  pnpm d1:backup -- --output-dir D:\ZatiarasPOS-Backups --env-file .env
  ```
- Verifikasi manifest SHA-256 hasil backup:
  ```bash
  pnpm d1:backup -- --verify-manifest D:\ZatiarasPOS-Backups\<run-id>\manifest.sha256.json
  ```
- Status valid hanya jika file `COMPLETE` terbit dan seluruh 3 database grup (Samarinda, Balikpapan, Berau) lolos verifikasi.

### B. Prosedur Restore Terkendali

- Restore bersifat destruktif dan memerlukan konfirmasi environment explicit:
  ```bash
  CONFIRM_D1_RESTORE=<binding> pnpm d1:restore -- --database <binding> --file <backup.sql>
  ```

### C. Release & Artifact (Provenance)

- Rilis hanya dari branch `main`/`release/*` dengan working tree bersih dan `RELEASE_COMMIT_SHA` = HEAD.
- Gerbang penuh operator (jalankan `test:release` + tulis manifest):
  ```bash
  RELEASE_COMMIT_SHA=<sha> pnpm deploy:preflight
  ```
- Verifikasi ulang tanpa rebuild (dipakai workflow Deploy sebelum Pages/realtime):
  ```bash
  RELEASE_COMMIT_SHA=<sha> pnpm deploy:verify
  ```
- Manifest `build-artifacts.json` (gitignored) mengikat commit SHA, versi Node/pnpm, checksum `wrangler*.jsonc`, checksum `drizzle/meta/manifest.json` + `_journal.json`, dan SHA-256 seluruh file `.svelte-kit/cloudflare`. Satu file berubah/hilang/tambahan = release ditolak.
- CI job **Build** mengunggah artifact `release-<sha>`; workflow **Deploy** (`workflow_dispatch`, environment `production`, default dry-run) mengunduh artifact itu, verifikasi manifest, lalu deploy tanpa rebuild.
- Migrasi D1 tidak pernah otomatis ikut app deploy; jalankan manual per binding sesudah backup (lihat Migrasi D1 di README).
- Deploy realtime + Pages tidak atomik: bila Pages gagal sesudah realtime sukses, catat deployment ID tiap target dan ikuti runbook rollback (dispatch SHA sebelumnya). Rollback Pages tidak mengembalikan schema D1.

---

## 10. Panduan Toko & Batasan Sistem (Operational Limits)

### A. Peran & Sesi Toko

- `kasir`: Wajib memiliki tepat 1 sesi toko aktif untuk checkout penjualan.
- `pemilik`: Akses laporan, katalog produk, audit void, dan transaksi darurat tanpa sesi toko.
- Buka toko dilakukan 1 kali per hari kerja sebelum kasir bertransaksi; tutup toko dilakukan saat akhir shift/hari setelah kas dicocokkan.

### B. Batasan Pembayaran & Offline

- **QRIS**: Hanya online. Verifikasi dilakukan manual via mutasi merchant/aplikasi resmi bank (belum settlement otomatis webhook).
- **Offline POS**: Hanya berlaku untuk pembayaran tunai di `/pos` dan `/pos/bayar`.
- **Warm-up**: Browser/PWA harus pernah dibuka saat online agar katalog dan kredensial tersimpan di IndexedDB.
- **Antrean Offline**: Disimpan lokal di IndexedDB dan otomatis dikirim bertahap saat koneksi pulih. Dilarang membersihkan cache/data browser sebelum antrean menjadi nol.
