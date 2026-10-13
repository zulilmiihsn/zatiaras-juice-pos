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
   - Simpan event `order_created` dan intent audit checkout (`audit_log_outbox`) dalam batch D1 yang sama; idempotency tidak menciptakan event/intent kedua. Metadata perangkat berada di luar fingerprint uang/struk. Audit delivery memakai drain terjadwal; jangan enqueue intent hanya setelah commit atau retry pembayaran untuk memperbaiki audit. Realtime tetap best-effort/deferred lewat context atau bounded/cancellable fallback (ADR 0002).
4. **Cetak & Tampilan Struk**: Menggunakan `committedReceipt` yang diarsip permanen.

### A.1 Audit drain dan retensi teknis (AUD-051)

`auditEnvelope.ts`/`auditDrain.ts` adalah consumer/projection kanonik untuk manual drain dan scheduled backend Worker. Sink insert atau quarantine dan guarded exact-source delete ada dalam satu D1 batch; collision/outage mempertahankan intent, bukan overwrite/backfill tebakan. Timestamp sumber, amount0, actor dan metadata persisted terpelihara. Metadata baru dibatasi valid JSON; metadata source existing tidak ditruncate lagi saat delivery. Oversize/malformed dan valid source yang sudah lebih tua90hari masuk quarantine dengan bytes/timestamp asli untuk review.

- Existing minute/daily crons menjalankan audit drain; **retention hanya daily03:00UTC**. Retry scheduled eligible setelah `min(60min,2min×attempt_count)`, bukan retry counter berkali-kali per tick. Manual recovery menggunakan consumer yang sama dan dapat mencoba segera setelah repair.
- Page100, cap1000source rows/shard/tick dibagi sibling branches; source payload di Worker ≤65,536UTF8bytes dan mutation document ≤262,144bytes. Binary failure isolation dibatasi; shard/sibling priority berotasi agar head outage tidak memiliki semua tick.
- Default **40 audit+retention SQL statements/tick**, termasuk failed attempts; reserve32 untuk daily cleanup. `AUDIT_MAINTENANCE_QUERY_BUDGET` hanya boleh override integer1–900 setelah operator menyetujui plan/volume; invalid setting fallback40 dan dilaporkan. Ini bukan total relay/provider/Worker subrequest quota. Synthetic smoke900 tidak membuktikan production quota/latency/memory.
- Technical rows90hari, cleanup ≤100rows/table/branch/tick. Instant comparison mendukung SQL UTC legacy dan ISO offsets; exact boundary/unknown timestamp retained. Pending/leased/live POS order, ledger/receipt/archive/profile/catalog protected. Registry foreign-branch tombstones retained sampai desain cross-shard atomic/owner-ADR tersedia; advisory remote-read lalu delete dilarang.
- `rtk pnpm test:retention`, `rtk pnpm exec tsx src/tests/retention-tests.ts --d1`, `rtk pnpm test:scheduled-worker`, `rtk pnpm test:scheduled-compiled`. Compiled gate melakukan private backend Worker dry-run dan actual workerd scheduled controller, bukan imported handler/DO-only smoke atau staging cron/deployed artifact acceptance. Tidak memakai provider berbayar.

### B. Alur Transaksi Offline & Replay

1. **Deteksi Offline**: Saat offline, transaksi disimpan ke IndexedDB `pending-transactions`.
2. **Snapshot Struk Offline**: `bayarState.svelte.ts` membuat `committedReceipt` lokal sebelum cart dibersihkan.
3. **Replay Sinkronisasi**: Saat koneksi kembali, `offlineSync.ts` memutar ulang request dengan `mode: 'offline_replay'` dan `idempotency_key` asli.
   - Metadata asal disimpan bersama request; queue legacy memperoleh identitas profil saat replay. Snapshot receipt memakai `$state.snapshot` sebelum structured cloning IndexedDB.

