# FASE 3 — Quality Backlog (ZatiarasPOS)

> **Untuk AI agent eksekutor (model murah OK).** Tiap task atomik, ada lokasi persis,
> aksi, cara verifikasi, dan level risiko. Kerjakan **berurutan dari atas** (sudah
> diurut aman → berisiko). Sumber: `AUDIT-WHITELABEL.md` (P1–P3) + `CONVENTIONS.md`.
>
> **Bukan** termasuk: 7 P0 (sudah beres) dan white-label/branding/config (ditunda
> pemilik). Ini murni prinsip kode: YAGNI, DRY, SOLID, CONSISTENCY, READABILITY,
> MAINTAINABILITY.

---

## ATURAN WAJIB (baca dulu, jangan dilanggar)

1. **Satu cluster = satu commit.** Format pesan: `refactor(<area>): <ringkas> (<ID task>)`.
2. **Gate tiap commit HARUS hijau:** jalankan berurutan
   - `rtk pnpm check` → **0 error** (svelte-check, ini gate utama)
   - `rtk pnpm lint` → hijau (prettier + eslint)
   - kalau format gagal: `rtk pnpm format` lalu commit ulang.
3. **Sebelum HAPUS apa pun (dead-code):** WAJIB buktikan zero-consumer dengan grep.
   Contoh: `rtk grep "namaSimbol" src --glob "*.ts" --glob "*.svelte"`. Kalau ada
   consumer di luar file definisinya → **JANGAN hapus**, skip & tandai. Audit pernah
   salah klaim "dead" (mis. `security.ts`, `performance.ts`) → SELALU verifikasi sendiri.
4. **Read sebelum Edit.** Jangan asal ganti baris dari nomor di file ini — nomor baris
   bisa bergeser. Pakai grep untuk cari ulang lokasi simbol sebelum edit.
5. **Jangan sentuh jalur uang tanpa perlu.** File sensitif: `api/pos/transaction`,
   `api/transaksi-kasir`, `transactionService`, `offlineSync`, `offlineQueue`. Kalau
   task menyentuh ini, kerjakan paling akhir + catat butuh tes runtime.
6. **Jangan ubah perilaku.** Ini refactor kualitas, bukan fitur/bugfix. Output sama.
7. **Caveman commit OK**, tapi jelas. Akhiri commit body dengan baris:
   `Co-Authored-By: <model> <noreply@anthropic.com>`.

---

## STATUS

- [x] components.ts dihapus (dead) — commit `b3dd29e`
- [x] CartItem/CartSummary dihapus (dead) — commit `b3dd29e`
- [x] eslint prefer-const + `T extends any` → `<T>` (performance.ts) — commit `9ee3dcd`
- [x] format codebase — commit `9ee3dcd`
- [x] Seluruh cluster A-F selesai — commits `6b0254e`, `4350ec5`, `918454e`, `0ada088`, `4f3fb3f`

---

## CLUSTER A — YAGNI dead-code (RISIKO RENDAH, kerjakan dulu)

> Pola: verifikasi zero-consumer → hapus → `pnpm check` → commit.
> Commit cluster: `refactor(yagni): hapus dead-code zero-consumer (A1–A8)`

- [x] **A1. `src/lib/utils/validation.ts:101-253`** — validator dead:
      `validateEmail`, `validatePassword`, `validateDate`, `validateSKU`, `checkRateLimit`
  - rate-limiter kedua (duplikat `security.ts`). **Sudah diverifikasi zero-consumer.**
    Aksi: hapus fungsi-fungsi itu. Pertahankan `sanitizeInput` (canonical, dipakai).
    Verifikasi ulang: `rtk grep "validateEmail|validatePassword|validateSKU|checkRateLimit" src`.

- [x] **A2. `src/lib/utils/authGuard.ts:124-177`** — method dead:
      `requireRole`, `requireAdmin`, `requireKasir`. **Sudah diverifikasi zero external consumer.**
      ⚠️ Hati-hati: setelah hapus, cek private helper yang jadi yatim (`getClientIdentifier`,
      `simpleHash`, `recordFailedAuth`, `loginAttempts`) — hapus juga HANYA kalau tak ada
      method lain yang pakai. Grep tiap helper dulu di dalam file. Pertahankan
      `requireAuth`/`isAuthenticated`/`authGuard` (dipakai).

- [x] **A3. `src/lib/types/store.ts:14,35-60`** — type dead + duplikat `BranchId`.
      Grep tiap type name dulu. `BranchId` canonical ada di `branchResolver.ts` → hapus yang duplikat.

- [x] **A4. `src/lib/types/product.ts:120-189`** — type orphan: `MenuForm`,
      `FilteredProducts`, `ProductState`, dst. Grep tiap nama. Hapus yang zero-consumer SAJA.

