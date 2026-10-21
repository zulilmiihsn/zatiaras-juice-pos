# Konsistensi frontend

Tanggal mulai: 21 Oktober 2026. Pemindaian baca-saja terhadap 91 file `.svelte`
dan store menemukan pola yang berbeda-beda cara penulisannya. Tujuan dokumen ini:
setiap pola punya satu cara di seluruh aplikasi, dikerjakan per kartu oleh agent
yang lebih murah, dan dikunci oleh tes ratchet di CI supaya tidak kambuh.

## Cara memakai

- Lihat angka dan lokasi sekarang: `node scripts/frontend-consistency.mjs --details`
  (tambah `--json` untuk keluaran mesin).
- Angka dikunci oleh `pnpm test:frontend-consistency`
  ([`src/tests/frontend-consistency-guard-tests.ts`](../src/tests/frontend-consistency-guard-tests.ts)).
  Tes gagal dalam dua arah: angka naik (pelanggaran baru) **dan** angka turun
  tetapi ceiling belum diturunkan. Jadi setiap kartu wajib menurunkan ceiling
  miliknya di commit yang sama dengan perbaikannya.
- Menaikkan ceiling hanya boleh dengan alasan tertulis di pesan commit.

## Aturan kerja agent

1. Kerjakan satu kartu berstatus **Todo** dari atas yang sesuai modelmu. Jangan
   kerjakan kartu **Tertahan**. Jangan menyentuh apa pun di luar kartu.
2. Satu kartu = satu commit. Pesan commit bahasa Indonesia, conventional, satu
   topik, subjek diakhiri ID kartu, contoh `refactor(ui): pakai alias Tailwind (F7)`,
   lalu baris atribusi dari harness. Hash commit kartu dicari lewat
   `git log --grep='(F7)'`.
3. `git add <path eksplisit>`, `git commit`, dan `git push origin main` adalah
   tiga panggilan terpisah, tanpa `cd … &&` dan tanpa rantai. Periksa
   `git diff --cached --stat` sebelum commit. Perbarui tracker ini dengan Edit
   tool (bukan sed) dan sertakan di commit kartu: status menjadi **Selesai**,
   kolom "Sekarang" diisi hasil skrip.
4. Pakai ulang, jangan bikin baru: `AppModal` + `modalFocus`
   (`src/lib/utils/modalFocus.ts`), `ToastNotification` + `createToastManager`
   (`src/lib/utils/ui.svelte.ts`), `HeaderBackButton` (prop `href`), `PageHeader`,
   `.btn-brand-*` dan `.soft-float-card` (`src/app.css`), `normalizeRole`
   (`src/lib/utils/roles.ts`).
5. Gerbang tiap kartu, semuanya harus hijau sebelum commit:
   `pnpm check`; `pnpm exec eslint <file yang diubah>`;
   `pnpm exec prettier --write <file yang diubah>`; `pnpm test:frontend-consistency`;
   e2e yang tertulis di kartu lewat `node scripts/run-playwright-local.mjs e2e/<spec>.ts`.
   Kartu yang menyentuh store atau `roles.ts` menambah `pnpm test:unit`.
   Akhir tiap fase menambah `pnpm test:static`.
6. E2E yang butuh login asli gagal di lokal (password seed tidak cocok dengan
   `UAT_PASSWORD`, hasilnya 401). Itu masalah lingkungan, bukan kode; catat di
   laporan dan andalkan CI.
7. Setelah push, baca hasil CI dengan `gh run view <id> --json conclusion,jobs`.
   Jangan memakai `gh run watch … | tail` karena menelan status gagal.
8. Akhir tiap fase, deploy **staging saja**:
   `gh workflow run deploy.yml -f sha=<SHA 40 karakter> -f ci_run_id=<run CI hijau> -f dry_run=false -f target=staging -f staging_ref=main`.
   Produksi tidak pernah dikerjakan agent; pemilik yang menjalankannya.
9. Berhenti dan tanya pemilik bila: tes gagal dua kali tanpa sebab jelas;
   tampilan berubah di luar yang dijelaskan kartu; atau perubahan menyentuh
   otorisasi di server.
10. Edit yang mengandung regex atau backslash dilakukan dengan Edit/Write tool,
    bukan sed atau `node -e` ber-quote shell.

## Metrik

