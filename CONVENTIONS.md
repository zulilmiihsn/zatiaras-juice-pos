# CONVENTIONS.md — Refactor Contract (ZatiarasPOS)

> **Tujuan:** mencegah refactor hari ini melahirkan pelanggaran KISS/YAGNI/DRY/consistency baru.
> Setiap batch refactor **wajib converge ke kontrak ini**. Kalau sebuah perbaikan butuh pola baru
> yang belum ada di sini → **update file ini dulu**, baru tulis kode. Satu sumber kebenaran.
>
> Pendamping: `AUDIT.md` (daftar temuan). File ini = keputusan kanonik atas temuan itu.

---

## 0. Aturan main (anti-divergensi)

1. **Satu concern = satu helper/pola.** Dilarang bikin varian kedua. Kalau butuh beda perilaku → parameter, bukan fungsi baru.
2. **Extract dulu, migrasi semua consumer sekaligus.** Jangan extract util baru lalu cuma 1 file pakai (itu nambah pola ke-N+1). Lihat §8 impact-check.
3. **Hapus yang lama.** Setiap kali migrasi ke helper kanonik, helper/inline lama **dihapus di commit yang sama** (biar nggak co-exist).
4. **Tiap commit lulus gate:** `pnpm check` + `pnpm test:all` hijau, dan checklist §9.

---

## 1. Format Rupiah & angka

> ✅ **Diterapkan (app-wide):** 97 situs migrasi ke `formatRupiah` (74 client + 23 server prompt). Sisa 4 = util sendiri (currency.ts) + 2 tanggal. **Selesai.**

**Kanonik:** `src/lib/utils/currency.ts`

- `formatRupiah(value)` → `"1.000.000"` — **TIDAK** menambah prefix `Rp`.
- `parseRupiah(value)` → `number`.
- `handleRupiahInput(obj, field)` → handler `oninput`.

**Aturan:**

- Tampilan uang: `Rp {formatRupiah(x)}` (prefix "Rp " tetap di markup, angka lewat util).
- **Larang:** `x.toLocaleString('id-ID')` inline, `formatRupiah` lokal (hapus di `catat/+page.svelte:186`, `CustomItemModal.svelte:15`), `formatCurrency` lokal (laporan).
- ⚠️ Saat migrasi cek tiap call lama: kalau sebelumnya hasil sudah termasuk "Rp", jangan dobel.

**Tanggal/waktu:** pakai `src/lib/utils/dateTime.ts` (sudah ada). Pola `new Date().toLocaleString('id-ID',{...})` yang berulang → tambah **satu** helper `formatTanggalWaktu()` di `dateTime.ts`, bukan inline.

---

## 2. Struk / receipt printing

> ✅ **Dibuat & dipakai (3 riwayat).** `bayar/+page.svelte` belum migrasi → P4-followup (variannya = print POS, bukan cetak-ulang; perlu param header).

**Kanonik (BARU):** `src/lib/utils/receiptPrint.ts`

- `buildReceiptHtml(trx, pengaturan, items): string`
- `printViaIntent(html): void` (gzip + base64 + `intent://...print-intent`)
- `loadReceiptSettings(): Promise<...>` (fetch pengaturan struk + fallback localStorage)

**Consumer yang WAJIB migrasi sekaligus (jangan parsial):**

- `pengaturan/riwayat/+page.svelte` (`printStruk`)
- `pengaturan/kasir/riwayat/+page.svelte` (`printStrukDariRiwayat`)
- `pengaturan/pemilik/riwayat/+page.svelte` (`printStrukDariRiwayat`)
- `pos/bayar/+page.svelte` (`printStrukViaEscPosService`)

**Konsistensi data yang harus diseragamkan saat extract:**

- `methodLabels` (tunai/qris/lainnya) → const module-level di `receiptPrint.ts`, dipakai semua.
- transaction_id mapping → `t.ref_transaksi_kasir_id ?? t.transaction_id` (versi pemilik benar; kasir salah).
- default `ucapan` newline → `'\n'` (bukan literal `\\n`).

---

## 3. Riwayat (data + komponen)

> ✅ **Data layer + tipe selesai:** `riwayatService.ts` + `HistoryItem` di `lib/types/laporan`, 3 file migrasi. **Belum:** komponen `RiwayatHarian.svelte` tunggal (markup masih 3×) + seragamkan runes — sisakan untuk P5/follow-up.

- **Tipe:** `HistoryItem` → pindah ke `src/lib/types/` (satu definisi, hapus 3 duplikat).
- **Service:** `src/lib/services/riwayatService.ts` → `fetchTransaksiHariIni()`, `todayRange()`.
- **Target akhir:** satu komponen `RiwayatHarian.svelte` dengan prop `mode: 'umum' | 'kasir' | 'pemilik'` (kontrol tombol delete/edit). Sampai itu jadi, minimal share service + tipe + receipt util.
- **`each` key:** selalu `(trx.id)` — larang index `(_i)` / tanpa key.

