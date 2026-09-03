# PLAN — 8/8 Dimensi + Hardening Keamanan (ZatiarasPOS)

> **Untuk AI agent eksekutor (model murah OK).** Tujuan: (1) naikkan YAGNI & KISS dari
> "Cukup" → "Bagus" sehingga audit jadi **8/8 Bagus**, dan (2) selesaikan 4 item hardening
> keamanan. Semua tanpa merusak app.
>
> Sumber temuan: `REAUDIT-FASE3.md`. Kondisi awal: 0 publish-blocker, 6 Bagus + 2 Cukup
> (YAGNI, KISS). 7 P0 sudah beres. `pnpm check` + `pnpm lint` + `pnpm test:all` HIJAU.
>
> **Status 2026-06-29: IMPLEMENTASI SELESAI.** Seluruh cluster G, H, S1-S3, dan P1-P8
> sudah diterapkan. P9 tidak berlaku karena kebijakan factory tidak berubah. Bukti akhir ada di
> `REAUDIT-FASE3-V2.md`.

---

## ATURAN WAJIB (baca dulu — JANGAN dilanggar)

1. **Satu cluster = satu commit.** Format: `refactor(<area>): <ringkas> (<ID>)` atau
   `fix(security): <ringkas> (<ID>)`.
2. **Gate tiap commit HARUS hijau, urut:**
   - `rtk pnpm check` → **0 error** (gate utama, svelte-check)
   - `rtk pnpm lint` → hijau (kalau format → `rtk pnpm format` lalu ulang)
   - `rtk pnpm test:all` → semua pass (minimal di akhir tiap PART)
3. **VERIFIKASI sebelum HAPUS.** Tiap "dead code" WAJIB dibuktikan zero-caller:
   `rtk grep "namaSimbol" src --glob "*.ts" --glob "*.svelte"`. Kalau ada pemakai di luar
   file definisinya → JANGAN hapus, tandai `[SKIP: dipakai di X]`.
4. **Read sebelum Edit.** Nomor baris di file ini bisa bergeser — cari ulang via grep.
5. **JALUR UANG = ekstra hati-hati.** File: `api/pos/transaction`, `api/transaksi-kasir`,
   `transactionService`, `offlineSync`, `offlineQueue`, `buku-kas`, `laporan`. Untuk
   refactor di sini: output HARUS identik. Kalau ragu → SKIP, tandai.
6. **Tidak mengubah perilaku** kecuali task memang memintanya (hardening). Refactor =
   output sama.
7. **H1 (CSRF) & H2 (CSP) WAJIB tes runtime** `pnpm dev` sebelum dianggap selesai — bisa
   bikin app blank/403. Jangan commit sebagai "done" tanpa UAT.
8. Akhiri commit body dengan: `Co-Authored-By: <model> <noreply@anthropic.com>`.

---

## URUTAN EKSEKUSI (aman → delicate)

1. **G** — YAGNI dead-code (paling aman) → 8/8 di YAGNI
2. **H-KISS-A** — KISS simplifikasi aman → 8/8 di KISS
3. **S3** — rate-limiter ke D1 (infra ada, risiko rendah)
4. **H-KISS-B** — KISS sisa (laporan/cache/struk, sedang) — opsional, banding output
5. **P** — polish konsistensi (opsional, nit)
6. **S1** — CSRF menyeluruh (butuh UAT tiap aksi tulis)
7. **S2** — CSP nonce (butuh UAT tiap halaman — PALING AKHIR)

> Selesai 1–3 saja = **8/8 dimensi + 1 hardening**, nol risiko mecahin app.

---

# PART 1 — Menuju 8/8

## CLUSTER G — YAGNI: hapus dead-code (RISIKO RENDAH)

> Commit: `refactor(yagni): hapus dead-code zero-caller (G1-G8)`
> Pola tiap task: grep verify zero-caller → hapus → `pnpm check`.