"Awal" = hasil skrip pada 21 Oktober 2026. "Sekarang" diisi agent saat kartu selesai.

| Metrik                      | Yang dihitung                                                    | Awal | Target       | Sekarang | Kartu   |
| --------------------------- | ---------------------------------------------------------------- | ---- | ------------ | -------- | ------- |
| `nestedStyle`               | elemen `<style>` yang bukan blok tingkat atas                    | 2    | 0            | 0        | F1      |
| `effectAssignOnly`          | `$effect` yang hanya menyalin satu nilai ke variabel             | 3    | 0            | 0        | F3      |
| `appStoresImport`           | `import … from '$app/stores'`                                    | 3    | 0            | 0        | F4      |
| `pureGotoButton`            | `<button onclick={() => goto('/literal')}>`                      | 5    | 0            | 0        | F2, F5  |
| `headerBackGoto`            | `<HeaderBackButton onclick={() => goto(…)}>`                     | 6    | 0            | 0        | F5      |
| `consoleLogClient`          | `console.log` di kode klien                                      | 1    | 0            | 0        | F6      |
| `staleVersionText`          | teks `v1.0` atau `© 2024` di markup                              | 3    | 0            | 0        | F6      |
| `arbitraryDvh`              | `min-h-[100dvh]` dan `h-[100dvh]`                                | 18   | 0            | 0        | F7      |
| `flexShrinkAlias`           | `flex-shrink-*` (nama Tailwind v3)                               | 28   | 0            | 0        | F7      |
| `lowercaseComponentFiles`   | berkas komponen diawali huruf kecil                              | 11   | 0            | 0        | F8      |
| `importPathCaseMismatch`    | import `.svelte` beda huruf besar/kecil dari berkas di disk      | 0    | 0            | 0        | penjaga |
| `overlayFiles`              | elemen `fixed inset-0` di berkas tanpa `use:modalFocus`          | 17   | 0            | 14       | F9a–c   |
| `inlineToast`               | berkas dengan `z-toast` selain `toastNotification`               | 3    | 0            | 3        | F10     |
| `roleButton`                | kemunculan `role="button"`                                       | 14   | 0            | 14       | F11     |
| `duplicatedLongClassGroups` | string kelas ≥ 90 karakter yang muncul ≥ 3 kali                  | 36   | diset di F12 | 35       | F12     |
| `brandHexClass`             | `[#db2777]`, `[#ec4899]`, `[#f43f5e]` + gradien hex di `app.css` | 118  | 0            | 118      | F13     |
| `canvasHex`                 | `bg-[#faf7f8]`                                                   | 23   | 0            | 23       | F13     |
| `neutralNonSlate`           | `gray/stone/zinc/neutral-<shade>`                                | 279  | 0            | 276      | F14     |
| `roleLiteralUI`             | perbandingan literal `'pemilik'/'admin'/'kasir'` di UI dan store | 36   | 0            | 36       | F15     |
| `e2eWaitForTimeout`         | `waitForTimeout(` di `e2e/`                                      | 18   | 14           | 18       | F16     |

## Kartu

Status: Todo, Sedang, Selesai, Tertahan. Model = model terendah yang cukup.

| ID   | Judul                                 | Model  | Status   |
| ---- | ------------------------------------- | ------ | -------- |
| F0   | Alat track (skrip, tes, CI, dokumen)  | Sonnet | Selesai  |
| F1   | `<style>` bersarang                   | Haiku  | Selesai  |
| F2   | Menu `/pengaturan` jadi daftar + link | Sonnet | Selesai  |
| F3   | State turunan lewat `$derived`        | Sonnet | Selesai  |
| F4   | `$app/stores` ke `$app/state`         | Haiku  | Selesai  |
| F5   | Navigasi pakai link                   | Haiku  | Selesai  |
| F6   | Perapian kecil (log, versi, footer)   | Haiku  | Selesai  |
| F7   | Alias Tailwind                        | Haiku  | Selesai  |
| F8   | Nama berkas komponen PascalCase       | Haiku  | Selesai  |
| F9a  | Modal `pos/bayar` ke `AppModal`       | Sonnet | Selesai  |
| F9b  | Modal login, pajak, PIN, cropper      | Sonnet | Todo     |
| F9c  | Modal sisanya                         | Sonnet | Todo     |
| F10  | Satu mekanisme toast                  | Sonnet | Todo     |
| F11  | `role="button"` jadi `<button>`       | Sonnet | Todo     |
| F12  | Kelas form bersama                    | Sonnet | Todo     |
| F13  | Token warna merek                     | Haiku  | Todo     |
| F14  | Abu-abu ke slate                      | Haiku  | Todo     |
| F15  | Helper peran UI                       | Sonnet | Todo     |
| F15b | Server yang masih mengecualikan admin | Sonnet | Tertahan |
| F16  | Tidur di e2e jadi `toPass`            | Sonnet | Todo     |