### B.1 Ledger Manual dan Kulakan Atomik

- Boundary ledger dan decoder transaksi AI memakai `decodeMoneyAmount` di `currency.ts`: number finite/nonnegative/safe atau string angka mesin/queue legacy yang sah (desimal/exponent). Boolean, array/object, null, whitespace, hex, nonfinite, negative underflow dan string maximum+fraction ditolak sebelum normalization menghilangkan provenance. `normalizeMoney` adalah policy pembulatan, **bukan validator input**; HPP satuan tetap empat desimal.
- POST/PATCH ledger menolak baris malformed400 dan konflik metadata `branch`/`cabang_id`403 sebelum memaksa scope session; metadata legacy yang absen tetap kompatibel. Respons `data` berisi request rows tervalidasi/kanonik, bukan sertifikasi snapshot histori atau fingerprint berbeda dengan ID sama. Same-intent retry tetap memakai ID stabil; acceptance create/fingerprint AUD-033 tidak digantikan oleh normalization.
- `POST /api/bahan/purchase` mengikat `(cabang_id, operation_key)` pada fingerprint immutable intent. Stock, movement, cash, HPP dan fingerprint ditulis dalam satu atomic D1 batch. Payload berbeda dengan key yang sama menghasilkan 409; replay yang cocok mengembalikan snapshot movement lama, bukan hitung ulang dari katalog terkini.
- UI menyimpan body/cabang submit pertama untuk retry ambigu. Jangan mengganti key otomatis ketika respons hilang; menutup dialog tidak membatalkan commit yang mungkin sudah sah.
- Migrasi additive `0041_purchase_request_fingerprint` wajib tersedia sebelum rollout aplikasi baru. Legacy key dengan fingerprint NULL ditolak 409 untuk pemeriksaan riwayat; tidak ada backfill intent tebakan atau perubahan kontrak queue IndexedDB. Rollback aplikasi mempertahankan kolom additive dan histori fingerprint.

### C. Alur Manajemen Menu & Resep

1. **Input Data**: Pemilik memasukkan nama produk, harga, kategori, dan resep bahan baku.
2. **Ekstraksi ID**: Menyimpan produk dan resep terhubung dengan `result?.data?.[0]?.id || result?.id`.
3. **Mutasi Stok Realtime**: Perubahan menu/bahan memicu broadcast event via `realtimeManager.ts`.

### D. Alur Pengarsipan Data (Archive)

