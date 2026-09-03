# 🍹 ZatiarasPOS: Design Document Spec (DDS)

## 📋 Project Definition

**ZatiarasPOS** is a modern, high-performance Point of Sale (POS) application built for the Zatiaras retail business. It runs entirely on the **Cloudflare edge** (SvelteKit + D1 + R2 + Durable Objects) to provide a real-time, multi-branch, and offline-capable retail experience.

> Catatan: Aplikasi telah **bermigrasi dari Supabase ke Cloudflare D1/R2** (branch `feat/r2-storage-migration`). Bagian lama yang menyebut Supabase di dokumen ini bersifat historis.

## 🛠️ Technology Stack

- **Frontend**: SvelteKit 5.0 (Runes: `$state`, `$derived`, `$effect`, etc.)
- **Styling**: Tailwind CSS 4.x
- **Hosting**: Cloudflare Pages (edge SSR via `adapter-cloudflare`)
- **Database**: Cloudflare D1 (SQLite di edge), **di-shard per grup cabang** (3 DB terpisah), diakses lewat Drizzle ORM
- **Storage**: Cloudflare R2 (gambar produk; disajikan via proxy same-origin `/api/upload`)
- **Realtime & Rate limit**: Cloudflare Durable Objects (WebSocket Hibernation)
- **Auth**: Sesi cookie (httpOnly, SameSite=Lax) + PIN, terisolasi per cabang
- **PWA**: `@vite-pwa/sveltekit` for offline support and native-like experience
- **State Management**: Svelte 5 Runes + `idb-keyval` for persistent local state

## 🏗️ Architecture & Rules

### 1. Svelte 5 Runes Only

- All reactive state MUST use `$state()`.
- Derived values MUST use `$derived()`.
- Side effects MUST use `$effect()`.
- **NO** Svelte 4 `writable` stores or `$` syntax for reactive variables unless strictly necessary for legacy integration.

### 2. Database & Edge (Cloudflare)

- Akses DB lewat **Drizzle ORM → Cloudflare D1** (binding `platform.env.DB_*`), bukan client Supabase. Semua akses DB lewat endpoint server (`/api/...`) — binding **tidak** diekspos ke browser.
- **Isolasi per cabang via sharding**: 3 database D1 terpisah per grup cabang (pengganti pola RLS/instance-per-cabang Supabase).
- Sesi auth: cookie `zatiaras_sid` (httpOnly, SameSite=Lax) + PIN, divalidasi server-side (expiry dicek).
- Semua query DB menangani error dengan baik dan memberi umpan balik ke UI.

### 3. PWA & Offline First

- Every transaction MUST be saved locally to IndexedDB first and synced periodically or upon restoration of connection.
- Use `workbox` for service worker management.

### 4. Code Quality

- **Type Safety**: strict TypeScript is mandatory.
- **Micro-animations**: Use Svelte transitions for all UI changes to maintain "Premium Design" aesthetics.
- **Internationalization**: All displays must follow Indonesian/WITA standards.

## 📊 Core Modules

1. **POS (Point of Sale)**: Fuzzy search, fuzzy cart merging, payment processing.
2. **Dashboard**: Financial analytics with animated charts.
3. **Catat**: Income/Expense recording with categorization.
4. **Laporan**: Comprehensive multi-day reporting.
5. **Pengaturan**: Branch, products, and employee management.

---

_Created with ❤️ by Antigravity (Google DeepMind) using GSD Framework._