Urutan dan fase: **A** = F1–F8 (mekanis, tanpa perubahan tampilan) lalu staging.
**B** = F9a–F11 (perilaku dan aksesibilitas) lalu staging, pemilik mencoba alur
bayar dan modal. **C** = F12–F14 (tampilan) lalu staging, pemilik menyetujui
secara visual. **D** = F15, F15b, F16.

### Resep

**F1 `<style>` bersarang.** `src/routes/antrean/+page.svelte` dan
`src/routes/pengaturan/+page.svelte` punya `<style>` di dalam markup. Svelte hanya
memproses `<style>` tingkat atas, jadi blok itu menjadi elemen DOM mentah dan
`:global(pwa-install)` di dalamnya bukan CSS yang sah. Pindahkan blok ke
tingkat atas berkas (setelah markup). Bukti: `node scripts/frontend-consistency.mjs`
menunjukkan `nestedStyle` 0, dan compile berkas itu menghasilkan CSS.

**F2 Menu `/pengaturan`.** Di `src/routes/pengaturan/+page.svelte`, empat tombol
menu adalah salinan markup yang sama. Ganti dengan satu array data + `{#each}`.
Antrean, Draft Struk, dan Riwayat menjadi `<a href>`; Install PWA tetap `<button>`
(itu aksi). Item yang tidak diizinkan dirender sebagai elemen non-link dengan
`aria-disabled="true"`. Kelas `.settings-menu-item` dan `.settings-menu-icon`
diganti utilitas Tailwind dengan perilaku sama (satu kolom di HP, dua kolom md,
empat kolom lg). Sesuaikan `e2e/security-settings.spec.ts` (kini tiga link dan
satu button di navigasi "Menu pengaturan") dan `e2e/antrean-notifications.spec.ts`.
Tes: kedua spec itu.

**F3 State turunan.** `src/lib/stores/catatState.svelte.ts` dan
`src/lib/stores/posPageState.svelte.ts` memakai
`$effect(() => { currentUserRole = userRole.value || '' })`. Ganti dengan
`$derived` dan pertahankan antarmuka yang diekspos. Di `src/routes/login/+page.svelte`
tulis `selectedBranch.value` di handler perubahan cabang, bukan di `$effect`.
Tes: `pnpm test:unit`, e2e `catat-recent` dan `pos`.

**F4 `$app/stores`.** `import { page, navigating } from '$app/state'`;
`$page.url.pathname` menjadi `page.url.pathname`; `if ($navigating)` menjadi
`if (navigating.to)`. Berkas: `src/routes/+layout.svelte`,
`src/lib/components/shared/appNav.svelte`, dan satu berkas lain (lihat `--details`).
Tes: `e2e/stock-policy.spec.ts`, `e2e/pos.spec.ts`.

**F5 Navigasi pakai link.** Tombol `onclick={() => goto('/x')}` murni menjadi
`<a href="/x">` dengan kelas yang sama ditambah `focus-visible:ring-2`:
`src/routes/monitoring/+page.svelte`, `src/routes/pengaturan/pemilik/stok/+page.svelte`.
`<HeaderBackButton onclick={() => goto(X)}>` menjadi `<HeaderBackButton href={X} label="…">`
(daftar berkas: `--details`, metrik `headerBackGoto`). Hapus import `goto`
yang tidak terpakai. Jangan ubah tombol di `pos/bayar` yang mengerjakan aksi
sebelum berpindah halaman. Tes: `e2e/security-settings.spec.ts`, `e2e/antrean-notifications.spec.ts`.

