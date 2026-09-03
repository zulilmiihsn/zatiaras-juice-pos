# Audit ZatiarasPOS — Consolidated & Validated

> Read-only. ~34k LOC, 141 file. **Tidak ada kode diubah.**
> Hasil 6 agent audit per-scope, **di-dedup lintas-scope** + **divalidasi ulang** oleh main thread.
> Target perbaikan kanonik ada di `CONVENTIONS.md`.

**Status verifikasi tiap temuan:**

- ✅ **VERIFIED** — gua cek ulang langsung (grep import / baca baris). Aman ditindak.
- ◐ **AGENT-REPORTED** — dari agent, masuk akal, belum gua re-verifikasi per-baris → spot-check sebelum apply.

**Konvergensi sebagai validasi:** temuan yang ditemukan ≥2 agent terisolasi ditandai 🔁 (sinyal kuat, bukan kebetulan).

---

## TL;DR

| #   | Tema                                             | Status                     | Dampak                                                  |
| --- | ------------------------------------------------ | -------------------------- | ------------------------------------------------------- |
| 1   | Dead code whole-file (utils+types zero-consumer) | ✅ **DONE**                | hapus **2.518 LOC**, nol risiko                         |
| 2   | Dead code level-halaman                          | ◐ sebagian ✅              | ratusan LOC tambahan                                    |
| 3   | `formatRupiah` tak diadopsi 🔁×4                 | ✅ **DONE** (app-wide)     | 97 situs (74 client + 23 server); sisa 4 = util+tanggal |
| 4   | 3 file `riwayat` ~80-85% duplikat 🔁×2           | ✅ **DONE**                | ~447 baris dup → 3 modul bersama                        |
| 5   | God-components                                   | ✅ **DONE** ⚠️ tes runtime | aichat 1652→1162; manajemenmenu 2831→2167 (5 tab)       |
| 6   | Kontrak error/response API 4 gaya                | ✅ **DONE (no-code)**      | 2-tier didokumentasikan; konversi ditolak (unsafe)      |
| 7   | Bug korektnes + security                         | ✅ **DONE**                | upload no-auth, 3 bug kecil                             |

**Sudah bagus (jangan diutak-atik tanpa alasan):** Svelte 5 runes hampir tuntas (nol `export let`/`$:`); `schema.ts` snake_case + index rapi; `api/pos/transaction` = baseline auth benar.

---

## 🔴 P1 — Dead code whole-file — ✅ DONE (2.518 LOC dihapus)

> **Status: SELESAI.** 9 file dihapus sebagai cluster + dibersihkan re-export/interface yatim di `types/index.ts` (`export * from './user'|'./transaction'`, interface `UserState`/`TransactionState`, ref di `AppState`). `pnpm check`: **76 → 71 error** (turun 5, nol orphan, nol regresi). Belum di-commit.

Grep import: hanya self-reference internal, **nol consumer eksternal**. Catatan: file util ini saling-rujuk (`lazyLoader`→`performanceTracker`, `performanceMonitor`→`performanceTracker`) → **hapus sebagai satu cluster sekaligus**, jangan satu-satu.

| File                              | LOC       | Status                                                                       |
| --------------------------------- | --------- | ---------------------------------------------------------------------------- |
| `lib/utils/performanceTracker.ts` | 668       | ✅ zero ext. import                                                          |
| `lib/utils/bundleOptimizer.ts`    | 385       | ✅ zero — isinya fake (`findDuplicateModules` hardcoded `['lucide-svelte']`) |
| `lib/utils/lazyLoader.ts`         | 327       | ✅ zero — `lazyComponents` semua placeholder                                 |
| `lib/utils/naming.ts`             | 223       | ✅ zero match total (fully dead)                                             |
| `lib/utils/routeLoader.ts`        | 194       | ✅ zero — `preloadRoute` simulasi `setTimeout`                               |
| `lib/utils/cacheManager.ts`       | 88        | ✅ zero — shim deprecated, nol old-import                                    |
| `lib/utils/performanceMonitor.ts` | 34        | ✅ zero — shim deprecated                                                    |
| `lib/types/transaction.ts`        | 316       | ✅ `from '$lib/types/transaction'` = **No matches**                          |
| `lib/types/user.ts`               | 283       | ✅ `from '$lib/types/user'` = **No matches**                                 |
| **TOTAL**                         | **2.518** |                                                                              |

