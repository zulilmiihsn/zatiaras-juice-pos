# Audit independen AUD-001–AUD-063 — 9 Oktober 2026

## 1. Kesimpulan

**Klaim “63/63 Completed, plan CLOSED” belum dapat diterima sebagai bukti bahwa seluruh acceptance criteria dan aturan rencana sudah dipenuhi.** Implementasi dan CI menunjukkan kemajuan nyata, tetapi reproduksi independen masih menemukan pelanggaran kontrak uang, idempotency, restore, audit durability, dan authorization realtime.

Penilaian teknis terhadap seluruh 63 kartu:

| Penilaian           | Jumlah | Arti                                                                                                                               |
| ------------------- | -----: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Sesuai teknis       |     28 | Implementasi inti dan bukti pengujian yang diperiksa mendukung kontrak kartu. Bukan sertifikasi semua aturan proses atau produksi. |
| Sebagian            |     17 | Ada implementasi/bukti, tetapi acceptance, cakupan runtime, atau bukti operasional belum lengkap.                                  |
| Tidak sesuai        |     16 | Ada perilaku/source yang bertentangan dengan kontrak, atau klaim penutupan yang gugur karena prerequisite belum terpenuhi.         |
| Belum terverifikasi |      2 | Acceptance perangkat fisik tidak dapat diverifikasi secara independen dari bukti yang tersedia.                                    |
| **Total**           | **63** | Tidak ada kartu yang dilewati.                                                                                                     |

Angka **28** berarti perbaikan inti mempunyai bukti teknis yang memadai dalam scope yang disebutkan, **bukan “28 task sudah memenuhi seluruh DoD global”**. Aturan commit/fase dan kelengkapan sign-off dinilai terpisah pada §5. Status resmi tracker tidak diubah dalam audit ini.

## 2. Scope, provenance, dan batas kewenangan

- Rencana acuan: `docs/AUDIT-REMEDIATION-PLAN.md`, terutama setiap kartu §7, DoD global §4.2, gate §8, dan penutupan §11–12.
- Candidate penutupan historis: `e6d5cfd459badeaee2daed38f15eea6b94ba02bd`.
- HEAD saat pemeriksaan: `d3b94f2` — dokumentasi rilis; source produksi yang dicatat runbook: `0c3268bbb54a5b74f3ce6b279c8d5d7902a88625`.
- Lokal: Windows, Node **v26.8.1**, pnpm **11.24.0**. Pin proyek/CI adalah Node **24.20.0**. Hasil lokal tidak diklaim sebagai pembuktian seluruh major Node atau paritas pin.
- SQL: database SQLite in-memory dan workerd D1 terisolasi dengan migrasi aktual. R2 pada probe arsip adalah adapter fixture, **bukan R2 staging**.
- Browser: runner E2E terisolasi dan Chromium untuk utility fokus yang sebenarnya. Probe auth realtime menjalankan function hasil patch dengan database nyata, **bukan smoke seluruh compiled Worker**.
- Backup yang sudah tersedia diperiksa melalui verifikasi manifest dan salinan SQLite in-memory. Tidak ada repair terhadap backup asli atau data production.
- Tidak dilakukan deploy, migrasi production, restore/wipe remote, rotasi secret, panggilan provider berbayar, atau perubahan kode aplikasi. Probe dan log diagnostik disimpan di direktori OS-temp eksternal, bukan di repository.
- Working tree sebelum audit sudah mempunyai `?? nul`. Berkas tersebut tidak dibuat, dihapus, atau digunakan sebagai bukti perubahan audit. Tambahan repository dalam audit ini hanya laporan ini.

GitHub dikueri langsung, bukan hanya membaca label di dokumen:

