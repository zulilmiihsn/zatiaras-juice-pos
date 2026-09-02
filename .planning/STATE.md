# ZatiarasPOS — STATE.md

_File ini adalah "memori" proyek. Update setiap kali ada perubahan signifikan._

## Status Saat Ini

- **Tanggal**: 2026-09-01
- **Milestone**: v2.0 — Stabilisasi & Quality (10/10 Master Plan Completed)
- **Phase Aktif**: **Semua Wave 0–4 Selesai & Terverifikasi**
- **Pekerjaan Terakhir**:
  - Wave 0: Baseline & Checkpoint Branch
  - Wave 1: SEC-001 (Profil Route), MENU-001 (Resep ID), HPP-001 (4-Decimal Yield), POS-001 (Mode Validation), OFF-001 (Offline Receipt Retention)
  - Wave 2: TAX-001 (PP 55/2022 Omzet Usaha Base & 500M Threshold), ARC-001 & ARC-002 (WITA Cutoff, Anti-TOCTOU Exact-ID Batch Delete, Restore Tooling), RT-001 (Multi-Subscriber Isolated Disposers), R2-001 (Branch-Scoped R2 Object Isolation)
  - Wave 3: DB-002 (Journal Drizzle Sync 0017-0022), QA-002 (Typecheck 0 errors 0 warnings, ESLint passed, Prettier passed, Unit & Quality tests 100%), DEBT-001 (Dead code & unused imports cleaned)
  - Wave 4: Release & Evidence Verification (pnpm build, pnpm test:operations, pnpm test:unit, pnpm test:quality, pnpm test:e2e:pos all 100% passing)

## Riwayat Milestone

- **Fase 1** — Formatting & dead-code cleanup historis
- **Fase 2** — Perbaikan type safety; beberapa penggunaan `any` masih ada dan bukan klaim nol
- **Fase 3** — Migrasi state utama ke Svelte 5 rune stores
- **Fase 4** — Ekstraksi komponen dashboard, laporan, POS, dan komponen bersama
- **Fase 5** — Deduplikasi dan polish
- **Phase 3 aktif** — POS checkout reliability, loading/error states, offline/realtime smoke, premium cashier UI polish

## Verifikasi Terakhir

- `pnpm check` → lulus, 0 errors dan 0 warnings
- `pnpm lint` → lulus
- `pnpm test:unit` → lulus
- `pnpm test:all` → lulus
- `pnpm build` → lulus
- `pnpm test:e2e:pos` → 2/2 lulus
- `pnpm test:release` → lulus
- `pnpm audit` → lulus, tidak ada known vulnerability; jalur transitive `@esbuild-kit/core-utils > esbuild` dipaksa ke `0.25.12`
- Schema tiga D1 production → migration `0015` dan `0016` sudah terpasang; tidak dijalankan ulang
- Backup tiga shard → manifest `D:\ZatiarasPOS-Backups\backup-2026-08-12T04-44-27-662Z-1133ee28-185a-4529-a0b5-43542b198f7a\manifest.sha256.json` terverifikasi
- Realtime Worker → version `e69aebae-1ced-49ac-a52f-dd0b0d202033` berhasil dideploy
- Cloudflare Pages → deployment `78163363.zatiaraspos.pages.dev` berhasil dideploy
- Smoke production → root `200`, login `200`, protected API `401`, Worker health `200`
- Service worker → SHA-256 lokal/live sama: `31636b14565920cdd1ab5e83460e99d246b2ef2491a455a2d7a38fd2b538f858`
- Live UAT Samarinda → checkout, dua client realtime, dan cleanup transaksi/ledger terverifikasi

## Artefak Perencanaan

- `.planning/MASTER-PLAN-10of10.md` adalah source of truth aktif untuk prioritas, dependency,
  status task, evidence, dan release gate.