1. **Preview**: `GET /api/archive` mengkalkulasi jumlah baris di bawah cutoff tanggal (WITA UTC+8).
2. **Eksekusi Snapshot**: Serialisasi transaksi terpilih ke format JSON unik di Cloudflare R2 (`arsip/<branch>/<year>/<uuid>.json`).
3. **Batch Deletion Anti-TOCTOU**: Menghapus baris dari D1 aktif hanya untuk exact ID yang telah terverifikasi tersimpan di snapshot R2 (finalisasi per chunk).
4. **Restore**: CLI [scripts/restore-archive.mjs](scripts/restore-archive.mjs): whole-source preflight, private staging/checkpoint digest (default 100 baris dan cap SQL 90,000 byte), lalu **satu guarded atomic final batch**. Staging tidak memutasi live ledger. Migrasi additive `0042_archive_restore_staging` wajib ada di target restore; belum dimigrasi otomatis. Dry-run default; apply perlu expected SHA-256/approval target. SQLite/workerd/CLI lokal bukan pengesahan recovery production/largest target. SQL drill/rollback juga wajib approved external inventory baseline; lihat [runbook](docs/OPERATOR-RUNBOOK.md) untuk flags dan batas bukti.
5. **Kontrak snapshot**: writer emit v3; decoder menerima v1–v3 dan menolak versi lebih baru sebelum apply. Chunk arsip: 50 header/snapshot ≤1MB/maks 10 per panggilan. Satu header beserta details yang tidak muat ditolak 413 sebelum R2 put/seal/delete; source tidak dipotong atau dihapus. Pembacaan ledger diawali compact locator `rowid` internal/count/upper-bound byte JSON di SQL (bukan fetch full field lalu shrink). Pemilihan prefix memasukkan satu header + seluruh detail/manifest dan reserve metadata 4096 byte; field binary/indivisible oversize ditolak sebelum payload/claim/R2. Payload header/detail dibaca dalam satu D1 batch dengan guard ukuran/count segar, sehingga growth antara preflight dan read menghasilkan 409 tanpa upload/delete. Raw numeric fields tetap dibaca, tidak dikonversi lewat SQL JSON agar presisi HPP historis tidak berubah; escaping UTF-8/NUL dihitung di SQL. Bound konservatif dapat menolak grup sangat dekat cap; source tidak dipotong dan memerlukan review operator. Ini membatasi transfer ledger ke Worker, bukan klaim biaya scan SQL/memori total/approved-largest.
6. **Respons dan unduhan**: fresh single/multi-part maupun resume hanya metadata (job/parts/key/count), tanpa `content`. UI fresh single-part mengunduh otomatis melalui `/api/archive/download?job_id=…`; resume/parts dapat diunduh lewat tombol yang sama. Label selesai hanya setelah body terkonsumsi; kegagalan unduhan tidak membatalkan commit arsip yang sudah sah. HTTP download completed job dari cabang session meneruskan R2 body stream, bukan buffer seluruh objek; initial read failure 502, mid-stream failure/cancel diteruskan ke consumer untuk retry. UI saat ini masih membuat text/Blob satu part; metadata-only bukan bukti constant-memory browser atau real-R2/Worker128MB acceptance.

### E. Alur Autentikasi & Otorisasi Peran (Auth Flow)

1. **Login Kasir / Pemilik (`POST /api/veriflogin`)**:
   - Rate limiting per IP dan per username.
   - Verifikasi hash password bcrypt terhadap D1 database cabang terkait (PIN supervisor memakai PBKDF2-SHA256 terpisah).
   - Validasi role ketat: `pemilik`, `kasir`, `admin` (unknown fail-closed; endpoint Antrean hanya `kasir`/`pemilik`).
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

### Isolasi gate browser lokal

`rtk pnpm test:e2e:all` tanpa argumen menjalankan **semua** spec melalui inventory canonical `test:e2e:ci-a/b/c`, berurutan dengan environment D1/server/browser fresh tiap cohort. Inventory wajib mencakup tepat semua file spec: missing/duplicate/unknown entry menghentikan gate sebelum startup. Login rate limit dan CSRF aplikasi tidak di-disable/raise/reset; jangan mengganti full gate dengan subset hijau. Semua cohort tetap dicoba ketika satu gagal; aggregate exit nonzero.

Port readiness tidak cukup: anonymous owned-loopback `/login`200 HTML/form harus selesai sebelum browser dengan sisa total startup120s, tanpa cookie/credential/login mutation atau deadline reset. Malformed/status/redirect/512KiB overflow/stalled body fail closed. Ini warm SSR/emulator readiness, bukan cold/warm performance approval. `scripts/platform-emulation.mjs` membungkus adapter dengan lazy single-flight per emulator; request prerender/live tetap diteruskan, initialization failure tetap fail. `rtk pnpm test:platform-emulation` menguji concurrency/ownership/lazy/failure; existing runner operations menguji readiness ordering dan actual owned HTTP. Jangan memperbaiki native CLI `status:null` dengan timeout increase atau mengklaim compiled smoke ketika dry-run belum selesai.