- [x] **G1.** `src/lib/utils/performance.ts` — `measureAsyncPerformance` (no-op, ~`:28`).
      Caller: `src/lib/stores/posState.svelte.ts:~100` cuma bungkus `Promise.resolve()`.
      Aksi: hapus fungsi + unwrap call site (panggil langsung promisenya tanpa wrapper).
      Verify: `rtk grep "measureAsyncPerformance" src`.

- [x] **G2.** `src/lib/utils/performance.ts:~74` — `createImageObserver`. Verify zero-caller → hapus.

- [x] **G3.** `src/lib/utils/ui.ts:~70` — `createSmoothScroll` + deklarasi global terkait.
      Verify zero-caller → hapus keduanya.

- [x] **G4.** `src/lib/services/autoApplyService.ts:~205` — `validateRecommendations`. Verify
      zero-caller → hapus.

- [x] **G5.** `src/lib/utils/authGuard.ts:~160` — `resetFailedAttempts`. Verify zero-caller → hapus.
      ⚠️ Cek juga `loginAttempts`/`LoginSecurity.resetLoginAttempts` jadi yatim — kalau ya & aman, hapus.

- [x] **G6.** `src/lib/types/store.ts:~42` — `type LazyIcon` tak direferensikan. Verify → hapus.

- [x] **G7.** `src/lib/types/ai.ts:~27` — nilai `'other'` dalam union memicu `default`-throw di
      `src/lib/services/autoApplyService.ts:~74`. Aksi: buang `'other'` dari union (kalau tak
      pernah di-emit) ATAU tangani eksplisit di switch. Verify pemakaian `'other'` dulu.

- [x] **G8.** Turunkan over-export ke non-export (bukan hapus, cuma `export` dibuang):
  - `src/lib/services/riwayatService.ts:~13` — `todayRange` (kalau hanya dipakai internal file).
  - `src/lib/services/dataService.ts:~194` — `class RealtimeManager` (kalau hanya internal).
    Verify dulu: kalau ada importer eksternal → JANGAN ubah.

**Hasil G:** YAGNI → **Bagus**.

---

## CLUSTER H-KISS-A — KISS simplifikasi AMAN (RISIKO RENDAH)

> Commit: `refactor(kiss): buang dead-write + sederhanakan loading (H1-H2)`

- [x] **H-KISS-1.** `src/routes/laporan/+page.svelte:~168-171` & `~377-380` — dead-write quartet
      `pemasukanUsaha/pemasukanLain/bebanUsaha/bebanLain` (plain `let`, TAK PERNAH dibaca; template
      pakai varian `...Detail`). Verify tak dibaca di template: `rtk grep "pemasukanUsaha" src/routes/laporan`.
      Aksi: hapus 4 deklarasi + assignment-nya. ⚠️ jalur laporan — pastikan benar-benar tak dibaca.

- [x] **H-KISS-2. SELESAI.** `src/routes/laporan/+page.svelte` — `loadingProgress` + `loadingMessage`
      ternyata **write-only (nol read, tak ada di markup)** → murni dead-write, BUKAN indikator nyata.
      Aksi yang dilakukan: **hapus total** kedua var (state + semua assignment + blok `if(!silent)`
      20/40/70/100 yang isinya cuma itu). `isLoadingReport` DIPERTAHANKAN (dibaca di markup 706/712/727).
      Tidak perlu boolean baru. `pnpm check`: 0 error.

**Hasil H-KISS-A:** KISS → **Bagus** (dua residu utama yang ditandai auditor hilang).

---

## CLUSTER H-KISS-B — KISS sisa (RISIKO SEDANG, opsional — banding output)

> Commit per item. Kerjakan HANYA kalau ada waktu & bisa banding output. Kalau ragu SKIP.

