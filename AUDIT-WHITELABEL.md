# Audit White-Label ZatiarasPOS

> Laporan auditor utama. Temuan sudah di-verifikasi adversarial per-area, lalu **di-dedup lintas-area** (root-cause yang sama digabung) dan dinilai ulang di sini.
> Cakupan: lib-server, lib-services, lib-stores/types, lib-utils, db-config, components, api-money, api-auth, api-aichat, pages-pos, pages-admin, theme-tenant, theme-money, theme-offline, theme-data.
> Lintas-rujuk dengan `AUDIT.md` (kualitas/dead-code, banyak sudah DONE) dan `CONVENTIONS.md`. Temuan di bawah **bukan** yang sudah ditandai DONE di sana.

---

## Ringkasan Eksekutif

**Kondisi umum:** Inti POS solid secara fungsi single-tenant Zatiaras — auth server-side per-handler, checkout idempoten, Svelte 5 runes hampir tuntas, skema rapi. **Namun untuk dijual white-label, produk ini BELUM layak.** Ada lubang multi-tenant yang serius (kebocoran data lintas-tenant terotentikasi via AI chat, penulisan kredensial lintas-tenant, mass-assignment `cabang_id`), bug korektnes uang/stok (void sale tidak mengembalikan stok, dua delete HTTP non-atomik), dan identitas tenant + branding + zona waktu + tarif pajak yang **hardcoded ke Zatiaras di seluruh kode** sehingga onboarding bisnis baru = ubah source + redeploy. Ditambah dua bug P0 yang membuat 5 tab manajemen menu pemilik benar-benar rusak saat ini (`AUDIT.md:170` mengklaim sudah di-review — klaim itu FALSE, bug live).

**Verdict: BELUM LAYAK dijual white-label.** Wajib selesaikan semua P0 (ship-blocker) + lapisan white-label enablement (tenant registry, theme token, config pajak/zona-waktu/branding) sebelum dijual ke bisnis lain.

**Estimasi effort:**

- Fase 1 (ship-blocker P0): ~2-3 minggu engineer — fix keamanan/uang/bug live.
- Fase 2 (white-label enablement): ~4-6 minggu — tenant registry data-driven, theme token, config per-tenant (pajak, zona-waktu, branding, prompt AI, payment methods).
- Fase 3 (quality P1-P3): ~2-3 minggu — DRY, dead-code, SRP, hardening.
- **Total kasar: ~8-12 minggu** sebelum layak jual ke tenant pertama non-Zatiaras.

### Tabel jumlah per severity (setelah dedup)

| Severity | Jumlah | Keterangan                                                   |
| -------- | ------ | ------------------------------------------------------------ |
| **P0**   | 7      | Ship-blocker: data loss / kebocoran lintas-tenant / bug live |
| **P1**   | 19     | Serius: bug/keamanan/skalabilitas                            |
| **P2**   | 28     | Quality/konsistensi                                          |
| **P3**   | 18     | Minor/kosmetik                                               |

### Tabel jumlah per dimensi (perkiraan pasca-dedup)

| Dimensi                      | Jumlah | Catatan                                                  |
| ---------------------------- | ------ | -------------------------------------------------------- |
| MULTI-TENANT                 | ~24    | Dominan — isolasi, branding, configurability             |
| MONEY                        | ~11    | Pajak hardcode, void stok, total client vs server, COGS  |
| SECURITY                     | ~13    | Cross-tenant write, rate-limit in-memory, CSRF, XSS, CSP |
| CORRECTNESS                  | ~12    | Void, sesi ganda, silent-fail, dead-logic                |
| DRY                          | ~10    | Pajak/branch/error-parse/format duplikat                 |
| CONSISTENCY                  | ~10    | Casing branch, role naming, key `each`                   |
| MAINTAINABILITY              | ~9     | God-store/component, cache stale, compat-date            |
| SCHEMA                       | ~5     | No FK, unique index, append-only                         |
| OFFLINE                      | ~8     | Dead-letter, sync trigger, queue recovery                |
| SOLID/KISS/YAGNI/READABILITY | ~13    | God-store, dead types/validators, dead-logic             |

> Beberapa temuan menyentuh >1 dimensi; angka di atas indikatif, bukan partisi ketat.

---

## P0 — Ship Blockers (WAJIB beres sebelum jual)

