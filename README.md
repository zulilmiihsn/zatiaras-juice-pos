# ZatiarasPOS

Aplikasi point of sale internal Zatiaras untuk kasir dan pemilik di lima cabang
(Samarinda, Samarinda 2, Balikpapan, Balikpapan 2, Berau). Berjalan sebagai PWA di
Cloudflare Pages dan tetap bisa mencatat penjualan tunai saat offline.

## Fitur

- **POS**: tunai dan non-tunai, porsi biasa/jumbo, tambahan, gula/es/catatan, item
  kustom (khusus pemilik), struk browser dan ESC/POS.
- **Sesi toko**: buka/tutup toko dengan modal awal dan ringkasan laci per shift.
- **Antrean pesanan**: satu transaksi satu kartu (Belum selesai/Selesai), nomor
  pesanan harian `001`–`999+` per cabang per tanggal WITA, notifikasi pesanan baru
  di perangkat lain (banner, suara, Web Push).
- **Katalog**: produk, kategori, tambahan, bahan, resep, HPP, kulakan bahan.
- **Stok**: mutasi bahan/produk, rekonsiliasi fisik, monitoring stok opsional per cabang.
- **Keuangan**: buku kas manual, riwayat, dashboard, laporan harian/rentang berbasis
  WITA, pajak (PPh Final UMKM dan pajak daerah), ekspor PDF.
- **Arsip**: memindahkan transaksi lama ke R2 dengan ringkasan harian agar laporan tetap sama.
- **Asisten AI**: analisis laporan dan pencatatan lewat OpenRouter (hanya model gratis).
- **Keamanan**: peran `kasir`/`pemilik`, kunci PIN per halaman untuk kasir, isolasi data per cabang.

## Arsitektur

| Bagian   | Teknologi                                                              |
| -------- | ---------------------------------------------------------------------- |
| Aplikasi | Svelte 5 (runes), SvelteKit 2, TypeScript, Tailwind CSS 4, Vite 8      |
| Runtime  | Cloudflare Pages (`@sveltejs/adapter-cloudflare`)                      |
| Database | Cloudflare D1, tiga shard: Samarinda, Balikpapan, Berau (Drizzle ORM)  |
| Berkas   | Cloudflare R2 (`STORAGE`): gambar menu dan arsip                       |
| Realtime | Worker `zatiaraspos-realtime` + Durable Object `RealtimeDurableObject` |
| Offline  | Service worker kustom (`src/sw.ts`), IndexedDB untuk antrean transaksi |

Detail alur, konvensi, dan peta modul ada di [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md).

## Prasyarat

- Node.js 24.20 (lihat `.node-version`) dan pnpm 11.24 (lihat `packageManager`).
- Kredensial Cloudflare hanya untuk operasi remote (backup, migrasi, deploy).

## Mulai cepat

```bash
pnpm install
cp .env.example .env.local   # isi POS_PRICE_SIGNING_KEY (>= 32 karakter acak)
pnpm d1:setup:local          # migrasi + seed UAT ke D1 lokal Samarinda
pnpm dev
```

`OPENROUTER_API_KEY` hanya perlu untuk fitur AI. Masuk memakai akun dari seed UAT.

## Perintah penting

| Perintah                      | Fungsi                                                       |
| ----------------------------- | ------------------------------------------------------------ |
| `pnpm check`                  | Pemeriksaan TypeScript/Svelte                                |
| `pnpm lint`                   | Prettier + ESLint                                            |
| `pnpm test:unit`              | Seluruh tes unit/integrasi, paralel (SQLite lokal)           |
| `pnpm test:coverage`          | Diagnostik coverage seluruh unit                             |
| `pnpm test:coverage:critical` | Gate coverage per modul domain kritis + laporan JSON         |
| `pnpm test:all`               | Tes operasional + gate statis + `test:unit`                  |
| `pnpm test:e2e:all`           | Seluruh tes browser Playwright di lingkungan terisolasi      |
| `pnpm test:release`           | `test:all`, build produksi, smoke compiled, lalu seluruh E2E |
| `pnpm build`                  | Build produksi ke `.svelte-kit/cloudflare`                   |

Daftar lengkap ada di `package.json` (`test:*`, `d1:*`, `deploy:*`).

## Rilis dan operasi

Deploy produksi lewat workflow GitHub **Deploy** dari artifact CI yang sudah
terverifikasi, bukan dari laptop. Migrasi D1 tidak ikut deploy dan diterapkan manual
per shard sesudah backup. Langkah lengkap (backup, restore, migrasi, deploy,
rollback, wipe data uji) ada di [docs/OPERATOR-RUNBOOK.md](docs/OPERATOR-RUNBOOK.md).

## Dokumentasi

- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md): arsitektur, alur kritis, konvensi, pengujian.
- [docs/OPERATOR-RUNBOOK.md](docs/OPERATOR-RUNBOOK.md): prosedur operasi produksi.
- [docs/adr/](docs/adr/): catatan keputusan arsitektur.
- [AGENTS.md](AGENTS.md): aturan untuk agen AI (Codex/Claude) di repo ini.