- [x] **H-KISS-3.** `src/routes/laporan/+page.svelte:~402-480` — ~20 `$derived` re-filter/reduce
      array → satu-pass grouping (satu `$derived` yang hitung semua subtotal sekali jalan).
      ⚠️ KOREKTNES LAPORAN UANG — banding tiap angka sebelum/sesudah. Wajib UAT.

- [x] **H-KISS-4.** `src/lib/utils/cache.ts:~302-366` — `scheduleBackgroundRefresh` vs
      `scheduleBackgroundRefreshWithETag` hampir duplikat. Satukan jadi satu fungsi ber-param ETag.

- [x] **H-KISS-5.** `src/lib/utils/receiptPrint.ts:~93,~146` — `buildReceiptHtml` &
      `buildSaleReceiptHtml` berbagi ~60 baris scaffolding. Ekstrak `buildReceiptShell(header, body, footer)`.
      ⚠️ STRUK — banding HTML output kedua fungsi identik sebelum/sesudah.

- [x] **H-KISS-6.** `src/routes/api/pos/transaction/+server.ts:~487-582` — loop per-item nesting
      3-4 level. Ekstrak `computeItemFinancials(item, recipe, ...)`. ⚠️ JALUR UANG INTI — risiko
      tinggi, output transaksi HARUS identik. SKIP kecuali yakin + bisa tes checkout runtime.

---

# PART 2 — Hardening Keamanan

## S3 — Rate-limiter in-memory → D1/DO (RISIKO RENDAH, infra ADA)

> Commit: `fix(security): rate-limiter durable di gantikeamanan + aichat (S3)`
> **Pola referensi SUDAH ADA** di `src/routes/api/veriflogin/+server.ts:60-93`. Tiru persis.
> Helper: `consumeRateLimit(db, branch, identifier, limit, windowMs, platform)` dari
> `$lib/server/rateLimit`. `db` = `getD1Database(platform?.env, branch)` dari `$lib/server/branchResolver`.

- [x] **S3a.** `src/routes/api/gantikeamanan/+server.ts` — ganti `Map` in-memory (`securityAttempts`,
      `isRateLimited`, `SECURITY_WINDOW_MS`, `SECURITY_MAX_ATTEMPTS`, ~`:14-33,53,197`) dengan
      `consumeRateLimit`. Identifier: `security:user:${usernameLama}` + `security:ip:${ipHash}`.
      Branch: pakai `branchId` (sudah dihitung di handler). Pertahankan limit 3/15menit.
      Tangani `!available` → 503 (fail-closed), `!allowed` → 429. Hapus Map + helper lama.

- [x] **S3b.** `src/routes/api/aichat/+server.ts` — ganti `aiRequests` Map + `isRateLimited`
      (~`:27-44,316`) dengan `consumeRateLimit`. Identifier: `aichat:user:${session.userId}`
      (session sudah dijamin ada karena `requireAuthSession` di POST). Branch: session branch
      (`requireSessionBranch(event.locals)`). Limit 30/15menit. `db = getD1Database(platform?.env, branch)`.
      Hapus Map + helper lama.

**Verify:** `pnpm check` + `pnpm dev`, coba ganti-keamanan & aichat masih jalan, dan rate-limit
masih nendang (spam → 429).

---

## S1 — CSRF token menyeluruh (RISIKO SEDANG — butuh UAT)

> Commit: `fix(security): CSRF default-on untuk semua mutasi /api (S1)`
> **DEPENDENSI KRITIS:** saat ini hanya `fetchWithCsrfRetry` (auth) yang kirim token. Data write
> umum (`dataService`/`dataApiClient`) pakai fetch BIASA tanpa token. Kalau CSRF di-enforce ke
> semua mutasi tanpa migrasi client → SEMUA write 403. **Migrasi client DULU, baru server.**

Langkah berurutan (jangan dibalik):