---

## 4. Kontrak API (server)

> ✅ **Impact-check selesai (batch 5) — KONTRAK 2-TIER, BUKAN konversi paksa.**
> Audit awal menyuruh "samakan semua ke `kitError`". Setelah cek consumer: **itu UNSAFE** dan ditolak. Bukti:
>
> - `csrf.ts:56` membaca `payload.code === 'CSRF_INVALID'` untuk retry → field **`code` load-bearing**; `kitError` membuangnya → CSRF retry rusak.
> - `csrf` (token), `upload` (`{url,key}`) punya **shape sukses yang dikonsumsi** → ubah = breakage runtime (tak tertangkap `pnpm check`).
> - Frontend `normalizeApiErrorPayload` sudah baca `message || error || code` → **variasi error sudah terserap**; konversi = risiko tanpa benefit.

**Dua kontrak yang SAH (jangan dipaksa jadi satu):**

**Tier A — resource routes (≈22 endpoint, DEFAULT untuk endpoint baru):**

- **Error:** `throw kitError(status, msg)` — `import { error as kitError } from '@sveltejs/kit'`.
- **Sukses:** `{ ok: true, data }` / `{ ok: true }`; GET list boleh raw array / `{ items, nextCursor }`.
- **Baseline contoh:** `api/pos/transaction/+server.ts`.

**Tier B — telemetri & auth (`aichat`, `cache-metrics`, `security-events`, `csrf`, `logout`, `veriflogin`, `gantikeamanan`):**

- **Tetap** `json({ success, code, message })`. **JANGAN konversi** — `code` dipakai consumer (CSRF retry, rate-limit) & shape sukses coupled.

**Auth (wajib tiap handler mutasi, kedua tier):**

- `requireAuthSession(locals)` / `requireSessionBranch(locals, body?.branch)` + `requireAnyRole(session.role, ['kasir'|'pemilik'])`.

**Aturan endpoint BARU:** default Tier A. Pakai Tier B hanya kalau consumer butuh `code` terstruktur.

✅ **`api/upload` auth gap — FIXED (batch 2):** POST/DELETE pakai `requireAuthSession` + `requireAnyRole(['pemilik'])`; GET publik (serving gambar). Error tetap `json({error})` — ditoleransi normalizer, consumer DELETE fire-and-forget.

**Helper anti-duplikat:**

- ✅ `callOpenRouter(apiKey, systemMessage, opts)` + `stripJsonFence(content)` → **DONE** (in-file `aichat`, 3 fetch + 2 fence deduped).
- ◐ `throwIfNotOk(res, label)` → untuk `autoApplyService.ts` (4 duplikat) — belum.
- ◐ `getCachedTable(table, cacheKey, offlineKey)` → untuk `dataService.ts` (getProducts/Categories/AddOns) — belum.

---

## 5. Error handling (frontend)

**Kanonik:** `src/lib/utils/errorHandling.ts`

- `ErrorHandler.extractErrorMessage(e)`, `ErrorHandler.logError(...)`
- `getApiErrorMessage(...)` / `getApiErrorMessageFromResponse(res)`
- `reportApiFailure(...)` / `reportApiFailureFromResponse(res)`

**Aturan:** semua `catch` → lewat util di atas. **Larang:** `catch {}` silent, set string lokal hardcode, `error.message` di-render mentah ke UI (kebocoran info — fix `gantikeamanan:194`).
**Hapus (zero-consumer):** `createApiError`, `createErrorBoundary`, `ValidationHelper`.

---

## 6. Notifikasi / Toast

**Kanonik:** `createToastManager()` dari `src/lib/utils/ui.ts` + komponen `toastNotification.svelte`.

- API: `{ showToast, toastMessage, toastType, showToastNotification(msg, type?, duration?), hideToast }`.

**Aturan:** semua feedback non-blocking → toast manager ini.
**Larang:** toast HTML inline (`+layout.svelte:332-338`), `showToastNotification` lokal (laporan/pengaturan), state error ad-hoc untuk pesan umum.
Modal konfirmasi (PIN, hapus) tetap pakai modal — toast hanya untuk notifikasi sekilas.

---

## 7. Komponen UI

- **Modal/overlay:** satu base — backdrop `rgba(0,0,0,0.18)` + `@keyframes slideUp`. Hentikan re-implement di `modalSheet`/`dropdownSheet`/`aiChatModal`/`pwaInstallDialog`. Extract `lib/components/shared/ModalBase.svelte` (atau util CSS bersama).
- **Callback prop naming:** **camelCase** — `onClose`, `onDone`, `onCancel`, `onSuccess`. Larang `onclose`/`ondone`/`oncancel`.
- **Bindable:** sheet yang punya `value`/`open` → `$bindable` (samakan `dropdownSheet` ke pola `modalSheet`).
- **Icon render:** `<ArrowLeft/>` langsung. Larang `<svelte:component this={Icon}/>` (deprecated Svelte 5).
- **Svelte 5:** `$state/$derived/$props/$bindable` di semua `.svelte`. Sisa `<svelte:fragment slot>` & file riwayat `let` reaktif → migrasi ke runes/snippet.
- ⚠️ **Jangan assign ke nilai `$derived`** (bug nyata `bayar:219` `kembalian = 0`).