**F6 Perapian kecil.** `src/lib/stores/layoutState.svelte.ts` `console.log` menjadi
`console.warn`. Versi aplikasi: di `vite.config.ts` tambah
`define: { __APP_VERSION__: JSON.stringify(<version dari package.json>) }` dan
`declare const __APP_VERSION__: string;` di `src/app.d.ts`. Footer di
`src/routes/pengaturan/+page.svelte` menjadi `ZatiarasPOS v{__APP_VERSION__}` dan
`© {new Date().getFullYear()} Zatiaras Juice`, dipindah ke dalam `<main>` dengan
`mt-auto` supaya halaman tidak selalu bisa digulir. Tahun di
`src/routes/unauthorized/+page.svelte` juga dinamis.

**F7 Alias Tailwind.** Ganti `min-h-[100dvh]` dengan `min-h-dvh`, `h-[100dvh]`
dengan `h-dvh`, dan `flex-shrink-0` dengan `shrink-0` di semua `.svelte` memakai
skrip node pengganti string persis (taruh skrip di scratchpad, bukan di repo),
lalu `pnpm format`. Jangan menyentuh `calc(100dvh-…)`. Tes: `e2e/pos.spec.ts`,
`e2e/stock-policy.spec.ts`.

**F8 Nama berkas komponen.** Sebelas berkas camelCase (`aiChatModal`, `appNav`,
`cropperDialog`, `dropdownSheet`, `modalSheet`, `pinModal`, `sendIcon`,
`toastNotification`, `topBar`, `topBarAiAssistant`, `topBarStatus`) menjadi
PascalCase lewat `git mv` (di Windows rename yang hanya beda huruf wajib lewat
git). Perbarui semua import, termasuk di tes dan e2e. Pencarian case-sensitive
nama lama harus 0 dan `importPathCaseMismatch` tetap 0. Penjaga akhir adalah CI
Linux. Perbarui juga nama berkas yang disebut di tes ini dan di
`scripts/frontend-consistency.mjs` bila ada.

**F9a Modal `pos/bayar`.** Tiga overlay buatan sendiri di
`src/routes/pos/bayar/+page.svelte` (batal, peringatan QRIS, sukses) menjadi
`<AppModal open align="bottom" zClass="z-alert" label=… size=…>`. `onClose` =
handler tutup yang sudah ada; layar sukses yang tidak boleh ditutup memakai
`backdropClose={false}`. Buang animasi kustom yang digandakan `AppModal`.
Tes: `e2e/pos.spec.ts`, `e2e/sheet-enter.spec.ts`, `e2e/modal-focus.spec.ts`.

**F9b Modal login, pajak, PIN, cropper.** `src/routes/login/+page.svelte` (dua),
`src/routes/pengaturan/pemilik/pajak/+page.svelte`, `pinModal`
(ganti z-index numerik dengan token), dan `cropperDialog` menjadi `AppModal`, atau
`use:modalFocus` langsung di panel bila tata letak `AppModal` tidak cocok.
Pertahankan semantik tutup PIN yang sekarang. Tes: `e2e/auth.spec.ts`,
`e2e/tax.spec.ts`, `e2e/security-settings.spec.ts`, `e2e/modal-focus.spec.ts`.

**F9c Modal sisanya.** `TokoModal`, `NotifModal`, `DetailTransaksiModal`,
`LaporanFilter`, `LaporanAISection`, dua di `src/routes/laporan/+page.svelte`,
dua di `aiChatModal` (chat layar penuh memakai `use:modalFocus`), dan
`PendingTransactionsSheet`. Tes: `e2e/reports.spec.ts`, `e2e/aichat-errors.spec.ts`,
`e2e/dashboard-branch.spec.ts`, `e2e/modal-focus.spec.ts`.

**F10 Satu mekanisme toast.** Div `z-toast` manual di `src/routes/catat`,
`src/routes/pengaturan` (toast PWA terpasang dan notifikasi amber), dan
`src/routes/pos/bayar` menjadi `<ToastNotification>` + `createToastManager()`
(contoh pemakaian: `src/routes/pengaturan/printer/+page.svelte`). Hijau menjadi
`success`, amber menjadi `warning`. Teks tidak berubah.

