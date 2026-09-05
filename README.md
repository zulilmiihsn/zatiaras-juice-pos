<!-- generated-by: gsd-doc-writer -->

# ZatiarasPOS

ZatiarasPOS adalah aplikasi point of sale internal multi-cabang untuk kasir, pemilik, dan pengelola operasional Zatiaras.

## Fitur saat ini

- POS tunai dan non-tunai dengan sesi buka/tutup toko, struk, item tambahan, dan item kustom khusus pemilik.
- Katalog produk, kategori, bahan, resep, HPP, stok, dan mutasi bahan.
- Buku kas, riwayat transaksi, dashboard, serta laporan harian dan rentang tanggal berbasis WITA.
- Isolasi data per cabang dan kontrol akses untuk peran `kasir` serta `pemilik`.
- PWA untuk instalasi perangkat. Mode offline terbatas pada alur POS yang memakai katalog tersimpan dan antrean transaksi di IndexedDB; antrean diputar ulang saat koneksi kembali.
- Notifikasi perubahan per cabang melalui WebSocket. Klien memuat ulang data terkait ketika menerima event; jalur ini bukan pengganti penyimpanan transaksi di D1.

## Arsitektur ringkas

| Bagian   | Implementasi                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------- |
| Aplikasi | Svelte 5, SvelteKit 2, TypeScript, Tailwind CSS 4, Vite 6                                       |
| Runtime  | Cloudflare Pages melalui `@sveltejs/adapter-cloudflare`                                         |
| Database | Cloudflare D1 dengan tiga binding grup: Samarinda, Balikpapan, dan Berau                        |
| Aset     | Cloudflare R2 melalui binding `STORAGE`                                                         |
| Realtime | Worker `zatiaraspos-realtime` dan `RealtimeDurableObject`                                       |
| Skema    | Drizzle ORM; sumber skema ada di `src/lib/database/schema.ts` dan SQL migrasi ada di `drizzle/` |

Checkout menghitung ulang nilai transaksi di server, memakai token harga bertanda tangan, dan menyimpan transaksi secara idempoten. Pada skema terkini, checkout juga memperbarui `ringkasan_penjualan_harian` dan `penjualan_produk_harian`; nilai buku kas disimpan pada `buku_kas.nominal`.

Autentikasi memakai cookie sesi `httpOnly`, pemeriksaan peran di endpoint, perlindungan CSRF untuk mutasi API, dan rate limit untuk jalur sensitif. Daftar ini mencatat kontrol yang ada di kode, bukan sertifikasi atau jaminan keamanan menyeluruh.

## Prasyarat

- Node.js 24.20.x dan pnpm 11.24.0. Versi runtime dikunci melalui `.node-version`, `engines`, dan `packageManager`.
- Wrangler tersedia dari dependency proyek setelah instalasi.
- Kredensial Cloudflare hanya diperlukan untuk operasi remote, backup, dan deployment.

## Instalasi

```bash
git clone https://github.com/zulilmiihsn/zatiaraspos.git
cd zatiaraspos
pnpm install
```

## Mulai cepat

1. Salin contoh environment dan isi minimal `POS_PRICE_SIGNING_KEY` dengan nilai acak sepanjang sedikitnya 32 karakter. `OPENROUTER_API_KEY` hanya diperlukan untuk fitur AI.

   ```bash
   cp .env.example .env.local
   ```

2. Siapkan D1 lokal. Perintah ini menerapkan migrasi ke binding lokal Samarinda dan memuat seed UAT.

   ```bash
   pnpm d1:setup:local
   ```

3. Jalankan server pengembangan.

   ```bash
   pnpm dev
   ```

4. Buka URL lokal yang dicetak Vite, lalu masuk dengan profil dari seed UAT.

## Contoh alur penggunaan

### Transaksi kasir

1. Pilih cabang dan masuk sebagai kasir.
2. Buka sesi toko dengan modal awal.
3. Buka `/pos`, pilih produk, tentukan metode bayar, lalu selesaikan transaksi.
4. Hasil transaksi masuk ke buku kas dan riwayat; stok atau bahan dikurangi hanya jika pelacakannya aktif.

### Pengelolaan oleh pemilik

1. Masuk sebagai pemilik.
2. Kelola produk, bahan, resep, HPP, dan pengaturan dari `/pengaturan`.
3. Tinjau performa di dashboard atau buka `/laporan` untuk rentang tanggal yang dipilih.

## Migrasi D1

Perubahan skema dimulai dari `src/lib/database/schema.ts`. Buat file SQL Drizzle, tinjau SQL yang dihasilkan, lalu terapkan file tersebut dengan Wrangler. `drizzle-kit generate` tidak mengubah database.

```bash
pnpm exec drizzle-kit generate
```

Untuk database lokal, jalankan migrasi terhadap binding yang sedang diuji. Setup lokal bawaan hanya menyiapkan grup Samarinda.

```bash
pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --local --config wrangler.pages.jsonc --file drizzle/NNNN_nama_migrasi.sql --yes
```

Sebelum migrasi remote, buat backup tiga shard ke direktori absolut di luar repository/workspace.

```bash
pnpm d1:backup -- --output-dir "<ABSOLUTE_PATH_OUTSIDE_WORKSPACE>" --env-file .env
```

Terapkan file SQL yang sama secara manual ke ketiga binding remote. Ganti `NNNN_nama_migrasi.sql` dengan file baru yang sudah ditinjau.

```bash
pnpm exec wrangler d1 execute DB_SAMARINDA_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama_migrasi.sql --yes
pnpm exec wrangler d1 execute DB_BALIKPAPAN_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama_migrasi.sql --yes
pnpm exec wrangler d1 execute DB_BERAU_GROUP --remote --config wrangler.pages.jsonc --file drizzle/NNNN_nama_migrasi.sql --yes
```

Migrasi produksi tidak dijalankan otomatis oleh build atau deploy. Catat hasil tiap binding sebelum melanjutkan deployment.

## Pengujian

| Perintah            | Cakupan                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm check`        | Sinkronisasi SvelteKit dan pemeriksaan TypeScript/Svelte                                               |
| `pnpm lint`         | Pemeriksaan Prettier dan ESLint                                                                        |
| `pnpm test:unit`    | Regresi hardening, state store, offline POS, integritas POS, keluaran struk, dan pengelompokan laporan |
| `pnpm test:all`     | Self-test operasional, quality test, lalu seluruh `test:unit`                                          |
| `pnpm test:release` | `test:all`, build produksi, lalu Playwright E2E POS lokal                                              |

Suite lokal khusus juga tersedia untuk checkout, CSP, CSRF, workflow akhir, rate limit, dan load test. Lihat seluruh script `test:*` di `package.json`; beberapa suite menyiapkan D1 lokal dan dapat membuat serta membersihkan data UAT.

## Build dan deployment

```bash
pnpm build
pnpm deploy:check
pnpm deploy:all
```

`deploy:all` memeriksa konfigurasi, membangun aplikasi, menerapkan Worker realtime, lalu menerapkan output Pages. Perintah ini tidak menerapkan migrasi D1.

Panduan arsitektur, konvensi teknis, dan runbook operasional tersedia di [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md).