---

## 8. Tipe

- **Sumber kebenaran data domain:** Drizzle `src/lib/database/schema.ts` (snake_case Indonesia).
- **Hapus zero-consumer:** `types/transaction.ts`, `types/user.ts`, dan ~300 baris mati di `types/index.ts`. Sisakan `AppError`/`ApiError`/`ValidationError`.
- **Larang:** definisikan ulang `PaymentMethod`/`UserRole`/`TransactionStatus`/`ApiResponse` (sudah dobel enum vs union). Satu definisi saja.
- Tipe yang dipakai lintas komponen (`PosCartItem`, `PosProduct`, `HistoryItem`) → export dari `lib/types`, jangan `any[]` di props.

---

## 9. Checklist per-batch (tempel di tiap PR/commit)

Sebelum tiap batch refactor dianggap selesai:

- [ ] Tidak ada helper/pola baru di luar kontrak ini (kalau ada → kontrak di-update dulu).
- [ ] **Semua** consumer dari util yang di-extract sudah dimigrasi (lihat §8 impact-check), bukan sebagian.
- [ ] Implementasi lama (inline / lokal / duplikat) **dihapus** di commit yang sama.
- [ ] Tidak ada `toLocaleString('id-ID')`, `catch {}`, `json({error})` baru yang masuk.
- [ ] `each` pakai key stabil; callback prop camelCase; icon render langsung.
- [ ] `pnpm check` + `pnpm test:all` hijau.
- [ ] Grep cek nol referensi tersisa ke simbol yang dihapus.

### Impact-check sebelum extract shared file

Setiap mau bikin util/komponen bersama, **grep dulu semua consumer** dan migrasi serempak:

```
rtk grep "<nama-fungsi-lama>"      # temukan semua pemakai
rtk grep "toLocaleString('id-ID')" # untuk batch Rupiah
rtk grep "from '\$lib/types/transaction'"  # pastikan benar zero-consumer sebelum hapus
```

Tujuan: nol scope ketinggalan, nol varian baru.

---

## 10. Urutan eksekusi (mengunci dependensi antar-batch)

Diurutkan biar batch berikut nggak mengulang/merusak batch sebelumnya:

1. ~~**Hapus dead code** (utils + types whole-file)~~ — ✅ **DONE**: 9 file dihapus (2.518 LOC) + bersih yatim `types/index.ts`. `pnpm check` 76→71 error, nol orphan. (Page-level dead code §P2 belum.)
2. ~~**Fix bug korektnes + auth `upload`**~~ — ✅ **DONE**: upload POST/DELETE di-auth (`requireAuthSession`+`requireAnyRole(['pemilik'])`, GET tetap publik), `bayar:218`/`buku-kas:73`/`profil:27`/`gantikeamanan:195`/`autoApplyService:117` fixed. `pnpm check` 71→70.
3. ~~**Batch Rupiah** (§1)~~ — ✅ **DONE (app-wide)**: 97 situs → `formatRupiah` (74 client batch-3 + 23 server batch-P4). Sisa 4 = util + tanggal. `pnpm check` 70.
4. ~~**Extract `receiptPrint.ts` + `riwayatService.ts`** (§2-3)~~ — ✅ **DONE** (3 riwayat): `HistoryItem`→types, `riwayatService` (data), `receiptPrint` (struk). ~447 baris dup dihapus, `pnpm check` 70. `bayar` receipt + komponen `RiwayatHarian` tunggal → follow-up.
5. ~~**Kontrak error/response API** (§4)~~ — ✅ **DONE (no-code)**: impact-check → konversi paksa UNSAFE (CSRF `code` load-bearing, success coupled, normalizer sudah toleran). Resolusi: dokumentasikan kontrak 2-tier (§4). Endpoint baru default Tier A.
6. **Toast + modal base + error-handling frontend** (§5-7).
7. ~~**Pecah god-components**~~ — ✅ **DONE**: `aichat` 1652→1162 (DRY + `prompts.ts`), `manajemenmenu` 2831→2167 (5 tab dumb-component + dead-code + `resetMenuForm`), `bayar` printStruk→`printViaIntent`/`DEFAULT_RECEIPT_SETTINGS`. `pnpm build` lulus. ⚠️ **Split butuh tes runtime sebelum merge** (checklist di `AUDIT.md`). Opsional sisa: dekomposisi data-logic `handleRegularChat`.

> Setelah tiap batch: update `AUDIT.md` (centang yang beres) supaya progres lintas-scope tetap satu pandangan.