| #        | File:line                                                                                                                 | Masalah                                                                                                                                                                                                                                                                                                                          | Bukti                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0-1** | `src/routes/api/aichat/+server.ts:388-435` (+ `:204-208`, `productAnalysisService.ts:31-69`)                              | **Kebocoran data lintas-tenant terotentikasi.** AI chat ambil `branch` dari body request / header `x-branch`, tidak pernah dibandingkan ke session. `getDrizzleDb(platform, requestedBranch)` mengarahkan ke binding D1 berbeda per group.                                                                                       | `const { question, branch } = await request.json(); requestedBranch = normalizeBranch(branch \|\| 'balikpapan'); const db = getDrizzleDb(event.platform, requestedBranch)` — lalu `fetchReportData`/produk/kategori difilter hanya oleh `requestedBranch`. `requireSessionBranch` ada di `apiAuth.ts:14-24` & dipakai 23 endpoint lain, tapi TIDAK di sini. `analyzeTransactionText` baca `request.headers.get('x-branch') \|\| 'default'`. `productAnalysisService` singleton cache produk TANPA key branch, dipanggil dari route server. | Ganti dengan `const branch = requireSessionBranch(locals, body?.branch)` + `requireAnyRole`. Jangan derive branch dari body/header. Jangan panggil `dataService` (client-store-coupled) dari route server — query produk via `getDrizzleDb(platform, branch)` + filter `cabang_id`, cache di-key per branch. |
| **P0-2** | `src/routes/api/gantikeamanan/+server.ts:40-117`                                                                          | **Pengambilalihan kredensial lintas-tenant.** POST hanya cek role, lalu baca `branch` dari body dan update `profil` branch itu — `branchId` tak pernah dibandingkan ke `locals.authSession.branch`.                                                                                                                              | `if (requesterRole !== 'pemilik' && requesterRole !== 'admin') {...403}` lalu `const { ..., branch, targetRole } = await request.json(); branchId = normalizeBranch(branch);` lalu `db.update(profil).set({ username, password: hashedPassword }).where(and(eq(profil.cabang_id, branchId), eq(profil.id, user.id)))`. `requireSessionBranch` tidak dipakai.                                                                                                                                                                               | `const branchId = requireSessionBranch(locals, branch); requireAnyRole(locals.authSession.role, ['pemilik']);` agar pemilik non-admin hanya bisa ubah branch-nya sendiri.                                                                                                                                    |
| **P0-3** | `src/routes/api/buku-kas/+server.ts:111-114` (juga `produk`/`kategori`/`tambahan`/`sesi-toko`/`bahan`/`pengaturan` PATCH) | **Mass-assignment `cabang_id` — pindah baris ke tenant lain.** PATCH spread payload mentah ke `.set()`; WHERE membatasi baris sumber ke branch tapi tak ada yang strip `cabang_id` dari payload, jadi `SET cabang_id='other'` memindah baris keluar tenant.                                                                      | `db.update(bukuKas).set({ ...(body.payload as Partial<...>) }).where(and(eq(bukuKas.cabang_id, branch), eq(bukuKas.id, ...)))`. Pola identik di `produk:66-68/79-81`, `kategori:57-60`, `tambahan:57-60`, `sesi-toko:65-68`, `bahan:83-86`, `pengaturan:63-66`. `payloadRows` memaksa `cabang_id` di INSERT, tapi UPDATE tidak.                                                                                                                                                                                                            | Strip kunci scoping immutable (`cabang_id`, `id`) sebelum update di SEMUA PATCH, atau whitelist kolom updatable. Idealnya: satu `makeResourceRoute` factory agar fix di satu tempat.                                                                                                                         |
| **P0-4** | `src/routes/api/transaksi-kasir/+server.ts:111-140`                                                                       | **Void transaksi POS tidak mengembalikan stok produk/bahan.** DELETE hanya reverse daily-summary lalu hapus baris; tak ada `UPDATE produk SET stok += qty`, `UPDATE bahan SET stok_saat_ini += used`, tak ada `bahan_mutasi` pembalik. Checkout memotong keduanya saat masuk.                                                    | DELETE: `reverseDailySummaryForTransaction(...)` (125) lalu `db.delete(transaksiKasir)` (130-134). Checkout: `UPDATE produk SET stok = COALESCE(stok,0) - ?` (`transaction:622-624`), `UPDATE bahan SET stok_saat_ini = COALESCE(...) - ?` (631-633), `INSERT INTO bahan_mutasi` (638-660).                                                                                                                                                                                                                                                | Sebelum delete, re-derive qty per-produk & delta per-bahan dari snapshot/resep, tambahkan kembali stok + tulis `bahan_mutasi` (`sumber='void'`) dalam satu batch dengan reversal summary.                                                                                                                    |
| **P0-5** | `src/routes/pengaturan/pemilik/riwayat/+page.svelte:78-87`                                                                | **Hapus transaksi POS = dua HTTP non-atomik → ledger/summary desync.** `deleteRows('transaksi_kasir', ...)` lalu `deleteRows('buku_kas', ...)`. Call pertama reverse summary + hapus `transaksi_kasir`; jika kedua gagal (offline/network), baris `buku_kas` hidup sementara summary sudah dikurangi & `transaksi_kasir` hilang. | `await dataService.deleteRows('transaksi_kasir', { transaction_id })` (82) lalu `await dataService.deleteRows('buku_kas', { transaction_id })` (83). Tanpa transaksi.                                                                                                                                                                                                                                                                                                                                                                      | Satu endpoint server atomik: reverse summary, restore stok (lihat P0-4), hapus `transaksi_kasir` + `buku_kas` dalam satu `rawDb.batch()`. Buang urutan dua-call di client.                                                                                                                                   |
| **P0-6** | `src/routes/pengaturan/pemilik/manajemenmenu/+page.svelte:150-197`                                                        | **5 tab manajemen menu pemilik ship rusak.** Props anak dilewatkan dengan nama atribut tak valid `s.x={...}` → anak terima `undefined`. Data list, flag loading, dan handler klik (openMenuForm/confirmDeleteMenu/handleImgError) datang undefined.                                                                              | `<MenuTab bind:searchKeyword={s.searchKeyword} ... s.isLoadingKategori={s.isLoadingKategori} s.isLoadingMenus={s.isLoadingMenus} ... s.handleImgError={s.handleImgError}`. Sama di KategoriTab(160)/EkstraTab(168)/BahanTab(175)/HppTab(184). `svelte-check` emit: "Object literal may only specify known properties, and '\"s.isLoadingKategori\"' does not exist" di 150:116, 160:58, 168:40, 175:38, 184:71. `AUDIT.md:170` "MenuTab props di-review manual" → FALSE, bug live.                                                         | Lewatkan dengan nama identifier benar: `isLoadingKategori={s.isLoadingKategori}` dst. — prefix `s.` hanya di sisi value. Re-run `pnpm check` (0 error) + klik-test 5 tab.                                                                                                                                    |
| **P0-7** | `src/routes/pengaturan/pemilik/manajemenmenu/+page.svelte:698-707, 753-757`                                               | **Handler tutup modal Ekstra assign ke getter read-only → throw runtime.** Backdrop/keydown/Batal melakukan `s.showEkstraForm = false` dst., padahal state hanya punya getter.                                                                                                                                                   | Handler: `(s.showEkstraForm = false), (s.ekstraForm = {...}), (s.editEkstraId = null)`. State (`manajemenmenuState.svelte.ts:1088,1124,1125`) deklarasi `get ekstraForm()`/`get showEkstraForm()`/`get editEkstraId()` tanpa setter. `svelte-check`: "Cannot assign to 'showEkstraForm' because it is a read-only property" di 700,703,706,754.                                                                                                                                                                                            | Ekspos method `s.closeEkstraForm()` (mirip `s.closeMenuForm()` yang sudah ada), panggil dari handler-handler ini.                                                                                                                                                                                            |

