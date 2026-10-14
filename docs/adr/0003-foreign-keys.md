# ADR 0003: Tanpa Migrasi Foreign Key — Guard Aplikasi + Preflight Data

Tanggal: 2026-09-23. Status: diterima; koreksi fakta runtime 2026-10-09, keputusan menunda migrasi tetap.

## Konteks

Relasi legacy (`transaksi_kasir.buku_kas_id`, `bahan_mutasi.bahan_id`) tanpa
foreign key mengandalkan service. Opsi: migrasi FK/unique/check bertahap.

## Keputusan

Tunda penambahan constraint FK pada relasi legacy sampai preflight/approval migrasi tersedia. Alasan:

1. **Cloudflare D1 menegakkan FK yang dideklarasikan**, dengan `foreign_keys` aktif. Pernyataan sebelumnya bahwa D1 tidak menegakkan FK keliru. [Dokumentasi vendor](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) dan regression workerd `scripts/restore-drill-local.test.mjs` membuktikan `PRAGMA foreign_keys = 1` serta penolakan insert dengan parent fixture yang hilang. Relasi legacy tanpa deklarasi FK tetap memerlukan detector/guard aplikasi.
2. Tanpa inspeksi data produksi aktual, constraint baru dapat menolak data
   legacy atau gagal di tengah shard (first-fail-stop) dan memblokir rilis.
3. Pertahankan constraint/guard yang sudah valid, tetapi jangan menganggapnya menutup seluruh integrity contract: audit independen masih menemukan gap restore dan expected-revision CAS ledger. Koreksi fakta bukan izin menjalankan migrasi FK production.

## Konsekuensi

- Sebelum migrasi enforcement apa pun, operator WAJIB menjalankan detector
  `src/lib/server/dataHealth.ts` (`findOrphanTransaksiKasir`,
  `findOrphanBahanMutasi`, `findNegativeStock`) terhadap backup produksi dan
  mencapai `clean: true` per cabang. Temuan diperbaiki manual — dilarang
  dedup/hapus otomatis.
- Unique index yang sudah ada (idempotency, summary harian) dipertahankan.
- Constraint baru hanya diizinkan bila: didahului preflight hijau pada data
  produksi, forward-only, dan punya rollback/forward-fix guidance.