| Bukti                                                                                                           | SHA                                        | Hasil                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [CI closure 37773610638](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37773610638)            | `e6d5cfd459badeaee2daed38f15eea6b94ba02bd` | `success`                                                                                         |
| [CI current source 37900524468](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37900524468)     | `0c3268bbb54a5b74f3ce6b279c8d5d7902a88625` | `success`; grup E2E 36/36, 36/36, 40/40 (112 total; detail log dikonfirmasi ulang saat follow-up) |
| [Deploy current source 37903196792](https://github.com/zulilmiihsn/zatiaras-juice-pos/actions/runs/37903196792) | `0c3268bbb54a5b74f3ce6b279c8d5d7902a88625` | `success`                                                                                         |

Success workflow membuktikan workflow tersebut selesai pada SHA terkait. Itu bukan pengganti invariant yang tidak diuji, verifikasi seluruh byte artifact oleh auditor, atau UAT perangkat fisik.

Perbandingan `e6d5cfd..HEAD` juga diperiksa. `purchaseUseCase` dan `checkoutUseCase` mendapat wrapper boundary, bukan perbaikan fingerprint/durability; bagian download ditambahkan wrapper dalam `archiveUseCase`. Beberapa file bermasalah lainnya, termasuk restore library/CLI, gateway AI, patch realtime, dan utility fokus, tidak berubah dalam perbandingan itu. Reproduksi runtime tetap dinyatakan terhadap checkout saat audit, bukan berpura-pura telah menjalankan semua candidate historis.

## 3. Hasil verifikasi yang benar-benar dijalankan

### 3.1 Gate proyek

| Command                                          | Exit | Bukti/batas                                                                                                                                     |
| ------------------------------------------------ | ---: | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `rtk pnpm test:unit`                             |    0 | Seluruh rantai saat ini lulus; package mempunyai **62 entri command**, bukan angka historis 60. Tidak menyamakan entri dengan jumlah assertion. |
| `rtk pnpm test:operations`                       |    0 | 52 test `node:test` lulus, ditambah self-test live-UAT safety. Test D1 drill ternyata tidak menjalankan CLI/checker D1 yang rusak; lihat F-046. |
| `rtk pnpm check`                                 |    0 | 0 error, 0 warning.                                                                                                                             |
| `rtk pnpm lint`                                  |    0 | Prettier + ESLint lulus sebelum laporan ini ditambahkan. Laporan mendapat gate dokumen terpisah.                                                |
| `rtk pnpm deploy:check`                          |    0 | Config check; bukan deploy atau smoke compiled artifact.                                                                                        |
| `rtk git diff --check`                           |    0 | Tidak ada whitespace error pada diff yang diperiksa.                                                                                            |
| `rtk pnpm audit --json`                          |    0 | Nol vulnerability pada semua severity saat diperiksa.                                                                                           |
| `rtk pnpm test:e2e:ci-b` dengan output eksternal |    0 | **36/36 lulus**, `.last-run.json` berstatus `passed`, tanpa failed tests.                                                                       |
| Seleksi UI 38 test melalui runner terisolasi     |    1 | **36 lulus, 2 gagal** pada Catat recent. Bukan full E2E lokal 107/107.                                                                          |

Tidak dilakukan ulang full release/build/staging dalam audit ini. Build dan full E2E pada CI source terkini adalah bukti remote, dibedakan dari gate lokal di atas.

Dua kegagalan Catat ditelusuri melalui `trace.zip`, bukan ditutup dengan retry:

1. Test newest-five berhenti **sebelum assertion fitur**: delete fixture kedua menghasilkan `403 CSRF_INVALID`, walaupun test meminta token baru. Jar cookie dipakai bersama aktivitas aplikasi.
2. Test error-state mengintersep `**/api/buku-kas?*` terlalu luas. HTTP 500 mengenai request POS latar belakang dengan `sumber=pos`, sedangkan query aktivitas dengan `sumber=catat&direction=desc&limit=5` mendapat HTTP 200. Test tidak menginjeksi failure pada consumer yang diklaim diuji.

Ini bukti gap determinisme/targeting test AUD-027/AUD-054, **bukan bukti bahwa query aktivitas Catat sendiri salah**. Assertion tidak diubah dan test tidak di-retry buta agar hijau.

### 3.2 Probe negatif independen

Probe berada di `%TEMP%/zatiaras-reaudit-nUe7AY/`: `probes.mts`, `more-probes.mts`, `dom-and-traces.cjs`, dan `fk-enforcement.mts`. Log gate dan probe ada di direktori yang sama. Lokasi ini bukti lokal sementara, bukan artifact CI atau fixture yang sudah diregistrasikan ke unit chain.

**Exit 0 pada probe berarti pelanggaran berhasil direproduksi, bukan acceptance lulus.** Probe sengaja mengassert hasil yang melanggar kontrak. SQLite/workerd menggunakan database terisolasi dan ditutup melalui cleanup.

## 4. Temuan yang membantah completion

### F-005 — Coercion garbage pada nominal ledger

- Lokasi: `src/lib/server/ledgerValidation.ts:39–45`.
- Aktual: `validateLedgerNominal(true) -> 1`, whitespace -> `0`, array kosong -> `0`.
- Kontrak AUD-005 meminta validasi tipe/decoder historis eksplisit, bukan coercion garbage menjadi nominal sah.
- Scope: validator kanonik yang dipakai write path; nilai keluaran dibuktikan runtime. Ini bukan klaim seluruh request HTTP negatif sudah diulang.

### F-006 — Key kulakan tidak mengikat fingerprint; cash invalid menjadi tanpa cash

- Lokasi: `src/lib/server/purchaseUseCase.ts:80–96`, `:151–157`, `:222–235`, `:317`.
- Purchase pertama: quantity 100, cash 20000. Retry key sama dengan quantity 999 dan cash 99999 diterima sebagai `duplicate: true`; response delta **999**, delta tersimpan **100**.
- Request terpisah dengan cash `not-a-number` tetap commit stock dan menghasilkan `kas_id: null`.
- Seharusnya: fingerprint berubah -> 409 tanpa mutasi; cash invalid -> reject tanpa business mutation.
- Scope: use case nyata, migrated SQLite **dan workerd D1**. Tes yang lulus hanya membuktikan retry payload yang sama/race tertentu; bukan key–payload binding.

### F-023 — Fallback focus dan nested Escape belum benar

- Lokasi: `src/lib/utils/modalFocus.ts:89–122`; `src/lib/components/shared/AppModal.svelte` panel dialog tidak mempunyai `tabindex=-1`.
- Utility aktual ditranspile dan dijalankan pada Chromium DOM terisolasi.
- Dialog tanpa kontrol fokus tetap berada pada **BODY**, bukan panel.
- Escape pada dialog inline nested memanggil callback **inner dan outer**, bukan hanya dialog teratas.
- `src/tests/a11y-focus-tests.ts` masih mempunyai `MockFocusTrapManager` terpisah; tambahan `trapFocusStep` hanya menguji matematika indeks. Keduanya tidak membuktikan lifecycle/fokus DOM untuk dua edge case ini.
- Scope: utility browser nyata dan struktur panel yang ditinjau; bukan klaim semua halaman memakai dialog nested.

### F-030 — Ringkasan AI mencakup arsip, rincian fakta belum parity

- Lokasi: `src/lib/server/ai/reportData.ts:150` dan query monthly/daily/top-products yang masih membaca tabel aktif.
- Fixture archive-only dengan daily/product summaries menghasilkan pendapatan **40000**, tetapi monthly data, top products, dan daily performance semuanya **kosong**.
- Kontrak AUD-030 mencakup fakta/prompt/report DTO aktif + daily/product/manual archive, bukan hanya summary dan `hasData`.
- Scope: `fetchReportDataSql` nyata pada database migrated, termasuk workerd D1; tanpa model/provider.

### F-033 — Stale consent/update tidak dilindungi client revision CAS

- Lokasi: `src/lib/server/services/bukuKasService.ts:347–356`.
- Row stored revision 1; update dengan expected revision 0 tetap sukses, nominal menjadi **500**, revision menjadi **2**.
- Manual update menghapus revision payload lalu melakukan update hanya dengan branch dan ID. Increment revision tidak sama dengan compare-and-swap terhadap state yang disetujui user.
- Kontrak AUD-033 secara eksplisit melarang stale target dan mempertahankan intended update dengan confirmation/CAS.
- Scope: mutation service nyata, SQLite/workerd D1. Ini menunjukkan boundary belum melindungi stale intent; bukan klaim telah mengeksploitasi UI production.

### F-034 — Timeout response bukan pembatalan resource upstream

- Lokasi: `src/lib/server/aiGateway.ts:169–192`, `:212–225`, `:320`.
- Headers-success/body-stalled menghasilkan `UPSTREAM_TIMEOUT`, tetapi **body tidak dicancel** dan **upstream AbortSignal tidak aborted**.
- Fetch timer/listener dibuang ketika headers selesai; `readJson` melakukan Promise race tanpa membatalkan body yang kalah. Deadline baru pada body juga bukan satu end-to-end deadline.
- Scope: `Response`/`ReadableStream` nyata dengan fetch fixture, tanpa panggilan provider. Stream path mempunyai sebagian cancellation coverage, tetapi nonstream path masih gagal kontrak bounded resources.

### F-039 — Satu row dapat melampaui encoded-byte budget arsip

- Lokasi: `src/lib/server/archiveUseCase.ts:703–718`.
- Row dengan deskripsi 2 MiB menghasilkan snapshot **2.098.166 bytes**, melebihi `ARCHIVE_CHUNK_MAX_BYTES = 1.000.000`.
- Loop mengecilkan chunk berhenti ketika tinggal satu row; tidak menolak/menangani row oversized sebelum upload.
- Scope: `runArchive` nyata + D1 terisolasi + R2 fixture. Ini membuktikan cap tidak ditegakkan untuk oversized row, **bukan bukti OOM produksi** atau bahwa data produksi berukuran demikian.

### F-040 — Dedicated download masih buffering, bukan streaming

- Lokasi: `src/lib/server/archiveUseCase.ts:987–1036`, khususnya `body: await object.arrayBuffer()`.
- Branch-scoped job lookup, filename, dan retry-download sudah ada, serta E2E download bytes lulus.
- Namun interface `ArchiveDownload.body: ArrayBuffer` dan implementasi membaca seluruh object terlebih dahulu. Ini tidak memenuhi dedicated **streaming** download dalam kartu AUD-040; penjelasan eksekusi yang menyebut stream terlalu luas.
- Scope: pertentangan langsung source terhadap kontrak; tidak diklaim telah melakukan load test R2 nyata.

### F-042 — Restore preflight menerima business fields rusak

- Lokasi: `scripts/restore-archive-lib.mjs:83–130`, field maps `:261–308`.
- Archive v3 dengan `receipt_snapshot: 'null'`, `jumlah: 'not-a-quantity'` pada header, dan `created_at: 'not-a-date'` diterima dengan `ok: true`.
- Receipt hanya diperiksa sebagai JSON parseable, bukan shape/totals/cross-field business invariant. Sebagian field yang dimasukkan ke restore map tidak divalidasi penuh.
- Scope: library aktual; acceptance memerlukan validasi seluruh archive sebelum live apply. Tidak menyatakan setiap invalid quantity pada detail juga lolos: validator detail memang memiliki pemeriksaan quantity.

### F-043 — Restore per-chunk commit melanggar atomic final apply

- Lokasi: `scripts/restore-archive.mjs:256–321`; `buildRestoreChunks` di `scripts/restore-archive-lib.mjs`; `src/tests/restore-chunk-tests.ts`.
- Dua chunk satu row: chunk pertama commit; conflict disisipkan pada target chunk kedua; chunk kedua gagal, tetapi **row live chunk pertama tetap ada**.
- Kontrak kartu sangat jelas: late conflict -> **zero live changes**; jika atomic budget tidak cukup, status harus `Blocked` untuk keputusan ADR/owner, bukan silent partial apply.
- Implementasi bukan staging lalu finalisasi atomik; checkpoint CLI menandai independent commits. Tes crash/resume sekarang justru menerima model itu.
- Scope: SQL generated aktual dieksekusi pada SQLite **dan workerd D1**. Tidak menjalankan restore production atau real remote CLI apply.

### F-046 — Drill menerima incomplete schema; actual `--d1` CLI rusak

- Lokasi: `scripts/restore-drill-local.mjs:22–39`, `:45–60`, `:132–151`, `:224`.
- Dump yang hanya berisi dua tabel `buku_kas` + `transaksi_kasir`, tanpa keseluruhan schema/migration POS, mendapat PASS checker.
- Jalur CLI sebenarnya dengan `--d1` keluar **1**: `adapter.all(...).map is not a function`. Checker synchronous dipanggil dengan adapter async.
- `scripts/restore-drill-local.test.mjs:119–156` menjalankan query orphan D1 pada tabel toy, tetapi **tidak memanggil checker async/CLI yang gagal**. Karena itu operations tetap hijau.
- Expected manifest counts, financial/receipt/idempotency parity, dan full schema proof belum dipenuhi checker hanya dengan integrity/quick check.

### F-049 — Audit intent tidak atomik bersama commit penjualan

- Lokasi: `src/lib/server/checkout/checkoutUseCase.ts:808–809`, `src/lib/server/auditLog.ts:191–200`; statement builder tidak memasukkan intent ke business batch.
- Dengan injected failure pada insert `audit_log_outbox`, penjualan tetap commit, tetapi **audit_logs = 0 dan audit_outbox = 0**. Retry key yang sama tidak memulihkan intent.
- Best-effort delivery setelah commit memang boleh gagal; durable intent yang diwajibkan AUD-049 tetap harus ikut atomic business commit.
- Scope: checkout aktual dengan quote bertanda tangan fixture, SQLite/workerd D1. Respons bounded tidak membuktikan durability.

### F-050 — Generated realtime auth menyimpang dari canonical live profile policy

- Lokasi: `scripts/export-durable-objects.mjs:62`; pembanding `src/lib/server/sessionStore.ts:121` dan `src/lib/utils/roles.ts`.
- Setelah profile role diubah menjadi unknown, canonical `getAuthSession` menghasilkan **null** tetapi generated realtime handler tetap meneruskan request dengan **HTTP 200**.
- Generated path hanya mencari session ID/branch/expiry, tanpa live profile join/role validation kanonik.
- `scripts/realtime-artifact.test.mjs` terutama memeriksa snippet text pada fake Worker; bukan built-Worker websocket/auth behavior.
- Scope: generated function hasil patch + database nyata. Ini adalah gap authorization source yang terkonfirmasi, **bukan klaim observasi exploit pada deployed Worker**. Full compiled smoke tetap dibutuhkan.

### F-054 — Sebagian gate masih menguji pengganti/wiring, bukan kontrak yang diklaim

- Contoh konkret: mock focus manager terpisah; auth artifact test dengan `includes`; D1 drill test tidak memanggil actual checker; restore chunk test menerima partial commit; Catat failure injection mengenai consumer lain.
- Gate lokal hijau bersamaan dengan reproduksi negatif di atas adalah bukti missing invariant coverage, bukan alasan untuk menurunkan assertion atau membuat retry tambahan.
- Kartu AUD-054 meminta setiap risk mempunyai meaningful regression dan melarang source-text/mock-echo dianggap sertifikat behavior. Kontrak itu belum terpenuhi.

### F-055 — ADR foreign keys masih menyatakan fakta D1 yang salah

- Lokasi: `docs/adr/0003-foreign-keys.md:14`; komentar serupa di `scripts/restore-drill-local.mjs:80`.
- ADR mengatakan “Cloudflare D1 tidak menegakkan foreign key”.
- Workerd D1 terisolasi menunjukkan `PRAGMA foreign_keys = 1`; tabel fixture dengan FK menolak insert referensi yang tidak ada dengan foreign-key constraint.
- Ini juga bertentangan dengan [dokumentasi vendor](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) yang dirujuk rencana sendiri.
- Tidak menambahkan FK pada schema aplikasi/production. Koreksi fakta tidak sama dengan mengotorisasi migrasi FK.

### F-063 — Final CLOSED tidak memenuhi prerequisite sendiri

- CI/deploy yang sukses dan persetujuan owner mempunyai bukti; bagian itu tidak disangkal.
- Namun kartu AUD-063 mensyaratkan seluruh 62 kartu lain selesai, compiled-runtime smoke dan operational acceptance lengkap. F-005 sampai F-055 serta keterbatasan §6 membantah premis tersebut.
- Checklist §11 rencana masih unchecked; ini gejala dokumentasi, **bukan satu-satunya alasan** menolak closure. Alasan utama adalah kontrak dan acceptance yang belum terpenuhi.

## 5. Kepatuhan aturan proses rencana

1. **Satu commit = satu tujuan + satu fase belum konsisten.** Commit `d69b4ace40bfe3d059ae226abfe7bc413a672793`, `feat(audit): fondasi AUD-001..039 prasyarat gate CI`, mengubah **108 files, +7915/-869**, mencampur auth, uang/stok, AI, arsip, UI, dan tests lintas fase. Ini bukan sekadar kritik ukuran diff: tujuan/fasenya melintasi batas yang rencana dan AGENTS wajibkan. Slice refactor sesudahnya jauh lebih terpisah, tetapi tidak mengubah provenance commit fondasi.
2. **Dependency/correctness gate tidak boleh digantikan dengan jumlah suite.** AUD-053 memang mengurangi route DB allowlist menjadi 0 dan explicit `any`/empty catch menjadi 0; hasil itu nyata. Tetapi correctness prerequisite AUD-006/030/033/039/043/049 masih mempunyai gap. Klaim fase correctness telah closed sebelum maintainability tidak terbukti.
3. **Root cause AUD-002–004 belum diidentifikasi deterministik.** Catatan §12 menyatakan skenario lulus sebelum dan sesudah fix. Bounded auth fetch merupakan hardening bermanfaat, tetapi passing scenario bukan proof penyebab tiga kegagalan awal.
4. **Test-before-fix tercatat, tetapi tidak semua bukti gagal awal dapat direkonstruksi.** Catatan eksekusi bukan pengganti immutable log/trace/assertion pada tiap task. Audit ini tidak menyimpulkan catatan palsu; kelengkapan buktinya belum cukup untuk blanket process sign-off.
5. **Closure tidak boleh menurunkan atomicity/support secara diam-diam.** Per-chunk restore berbeda dari final atomic apply. Keterbatasan staging, largest dataset, push, atau printer harus tetap tercatat sebagai acceptance yang belum lulus, kecuali ada keputusan scope/ADR yang eksplisit dan memperbarui seluruh DoD.
6. **Batas bukti harus konsisten.** Catatan eksekusi tertentu secara jujur mengatakan “lokal saja”, “nested belum E2E”, atau “compiled staging belum”; status tracker Completed tidak otomatis menghilangkan batas itu. CI baru menutup kebutuhan same-SHA CI, tidak menutup acceptance yang tidak dijalankan workflow.

## 6. Bukti operasional dan kronologi data

### AUD-057 — Performance

Catatan rencana mengukur **2.000 rows**, Windows/Node/SQLite lokal. Batas yang ditulis sendiri: cold/warm browser, compiled Worker/D1, legacy archive sekitar **22.000 rows**, dan trafik production belum dibuktikan. Itu bukti berguna, tetapi bukan G-PERF lengkap. Tidak ditemukan evidence largest target workload, peak memory/distribution/concurrency/initial route payload yang cukup untuk menerima Completed.

### AUD-058/059 — Data dan recovery

- Dua backup set eksternal yang tersedia (timestamp 08:57 dan 10:40 UTC, 8 Oktober) lolos verifikasi manifest semua tiga shard.
- Keduanya direstore hanya ke **SQLite in-memory** untuk checker yang tersedia. Balikpapan dan Berau PASS pemeriksaan tersebut; Samarinda pada keduanya gagal karena **1 orphan bahan_mutasi**.
- PASS tersebut terbatas pada checker F-046; tidak menyertifikasi full schema/financial/idempotency/receipt parity.
- Runbook §11.5 dan catatan AUD-058 mencatat owner kemudian menghapus baris uji/orphan sendiri dan pemeriksaan read-only sesudahnya menunjukkan nol orphan. Karena itu audit **tidak menyatakan orphan masih ada di production saat ini**. Backup yang diperiksa menyimpan keadaan sebelum penghapusan.
- Bukti yang tersedia belum cukup untuk inventaris seluruh kategori data terdampak per lima cabang, approved before/after stock/tax/receipt/counter parity, dan rollback aktual semua shard.
- Backup hash/readability dan migrasi additive yang dicatat bukan proof restore/rollback staging, recovery tujuan yang approved, atau RPO/RTO terukur. Jalur actual D1 drill masih gagal F-046.

### AUD-060 — Push/perangkat

Workflow provisioning VAPID/deploy dan browser notification tests tersedia. Owner menyatakan UAT fisik lulus. Itu attestation yang sah untuk dicatat, tetapi tidak tersedia matriks hasil per browser/device/state foreground/background/closed, revoke/offline/relogin/cross-branch/old-session yang cukup untuk verifikasi independen seluruh kartu.

### AUD-061 — Provider

Catatan menyebut satu request sintetis: HTTP 200, model free, cost 0, 20 token. Tidak dilakukan request provider baru. Satu happy path tercatat belum membuktikan seluruh gateway/chat/HPP/report, bounded cancel/fallback, dan approved quota/budget matrix. Temuan F-030/F-034 juga masih relevan pada consumer/provider contract.

### AUD-062 — Printer

Snapshot/HTML/ESC-POS tests dan browser flow mempunyai bukti. Owner menyatakan output fisik lulus. Belum tersedia per-supported-channel/device output dan error/reconnect/retry/offline/archive-restore matrix untuk memverifikasi seluruh acceptance fisik. Preview atau unit output tidak disamakan dengan paper/device proof.

## 7. Matriks seluruh 63 task

Kolom **hasil** menilai kontrak teknis/acceptance dengan scope bukti yang dinyatakan. Semua row masih bertanda Completed pada tracker resmi. “Sesuai teknis” tidak menghapus temuan lintas-task pada §5 atau mengklaim sign-off operasional penuh.

| ID      | Hasil               | Dasar dan bukti utama                                                                                                                                                                                                                                                                        |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUD-001 | Sebagian            | Pin/toolchain dan isolation tersedia (`.node-version`, `scripts/e2e-environment.mjs`, runner, operations). Windows success/CI Ubuntu terbukti; seluruh interruption/startup/browser/workerd-stop matrix serta root-cause ECONNRESET tidak dibuktikan lengkap.                                |
| AUD-002 | Sebagian            | Backend notification persistence/lease/cursor + E2E fan-out lulus (`src/tests/antrean-notification-tests.ts`, `e2e/antrean-notifications.spec.ts`). Catatan mengakui root cause timeout awal belum deterministik; passing before/after tidak menutup requirement itu.                        |
| AUD-003 | Sebagian            | Preference/reload/profile flow mempunyai implementasi dan passing E2E. Penyebab switch hilang awal tidak diisolasi; matriks device fisik terhubung ke AUD-060 yang belum terverifikasi.                                                                                                      |
| AUD-004 | Sebagian            | Login/session guard dibatasi timeout dan relogin E2E lulus (`src/lib/utils/authGuard.ts`). Belum ada root-cause mapping kegagalan navigation asli pada full load.                                                                                                                            |
| AUD-005 | Tidak sesuai        | Validator masih menerima coercion garbage menjadi uang (F-005); `ledger-validation-tests` yang hijau tidak mencakup tipe tersebut.                                                                                                                                                           |
| AUD-006 | Tidak sesuai        | Atomic purchase normal tersedia, tetapi key berbeda payload diterima dan cash invalid menjadi purchase tanpa cash; reproduced SQLite/D1 (F-006).                                                                                                                                             |
| AUD-007 | Sesuai teknis       | Base-unit conversion/preset dan stock outcome diuji (`src/lib/utils/unitConversion.ts`, `e2e/kulakan.spec.ts`, ingredient-yield/quantity suites). 1000 gram ditampilkan 1 kg, tidak double convert.                                                                                          |
| AUD-008 | Sesuai teknis       | Metadata/recipe update tidak menulis captured stock (`src/lib/server/services/productAtomicService.ts`, menu-atomic/stock-write-guards, browser menu). Route sudah memakai boundary service.                                                                                                 |
| AUD-009 | Sesuai teknis       | Balance field metadata PATCH ditolak; actual adjustment lewat guarded ledger (`src/lib/server/services/bahanService.ts`, stock-reconciliation/stock-write-guards, kulakan E2E).                                                                                                              |
| AUD-010 | Sesuai teknis       | Partial unique/session opening invariant dan deterministic concurrency tersedia (`src/lib/server/services/sesiTokoService.ts`, `src/tests/sesi-toko-tests.ts`); unit dan CI workerd mendukung. Production migration/recovery terpisah AUD-059.                                               |
| AUD-011 | Sesuai teknis       | Close allowlist + active->closed CAS/retry; opening fields tidak dapat rewrite (`sesiTokoService.ts`, handler/session tests, browser buka/tutup).                                                                                                                                            |
| AUD-012 | Sesuai teknis       | Void movement terikat winning mutation token; conflict 409/duplicate tidak double restock (`src/lib/server/services/transaksiKasirService.ts`, stock-policy/POS suites).                                                                                                                     |
| AUD-013 | Sesuai teknis       | Mandatory archive read error tidak dijadikan empty success (`src/lib/server/reportQueries.ts`, report-tax/AI source-error suites, browser laporan). Valid empty archive tetap dibedakan.                                                                                                     |
| AUD-014 | Sesuai teknis       | Canonical history receipt decoder membawa commit snapshot; legacy menyatakan missing data (`src/lib/utils/historyReceipt.ts`, `src/lib/services/riwayatPrint.ts`, receipt-output/archive-version tests). Bukti printer fisik hanya AUD-062.                                                  |
| AUD-015 | Sesuai teknis       | Username unique tenant/collation dan credential update/revoke atomik (`src/lib/server/services/credentialService.ts`, `src/tests/credential-username-tests.ts`, auth E2E). Staging/production preflight bukan diasumsikan dari unit.                                                         |
| AUD-016 | Sesuai teknis       | Public username-missing/password-wrong contract seragam (`src/lib/server/services/authService.ts`, `e2e/auth-enumeration.spec.ts`, auth-service tests), rate limit tetap ada.                                                                                                                |
| AUD-017 | Sesuai teknis       | Observability mengambil session branch; anonymous tidak memilih tenant (`src/lib/server/observability.ts`, `src/tests/telemetry-scope-tests.ts`), outage best-effort.                                                                                                                        |
| AUD-018 | Sesuai teknis       | History collect/summarize bertag branch, owner scoped dan admin permission terpisah (`api/cache-metrics`, `api/security-events`, `src/tests/diagnostic-scope-tests.ts`). Actual handler fixture digunakan.                                                                                   |
| AUD-019 | Sesuai teknis       | Login/session/UI memakai `src/lib/utils/roles.ts`; unknown canonical session ditolak, tiga role konsisten (`role-contract-tests`, auth browser). **Generated realtime exception tetap gagal AUD-050**, bukan dianggap sudah ikut policy.                                                     |
| AUD-020 | Sesuai teknis       | Captured branch diteruskan ke actual fetch dan generation cache (`src/lib/services/productService.ts`, `dataApiClient.ts`, `src/lib/utils/cache.ts`, `e2e/cache-branch.spec.ts`). Late/invalidation cases tersedia; tidak mengklaim semua physical offline devices.                          |
| AUD-021 | Sesuai teknis       | Stok current generation/context menguasai commit/loading/error (`src/routes/stok/+page.svelte`, `e2e/stock-generation.spec.ts`), delayed ordering test tersedia dan browser lulus.                                                                                                           |
| AUD-022 | Sesuai teknis       | Subscription setup/disposal sync + continuation guard/named handler (`stok/+page.svelte`, `e2e/stock-lifecycle.spec.ts`); SPA destroy/pending observation lulus, bukan hanya full page reload.                                                                                               |
| AUD-023 | Tidak sesuai        | Chromium utility actual gagal empty-focus dan nested Escape; unit mock/matematika tidak meliputnya (F-023).                                                                                                                                                                                  |
| AUD-024 | Sebagian            | Dialog stok bernama dan migrated primitive; `e2e/stock-dialogs.spec.ts` positif keyboard/mobile tersedia/lulus. Primitif yang diwajibkan sudah lolos AUD-023 masih mempunyai gap, jadi tidak menerima blanket keyboard-safety completion.                                                    |
| AUD-025 | Sesuai teknis       | Backdrop Enter dismiss dihapus; focused form/control tetap submit/cancel (`modalSheet.svelte`, `e2e/sheet-enter.spec.ts`). Status terbatas pada kontrak Enter/submit ini, tidak menghapus edge case shared focus AUD-023.                                                                    |
| AUD-026 | Sesuai teknis       | Default instant WITA menggunakan helper yang sama; frozen boundary unit dan browser timezone UTC-11/WIB lulus (`catatState.svelte.ts`, catat-timezone suites), explicit date/time tetap tersedia.                                                                                            |
| AUD-027 | Sebagian            | Source query mempunyai WITA bounds + desc + limit 5 + error state (`catatState.svelte.ts`). Dua browser regressions gagal karena fixture CSRF dan failure injection salah consumer; trace belum memberi proof acceptance end-to-end deterministik.                                           |
| AUD-028 | Sesuai teknis       | Named tax handler, remove-before-register/destroy, refresh ownership (`laporanState.svelte.ts`, `e2e/laporan-tax.spec.ts`) mendukung satu logical refresh.                                                                                                                                   |
| AUD-029 | Sesuai teknis       | Canonical five-branch labels + unknown neutral dan actual authenticated branch/reload tests (`src/lib/utils/branches.ts`, branch-label tests, `e2e/dashboard-branch.spec.ts`) tersedia/lulus.                                                                                                |
| AUD-030 | Tidak sesuai        | Summary arsip 40000 benar, tetapi monthly/top-product/daily facts kosong pada archive-only fixture (F-030).                                                                                                                                                                                  |
| AUD-031 | Sesuai teknis       | Canonical omzet/YTD/year segmentation dipakai untuk summary; actual DB numeric parity 600m+100k -> 500, capital excluded (`src/tests/ai-report-tests.ts`, report-tax/tax suites). Tidak menyertifikasi seluruh detail DTO AUD-030.                                                           |
| AUD-032 | Sesuai teknis       | Category validator/prompt/consent memakai policy kanonik modal/prive vs usaha (`src/lib/utils/ledgerCategory.ts`, `autoApplyService.ts`, ledger-category/AI report/AI category E2E), cashflow tidak disamakan taxable turnover.                                                              |
| AUD-033 | Tidak sesuai        | Schema/consent hardening ada, tetapi stale manual update tetap diterima tanpa expected-revision CAS (F-033).                                                                                                                                                                                 |
| AUD-034 | Tidak sesuai        | Nonstream timeout tidak cancel body/abort upstream; bounded response bukan bounded resources (F-034).                                                                                                                                                                                        |
| AUD-035 | Sebagian            | HPP sudah lewat gateway, owner/session dan limiter sebelum upstream (`hppParseUseCase.ts`, `hpp-parse-usecase-tests`, `e2e/hpp-parse.spec.ts`). Valid provider-backed HTTP parse belum lengkap; gateway resource contract F-034 masih bermasalah.                                            |
| AUD-036 | Sesuai teknis       | Explicit future/invalid calendar ditolak dengan frozen WITA boundary sebelum historical query (`src/lib/server/aiPeriod.ts`, ai-period/usecase tests).                                                                                                                                       |
| AUD-037 | Sesuai teknis       | Public AI message/code tetap, raw internal error tidak diteruskan (`src/lib/server/ai/aiChatUseCase.ts`, gateway, `e2e/aichat-errors.spec.ts`, error-code tests). Provider readiness tetap AUD-061.                                                                                          |
| AUD-038 | Sesuai teknis       | Historical session memilih requested WITA opening period/excludes current session (`ai/reportData.ts`, `ai-report-tests` historical/current/no-session cases), bukan sesi live tanpa label.                                                                                                  |
| AUD-039 | Tidak sesuai        | Multi-chunk/resume/claim/readback guard ada, tetapi single oversized row melampaui byte cap (F-039). Largest target/R2 staging performance juga belum dibuktikan.                                                                                                                            |
| AUD-040 | Tidak sesuai        | Actual bytes/auth/retry download ada (`archive-download-tests`, `e2e/archive-download.spec.ts`), tetapi server masih `arrayBuffer()` bukan streaming dedicated boundary (F-040).                                                                                                             |
| AUD-041 | Sesuai teknis       | Writer v3, explicit field map, supported legacy decode/unsupported version rejection dan round-trip (`archiveUseCase.ts`, `restore-archive-lib.mjs`, archive-version tests) mendukung version contract; business validity terpisah AUD-042.                                                  |
| AUD-042 | Tidak sesuai        | Full business preflight belum lengkap; invalid receipt/header quantity/date diterima (F-042).                                                                                                                                                                                                |
| AUD-043 | Tidak sesuai        | Chunk restore commit langsung live; conflict akhir meninggalkan commit awal, bertentangan zero-live-change final apply (F-043).                                                                                                                                                              |
| AUD-044 | Sebagian            | Verifier COMPLETE/file/size/SHA/external root/target dipakai ulang (`d1-backup.mjs`, wipe tests); fabricated manifest ditolak. Actual safe CLI/valid recovery prerequisite belum lengkap; npx shell-false portability dan F-046 membatasi proof operasional.                                 |
| AUD-045 | Sebagian            | Wipe SQL satu branch transaction + archive guards ada (`scripts/wipe-branch-history.mjs`, tests). Executor tests memeriksa SQL/order/failure, bukan actual SQLite/workerd mid/late rollback + concurrency seluruh business tables. Tidak dilakukan production wipe.                          |
| AUD-046 | Tidak sesuai        | Incomplete two-table dump PASS; actual `--d1` CLI gagal meski operations hijau (F-046).                                                                                                                                                                                                      |
| AUD-047 | Sebagian            | Parser documented flags/external backup/dry-run diperbaiki (`scripts/rollback-migration.mjs`, rollback tests), tetapi checker menerima incomplete dump dan Windows actual child `npx` shell-false tidak ditemukan pada environment audit; staging rollback/schema/data proof belum tersedia. |
| AUD-048 | Sesuai teknis       | Exact loopback URL guard sebelum credentials/network + actual CLI negative tests (`scripts/uat-target.test.mjs`, live safety self-test); lookalike/userinfo/protocol ditolak.                                                                                                                |
| AUD-049 | Tidak sesuai        | Settle response bounded ada, tetapi audit enqueue dilakukan setelah commit; outbox outage menyebabkan hilangnya durable intent (F-049).                                                                                                                                                      |
| AUD-050 | Tidak sesuai        | Binding checks/patch guards ada; generated auth tidak memeriksa live profile canonical, dan compiled Worker smoke belum terbukti (F-050).                                                                                                                                                    |
| AUD-051 | Sebagian            | Retention/drain-250/pending-leased safety diuji (`realtimeWorker.js`, `src/tests/retention-tests.ts`). Permanent poison/quarantine, throughput target, actual scheduled runtime belum lengkap; F-049 tetap mencegah drain intent yang tidak pernah tersimpan.                                |
| AUD-052 | Sesuai teknis       | Dependency graph diperbarui dan current `pnpm audit --json` semua severity nol; CI build/PDF/PWA consumers tetap hijau. Bukan klaim nol risiko supply chain selamanya.                                                                                                                       |
| AUD-053 | Sebagian            | Refactor nyata: route DB allowlist **0**, explicit any **0**, empty catch **0**, menu modals extracted, CI/E2E terkait hijau. Correctness prerequisite belum closed dan commit fondasi lintas fase tidak memenuhi aturan atomik (lihat §5).                                                  |
| AUD-054 | Tidak sesuai        | Mock/source-text tests dan incorrect consumer injections masih ada; green gates gagal menangkap reproduced invariant violations (F-054).                                                                                                                                                     |
| AUD-055 | Tidak sesuai        | Auth/CLI/schema docs banyak diperbarui, tetapi ADR FK masih salah; D1 actual rejects invalid FK reference (F-055).                                                                                                                                                                           |
| AUD-056 | Sebagian            | Raw-byte manifest hashes/tamper guards dan LF policy tetap kuat (`preflight-release.mjs`, tests, `.gitattributes`), CI artifact/deploy sukses. Fresh Windows/Linux checkout + actual artifact download/strict verify portability matrix belum dibuktikan lengkap pada audit ini.             |
| AUD-057 | Sebagian            | Budget lokal/2000-row metrics tersedia; largest ~22k legacy, compiled Worker/D1, cold/warm/device payload/concurrency/peak memory belum dibuktikan (§6).                                                                                                                                     |
| AUD-058 | Sebagian            | Backup inventory/orphan decision dan post-owner-cleanup read-only record ada. Tidak mengklaim orphan masih live; seluruh affected-domain inventory/approved before-after parity lima cabang belum lengkap (§6).                                                                              |
| AUD-059 | Sebagian            | Dua backup set nyata terverifikasi; isolated SQLite checker menemukan 1 orphan pada Samarinda, shard lain PASS terbatas. Production additive migration record ada, tetapi actual isolated D1/full parity/staging rollback/RPO/RTO semua scope belum terbukti (§6).                           |
| AUD-060 | Belum terverifikasi | Config/deploy/browser evidence dan attestation owner ada; physical push acceptance matrix seluruh supported devices/states tidak tersedia untuk independent verification (§6).                                                                                                               |
| AUD-061 | Sebagian            | Satu synthetic live request dicatat; belum seluruh provider/chat/HPP/report/cancel/fallback/quota contract, dan F-030/F-034 belum selesai (§6).                                                                                                                                              |
| AUD-062 | Belum terverifikasi | Receipt software tests/owner physical attestation ada; per-supported-channel physical output dan recovery/archive/offline matrix tidak dapat diverifikasi independen (§6).                                                                                                                   |
| AUD-063 | Tidak sesuai        | CI/deploy exact-SHA benar, tetapi prerequisite seluruh 62 acceptance completed tidak benar; final CLOSED tidak lolos gate-nya sendiri (F-063).                                                                                                                                               |

## 8. Tindakan lanjut yang disarankan — belum dieksekusi

1. **Reopen closure dan kartu yang gagal kontrak**, tanpa menghapus sejarah CI/deploy yang memang sukses. Tidak menerima blanket “63/63 sesuai plan”.
2. Dahulukan **AUD-043/042/046** (restore/recovery), **AUD-006/005** (uang/idempotency), **AUD-049/050** (audit/security). Tambahkan regression yang mengassert expected behavior, bukan hasil bug probe.
3. Pertahankan atomicity restore yang dijanjikan atau buat keputusan ADR/owner eksplisit dan revisi seluruh acceptance/support contract; jangan menyembunyikan perubahan sebagai chunking.
4. Selesaikan fakta AI aktif/arsip, cancellation lifecycle, archive oversized-row policy/streaming download, dan utility fokus nested/no-controls.
5. Perbaiki targeting/fixture E2E Catat; jalankan lagi setelah diagnosis, bukan menambah retry untuk meredakan merah. Perkuat tests yang saat ini melewati consumer rusak.
6. Lengkapi operator matrix recovery/RPO/RTO, target-runtime largest-data performance, push/perangkat, provider, dan printer dengan approval yang spesifik. Attestation tetap dicatat sebagai attestation, bukan observasi agen.
7. Jalankan consolidated gates/compiled-artifact smoke pada candidate baru yang sama, lalu baru lakukan review dan sign-off ulang. Semua production action tetap memerlukan izin tersendiri.

Laporan ini tidak mengubah tracker, memperbaiki kode, melakukan commit/push, atau mengotorisasi production operation. Kesimpulannya tentang **kecukupan implementasi dan bukti terhadap rencana**, bukan klaim seluruh aplikasi tidak berfungsi atau data production pasti rusak.