**F11 `role="button"`.** Daftar berkas: `--details` pada `roleButton`. Ganti elemen
`div`/`span` ber-`role="button"` dengan `<button type="button">` dan hapus
`onkeydown` Enter/Space yang jadi berlebih. Bila elemen membungkus kontrol
interaktif lain (button bersarang tidak sah), pisahkan area kliknya; bila tidak
bisa, laporkan ke pemilik. Tes: `e2e/menu.spec.ts`, `e2e/security-settings.spec.ts`,
`e2e/reports.spec.ts`.

**F12 Kelas form bersama.** Tambah `.form-input` dan `.form-label` di
`src/app.css` di samping `.btn-brand-*`, berdasar string input yang paling sering
(empat FormModal manajemen menu). Terapkan ke grup duplikat yang dilaporkan
`--details` (`duplicatedLongClassGroups`): FormModal ×4, `CredentialsCard`,
`src/routes/pengaturan/printer`, `LaporanFilter` + `src/routes/laporan`, label di
`PosProductSheet`. Tampilan harus identik; bandingkan screenshot sebelum dan
sesudah. Set ceiling baru dari hasil.

**F13 Token warna merek.** Keputusan pemilik: pink header lama (hex) menjadi
sumber. Di blok `@theme` `src/app.css` tambah
`--color-pink-500: #ec4899; --color-pink-600: #db2777; --color-rose-500: #f43f5e;`
dan `--color-canvas: #faf7f8;`. Di semua `.svelte`: `[#ec4899]` menjadi `pink-500`,
`[#db2777]` menjadi `pink-600`, `[#f43f5e]` menjadi `rose-500` (mis.
`from-[#db2777]` menjadi `from-pink-600`), `bg-[#faf7f8]` menjadi `bg-canvas`.
Gradien `.page-header` dan gradien lain di `app.css` memakai `var(--color-pink-600)`,
`var(--color-pink-500)`, `var(--color-rose-500)`. Hex lain yang muncul 1–6 kali
dibiarkan. Bukti: screenshot header sebelum dan sesudah pada lebar 1440 dan 390
tampak identik. Pemilik bisa membatalkan keputusan ini saat melihat staging.

**F14 Abu-abu ke slate.** Ganti `gray|stone|zinc|neutral-<shade>` menjadi
`slate-<shade>` (shade sama) di `.svelte`. Pemilik memeriksa tampilan di staging.

**F15 Helper peran UI.** Keputusan pemilik: `admin` diperlakukan sama dengan
`pemilik` di semua UI, sesuai `requireAnyRole` di `src/lib/server/apiAuth.ts`.
Tambah `isOwnerRole(role)` (pemilik atau admin), `isStaffRole(role)` (kasir,
pemilik, atau admin), dan `isKasirRole(role)` di `src/lib/utils/roles.ts`, dan
ganti semua literal peran di UI dan store dengan helper itu, termasuk yang kini
mengecualikan admin (menu Antrean di `pengaturan/+page.svelte`,
`pengaturan/antrean/+page.svelte`, `pengaturan/pemilik/riwayat/+page.svelte`,
`securitySettingsState`, `bayarState`, `+layout.svelte`). Tambah kasus ke
`src/tests/role-contract-tests.ts`. Nama tab seperti
`activeSecurityTab === 'pemilik'` bukan peran dan tidak termasuk.

**F15b Server yang masih mengecualikan admin.** Tertahan sampai pemilik
menyetujui secara eksplisit karena memperluas akses di server.
`src/routes/api/pengaturan/stok/offline-reviews/+server.ts`,
`…/offline-reviews/[idempotency_key]/+server.ts`, dan `src/routes/api/pengaturan/stok/+server.ts`
memakai `role !== 'pemilik'`; ganti dengan `requireAnyRole(session.role, ['pemilik'])`
agar admin tidak melihat fitur di UI lalu ditolak 403.

**F16 Tidur di e2e.** Empat loop tidur-lalu-cek di `e2e/menu.spec.ts` menjadi
`await expect(async () => { … }).toPass({ timeout })`. `waitForTimeout` lainnya
adalah jendela "tidak ada yang terjadi" yang disengaja; beri komentar satu baris
dan biarkan. Target `e2eWaitForTimeout` 14.

## Menyerahkan ke agent

Setelah F0 ada di `main`, sesi baru cukup diberi prompt ini:

