# Re-Audit Fase 3 — ZatiarasPOS

Audit ulang kondisi NYATA kode (verifikasi file:line langsung, bukan percaya commit message).
Konteks: 7 bug P0 sudah diperbaiki; cleanup kualitas Fase 3 sudah dijalankan; factory `makeResourceRoute` sudah dibuat & diadopsi.
Lingkup: kelayakan publish sebagai **POS single-tenant Zatiaras Juice**. White-label / multi-tenant onboarding **dikecualikan** (sengaja ditunda owner).

Tanggal: 2026-06-29 · Branch: dev

---

## 1. Skor Dimensi

| Dimensi                  | Skor      | Alasan (1 kalimat)                                                                                                                                                                                                        |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SOLID                    | **Bagus** | Factory `makeResourceRoute` nyata dipakai 3/6 route; abstraksi auth/tenant-scope/audit/publish konsisten di SEMUA 6 route; 3 route manual punya divergensi domain sah (dedup/cursor/dual-delete, coercion+FK-precheck).   |
| DRY                      | **Bagus** | Duplikasi besar sudah dikonsolidasi (struk, error-parse, orderDetails); sisa hanya 4 duplikasi kosmetik P3 (tipe cart, inline error-parse, scaffolding struk, label gula/es).                                             |
| YAGNI                    | **Cukup** | Tidak ada blocker, tapi masih ada residu dead code/over-export (createImageObserver, createSmoothScroll, measureAsyncPerformance no-op, type LazyIcon, dll) yang layak dipangkas.                                         |
| KISS                     | **Cukup** | Kode inti benar & shippable, tapi akumulasi verbositas (dead-write quartet laporan, ~20 $derived re-filter, teater loadingProgress) menahan dari "Bagus".                                                                 |
| CONSISTENCY              | **Bagus** | Jalur tulis metode-bayar sudah kanonik (qris→non-tunai sebelum DB insert) di server & halaman bayar; cek-ganda di konsumen hanya normalisasi defensif baris legacy, bukan bug.                                            |
| READABILITY              | **Bagus** | Interface bernama & rune jelas; sisa hanya komentar usang ("mock", scaffolding migrasi) dan satu param `any` — nit P3.                                                                                                    |
| MAINTAINABILITY          | **Bagus** | READ/WRITE_ROUTES map menggantikan god endpoint; sisa kosmetik (`dbGetStrict` duplikat `dbGet`, gaya `$props` WeeklyChart, fallback offline parsial).                                                                     |
| BEST-PRACTICE / SECURITY | **Bagus** | Cookie sesi httpOnly+sameSite=lax+secure, header keamanan lengkap (HSTS/CSP/XFO/nosniff), auth+role guard; sisa 4 hardening P3 defense-in-depth (CSRF token tak menyeluruh, CSP unsafe-inline, 2 rate-limiter in-memory). |

Verifikasi langsung yang dikonfirmasi pada file sensitif (uang/data):

- `resourceRouteHelpers.ts:99-171` — factory nyata: satu implementasi auth+scope+publish+audit.
- `resourceRouteHelpers.ts:43-53` — `sanitizeUpdatePayload` buang `cabang_id`/`id` (guard mass-assignment) dipanggil di SEMUA PATCH.
- `api/buku-kas/+server.ts` — RBAC (insert kasir/pemilik, update/delete pemilik), tenant-scope `cabang_id` di tiap query, dedup idempotent, sanitize PATCH.
- `api/pos/transaction/+server.ts:365-367` — money-write path: `requireSessionBranch` + `requireAnyRole(kasir/pemilik)`.
- `api/pos/transaction/+server.ts:126-129` — `normalizePaymentMethod` normalkan qris→non-tunai SEBELUM insert DB.
- `hooks.server.ts:75-83` — header keamanan komprehensif aktif.

---

## 2. Verdict Siap-Publish

### SIAP DENGAN CATATAN

App ini **aman untuk dipublish sebagai POS single-tenant Zatiaras Juice**.
Hasil verifikasi adversarial lintas 8 dimensi: **NOL publish-blocker nyata** — tidak ada bug aktif, lubang keamanan tereksploitasi, atau risiko kehilangan data/uang pada operasi single-tenant. Jalur kritis (transaksi POS, buku-kas/ledger, auth, tenant-scope, audit log) sudah benar dan terverifikasi pada kode nyata.

"Dengan catatan" = bukan blocker, melainkan backlog kualitas/hardening yang sebaiknya dikerjakan setelah publish. Semua temuan tersisa berstatus **P3** (kosmetik/higiene/defense-in-depth).

---

## 3. Publish-Blocker (WAJIB sebelum publish)

**TIDAK ADA.**

Tidak ditemukan satupun masalah yang memenuhi kriteria blocker (bug nyata / lubang keamanan / risiko kehilangan data-uang aktif di operasi single-tenant). Semua temuan dari 8 dimensi diklasifikasikan `publish_blocker=false` dan dikonfirmasi benar lewat pembacaan file langsung.

---

