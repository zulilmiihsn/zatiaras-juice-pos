# Penilaian Kualitas Proyek

Catatan posisi kualitas ZatiarasPOS per 2026-10-18. Skor di sini adalah penilaian subjektif
hasil telaah kode oleh asisten AI, bukan hasil ukur otomatis. Selisih 0,1 antar aspek berada
di dalam derau penilaian. Gunakan dokumen ini untuk melihat arah dan penahan terbesar, bukan
sebagai ambang lulus.

## Batas penilaian

- Telaah membaca penuh dokumen utama, hook dan konfigurasi, jalur checkout, audit, arsip, dan
  rute unggah/login. Sisa ±100 ribu baris hanya ditinjau lewat statistik dan struktur.
- Tidak ada uji penetrasi, uji beban, atau uji perangkat kasir nyata.
- Bukti yang dijalankan: `pnpm check`, `pnpm lint`, `pnpm test:unit`, tes D1/workerd, E2E,
  build, dan CI penuh. Data produksi hanya dibaca untuk keperluan migrasi gambar.

## Skor

| Aspek             | Awal | Sekarang | Catatan                                                    |
| ----------------- | ---- | -------- | ---------------------------------------------------------- |
| Arsitektur        | 9,5  | 9,5      |                                                            |
| Tes               | 9,5  | 9,5      | state klien masih hanya E2E                                |
| Operasi dan rilis | 9,5  | 9,5      |                                                            |
| Keamanan          | 8,5  | ±9,0     | img-src masih membuka Supabase sampai besok                |
| Keterbacaan       | 8,0  | ±8,7     | computeItemFinancials, schema.ts, store besar              |
| Kebersihan repo   | 7,5  | ±8,5     | .codex sudah keluar. Sprawl skrip dan skrip seed masih ada |
| Integritas uang   | 9,0  | 9,0      | masih REAL                                                 |
| Total             | 9,0  | ±9,2     |                                                            |

## Yang menaikkan skor

- Keamanan: CSP dirapatkan (`d30af27`). Host CDN yang tidak dipakai kode klien, `ws:` polos,
  dan `https:` bebas di `img-src` dibuang. `test:csp` dan pemeriksaan pelanggaran CSP di
  halaman login menjaga agar tidak kembali (`b43b96a`).
- Keterbacaan: `auditEnvelope` dan `auditDrain` dirapikan (`8868144`). `executeCheckout`
  dipecah per fase, `checkoutUseCase.ts` turun dari 950 ke 483 baris (`98669cc`).
  `runArchive` dipecah menjadi pembaca dan job per chunk, `archiveUseCase.ts` turun dari 923
  ke 427 baris (`c9a1877`). Semua tanpa perubahan perilaku.
- Kebersihan: `.codex` dilepas dari repo (`ab420b5`). Kebijakan gambar R2 disatukan
  (`7cf64b3`). Gambar menu Samarinda dipindah dari Supabase ke R2 dengan skrip yang
  terverifikasi hash (`cf97a1c`; 14 baris, 14 objek, 14 dari 14 hash cocok).

## Penahan menuju 9,5

1. Uang disimpan sebagai `REAL` (float). ADR 0001 menjelaskan alasannya dan disiplin
   pembulatan di batas tulis sudah ada. Audit baca-saja atas data produksi (jumlah dalam sen
   dibandingkan total laporan) bisa menutup keraguan tanpa migrasi. Migrasi ke integer
   sengaja tidak disarankan selama kasir masih dalam masa transisi.
2. Keterbacaan: `computeItemFinancials` (±150 baris), `schema.ts` (975 baris), dan beberapa
   store atau halaman Svelte berukuran 600 sampai 760 baris.
3. Tes: logika murni klien belum punya tes unit dan hanya dijaga E2E.
4. Kebersihan: lebih dari 100 skrip npm, skrip seed berukuran besar, dan PDF di `docs/`.
5. Keamanan: `style-src 'unsafe-inline'` ditambahkan SvelteKit sendiri untuk elemen style yang
   ia sisipkan. `wss:` tetap terbuka karena perilaku `'self'` untuk WebSocket tidak bisa
   dipastikan di semua browser, termasuk Safari.
6. Jalur HTTP printer lokal (`http://127.0.0.1:40213/print`) diblokir CSP sejak awal dan
   sistem jatuh ke WebSocket. Perlu keputusan setelah diuji di PC kasir: aktifkan, atau hapus
   jalurnya.
7. Dependensi di tepi: TypeScript 7 native, `miniflare` alpha, Vite 8.

## Langkah terjadwal

- Sekitar 24 jam setelah migrasi gambar (2026-10-19): buang host Supabase dari `img-src` dan
  dari `csp-policy-tests.ts`, lalu hapus skrip migrasi sekali-pakai beserta tesnya. Sebelum
  itu, pastikan gambar menu kasir Samarinda dan Samarinda 2 tampil normal di perangkat nyata.
- File asli di Supabase tidak dihapus oleh proses mana pun. Itu keputusan pemilik setelah CSP
  baru stabil.
