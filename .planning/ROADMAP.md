# 🗺️ ZatiarasPOS — ROADMAP.md

## Milestone Aktif: v2.0 — Stabilisasi & Quality

> Source of truth aktif: [`MASTER-PLAN-10of10.md`](./MASTER-PLAN-10of10.md).
> Eksekusi dimulai dari `GOV-001`; phase di bawah dipertahankan sebagai riwayat
> dan konteks.

### ✅ Phase 0: GSD Setup (SELESAI)

- [x] Pasang Context7 MCP di Antigravity
- [x] Inisialisasi GSD framework di `.claude/`
- [x] Buat `DDS.md`, `PHASES.md`, `.planning/` structure
- [x] Pemetaan arsitektur codebase

### ✅ Phase 1: Audit & Alignment (SELESAI)

- [x] Periksa semua route, hapus dead code, format dengan Prettier
- [x] Audit tipe TypeScript — hilangkan semua `any` di routes (270+ → 0)
- [x] Migrasi semua Svelte 4 stores → Svelte 5 runes (`$state`, `$derived`, `$effect`)
- [x] Ganti semua `(window as any).__refreshXxx` dengan `refreshBus`
- [x] Ekstrak komponen reusable dari route monolitik (laporan, dashboard, pos)
- [x] Deduplikasi: centralize touch nav, nav constants, toast manager, sesi toko service
- [x] Hapus semua `a11y-ignore` comments
- [x] `pnpm check` → 0 errors ✅

### ✅ Phase 2: Feature Improvement (SELESAI)

- [x] Scope Phase 3 ditentukan: POS checkout reliability, loading states, empty/error states, offline/realtime validation.

### ✅ Phase 3: POS Production Polish (SELESAI)

- [x] Deploy config check: `pnpm deploy:check`
- [x] Quality test runner failure propagation
- [x] Local verification: `pnpm check`, `pnpm build`, `pnpm lint`, `pnpm test:all`
- [x] PWA/offline reliability check
- [x] Realtime auth-gate smoke check on live Pages endpoint
- [x] Premium UI polish for cashier-critical screens
- [x] Migrasi `modalSheet.svelte` ke Svelte 5 rune callbacks & snippets

---

_Update roadmap ini setiap kali ada fitur baru atau perubahan prioritas._