Tes browser yang import raw `/src/...` dengan dependency `$app` harus menginisialisasi runtime dev asli Vite (`/@vite/env`) terlebih dahulu; `page.goto`/SSR/HTTP200 file env bukan bukti initializer sudah dieksekusi. Fixture cache menguji kasus Viteclient tertahan, SDKdefine belum ada, lalu nativeinitializer siap sebelum assertion cache yang sama. Jangan memasang global/versi palsu, mengubah node_modules, menyembunyikan ReferenceError, atau mengendurkan assertion. Ini prasyarat fixture dev, bukan pengganti hydration/UI/compiled acceptance. Cold startup/shutdown gagal tetap dicatat; state unconfirmed stop harus dipertahankan meski kemudian process count0.

Page laporan/arsip memakai `src/lib/server/pageAuth.ts` dari canonical hook session sebelum hydration. Owner-only UI arsip tetap hanya pemilik (admin/kasir menuju unauthorized); ini berbeda dari bypass admin API yang memang eksplisit. Jangan mengembalikan authority ke role localStorage/onMount. Role suite menguji actual loaders + live canonical D1 reader, compiled Pages smoke menguji actual HTTP page redirects.

Endpoint CSRF mempertahankan cookie canonical64lowercasehex yang sudah ada agar GET caller lain tidak menginvalidasi header mutasi in-flight. Cookie kosong/malformed diganti `randomBytes(32)`; Secure/SameSite Strict/maxAge2jam dan cookie–header guard tetap. Respons token `Cache-Control: no-store`/`Vary: Cookie`; refresh client berarti network-read tanpa cache, bukan wajib rotasi token. Dua realm yang pertama kali mengambil token tanpa cookie masih dapat mint independen; ini bukan klaim koordinasi lintas tab/global atau token session-signed. `test:csrf-contract` dan native compiled interleaving menjaga batas SATU retry dan negative mutation guards.

Fixture held-response/cross-tab wajib release barriers lalu `unrouteAll({behavior:'wait'})` untuk seluruh active callbacks, bukan satu shared pending boolean/resolved promise atau ignoreErrors. Tutup tab sebelum mutasi cleanup owned ID; unconfirmed drain/close veto cleanup, primary assertion tidak boleh tertutup cleanup error. Pakai shared CSRF helper dengan tepat satu identified CSRF_INVALID retry; role/branch/non-CSRF failure tetap gagal.

Argumen CLI eksplisit mempertahankan satu environment untuk selection/flags yang diminta (misalnya `rtk pnpm exec node scripts/run-playwright-local.mjs e2e/catat-recent.spec.ts`); itu bukan bukti full gate. Artifact tiap invocation/cohort terpisah di ignored `test-results/isolated-<uuid>/<cohort>/` dan `playwright-report/isolated-<uuid>/<cohort>/`, tidak dihapus bersama owned D1 state atau ditimpa cohort berikutnya. Simpan logs/reports sebagai evidence sebelum cleanup manual; log tidak boleh berisi cookie/token/password. Unit launcher memakai controlled subprocesses dan actual owned Node children; itu bukan compiled Worker/Vite interruption acceptance atau bukti Ubuntu/pinned Node.

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

#### Buku Kas manual: kontrol revisi dan consent AI (AUD-033)

