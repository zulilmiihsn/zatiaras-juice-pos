# ADR 0003: Tanpa Migrasi Foreign Key — Guard Aplikasi + Preflight Data

Tanggal: 2026-09-23. Status: diterima.

## Konteks

Relasi legacy (`transaksi_kasir.buku_kas_id`, `bahan_mutasi.bahan_id`) tanpa
foreign key mengandalkan service. Opsi: migrasi FK/unique/check bertahap.

## Keputusan

Jangan tambah FK enforcement. Alasan:

1. Cloudflare D1 tidak menegakkan foreign key — migrasi FK hanya dokumentasi
   berbiaya risiko tanpa perlindungan runtime.
2. Tanpa inspeksi data produksi aktual, constraint baru dapat menolak data
   valid atau gagal di tengah shard (first-fail-stop) dan memblokir rilis.
3. Guard atomik sudah ada di titik mutasi kritis (klaim arsip, CAS ledger,
   idempotency, trigger non-negatif stok) dan tercakup regresi.

## Konsekuensi

- Sebelum migrasi enforcement apa pun, operator WAJIB menjalankan detector
  `src/lib/server/dataHealth.ts` (`findOrphanTransaksiKasir`,
  `findOrphanBahanMutasi`, `findNegativeStock`) terhadap backup produksi dan
  mencapai `clean: true` per cabang. Temuan diperbaiki manual — dilarang
  dedup/hapus otomatis.
- Unique index yang sudah ada (idempotency, summary harian) dipertahankan.
- Constraint baru hanya diizinkan bila: didahului preflight hijau pada data
  produksi, forward-only, dan punya rollback/forward-fix guidance.