---

## 🟠 P2 — Dead code level-halaman & partial (perlu spot-check per item)

| Lokasi                       | Temuan                                                                                                                                                                                                                                         | Status                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `bayar/+page.svelte`         | modal **NoSession** + notif **Success** zero-trigger                                                                                                                                                                                           | ✅ **DONE** (verified zero-trigger, dihapus)                                                             |
| `manajemenmenu/+page.svelte` | `blockNextClick` (no-op), `touchStartX/EndX`, `selectedImage`                                                                                                                                                                                  | ✅ **DONE** (27 baris dihapus, grep nol)                                                                 |
| `lib/types/index.ts:112-438` | ~300 baris tipe mati; sisakan `AppError`/`ApiError`/`ValidationError`. **Sebagian sudah dibuang saat P1** (`UserState`/`TransactionState`/ref `AppState` — yang rujuk modul terhapus). Sisa (`UIState`/`AppState`/`ButtonProps`/dst) masih ada | ◐ **per-simbol** sebelum trim lanjut                                                                     |
| `pengaturan/+page.svelte`    | `PengaturanData`, `fetchPengaturan()`, 5 getter role, `settingsSections`, toast lokal                                                                                                                                                          | ✅ **DONE** (~110 baris, verify zero-read)                                                               |
| `laporan/+page.svelte`       | 8 `$derived` subgroup + `groupAndSumByName`/`toYMD`/`showToastNotification` lokal/`userProfileData`/`pengeluaran`/`produkTerlaris`/`kategoriTerlaris`                                                                                          | ✅ **DONE** (~95 baris, verify zero-read)                                                                |
| `performance.ts`             | ~~`throttle` + `measureAsyncPerformance` zero-consumer~~                                                                                                                                                                                       | ⚠️ **KOREKSI**: keduanya DIPAKAI di `pos/+page.svelte` (import+call). Audit salah → **KEPT**             |
| `errorHandling.ts`           | `createApiError`/`createErrorBoundary`/`ValidationHelper` zero-consumer                                                                                                                                                                        | ✅ **DONE** (verified, dihapus)                                                                          |
| `security.ts`                | ~~`CSRFProtection`/`SessionSecurity`/`XSSProtection`/`InputValidation` zero-consumer~~                                                                                                                                                         | ⚠️ **KOREKSI**: dipakai internal oleh `securityUtils`/`csrfProtection` (DIPAKAI). Audit salah → **KEPT** |
| `autoApplyService.ts:273`    | `rollbackChanges()` body kosong `// TODO`                                                                                                                                                                                                      | ◐                                                                                                        |
| `pos/+page.svelte`           | `measureAsyncPerformance(..., ()=>Promise.resolve())` no-op; `skeletonCount` dihitung tapi hardcode 12                                                                                                                                         | ◐                                                                                                        |

---

## 🔴 P3 — DRY (→ lihat target di CONVENTIONS §1-4)