- `.planning/` memuat `PROJECT.md`, `ROADMAP.md`, `STATE.md`, dan analisis codebase.
- `.claude/` memuat workflow perencanaan lokal. Keberadaannya tidak berarti package GSD menjadi dependency aplikasi.
- Konfigurasi MCP dan credential developer berada di luar kontrak repository dan tidak dicatat di file ini.

## Arsitektur Codebase (Ringkasan)

```
src/
├── hooks.server.ts     # CSRF + Security headers + Session middleware
├── app.html            # HTML shell + PWA meta
├── app.css             # Global styles (Tailwind base)
├── lib/
│   ├── auth/           # auth.ts — login username/password dan state autentikasi klien
│   ├── components/
│   │   ├── shared/     # navigasi, modal/sheet, toast, status, dan PWA dialog
│   │   ├── dashboard/  # metrik, WeeklyChart, dan TokoModal
│   │   ├── laporan/    # filter, summary, laba-rugi, AI, dan accordion laporan
│   │   └── pos/        # ProductGrid, CartPreview, dan modal item kustom
│   ├── config/         # env.ts — environment variable access
│   ├── constants/      # navigation.ts — NAV_ITEMS dan getNavIndex
│   ├── database/       # schema.ts — Cloudflare D1 schema via Drizzle
│   ├── server/         # Server-side logic (sessionStore)
│   ├── services/       # dataApiClient, sesiTokoService, aiAnalysisService, dan service domain
│   ├── stores/         # Svelte 5 rune stores (userRole, selectedBranch, securitySettings, posGridView)
│   ├── types/          # TypeScript interfaces (product, user, transaction, laporan, store)
│   └── utils/          # touchNavigation, refreshBus, UI, date/time, dan utility domain
└── routes/
    ├── +layout.svelte  # Root layout (auth guard, bottomNav, PWA)
    ├── +page.svelte    # Dashboard (modular, thin orchestrator)
    ├── pos/            # Point of Sale + /bayar
    ├── catat/          # Catat transaksi/buka-tutup toko
    ├── laporan/        # Laporan (modular dengan LaporanFilter, dll)
    ├── pengaturan/     # Settings (kasir, pemilik, printer sub-routes)
    ├── login/          # Login PIN
    ├── unauthorized/   # 401 page
    └── api/            # Server-side API endpoints
```

## Follow-up Saat Ini

- Jalankan `GOV-001`: inventaris dan pertahankan dirty WIP sebelum source edit, test, migration, atau production probe.

## Keputusan Arsitektural Yang Sudah Dibuat

1. Auth pakai custom session (cookie-based), BUKAN Supabase Auth
2. CSRF protection aktif untuk mutasi API setelah login; login dan logout termasuk route yang dikecualikan
3. Cloudflare D1 dipakai sebagai data store utama, dengan Drizzle schema dan branch-scoped server access
4. Offline-first via IndexedDB (`idb-keyval`)
5. Toast standardized ke `createToastManager()` dari `$lib/utils/ui`
6. sesi_toko fetch centralized ke `$lib/services/sesiTokoService`
7. Touch navigation centralized ke `$lib/utils/touchNavigation`
8. Nav constants di `$lib/constants/navigation`
9. Window event bus di `$lib/utils/refreshBus`

## Instruksi Untuk AI (Antigravity/Claude)

Saat menerima task di proyek ini:

1. Baca `.planning/PROJECT.md` untuk memahami prinsip yang tidak boleh dilanggar
2. Cek `.planning/ROADMAP.md` untuk tahu prioritas saat ini
3. Update `.planning/STATE.md` ini setelah menyelesaikan task signifikan
4. Gunakan Context7 MCP untuk fetch dokumentasi Svelte 5 / Supabase jika diperlukan
5. Jangan ubah UI/UX yang sudah ada kecuali diminta secara eksplisit

## Quick Tasks Completed

| ID         | Task                                        | Commit    | Status                                                                                                                   |
| ---------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 260730-1am | Harden production backup and owner handover | `ebef6e1` | `human_needed` — 8/8 teknis terverifikasi; owner UAT, transfer akses, rotasi credential, dan persetujuan tag masih wajib |