---

## White-Label Blockers

Semua temuan dengan `whitelabel_blocker=true`, dikelompokkan. Ini yang membuat onboarding tenant baru mustahil tanpa ubah source/redeploy, atau membocorkan brand/vertical Zatiaras ke tenant lain.

### A. Multi-Tenant Isolation (paling kritis)

| File:line                                         | Masalah                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/aichat/+server.ts:388-435, 204-208`          | **(P0-1)** Branch dari body/header, bukan session — kebocoran financial + katalog produk lintas-tenant.                                                                                                                                                                                      |
| `productAnalysisService.ts:31-69`                 | **(P0-1)** Singleton client-store + cache tak-ber-key-branch dipanggil dari route server → produk satu tenant masuk prompt AI tenant lain.                                                                                                                                                   |
| `api/gantikeamanan/+server.ts:40-117`             | **(P0-2)** Penulisan kredensial lintas-tenant (branch tak di-scope ke session).                                                                                                                                                                                                              |
| `api/buku-kas/+server.ts:111-114` (+5 PATCH lain) | **(P0-3)** Mass-assignment `cabang_id` memindah baris ke tenant lain.                                                                                                                                                                                                                        |
| `src/lib/server/branchResolver.ts:5-31, 51-61`    | **Identitas tenant hardcoded** sebagai enum 5 branch Zatiaras + binding D1 statis; `getD1Database` map ke binding SHARED (samarinda+samarinda2 satu D1), fallback `env.DB`. Isolasi = `WHERE cabang_id` saja, tak ada RLS / DB per-tenant. Onboarding = edit source + type union + redeploy. |
| `wrangler.jsonc:1-31`                             | Resource Cloudflare hardcoded Zatiaras: project name, 3 D1 `zatiaras-*-group`, bucket `zatiaras-assets`. Tak bisa host customer baru.                                                                                                                                                        |
| `src/app.d.ts:17-32`                              | Type `env` mengenumerasi 3 binding DB Zatiaras spesifik.                                                                                                                                                                                                                                     |
| `apiAuth.ts:19-28`                                | Role `admin` bypass cek branch & semua role-gate — lintas-tenant saat white-label, lintas-branch dalam satu DB-group hari ini.                                                                                                                                                               |
| `src/lib/server/observability.ts:16-21`           | Telemetri unknown-branch default ke `'samarinda'` — mis-atribusi error/metrik ke tenant salah.                                                                                                                                                                                               |
| `auth/auth.ts:104-116`                            | Default PIN `'1234'` + locked-page list hardcoded client-side saat settings hilang/fetch gagal.                                                                                                                                                                                              |
| `theme-offline` `bayar/+page.svelte:365-376`      | Transaksi offline antri tanpa tag branch; replay bind ke branch session saat sync (admin bisa salah branch).                                                                                                                                                                                 |

### B. Hardcoded Branding (brand "Zatiaras"/"JUS"/juice baked di kode)

| File:line                                                                                               | Masalah                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/utils/receiptPrint.ts:14-22`                                                                   | `DEFAULT_RECEIPT_SETTINGS` = "Zatiaras Juice", "@zatiarasjuice", "Terima kasih sudah ngejus di Zatiaras Juice!" — fallback tercetak saat settings tenant kosong.                                                                                |
| `pos/bayar/+page.svelte:91-97, 9, 388`                                                                  | Prefix kode struk `'JUS'`, counter `last_jus_id` (global per-device, tak ber-scope branch → kode duplikat), logo `LOGO_BASE64` Zatiaras.                                                                                                        |
| `src/lib/components/shared/topBar.svelte:82-86`                                                         | Logo `/img/logo.svg` + alt "Logo Zatiaras" di top bar setiap halaman.                                                                                                                                                                           |
| `src/lib/components/shared/pwaInstallDialog.svelte:234,287,222,231`                                     | Nama app "ZatiarasPOS", icon `/img/icon-192.png`, emoji `🧋`.                                                                                                                                                                                   |
| `static/manifest.json:2-6` + `app.html:5,8,11,17`                                                       | Nama PWA "ZatiarasPOS", theme color `#ec4899`, deskripsi "Bisnis Minuman Anda", title.                                                                                                                                                          |
| `pengaturan/+page.svelte:456-491`                                                                       | Nama app, icon, "© 2024 Zatiaras Juice", "ZatiarasPOS v1.0", theme `#ffb6c1`.                                                                                                                                                                   |
| `pengaturan/printer/+page.svelte:31-37`                                                                 | Default struk "Zatiaras Juice" + alamat/telepon/IG + `LOGO_BASE64`.                                                                                                                                                                             |
| `tailwind.config.js:4-6`                                                                                | **Tak ada theme token** — `theme.extend` kosong; warna pink brand (`#ec4899`/`pink-*`) tersebar **394 occurrence / 36 file** (bottomNav, dropdownSheet, cropperDialog, CartPreview, LaporanFilter, pinModal, dll). Rebrand = edit puluhan file. |
| `+page.svelte:253,259,278,364` & komponen                                                               | Emoji `🍹` + palet pink hardcoded di dashboard, ProductGrid, TokoModal.                                                                                                                                                                         |
| `api/aichat/prompts.ts:101-205` & `hpp/parse/+server.ts:40-49`                                          | Persona AI hardcoded "Zatiaras Juice", "brand jus buah segar", "SPESIFIKASI ANALISIS BISNIS JUS", header OpenRouter `X-Title: Zatiaras POS`, `HTTP-Referer: zatiaraspos.com`.                                                                   |
| `api/aichat/+server.ts:662-681`                                                                         | Whitelist keyword buah (`alpukat,mangga,jeruk,...`) — tenant kopi/roti tak pernah match pertanyaan harga.                                                                                                                                       |
| Komponen reusable (ProductGrid:155, TokoModal:120/156/199, HppTab:249, BahanTab:66, CustomItemModal:91) | Emoji jus + copy contoh ("alpukat 10 kg", "buah, gula, susu, cup") baked di komponen.                                                                                                                                                           |
| `pos/+page.svelte:76-85, 567, 582`                                                                      | Modifier gula/es hardcoded, di-gate `tipe === 'minuman'` — model produk drink-only.                                                                                                                                                             |