## 4. Post-Publish Backlog (boleh setelah publish)

Hardening keamanan (defense-in-depth, prioritaskan):

- [ ] `hooks.server.ts:25-28` — CSRF token eksplisit hanya di 3 route; route write uang/data lain (pos/transaction, buku-kas, resource routes) andalkan sameSite=lax saja. Pertimbangkan token menyeluruh.
- [ ] `hooks.server.ts:82` — CSP `script-src 'unsafe-inline'` (+unpkg); pertimbangkan nonce/hash. (base-uri/form-action/frame-ancestors sudah ketat.)
- [ ] `api/gantikeamanan/+server.ts:16` — rate-limiter Map in-memory per-isolate (3x/15m) bisa terlampaui di Workers multi-isolate; dilindungi role+verif password lama. Pindahkan ke DO/D1.
- [ ] `api/aichat/+server.ts:27` — rate-limiter AI in-memory (30/15m); konsumsi token OpenRouter bisa > intended. Pindahkan ke DO/D1.

Kebersihan kode / dead code (YAGNI):

- [ ] `utils/performance.ts:28` — `measureAsyncPerformance` no-op (caller `posState:100` hanya passing `Promise.resolve()`); hapus fungsi + call site. `createImageObserver:74` 0 caller — hapus.
- [ ] `utils/ui.ts:70` — `createSmoothScroll` 0 caller — hapus + global decl.
- [ ] `services/autoApplyService.ts:205` — `validateRecommendations` 0 caller — hapus/pakai.
- [ ] `utils/authGuard.ts:160` — `resetFailedAttempts` 0 caller — hapus.
- [ ] `types/store.ts:42` — `type LazyIcon` tak direferensikan — hapus.
- [ ] `types/ai.ts:27` — nilai `'other'` picu default-throw di `autoApplyService.ts:74`; buang dari union / tangani.
- [ ] `services/riwayatService.ts:13` (`todayRange`) & `dataService.ts:194` (`class RealtimeManager`) over-export — turunkan ke non-export.

Penyederhanaan (KISS / DRY):

- [ ] `laporan/+page.svelte:168-171,377-380` — dead-write `pemasukanUsaha/pemasukanLain/bebanUsaha/bebanLain` (plain `let`, tak pernah dibaca; template pakai `...Detail`). Hapus.
- [ ] `laporan/+page.svelte:402-480` — ~20 `$derived` re-filter/reduce array; bisa satu-pass grouping.
- [ ] `laporan/+page.svelte:110-194` — teater `loadingProgress` 20/40/70/100; boolean `isLoading` lebih KISS.
- [ ] `api/pos/transaction/+server.ts:487-582` — loop per-item nesting 3-4 level; opsional ekstrak `computeItemFinancials`.
- [ ] `utils/cache.ts:302-366` — `scheduleBackgroundRefresh` vs `...WithETag` hampir duplikat; satukan.
- [ ] `utils/receiptPrint.ts:93,146` — `buildReceiptHtml` & `buildSaleReceiptHtml` berbagi ~60 baris scaffolding; ekstrak header/footer.

Konsistensi tipe & arsitektur:

- [ ] Ekstrak tipe cart bersama ke `$lib/types` — `PosCartItem` (`pos/+page.svelte:47`) vs `BayarCartItem` (`bayar/+page.svelte:39`).
- [ ] `bayar/+page.svelte:320` — pakai `parseApiError` alih-alih inline parse.
- [ ] Satukan sumber label gula/es: `sugarOptions/iceOptions` vs `OPTION_LABELS` (`orderDetails.ts:7`).
- [ ] Ganti `any` → tipe konkret: `CustomItemModal.svelte:7`, `pos/+page.svelte:307`, `aiChatModal.svelte:16`; hapus cast `as any` di `login/+page.svelte:22`.
- [ ] Tambah `(key)` pada `{#each}` cart/categories (aman sekarang, demi konsistensi).
- [ ] Hapus komentar usang "mock" (`pos/+page.svelte:65,69`) & scaffolding migrasi (`manajemenmenu/+page.svelte:38`).
- [ ] Sentralisasi durasi toast ke `NOTIF.TOAST_MS` (hardcode 3000/2000 tersebar).
- [ ] `dataApiClient.ts:88` — `dbGetStrict` identik `dbGet`; alias/hapus.
- [ ] Migrasi `bahan`/`buku-kas`/`sesi-toko` ke `makeResourceRoute` BILA kebijakan factory berubah (jaga divergensi domain).

---

## Ringkasan

- **Verdict: SIAP DENGAN CATATAN.**
- **Publish-blocker: 0.**
- Semua dimensi sehat: 5 Bagus (SOLID, DRY, CONSISTENCY, READABILITY, MAINTAINABILITY, SECURITY) + 2 Cukup (YAGNI, KISS).
- Jalur kritis uang/data/auth terverifikasi benar pada kode nyata.
- Backlog seluruhnya P3; kerjakan setelah publish, prioritaskan hardening keamanan (CSRF token menyeluruh, rate-limiter ke DO/D1).