| Temuan                                                                  | Bukti                                                                                                                                                      | Status                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 🔁×4 **`formatRupiah` tak diadopsi**                                    | **102× `toLocaleString('id-ID')`** → migrasi **97 situs** (74 client + 23 server prompt). Sisa 4: currency.ts (2, util) + pengaturan dates (2, skip)       | ✅ **DONE** (app-wide)  |
| `formatRupiah`/`formatCurrency` lokal duplikat                          | `catat:186` (dihapus→util), `laporan formatCurrency` (dihapus), `CustomItemModal` `formatRupiahInput` → pakai `formatRupiah` util                          | ✅ **DONE**             |
| 🔁×2 **builder struk ~70 baris ×3 verbatim**                            | → `lib/utils/receiptPrint.ts` (`buildReceiptHtml`+`printViaIntent`+`loadReceiptSettings`). 3 riwayat migrasi. **`bayar:400-487` masih → ikut P4-followup** | ✅ **DONE** (3 riwayat) |
| `fetchTransaksiHariIni`/`fetchPengaturanStruk`/`HistoryItem` identik ×3 | → `lib/services/riwayatService.ts` + `HistoryItem` ke `lib/types/laporan`. Reconcile: `ref_transaksi_kasir_id ?? transaction_id`, ucapan `\n`              | ✅ **DONE**             |
| aichat OpenRouter fetch ×3 + fence-parse ×2                             | `aichat:146,305,682`                                                                                                                                       | ◐                       |
| `methodLabels` map di-copy                                              | → `METHOD_LABELS` export di `receiptPrint.ts`; bayar pakai itu. (riwayat sudah via `buildReceiptHtml`; aichat = konteks beda, biar)                        | ✅ **DONE**             |
| `LaporanAccordions` 4 sub-accordion copy-paste (~110×4)                 | → 1 `{#snippet accordionGroup}` render 4×. 406→287 baris                                                                                                   | ✅ **DONE**             |
| 3 impl sanitasi XSS + 2× validateEmail/Password                         | `XSSProtection`+`InputValidation` (security.ts) **nol caller** → dihapus (~180 baris). `validation.sanitizeInput` = canonical                              | ✅ **DONE**             |
| `dataService` getProducts/Categories/AddOns nyaris identik              | → `getCachedTable(table, cacheKey, offlineKey)` private method                                                                                             | ✅ **DONE**             |
| `autoApplyService` pola `if(!res.ok)` ×4                                | → `throwIfNotOk(res, label)` helper                                                                                                                        | ✅ **DONE**             |

---

## 🟠 P4 — KISS god-components (✅ DONE — split butuh tes runtime sebelum merge)

> ✅ **Selesai, semua `pnpm check` 70 + `pnpm build` lulus.** ⚠️ Split komponen reaktif & receipt = **compile-verified only**; bug reaktivitas TIDAK ketangkep build → **WAJIB klik-test di `pnpm dev` sebelum merge** (lihat checklist di akhir file).

| File                                            | LOC           | Aksi                                                                                                                                                              | Status                 |
| ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `api/aichat/+server.ts`                         | 1652→**~780** | ✅ DRY + 3 prompt → `prompts.ts` + `handleRegularChat` 779→396 (4 helper → `reportData.ts`)                                                                       | ✅ **DONE**            |
| `pengaturan/pemilik/manajemenmenu/+page.svelte` | 2831→**2167** | ✅ Dead-code dihapus + `resetMenuForm` + **pecah 5 tab** (`MenuTab/KategoriTab/EkstraTab/BahanTab/HppTab`, dumb-component)                                        | ✅ done ⚠️ tes runtime |
| `bayar/+page.svelte`                            | 1008          | ✅ `printStruk` → pakai `printViaIntent` + `DEFAULT_RECEIPT_SETTINGS` (buang pako/Base64 dup). `addToCart` split → opsional                                       | ✅ done (receipt)      |
| `laporan:38-79`                                 | —             | `computeReportFingerprint` → **KEPT** (simplifikasi buang sensitivitas detail-edit → risiko report stale; cost negligible di skala POS). Documented, bukan defect | ✅ resolved (kept)     |

---

## 🟠 P5 — Consistency (→ CONVENTIONS §4-7)