### C. Configurability (asumsi single-tenant yang harus jadi config)

| File:line                                                                                                                | Masalah                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reportQueries.ts:137,148` + `dashboardService.ts:335` + `aichat/+server.ts:542` + label `LaporanLabaRugiCard.svelte:30` | **Tarif pajak 0.5% hardcoded & terduplikasi 3-4 tempat.** `Math.round(labaKotor * 0.005)`. Asumsi UMKM PP-23 Indonesia, salah untuk tenant beda regime/jurisdiksi.                           |
| `src/lib/utils/dateTime.ts:1-50` (+ dashboardService:67-71/270, pos/transaction, dashboardQueries, reportData:286-302)   | **Zona waktu `Asia/Makassar` (WITA +08:00) hardcoded app-wide**, konstanta ajaib `hour - 8`/`16:00`. Tenant WIB (+07)/WIT (+09) salah-bucket transaksi, geser total harian lewat batas hari. |
| `src/lib/server/branchResolver.ts:5-31`                                                                                  | **(lihat A)** Roster tenant/branch hardcoded di source.                                                                                                                                      |
| `receiptPrint.ts:26-31` + `pos/transaction/+server.ts:126-130`                                                           | Enum payment method hanya `tunai/qris/non-tunai`; debit/GoPay/transfer collapse jadi `non-tunai`. Tak bisa config metode per-tenant.                                                         |
| `config/env.ts:7-14`                                                                                                     | Config model/endpoint AI literal statis, bukan env/config.                                                                                                                                   |
| `realtimeWorker.js:6-15`                                                                                                 | Cron retention + service name hardcode binding Zatiaras + brand `zatiaraspos-realtime`.                                                                                                      |
| `theme-data` `pos/transaction/+server.ts:198-268`                                                                        | Probing kapabilitas skema via PRAGMA per-request menggantikan migration gate — tenant setengah-migrasi diam-diam drop idempotency/HPP.                                                       |

---

## P1 — Serius

| #     | File:line                                                                                                                    | Dimensi                      | Masalah                                                                                                                                   | Fix singkat                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| P1-1  | `apiAuth.ts:19-28`                                                                                                           | SECURITY/MULTI-TENANT        | Role `admin` bypass cek branch + semua role-gate (lintas-branch/tenant)                                                                   | Batasi/dokumentasikan scope admin (platform-superuser vs owner per-tenant), auditable.                                       |
| P1-2  | `rateLimit.ts:84-130`                                                                                                        | CORRECTNESS                  | Fallback D1: increment SELECT-then-UPDATE non-atomik (race) + DELETE per-request                                                          | `UPDATE ... SET count = count+1` atomik / `ON CONFLICT DO UPDATE`; pindahkan DELETE stale ke cron.                           |
| P1-3  | `gantikeamanan:8-27,52-63,163` + `security-events:12,134-178` + `aichat:25-44,313-326`                                       | SECURITY                     | Rate limiter & event history in-memory per-isolate — di Cloudflare reset terus, bypass-able; cost control AI lemah                        | Gunakan `consumeRateLimit` (DO/D1, fail-closed) seperti veriflogin; key per session/user, bukan IP. Persist event ke D1.     |
| P1-4  | `gantikeamanan:65-66,104-117`                                                                                                | SECURITY                     | `targetRole` tak tervalidasi dipakai sebagai filter query auth-sensitif                                                                   | Validasi terhadap allow-list role, reject unknown 400.                                                                       |
| P1-5  | `hooks.server.ts:25-45`                                                                                                      | SECURITY                     | CSRF opt-in by path list (3 route) + compare non-constant-time; banyak endpoint mutasi tak terlindung                                     | Constant-time compare; default-on untuk semua `/api` mutasi (allow-list exception).                                          |
| P1-6  | `hooks.server.ts:47-60`                                                                                                      | SECURITY                     | Halaman admin hanya dilindungi redirect client-side `onMount`; nol `+layout.server.ts`/`+page.server.ts` di `/pengaturan`                 | Tambah server guard (`+layout.server.ts`) baca `locals.authSession`, 403/redirect sebelum render.                            |
| P1-7  | `receiptPrint.ts:62-112`                                                                                                     | SECURITY                     | `buildReceiptHtml` interpolasi field tak-tepercaya (nama_pelanggan/nama_kustom/produk.nama/settings) tanpa escape — XSS/receipt injection | Tambah `escapeHtml()`, bungkus semua interpolasi dinamis.                                                                    |
| P1-8  | `pos/transaction/+server.ts:76,225-268`                                                                                      | MAINTAINABILITY/MULTI-TENANT | Cache kapabilitas module-global key branch saja — stale pasca-migrasi, unbounded lintas-tenant                                            | TTL/schema-version stamp atau invalidate on migration; idealnya skema known-current, buang probing.                          |
| P1-9  | `api/archive/+server.ts:15-85`                                                                                               | CORRECTNESS                  | Archive hapus ledger tapi sisakan agregat summary; R2-put-then-DB-delete tak atomik → sumber report tak konsisten pra-cutoff              | Tetapkan satu sumber historis kanonik + dokumentasikan; jangan delete jika ledger = truth.                                   |
| P1-10 | `sesi-toko/+server.ts:36-53`                                                                                                 | CORRECTNESS                  | POST open-session tanpa guard sesi aktif ganda; skema tak ada unique constraint                                                           | Reject 409 jika ada `is_active=1`, atau partial-unique index `(cabang_id) WHERE is_active=1`.                                |
| P1-11 | `manajemenmenuState.svelte.ts:36-1196`                                                                                       | SOLID                        | God-store ~1160 baris: load + CRUD 6 entitas + upload gambar + HPP money math + cropper + cache                                           | Split per tab (`createMenuCrud`/`createBahanCrud`/`createHppState`/image helper).                                            |
| P1-12 | `dashboardService.ts:324-353`                                                                                                | MONEY                        | `getReportData` re-derive summary uang client-side, duplikasi formula server (POS gross vs sum cash rows)                                 | Konsumsi `aggData.summary` dari `/api/reports/aggregate`, jangan re-sum.                                                     |
| P1-13 | `reportQueries.ts:37-45,133-149`                                                                                             | MONEY                        | Report abaikan HPP (COGS) — "Laba Kotor/Bersih" overstated; padahal kolom `total_hpp` ada & ditulis checkout, dashboard membacanya        | `labaKotor = pendapatan - pengeluaran - SUM(total_hpp)` atau ekspos COGS sebagai line tersendiri.                            |
| P1-14 | `branchResolver.ts:5-31` / `selectedBranch.svelte.ts:1-31` / `login/+page.svelte:8,357-361` / `wrangler*.jsonc` / `app.d.ts` | MULTI-TENANT                 | **(White-label A)** Roster branch hardcoded & triplikasi lintas file                                                                      | Data-driven tenant registry; single source dari `BRANCH_GROUPS`.                                                             |
| P1-15 | `login/+page.svelte:8,359` / `selectedBranch.svelte.ts:1,11`                                                                 | CONSISTENCY                  | Casing `'Balikpapan'` (client) vs `'balikpapan'` (server) — laten, ditutupi `normalizeBranch` lowercasing                                 | Standardisasi lowercase di store/type/option/localStorage.                                                                   |
| P1-16 | `dataApiClient.ts` (via dashboard read paths)                                                                                | —                            | (lihat P2)                                                                                                                                | —                                                                                                                            |
| P1-17 | `aichat/prompts.ts:92,189,149`                                                                                               | SECURITY                     | Prompt injection: teks user diinterpolasi mentah ke system prompt + arahan "jangan pernah bilang data tidak ada"                          | Tempatkan input user di message role user terdelimitasi, treat sebagai data.                                                 |
| P1-18 | `offlineSync.ts:149-156` (+ `offlineQueue.ts:95-101`, `offline.ts:105-134`)                                                  | OFFLINE                      | Transaksi offline conflict permanen hanya bisa dipulihkan dengan wipe seluruh queue (data-loss trap)                                      | Viewer per-transaksi + discard per-item + state dead-letter, simpan `last_error`.                                            |
| P1-19 | `offlineSync.ts:115-122,135,174-180`                                                                                         | OFFLINE                      | Tak ada trigger sync periodik/visibility; PWA relaunch online dengan queue tak fire event                                                 | `syncPendingTransactions()` on mount jika online & queue non-empty; listener visibilitychange/focus; Workbox BackgroundSync. |
| P1-20 | `buku-kas/+server.ts:77-84`                                                                                                  | PERFORMANCE                  | N+1 SELECT per-row di batch insert offline-sync                                                                                           | Satu `SELECT id ... WHERE id IN (...)` chunked, Set + filter.                                                                |
| P1-21 | `pengaturan/pemilik/arsip/+page.svelte:33-39`                                                                                | OFFLINE                      | Archive destruktif pakai plain `fetch` tanpa CSRF retry & tanpa `branch` di body                                                          | `fetchWithCsrfRetry` + `branch: selectedBranch.value`; pastikan server enforce auth+branch.                                  |
| P1-22 | `schema.ts:281-297`                                                                                                          | SCHEMA                       | Settings `pengaturan`: PK int autoincrement + index branch NON-unique + default PIN `'1234'`                                              | `uniqueIndex` di `cabang_id`; buang default PIN, paksa setup per-tenant.                                                     |

> Catatan P1-13/P1-12/pajak/branch/timezone/receipt-branding juga muncul di White-Label & P0 dependency — lihat silang di Roadmap.

---

## P2 / P3 — Quality (ringkas, per dimensi)

### DRY / dead-code (P2)

- `pos/transaction` PATCH/CRUD boilerplate verbatim lintas endpoint → factory `makeResourceRoute` (`produk:50-87`). Sekaligus jadi single-point fix P0-3.
- Error-parse `body.message||body.error||status` triplikat: `offlineSync:32-44`, `dataApiClient:24-31`, `autoApplyService:7-12` → satu `parseApiError`.
- `formatCurrency` lokal di `manajemenmenuState:918-920` (dilewatkan prop ke BahanTab/HppTab) → pakai `formatRupiah` util.
- `PosProduct/PosCategory/PosAddOn` (`posState:7-27`) re-declare type kanonik + `as unknown as` cast → reuse `$lib/types/product`.
- `CartItem/CartSummary` kanonik (`product.ts:86-99`) nol-consumer; POS pages punya cart interface lokal masing-masing.
- `components.ts:1-53` seluruhnya dead (nol consumer) + `index.ts:18` re-export.
- `product.ts:120-189` banyak type nol-consumer (MenuForm/FilteredProducts/ProductState/dst).
- `store.ts:14,35-60` type dead + duplikat `BranchId`.
- `validation.ts:101-253` validator dead (validateEmail/Password/Date/SKU/checkRateLimit) + rate-limiter kedua duplikat `security.ts`.
- `authGuard.ts:124-177` `requireRole/requireAdmin/requireKasir` dead + asumsi role `admin` tak ada.
- `REPORT_CACHE_VERSION` duplikat `dashboardService:14` & `dataService:12` (P3, desync hazard).
- AI modal shell + SVG send-arrow duplikat `aiChatModal` & `LaporanAISection` (P3).
- gula/es label ladder duplikat (`bayar:413-433,566-585`), NotifModal ~90 baris duplikat (`bayar:864-953` vs `catat:380-469`), rb/ribu/k parse duplikat (`aichat:242-283`).

### Correctness / consistency (P2)

- `dataApiClient.dbGet:79-89` return `[]` pada response non-ok — 401/500 tak bisa dibedakan dari kosong; dashboard/produk read pakai non-strict → dashboard kosong saat error.
- `autoApplyService.rollbackChanges:273-275` stub kosong (orphan financial state on partial apply); branch `penjualan` unreachable (131,148-150).
- `productService` offline-fallback tak konsisten (`getCachedTable` jatuh ke IndexedDB, `getIngredients/getHppSettings` tidak).
- `bahan` PATCH:58-92 edit stok bypass `bahan_mutasi` audit trail.
- `transaksi-kasir` POST:93-109 dead `hasPosInsert` scan + throw unreachable.
- `pos/transaction:591-594` validasi cash hanya jika `cash_received` ada (asimetri); :956 change asimetri.
- Non-cash POS dilabel `'qris'` di report tapi disimpan `'non-tunai'` (`reportQueries:104-114`).
- `avgTicketSize` bagi dengan jumlah baris buku_kas, bukan distinct transaction (`reportData:338-341`).
- Silent error swallow buat query gagal tampak data kosong ke AI (`reportData:64-66,106-108`).
- `jamRamai/dailyTrend` pakai UTC server walau nama var `wita` (`reportData:286-302`).
- DashboardMetrics icon salah (`TrendingUp` bukan `Wallet`) desktop:75-76; class konflik `flex hidden`:73,90; markup mobile duplikat.
- `each` tanpa key: ProductGrid:73/132, MenuTab:120/165/221, dropdownSheet:45, WeeklyChart:72, pemilik riwayat:301.
- Branch casing mismatch (latent) `selectedBranch:1,11` (P2 versi).
- IntersectionObserver tak disconnect on destroy (`WeeklyChart:18-31`).
- `monitoring/+page.server.ts:9-11` butuh role `admin` sedang owner = `pemilik` — split role naming.
- Online checkout hanya queue TypeError/offline; 5xx/timeout gagal-kan sale (`bayar:311-342`).
- Offline cash bisa ditolak conflict saat sync jika harga server naik (`bayar:291-361`).
- Stuck-`syncing` item invisible ke auto-retry 5 menit (`offlineQueue:93-97`).
- `pengaturan` PATCH:63-66 mass-assign kolom (mis. pin) dalam tenant sendiri (allow-list).

### SOLID / SRP / maintainability (P2)

- `topBar.svelte:7,22-72,144-149` chrome layout merangkap AI chat + refreshBus + offline/pending (SRP leak).
- `bayar/+page.svelte:261-363,382-451` orkestrasi transaksi + builder HTML struk inline (~70 baris) walau `receiptPrint.ts` ada.
- Props `any` di ProductGrid/CartPreview/DashboardMetrics sedang manajemenmenu/laporan fully typed.
- Dead imports `pos/+page.svelte:16-27,48` (`AUDIT.md:62` note stale); `skeletonCount` dihitung tapi hardcode 12 (`:284-293,457`).
- `gantikeamanan/+page.svelte:15-40` & `printer/+page.svelte:14-22` masih Svelte 4 `let` (bukan runes).
- `gantikeamanan` duplikasi auth logic (42-50) bukan pakai helper (penyebab P0-2).
- Kredensial change tak audit-logged (`gantikeamanan:144-168`).
- D1 binding block triplikat 3 wrangler file (UUID identik); compat-date 2024-05-18 menua.
- Index redundan `dailySalesSummary:249-250`; `bahan_mutasi.stok_setelah` nullable + no FK; tabel append-only tanpa updated_at (undocumented).
- `unauthorized/+page.svelte:7-10` `logSecurityEvent` jalan top-level (SSR).
- Client cache key tak ber-namespace branch (`cache.ts:492-538`).
- Pagination keyset duplikat raw-SQL vs Drizzle (`transaksi-kasir:54-90`).

### Minor / kosmetik (P3)

- `securitySettings.svelte.ts` PIN tak rehydrate → fallback `'1234'` di consumer; `pinModal.svelte:6` default `'1234'`.
- `userRole.value` typed `string`/`unknown` — kehilangan role-union safety.
- Dashboard error swallowed; realtime refresh tanpa error report (`dashboardState:97-124`).
- Fetch error bypass ErrorHandler + raw `error.message` ke UI (`manajemenmenuState:194-245`; `catat:156-158`).
- HPP default `'1.000'` (display) vs `1000` (calc) (`manajemenmenuState:265,894`).
- `aiAnalysisService` no-op try/catch + unused index + pervasive `any`.
- `productAnalysisService` param `branch` dead + `.includes` tanpa guard null.
- `iconLoader` cache branch unreachable; `csrf.ts` token cache tanpa invalidasi logout.
- CSP `unsafe-inline` (hooks:80-83); markdown→`{@html}` AI output (`LaporanAISection`); receipt HTML unescaped (`bayar:389-407`).
- `upload` GET serve R2 by raw key tanpa validasi prefix.
- `bottomNav` `<a href>` + `onclick goto` dobel; `handlePinError` no-op (`+layout:275-277`).
- `reportQueries:121` komentar `amount` salah (kode pakai `nominal`); `roundMoney` 2-desimal vs rupiah-bulat.
- `pos/transaction:377-393` rate-limit dikonsumsi sebelum cek idempotency; `cash_received`/change tak dipersist.
- Comment stale, `let` vs `$state` di `laporan:377-380`; "Login terakhir" = render-time (`pengaturan:226,235`).
- Legacy offline replay `dbPost` tanpa idempotency; queue-full throw di 1000; hanya `/pos` di-cache offline.
- AI referer/title `zatiaraspos.com` (P3 branding); `BRANCH_ALIASES` identity map; `attempt_count` inflate backoff.

---

## Roadmap Remediasi

### Fase 1 — Ship-Blockers (WAJIB sebelum jual; ~2-3 minggu)

Urutan menghormati dependensi:

1. **P0-6 + P0-7** (manajemenmenu props + ekstra modal) — bug live, perbaiki dulu, `pnpm check` 0 + klik-test 5 tab.
2. **P0-3** (mass-assignment `cabang_id`) — strip kunci immutable di semua PATCH; idealnya via factory `makeResourceRoute` (sekaligus P2 DRY CRUD).
3. **P0-2** (gantikeamanan branch-scope) — pakai `requireSessionBranch` + `requireAnyRole` (sekaligus tutup duplikasi auth P2).
4. **P0-1** (aichat branch dari session, bukan body/header; productAnalysisService jangan dari client-store) — kebocoran lintas-tenant terbesar.
5. **P0-4 + P0-5** (void restore stok + delete atomik) — gabung jadi satu endpoint server `rawDb.batch()` (reverse summary + restore stok + delete dua tabel).
6. Sekalian: P1-5/P1-6 (CSRF default-on + server guard halaman admin), P1-3 (rate-limiter durable), P1-7 (escapeHtml struk).

### Fase 2 — White-Label Enablement (~4-6 minggu)

1. **Tenant registry data-driven** (P1-14/branchResolver/wrangler/app.d.ts): branch→DB-binding dari tabel/KV; `normalizeBranch` validasi terhadap branch set tenant terotentikasi; standardisasi casing lowercase (P1-15). Pertimbangkan DB per-tenant atau helper query fail-closed yang inject `cabang_id`.
2. **Config per-tenant**: tarif pajak (+ apakah berlaku) → `pengaturan`/tabel fiskal, baca di reportQueries+dashboard+aichat (satu helper `computePajak`); zona waktu per-tenant lewat `dateTime.ts`; payment methods sebagai data.
3. **Theme token layer** (tailwind `theme.extend` + CSS custom properties `--color-brand`): ganti 394 occurrence pink/hex; logo/nama/icon/manifest dari config tenant; emoji & copy contoh dari config/netral.
4. **Prompt AI parametrik**: nama bisnis + industri + vocab kategori dari `pengaturan`; buang whitelist buah; referer/title dari env.
5. **Migration gate** (P1-8 + theme-data PRAGMA): jalankan migrate per-DB sebelum serve, buang capability-probing/cache stale.
6. **Observability/cron** (observability default, realtimeWorker binding) jadi config-driven.
7. **Cookie/storage key** netral (`APP_COOKIE_PREFIX`) menggantikan `zatiaras_*`.

### Fase 3 — Quality & Hardening (~2-3 minggu)

1. **Money correctness**: P1-13 (COGS di report), P1-12 (konsumsi summary server), audit-trail bahan, avgTicket distinct-tx.
2. **Offline reliability**: P1-18 (dead-letter + per-item discard), P1-19 (sync trigger on-mount/visibility/background), queue stuck-syncing recovery, 5xx queueing.
3. **DRY/dead-code**: hapus type/validator/komponen nol-consumer; ekstrak `parseApiError`/`makeResourceRoute`/NotifModal/AiModalShell; single `formatRupiah`.
4. **SOLID**: split god-store `manajemenmenuState`, SRP `topBar`/`bayar`.
5. **Consistency**: `each` key, role-union type, runes migration sisa, casing, cache namespace branch.
6. **Hardening minor**: CSP nonce, escapeHtml semua receipt, upload prefix validate, schema FK strategy + unique constraints + append-only docs, compat-date bump.

---

> Lintas-rujuk: temuan yang ditandai DONE di `AUDIT.md` (dead-code whole-file, Rupiah sweep, riwayat dedup, god-component split, kontrak error 2-tier) TIDAK diulang di sini. Klaim `AUDIT.md:170` ("MenuTab props di-review manual") terbukti FALSE oleh `svelte-check` — lihat P0-6.