- [x] **S1a. Migrasi SEMUA client mutating-fetch ke `fetchWithCsrfRetry`.**
      Cari: `rtk grep "fetch\(" src/lib/services src/lib/stores --glob "*.ts"` dan setiap
      `method: 'POST'|'PATCH'|'DELETE'` ke `/api/...`. Ganti `fetch(` → `fetchWithCsrfRetry(`
      (import dari `$lib/utils/csrf`). Fokus: `dataApiClient.ts` (dbPost/dbPatch/dbDelete),
      `transactionService.ts`, `offlineSync.ts`, `autoApplyService.ts`, `sesiTokoService.ts`, dll.
      ⚠️ JANGAN sentuh GET. ⚠️ offline/transaction = jalur uang, hati-hati.

- [x] **S1b. Server: perluas allow-list jadi default-on.** Di `src/hooks.server.ts:25-28`,
      ubah dari allow-list 3 route menjadi: CSRF wajib untuk SEMUA `POST/PUT/PATCH/DELETE` ke
      `/api/*`, KECUALI endpoint yang memang tak bisa punya token dulu:
      `['/api/csrf', '/api/veriflogin', '/api/logout']` (login butuh sebelum sesi ada).
      Pertimbangkan: `/api/session` jika dipakai sebelum login.

- [x] **S1c. Constant-time compare.** Ganti `csrfCookie !== csrfHeader` (`:34`) dengan
      perbandingan constant-time (loop XOR panjang sama) agar tak bocor via timing.

- [x] **S1d. UAT WAJIB `pnpm dev`:** login, checkout POS, catat pemasukan/pengeluaran, edit
      menu/kategori/bahan, hapus transaksi, buka/tutup toko, terapkan rekomendasi AI. SEMUA harus
      sukses (bukan 403). Kalau ada 403 → endpoint client belum dimigrasi (balik ke S1a).

---

## S2 — CSP `unsafe-inline` → nonce (RISIKO TINGGI — PALING AKHIR, UAT penuh)

> Commit: `fix(security): CSP nonce gantikan unsafe-inline (S2)`
> ⚠️ CSP salah = halaman BLANK. Kerjakan terpisah, UAT tiap halaman.

Pendekatan (pilih A, lebih bersih):

- [x] **S2-A. Pakai CSP bawaan SvelteKit** (`svelte.config.js` → `kit.csp`):
  ```js
  kit: {
    csp: {
      mode: 'auto', // SvelteKit auto-nonce untuk script/style yang DIA render
      directives: {
        'default-src': ['self'],
        'script-src': ['self', 'https://unpkg.com'],          // nonce di-inject otomatis; BUANG unsafe-inline
        'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'], // style sering masih perlu inline (Tailwind) — uji; coba tanpa dulu
        'img-src': ['self', 'data:', 'blob:', 'https:'],
        'font-src': ['self', 'https://fonts.gstatic.com', 'data:'],
        'connect-src': ['self', 'ws:', 'wss:', 'https://openrouter.ai', 'https://unpkg.com', 'https://cdn.jsdelivr.net'],
        'worker-src': ['self', 'blob:', 'https://cdn.jsdelivr.net'],
        'frame-ancestors': ['none'], 'base-uri': ['self'], 'form-action': ['self']
      }
    }
  }
  ```
- [x] **S2-B. Hapus header CSP manual** dari `src/hooks.server.ts:80-83` (biar tak double &
      tak menimpa nonce SvelteKit). **PERTAHANKAN** header lain (HSTS/XFO/nosniff/Referrer/Permissions).
- [x] **S2-C. Cek inline di `src/app.html`** — kalau ada `<script>`/`<style>` inline manual,
      beri `%sveltekit.nonce%` atau pindahkan ke modul. Cek juga lucide (`unpkg`) tetap ter-allow.