| Temuan                                                                                           | Status                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kontrak error API 4 gaya (`kitError` vs `json({success})` vs `json({error})`) lintas 27 endpoint | ✅ **DONE (no-code)** — impact-check: konversi paksa UNSAFE (`csrf.ts:56` baca `code:'CSRF_INVALID'` utk retry; success `token`/`{url,key}` coupled; normalizer `message\|\|error\|\|code` sudah toleran). Resolusi: 2-tier didokumentasikan di `CONVENTIONS §4` |
| Toast 3 pola (`createToastManager` vs inline `+layout:332` vs state lokal)                       | ✅ **DONE** — `+layout` inline toast → `createToastManager`+`ToastNotification` (sama kayak page lain)                                                                                                                                                           |
| Error-handling frontend tak konsisten (`catch {}` silent vs string lokal vs `ErrorHandler`)      | ✅ **REVIEWED** — leaks sudah difix (gantikeamanan); riwayat/dsb pakai `ErrorHandler`; 4 `catch {}` sisa = best-effort benign → diberi comment intent. String-lokal utk display = legit                                                                          |
| 4 komponen reimplement modal backdrop + `@keyframes slideUp`                                     | ⚠️ **KEPT** — animasi/sheet **genuinely beda** (modalSheet full-height tanpa opacity vs dropdownSheet auto-height + opacity fade). Maksa ke base = visual regression demi ~10 baris. Tidak diubah                                                                |
| Icon: `<ArrowLeft/>` vs `<svelte:component>` (deprecated) campur                                 | ✅ **DONE** — 47× `svelte:component` → render langsung (14 file); grep 0, `pnpm build` lulus                                                                                                                                                                     |
| Runes vs Svelte 4 `let` campur di file riwayat                                                   | ✅ **DONE** — kasir + pemilik riwayat → `$state` (umum sudah runes). Nol `$:`, malah ngapus 2 latent error                                                                                                                                                       |
| Callback prop `onClose` vs `onclose`/`ondone` campur                                             | ✅ **DONE** — semua → camelCase (`onClose`/`onDone`/`onCancel`), modalSheet+cropperDialog + consumers                                                                                                                                                            |
| `each` key `(trx.id)` vs `(_i)` index vs tanpa key                                               | ✅ **DONE** — kasir riwayat `(_i)` → `(trx.id)`                                                                                                                                                                                                                  |

---

## ⚠️ P0 — Bug & Security — ✅ DONE (6/6 fixed)

> **Status: SELESAI.** `pnpm check` 71 → 70 error (fix `profil` buang 1 type-error; nol regresi). Belum di-commit.

| Lokasi                       | Temuan                                                                | Fix                                                                                                                                                         | Status  |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `api/upload/+server.ts`      | **POST/DELETE tanpa auth** — siapa pun bisa upload/hapus R2           | `requireAuthSession` + `requireAnyRole(['pemilik'])` **sebelum** `try` di POST & DELETE. **GET dibiarkan publik** (serving gambar by uuid-key, `<img src>`) | ✅ DONE |
| `bayar/+page.svelte:218`     | `kembalian = 0` di-assign ke `$derived` — invalid Svelte 5 + redundan | Baris dihapus (line 217 sudah bikin derive ke 0)                                                                                                            | ✅ DONE |
| `api/buku-kas/+server.ts:73` | `row.nominal ?? row.nominal ?? 0` operand kembar                      | → `row.nominal ?? 0`                                                                                                                                        | ✅ DONE |
| `api/profil/+server.ts:27`   | `profilToko.$inferInsert` — var undefined                             | → `profil.$inferInsert`                                                                                                                                     | ✅ DONE |
| `gantikeamanan:195`          | `error.message` di-render mentah — bocor detail server                | pesan generik + `console.error` (CONVENTIONS §5)                                                                                                            | ✅ DONE |
| `autoApplyService.ts:117`    | cabang ternary `penjualan` tak terjangkau                             | → `data.type === 'pemasukan' ? 'in' : 'out'`                                                                                                                | ✅ DONE |

---

## Urutan eksekusi (kunci dependensi antar-batch — sama dgn CONVENTIONS §10)

