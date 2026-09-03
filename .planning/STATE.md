# ZatiarasPOS — STATE.md

_File ini adalah "memori" proyek. Update setiap kali ada perubahan signifikan._

## Status Saat Ini

- **Tanggal**: 2026-09-02
- **Milestone**: v2.0 — Stabilisasi & Quality (10/10 Master Plan Completed)
- **Candidate Commit SHA**: `8b345a63048f23985834623b3384031c36f318f1`
- **Phase Aktif**: **Semua 28 Task Master Plan Selesai & Terverifikasi (Evidence Ledger Terisi)**
- **Pekerjaan Terakhir**:
  - Wave 0: GOV-001, DB-001, QA-001 (Clean candidate branch, D1 backup runner, Code quality suite)
  - Wave 1: SEC-001 (Strict role whitelist), MENU-001 (Atomic menu/recipe mutation + CSRF retry), HPP-001 (4-Decimal Yield/HPP), POS-001 (Fail-closed validation), POS-002 (Canonical SHA-256 fingerprint & receipt snapshot idempotency), OFF-001 & OFF-002 (Branch-scoped offline queue & sync replay)
  - Wave 2: TOK-001 (Multi-generation HMAC key rotation), R2-001 (Branch-scoped R2 image isolation), RT-001 (Multi-subscriber isolated disposers), ARC-001 & ARC-002 (GET preview, WITA cutoff, R2 readback checksum, exact-ID delete, auto-binding restore), TAX-001 (PP 55/2022 YTD cumulative 500M threshold)
  - Wave 3: DB-002 (Drizzle migration 0000-0023 complete), QA-002 (100% test pass across operations, quality, and 10 unit test suites), MAINT-001 & DEBT-001 (Clean types & zero svelte-check diagnostics)
  - Wave 4: Release Provenance & Checklists (package.json release gates, DEVELOPER-GUIDE.md, HANDOVER-CHECKLIST.md, clean git tree)

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

- Seluruh 28 task master plan selesai dan diverifikasi (`test:all` 100% pass).
- Release candidate SHA tercatat di Evidence Ledger [MASTER-PLAN-10of10.md](./MASTER-PLAN-10of10.md).
- Siap untuk owner UAT & release tag setelah persetujuan pemilik.

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
4. Gunakan Context7 MCP untuk fetch dokumentasi Svelte 5 / Cloudflare D1 jika diperlukan
5. Jangan ubah UI/UX yang sudah ada kecuali diminta secara eksplisit

## Quick Tasks Completed

| ID         | Task                                        | Commit    | Status                                                                                                                   |
| ---------- | ------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 260730-1am | Harden production backup and owner handover | `ebef6e1` | `human_needed` — 8/8 teknis terverifikasi; owner UAT, transfer akses, rotasi credential, dan persetujuan tag masih wajib |