- `PATCH /api/buku-kas` untuk row non-POS wajib menyertakan `payload.revision` dari GET live target. Token hanya number safe integer nonnegative di bawah `Number.MAX_SAFE_INTEGER`; string, boolean, NULL/missing, fractional/nonfinite/unsafe ditolak 400. Jangan memakai default 0, mengambil revisi dari model, atau backfill menebak revisi historis.
- Write memakai predicate atomik `cabang_id + id + revision + non-POS` dan `RETURNING`; counter dinaikkan server, bukan ditetapkan dari payload. Stale/losing race 409 **tanpa ledger/audit/publication change**. Setelah 409, user membaca ulang dan menyetujui before/after baru; dilarang auto-rebase/overwrite/retry buta. Target luar cabang tidak ditulis. Body branch present yang berbeda dari session ditolak 403 (POST/PATCH, termasuk admin); body branch legacy yang missing bukan authority.
- POS payment-method-only tetap lewat jalur CAS khusus existing dan kompatibel dengan caller tanpa token manual. Jangan membuat manual PATCH dapat mengubah amount/domain row POS. Kontrak uang/category tetap kanonik, tanpa migrasi kolom/revision yang ditebak.
- `AutoApplyService.prepareRecommendations()` menyiapkan payload allowlisted serta live before/target/revision; UI menampilkan canonical action, before/after/category/WITA/date/dampak sebelum tombol apply. Model title/description/control revision/branch bukan authority. Update langsung tanpa prepared consent, forged/copied/cancelled consent, stale user/role/expiry/logoutrevision/branch+epoch ditolak sebelum HTTP. `$state.raw` menjaga private WeakMap identity; nested payload/before frozen. Cancel/close/session/context change memagari late responses dan tidak menghidupkan ulang consent. Overlay body-owned agar ancestor header tidak menutup hit target; destroy melepaskan node, bukan `force click`.
- Provider-free regressions: `rtk pnpm test:ledger-cas` dan `rtk pnpm test:ledger-cas --d1`; actual UI di `e2e/remediation.spec.ts`. Bukti local core/callers bukan full AUD-033/same-SHA CI/reviewer/release approval. Loss-of-response/retry fingerprint/full create/category/POS/offline/identity/platform matrix tetap memerlukan acceptance yang tercatat tracker.

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
- CI job **Build** menjalankan `test:realtime-compiled` setelah build dan sebelum manifest/upload; full `test:release` memakai urutan yang sama. Gate tambahan `rtk pnpm test:ledger-browser-compiled` menjalankan selected genuine Catat/AI callers memakai public build assets/private snapshot dan own local Pages/workerd HTTPS, bukan Vite/devmodule imports. SDK development certificate hanya fixture loopback, bukan production trust; cookie/auth/CSRF tidak dilonggarkan. Semua native/full-browser gate lama tetap. Latest caller acceptance/observed cookie rotation race dan batas evidence ada di tracker§2.1/TRK-073, bukan otomatis dianggap lulus karena harness sudah bootstrap. Smoke terpisah bisa dijalankan dengan `rtk pnpm build` lalu `rtk pnpm test:realtime-compiled`. Jangan menggantinya dengan `test:realtime-artifact`: yang terakhir menguji generator/source consumer, bukan seluruh adapter built.
- Entry `_worker.js` adalah wrapper ESM eksplisit atas adapter asli `_worker.sveltekit.js` dan canonical `_worker.auth.js`. Reader `authSessionReader.ts` dipakai HTTP hooks melalui re-export `sessionStore.ts` dan entry compiled; live profile/role/branch adalah authority, bukan snapshot role session. Prefix session wajib cocok row branch; admin cross-branch tetap mengikuti `requireSessionBranch`. Legacy text intercept ditolak dan membutuhkan clean build.
- Smoke compiled membundel **entry Pages hasil build yang sama** lewat Wrangler **Worker dry-run** privat, lalu menjalankan workerd dengan tiga D1 disposable, external real DO class, lima cabang, WebSocket heartbeat/fanout/reconnect/isolation, role/live-profile/session negative matrix, missing binding dan sanitized DB outage. Sockets menunggu close acknowledgement; runtime ditutup sebelum state milik run dihapus. Rejected upgrade memakai native HTTP client dengan owned cleanup (SDK v5 unexpected-response menyisakan connection); error tidak disenyapkan.
- `COMPILED_REALTIME_ARTIFACT` mencatat hash entry/adapter/auth/bundle/DO tanpa credentials. Ini **bukan Pages dry-run/upload, staging binding, physical browser, performance atau scheduled drain proof**. Ubuntu/pinned Node dan CI same-SHA tetap harus benar-benar dijalankan. Workflow Build menyimpan log smoke, tetapi penambahan step bukan bukti remote CI hijau.
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