1. ~~**P1 hapus dead-code whole-file** (2.518 LOC, hapus 9 file sbg cluster)~~ — ✅ **DONE** (76→71 error, nol orphan). Belum commit.
2. ~~**P0 fix bug + auth `upload`**~~ — ✅ **DONE** (6/6 fixed, 71→70 error). Belum commit.
3. ~~**P3 batch Rupiah** — sweep ke `formatRupiah`~~ — ✅ **DONE**: 74 situs display di 18 file (4 builder-agent paralel), `pnpm check` tetap 70 (nol regresi). Server prompt (23×) folded ke P4. Belum commit.
4. ~~**Extract `receiptPrint.ts` + `riwayatService.ts`**~~ — ✅ **DONE** (3 riwayat): ~447 baris dup dihapus, `pnpm check` tetap 70. `bayar` receipt → P4-followup. Belum commit.
5. ~~**P5 kontrak error API**~~ — ✅ **DONE (no-code)**: impact-check menolak konversi (unsafe), kontrak 2-tier didokumentasikan. Nol perubahan kode = nol risiko.
6. **Toast + modal base + error-handling frontend.** — ⏸ belum (P5 §6, opsional).
7. ~~**P4 pecah god-components**~~ — ✅ **DONE**: aichat 1652→1162, manajemenmenu 2831→2167 (5 tab), bayar receipt, computeReportFingerprint kept. ⚠️ split butuh tes runtime.

Tiap batch: `pnpm check` + `pnpm build` hijau, ikuti checklist `CONVENTIONS.md §9`, centang progres di sini.

---

## ⚠️ CHECKLIST TES RUNTIME WAJIB (sebelum merge `refactor/audit-cleanup`)

Split komponen & receipt **compile + build OK**, tapi reaktivitas/logika cuma terbukti saat di-klik. Jalankan `pnpm dev`, lalu verifikasi:

**manajemenmenu (5 tab — paling kritis):**

- [ ] Tab **Menu**: search filter jalan, toggle grid/list, tambah/edit/hapus menu, gambar tampil (handleImgError), pilih kategori filter
- [ ] Tab **Kategori**: search, tambah/edit/hapus kategori, count menu benar
- [ ] Tab **Tambahan (ekstra)**: search, tambah/edit/hapus
- [ ] Tab **Bahan**: search, tambah/edit/hapus, mutasi bahan, format Rupiah harga
- [ ] Tab **HPP**: form HPP (input Rupiah ke-format via `hppForm` bindable), parse purchase text, simpan item, kalkulasi overhead/recipe/margin tampil benar
- [ ] FAB "Tambah" tiap tab muncul + buka form yang benar
- [ ] Modal/cropper/notif masih jalan (tetap di parent)

**bayar:** cetak struk POS (tunai + qris) — header/item/addons/gula-es/total/kembalian/ucapan benar, kirim ke printer (`printViaIntent`)
**3 riwayat (umum/kasir/pemilik):** cetak ulang struk, list transaksi, delete (pemilik)
**aichat:** chat laporan + analisis transaksi (prompt `prompts.ts` + `callOpenRouter`) balas normal, angka Rupiah benar

---

### Catatan validasi (apa yang gua cek ulang sesi ini)

- ✅ Grep import 7 util + 2 types → semua zero external consumer (self-ref only).
- ✅ `toLocaleString('id-ID')` = 102 occurrence / 20 file (exact); migrasi 97 → sisa 4 (util+tanggal).
- ✅ Baca baris: `upload` no-auth, `bayar:218`, `buku-kas:73`, `profil:27` — semua benar.
- ✅ LOC presisi file mati via `wc -l` = 2.518 total.
- ✅ Split manajemenmenu: `pnpm check` 70 (nol baru) + `pnpm build` lulus; wiring parent + MenuTab props di-review manual.
- ◐ Item bertanda ◐ belum di-verifikasi per-baris — verifikasi saat batch-nya dikerjakan (impact-check `CONVENTIONS §8`).

---

### Catatan validasi (apa yang gua cek ulang sesi ini)

- ✅ Grep import 7 util + 2 types → semua zero external consumer (self-ref only).
- ✅ `toLocaleString('id-ID')` = 102 occurrence / 20 file (exact).
- ✅ Baca baris: `upload` no-auth, `bayar:218`, `buku-kas:73`, `profil:27` — semua benar.
- ✅ LOC presisi file mati via `wc -l` = 2.518 total.
- ◐ Item bertanda ◐ belum di-verifikasi per-baris — verifikasi saat batch-nya dikerjakan (impact-check `CONVENTIONS §8`).