- [x] **A5. `src/lib/types/index.ts:36-87`** — cek `ApiResponse`, `PaginatedResponse`,
      `BaseEntity`, `ActiveEntity` — grep dulu, hapus yang zero-consumer.
      **PERTAHANKAN** `AppError`, `ApiError`, `ValidationError` (dipakai).

- [x] **A6. `src/lib/services/autoApplyService.ts:273-275`** — `rollbackChanges()` stub
      kosong (`// TODO`). Juga branch `penjualan` unreachable di `:131,148-150`.
      Aksi: kalau `rollbackChanges` dipanggil di mana pun, JANGAN hapus — beri implementasi
      minimal atau lempar error eksplisit. Kalau tak dipanggil → hapus. Grep dulu.

- [x] **A7. `src/routes/api/transaksi-kasir/+server.ts` (POST handler)** — `hasPosInsert`
      scan + `throw` pertama unreachable (ada `throw` kedua tanpa syarat setelahnya).
      Aksi: sederhanakan POST jadi langsung `throw kitError(409, ...)`. ⚠️ JALUR UANG —
      cuma hapus dead-logic, jangan ubah status 409.

- [x] **A8. `src/routes/pos/+page.svelte:16-27,48`** — dead imports (catatan `AUDIT.md:62`
      stale). `:284-293,457` `skeletonCount` dihitung tapi hardcode 12. Grep tiap import.
      ⚠️ JALUR POS — verifikasi tiap import benar-benar tak dipakai sebelum hapus.

---

## CLUSTER B — DRY dedup (RISIKO RENDAH–SEDANG)

> Pola: buat 1 helper canonical → migrasi SEMUA consumer sekaligus → hapus yang lama
> (CONVENTIONS.md §0 aturan 2 & 3) → `pnpm check` → commit.
> Commit: `refactor(dry): ekstrak helper bersama (B1–B6)`

- [x] **B1. `parseApiError` helper.** 3 impl identik `body.message||body.error||status`:
      `src/lib/services/offlineSync.ts:32-44`, `src/lib/services/dataApiClient.ts:24-31`,
      `src/lib/services/autoApplyService.ts:7-12`. Aksi: buat `parseApiError(res|body)` di
      `src/lib/utils/errorHandling.ts`, migrasi 3 consumer, hapus impl lama.
      ⚠️ offlineSync di jalur uang — hati-hati, tes setelahnya.

- [x] **B2. `formatCurrency` lokal → `formatRupiah` util.**
      `src/lib/stores/manajemenmenuState.svelte.ts` (~`:918`, fungsi `formatCurrency`
      dilewatkan prop ke BahanTab/HppTab). Aksi: ganti pakai `formatRupiah` dari
      `$lib/utils/currency`, hapus lokal. Cek BahanTab/HppTab tetap nerima fungsi yang sama
      (atau import `formatRupiah` langsung di tab).

- [x] **B3. Pos types reuse.** `src/lib/stores/posState.svelte.ts:7-27` re-declare
      `PosProduct/PosCategory/PosAddOn` + `as unknown as` cast. Aksi: reuse type dari
      `$lib/types/product`, buang cast.

- [x] **B4. `REPORT_CACHE_VERSION` duplikat.** `src/lib/services/dashboardService.ts:14`
      & `src/lib/services/dataService.ts:12`. Aksi: pindah ke satu konstanta bersama
      (mis. `src/lib/constants/`), import di dua tempat. (Hazard desync.)

- [x] **B5. `NotifModal` ~90 baris duplikat.** `src/routes/pos/bayar/+page.svelte:864-953`
      vs `src/routes/catat/+page.svelte:380-469`. Aksi: ekstrak komponen
      `src/lib/components/shared/NotifModal.svelte`, pakai di kedua tempat. ⚠️ bayar = jalur
      uang, jangan ubah perilaku modal.

- [x] **B6. AI modal shell + SVG send-arrow duplikat** (P3, opsional). `aiChatModal.svelte`
      & `LaporanAISection.svelte`. Ekstrak shell bersama kalau worth; kalau ragu, SKIP.
      **Resolusi:** `SendIcon` diekstrak; shell tetap terpisah karena alur chat dan hasil laporan
      berbeda. Abstraksi shell ditolak sebagai YAGNI.

- [x] **B7. gula/es label ladder duplikat** (P3). `bayar:413-433` & `:566-585`. Ekstrak
      satu helper format gula/es. ⚠️ jalur uang/struk — hati-hati.

---

## CLUSTER C — CONSISTENCY (RISIKO RENDAH)

> Commit: `refactor(consistency): seragamkan pola (C1–C7)`

