# 🍹 ZatiarasPOS — PROJECT.md

## Visi

ZatiarasPOS adalah aplikasi Point of Sale (POS) modern berbasis PWA untuk bisnis retail Zatiaras. Aplikasi ini dirancang mobile-first, mendukung multi-cabang, dan mampu beroperasi secara offline-first dengan sinkronisasi real-time di edge Cloudflare.

## Target Pengguna

| Peran               | Kebutuhan Utama                     |
| ------------------- | ----------------------------------- |
| **Kasir**           | Interface cepat, mudah, minim error |
| **Pemilik/Manager** | Laporan akurat, analytics real-time |
| **Admin**           | Manajemen menu, user, dan branch    |

## Tech Stack (LOCKED)

- **Framework**: SvelteKit 5.0 (WAJIB pakai Runes: `$state`, `$derived`, `$effect`)
- **Styling**: Tailwind CSS 4.x (utility-first, no arbitrary values kecuali perlu)
- **Database**: Cloudflare D1 (SQLite di edge), **sharded per grup cabang** (3 DB terpisah), via Drizzle ORM. R2 untuk gambar, Durable Objects untuk realtime + rate limit
- **Auth**: Custom session-based (cookie `zatiaras_sid`) + CSRF protection
- **State Persistence**: `idb-keyval` (IndexedDB) untuk offline-first
- **PWA**: `@vite-pwa/sveltekit` + Workbox

## Prinsip Pengembangan (WAJIB DIIKUTI)

1. **Svelte 5 Runes Only** — Tidak boleh pakai `writable()` store lagi
2. **TypeScript Strict** — Semua kode harus typed, tidak ada `any` kecuali terpaksa
3. **Offline First** — Data penting harus tersimpan lokal dulu, sync kemudian
4. **Mobile First** — Design dan UX harus optimal di HP/tablet
5. **Security** — CSRF token, input sanitization, XSS prevention sudah ada di hooks
6. **No Breaking Changes** — Jangan ubah UI/UX yang sudah ada kecuali diminta

## Modul Inti

- `/` — Dashboard & Analytics (omzet, grafik, produk terlaris)
- `/pos` — Point of Sale (keranjang, pencarian, pembayaran)
- `/pos/bayar` — Proses pembayaran
- `/catat` — Buka/tutup toko, catat pemasukan/pengeluaran
- `/laporan` — Laporan harian dan multi-period
- `/pengaturan` — Settings (kasir, pemilik, printer)
- `/login` — PIN-based authentication
- `/unauthorized` — Access control page