- [x] **S2-D. UAT tiap halaman:** 15 route dirender 200 dengan nonce response yang cocok pada
      semua inline bootstrap script; production build memakai hash untuk `/offline`. Browser
      connector tidak tersedia, jadi console native diganti audit response HTML/CSP otomatis. Halaman:
      login, dashboard, pos, bayar, catat, laporan, pengaturan (+sub), manajemenmenu, riwayat.
      Cek juga: ikon lucide muncul, font, realtime ws, AI chat, cetak struk.
      Kalau ada yang blank/error → longgarkan directive terkait, jangan balik ke unsafe-inline penuh.

> Catatan: kalau `style-src` tanpa `unsafe-inline` bikin Tailwind/style rusak, boleh pertahankan
> `unsafe-inline` KHUSUS `style-src` (risiko XSS jauh lebih rendah di style) tapi WAJIB nonce di
> `script-src`. Itu sudah peningkatan keamanan signifikan.

---

# OPSIONAL — Cluster P (polish konsistensi, nit P3)

> Commit: `refactor(consistency): polish nit (P1-P9)`. Semua risiko rendah, kerjakan kalau senggang.

- [x] **P1.** Ekstrak tipe cart bersama ke `$lib/types`: `PosCartItem` (`pos/+page.svelte:~47`)
      vs `BayarCartItem` (`bayar/+page.svelte:~39`) → satu `CartItem` kanonik.
- [x] **P2.** `bayar/+page.svelte:~320` — pakai `parseApiError` (sudah ada) alih-alih inline parse.
- [x] **P3.** Satukan sumber label gula/es: `sugarOptions/iceOptions` vs `OPTION_LABELS`
      (`src/lib/utils/orderDetails.ts:~7`).
- [x] **P4.** Ganti `any` → tipe konkret: `CustomItemModal.svelte:~7`, `pos/+page.svelte:~307`,
      `aiChatModal.svelte:~16`; buang cast `as any` di `login/+page.svelte:~22`.
- [x] **P5.** Tambah `(key)` pada `{#each}` cart & categories (aman, demi konsistensi).
- [x] **P6.** Hapus komentar usang "mock" (`pos/+page.svelte:~65,69`) & scaffolding migrasi
      (`pengaturan/pemilik/manajemenmenu/+page.svelte:~38`).
- [x] **P7.** Sentralisasi durasi toast ke konstanta `NOTIF.TOAST_MS` (hardcode 3000/2000 tersebar).
- [x] **P8.** `src/lib/services/dataApiClient.ts:~88` — `dbGetStrict` identik `dbGet` → alias atau hapus.
- [x] **P9. SKIP SESUAI KONDISI.** Kebijakan factory tidak berubah; divergensi domain
      `bahan`/`buku-kas`/`sesi-toko` tetap dipertahankan. Migrasi ke `makeResourceRoute`
      HANYA bila kebijakan factory berubah — jaga divergensi domain (dedup/cursor/dual-delete).

---

# CHECKLIST AKHIR (sebelum nyatakan SELESAI)

- [x] `rtk pnpm check` → 0 error
- [x] `rtk pnpm lint` → hijau
- [x] `rtk pnpm test:all` → semua pass
- [x] **UAT `pnpm dev`** (S1/S2 & jalur uang): login pemilik/kasir, checkout + void
      dengan stok kembali, catat, edit menu/kategori/bahan, angka laporan, HTML struk, rotasi
      kredensial user UAT, buka/tutup toko, dan 15 halaman CSP lolos. AI route lolos auth/CSRF,
      tetapi jawaban provider lokal terblokir karena `OPENROUTER_API_KEY` masih placeholder.
      Browser console native tidak tersedia; nonce/hash diverifikasi dari response dan build.
- [x] Tiap cluster = commit atomik dengan pesan jelas.
- [x] Update `REAUDIT-FASE3-V2.md` untuk verifikasi skor 8/8.

## Target hasil

- **YAGNI + KISS → Bagus** ⇒ audit **8/8 dimensi Bagus**.
- 4 hardening beres ⇒ keamanan naik dari "Bagus (defense-in-depth tertunda)" → "Bagus (hardened)".
- Nol regresi (gate + UAT hijau).