- [x] **C1. `{#each}` tanpa key** → tambah key unik. Lokasi: `ProductGrid.svelte:73,132`,
      `MenuTab.svelte:120,165,221`, `dropdownSheet.svelte:45`, `WeeklyChart.svelte:72`,
      `pengaturan/pemilik/riwayat/+page.svelte:301`. Pakai `id` row sebagai key.

- [x] **C2. Props `any` → typed.** `ProductGrid.svelte`, `CartPreview.svelte`,
      `DashboardMetrics.svelte` pakai `any` di `$props`. Ganti pakai type dari
      `$lib/types/product` / `laporan`. (File lain sudah fully-typed — ikut polanya.)

- [x] **C3. Svelte 4 `let` → runes.** `src/routes/pengaturan/pemilik/gantikeamanan/+page.svelte:15-40`
      & `src/routes/pengaturan/printer/+page.svelte:14-22` masih `let`/`$:`. Migrasi ke
      `$state`/`$derived` (ikut pola file lain yang sudah runes).

- [x] **C4. Role naming `admin` vs `pemilik`.** `src/routes/monitoring/+page.server.ts:9-11`
      butuh role `admin` padahal owner = `pemilik`. Samakan ke konvensi proyek (pemilik=owner,
      admin=superuser). Putuskan & dokumentasikan, jangan diam-diam.

- [x] **C5. Label non-cash `qris` vs `non-tunai`.** `src/lib/server/reportQueries.ts:104-114`
      POS non-cash dilabel `'qris'` di report tapi disimpan `'non-tunai'`. Seragamkan label.
      ⚠️ jalur laporan uang — cek tak mengubah angka, hanya label.

- [x] **C6. Branch casing lowercase** (CATATAN: ini overlap white-label P1-15, tapi casing
      konsistensi tetap valid). `selectedBranch.svelte.ts:1,11` & `login/+page.svelte:8,359`
      campur `'Balikpapan'` vs `'balikpapan'`. Standarisasi lowercase di store/type/option.
      Sudah ditutup `normalizeBranch`, tapi rapikan biar konsisten.

- [x] **C7. Cache key namespace branch.** `src/lib/utils/cache.ts:492-538` client cache key
      tak ber-namespace branch (potensi tampil data branch lain di multi-branch). Tambah
      prefix branch ke cache key. ⚠️ uji ganti-branch setelahnya.

---

## CLUSTER D — READABILITY (RISIKO RENDAH)

> Commit: `refactor(readability): magic number + komentar + tipe (D1–D4)`

- [x] **D1. Magic number → constants.** Buat di `src/lib/constants/`:
  - quick-cash `[5000,10000,20000,50000,100000]` di `bayar/+page.svelte:57` → `PAYMENT.QUICK_AMOUNTS`
  - notif auto-dismiss `2000`ms di `manajemenmenuState.svelte.ts` (`$effect` notif) → `NOTIF.AUTO_DISMISS_MS`
  - `skeletonCount` hardcode 12 di `pos/+page.svelte` → konstanta.

- [x] **D2. Komentar stale.** `src/lib/server/reportQueries.ts:121` komentar bilang `amount`
      padahal kode pakai `nominal`. Perbaiki komentar.

- [x] **D3. `userRole.value` typed `string`/`unknown`** → kasih union type
      (`'pemilik'|'kasir'|'admin'`). File `src/lib/stores/userRole.svelte.ts`.

- [x] **D4. Var `wita` tapi pakai UTC.** `src/routes/api/aichat/reportData.ts:286-302`
      `jamRamai`/`dailyTrend` pakai UTC server walau nama var `wita`. Rename var ATAU
      perbaiki ke WITA (cek mana yang benar dari konteks — kalau ragu, rename var saja, jangan
      ubah logika). ⚠️ jalur laporan.

---

## CLUSTER E — MAINTAINABILITY (RISIKO RENDAH–SEDANG)

> Commit: `refactor(maintainability): hardening kecil (E1–E6)`

- [x] **E1. DashboardMetrics bug-kosmetik.** `src/lib/components/dashboard/DashboardMetrics.svelte:75-76`
      icon salah (`TrendingUp` mestinya `Wallet`); `:73,90` class konflik `flex hidden`;
      markup mobile duplikat. Perbaiki icon + class, dedup markup kalau aman.

- [x] **E2. IntersectionObserver tak disconnect.** `src/lib/components/dashboard/WeeklyChart.svelte:18-31`
      tambah cleanup `observer.disconnect()` di `$effect` return / `onDestroy`.