> Baca `docs/FRONTEND-CONSISTENCY.md`. Kerjakan kartu berstatus Todo paling atas
> yang sesuai modelmu, ikuti "Aturan kerja agent" persis, perbarui tracker
> (status dan kolom "Sekarang"), lalu berhenti dan laporkan. Jangan kerjakan
> kartu Tertahan.

## Log

- 21 Oktober 2026: F0 selesai. Skrip pengukur, tes ratchet, langkah CI, dan
  dokumen ini ditambahkan. Pemindaian awal mencatat 20 metrik.
- 21 Oktober 2026: F2 selesai. Menu `/pengaturan` jadi array + `{#each}`; tiga
  item `<a href>`, Install PWA tetap `<button>`, item terlarang `aria-disabled`.
  Kelas `.settings-menu-*` dibuang. `pureGotoButton` 5 → 2, `neutralNonSlate`
  279 → 276 (tiga `text-stone-400` duplikat hilang).
- 21 Oktober 2026: F3 selesai. `currentUserRole` di `catatState` dan
  `posPageState` jadi `$derived`. Di `login/+page.svelte` `selectedBranch.value`
  ditulis di handler `onchange` dan sekali lagi sebelum `loginWithUsername`
  (pilihan bawaan tanpa perubahan tetap harus masuk store). `effectAssignOnly`
  3 → 0.
- 21 Oktober 2026: F1 selesai. Blok `<style>` di `antrean/+page.svelte` dan
  `pengaturan/+page.svelte` dipindah ke tingkat atas berkas; compile keduanya
  kini menghasilkan CSS. `nestedStyle` 2 → 0.
- 21 Oktober 2026: F4 selesai. `+layout.svelte` dan `appNav.svelte` memakai
  `page` dan `navigating` dari `$app/state`. `appStoresImport` 3 → 0.
- 21 Oktober 2026: F5 selesai. Tombol `goto` di `monitoring` dan `pemilik/stok`
  jadi `<a href>` dengan `focus-visible:ring-2`; enam `HeaderBackButton` memakai
  `href` + `label` ("Kembali ke Pengaturan" / "Kembali ke Pengaturan Pemilik").
  Import `goto` yang tak terpakai dibuang. `pureGotoButton` 2 → 0,
  `headerBackGoto` 6 → 0.
- 21 Oktober 2026: F6 selesai. `console.log` di `layoutState` jadi
  `console.warn`. `__APP_VERSION__` didefinisikan di `vite.config.ts` dari
  `package.json` dan dideklarasikan di `app.d.ts`. Footer `pengaturan` dipindah
  ke dalam `<main>` (`mt-auto`) dengan versi dan tahun dinamis; tahun di
  `unauthorized` juga dinamis. `consoleLogClient` 1 → 0, `staleVersionText` 3 → 0.
- 21 Oktober 2026: F7 selesai. `min-h-[100dvh]` → `min-h-dvh` (18) dan
  `flex-shrink-0` → `shrink-0` (28) di 31 berkas `.svelte`; `h-[100dvh]` tidak
  ada. `calc(100dvh-…)` tidak disentuh. `arbitraryDvh` 18 → 0, `flexShrinkAlias`
  28 → 0. Efek samping: `duplicatedLongClassGroups` 36 → 35 (satu string
  kelas memendek di bawah 90 karakter setelah alias diganti).
- 21 Oktober 2026: F8 selesai. Sebelas berkas komponen di
  `src/lib/components/shared` di-rename PascalCase lewat `git mv` (dua langkah
  karena Windows tak peka huruf besar/kecil) dan 21 berkas yang mengimpornya
  diperbarui. Pencarian case-sensitive nama lama 0, `importPathCaseMismatch`
  tetap 0. `lowercaseComponentFiles` 11 → 0. Penjaga akhir: CI Linux.
- 21 Oktober 2026: F9a selesai. Tiga overlay `pos/bayar` (batal, peringatan QRIS,
  sukses) jadi `<AppModal align="bottom" zClass="z-alert" size="sm">`. Batal
  menutup lewat `closeModal` (Escape dan klik latar ikut menutup); QRIS dan sukses
  memakai `backdropClose={false}` tanpa `onClose` sehingga hanya tombol yang
  menutup, sama seperti sebelumnya. Keyframes `slideUpModal` dibuang; panel kini
  `max-w-md` (ukuran `sm` AppModal) menggantikan `max-w-sm`. `overlayFiles`
  17 → 14.