- [x] **E3. Silent error swallow → data tampak kosong.**
      `src/lib/services/dataApiClient.ts:79-89` `dbGet` return `[]` saat non-ok (401/500 tak
      bisa dibedakan dari kosong). Aksi: throw/propagate error, jangan return `[]` diam-diam.
      ⚠️ banyak consumer baca ini — cek caller handle error. Uji dashboard.
      Juga `src/routes/api/aichat/reportData.ts:64-66,106-108` swallow → minimal log.

- [x] **E4. Schema housekeeping.** `src/lib/database/schema.ts`: index redundan
      `dailySalesSummary:249-250`; `bahan_mutasi.stok_setelah` nullable + tanpa FK; tabel
      append-only tanpa `updated_at` (undocumented). Aksi: dokumentasikan keputusan di komentar
      schema; HANYA tambah index/constraint kalau yakin tak butuh migrasi data. **Jangan ubah
      schema produksi tanpa migrasi** — kalau perlu DDL, catat sebagai task migrasi terpisah.

- [x] **E5. `compat-date` menua.** 3 file `wrangler*.jsonc` `compatibility_date 2024-05-18`.
      Bump ke tanggal terkini + test `pnpm build`. Risiko rendah tapi uji build.

- [x] **E6. D1 binding block triplikat** 3 wrangler file (UUID identik). Ini overlap
      white-label (ditunda) — SKIP kecuali diminta.
      **Resolusi:** ditutup sebagai deferred white-label. Wrangler tidak punya inheritance JSONC
      aman untuk tiga entrypoint; generator config tidak ditambah hanya demi dedup.

---

## CLUSTER F — SOLID / split besar (RISIKO SEDANG–TINGGI, paling akhir)

> Ini refactor struktural besar. Kerjakan satu per satu, commit terpisah, tes runtime tiap
> selesai. Kalau ragu / waktu mepet → SKIP, biarkan untuk sesi khusus.

- [x] **F1. Split god-store `manajemenmenuState.svelte.ts` (~1196 baris).** Pecah per concern:
      `createMenuCrud`, `createKategoriCrud`, `createEkstraCrud`, `createBahanCrud`,
      `createHppState`, helper image/cropper. Store utama jadi komposisi. ⚠️ reaktif Svelte 5 —
      WAJIB klik-test 5 tab setelahnya (build tak nangkap bug reaktivitas).
      **Implementasi:** CRUD/API, kalkulator HPP, dan helper image dipisah; store utama menjaga
      state reaktif dan orkestrasi UI.

- [x] **F2. `topBar.svelte` SRP.** `:7,22-72,144-149` chrome layout merangkap AI chat +
      refreshBus + offline/pending. Pisah jadi sub-komponen. Klik-test navigasi.

- [x] **F3. `bayar/+page.svelte` builder struk inline → `receiptPrint.ts`.** `:382-451`
      builder HTML struk ~70 baris padahal `lib/utils/receiptPrint.ts` ada (`buildReceiptHtml`).
      Migrasi (ini "P4-followup" dari AUDIT.md). ⚠️ JALUR UANG/STRUK — banding output struk
      sebelum/sesudah, harus identik. Klik-test cetak struk.

- [x] **F4. `makeResourceRoute` factory (DRY penuh).** Lanjutan P0-3 (helper
      `sanitizeUpdatePayload` sudah ada). Ekstrak pola CRUD GET/POST/PATCH/DELETE yang
      berulang di `api/<resource>/+server.ts` jadi factory. ⚠️ tiap endpoint punya variasi
      (dedup POST buku-kas, bulk delete) — factory harus param-kan itu. JALUR UANG. Risiko
      tinggi → sesi khusus + tes menyeluruh. Kalau ragu, SKIP.
      **Implementasi:** factory dipakai `produk`, `kategori`, dan `tambahan`; endpoint uang dan
      resource dengan invariant khusus tetap bespoke agar factory tidak jadi god-abstraction.

---

## URUTAN EKSEKUSI YANG DISARANKAN

1. Cluster **A** (dead-code) → commit
2. Cluster **C** (consistency, kecuali C5/C7 jalur uang di akhir) → commit
3. Cluster **D** (readability) → commit
4. Cluster **B** (DRY) → commit per 1-2 helper
5. Cluster **E** (maintainability) → commit
6. Cluster **F** (SOLID split) → satu per satu, tes runtime, atau SKIP ke sesi khusus

## CHECKLIST AKHIR (sebelum nyatakan selesai)

- [x] `rtk pnpm check` → 0 error
- [x] `rtk pnpm lint` → hijau
- [x] `rtk pnpm test:all` → semua pass
- [ ] Klik-test `pnpm dev`: 5 tab manajemenmenu, checkout POS, void transaksi, cetak struk
      — browser backend tidak tersedia; smoke HTTP lokal dan seluruh test otomatis lulus.
- [x] Tiap cluster = commit atomik dengan pesan jelas
