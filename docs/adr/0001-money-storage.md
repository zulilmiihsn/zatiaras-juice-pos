# ADR 0001: Penyimpanan Nilai Uang Tetap REAL

Tanggal: 2026-09-23. Status: diterima.

## Konteks

Kolom uang (`buku_kas.nominal`, `transaksi_kasir.nominal/harga`, `produk.harga`,
agregat harian) bertipe `REAL`. Rupiah operasional berupa bilangan bulat,
sedangkan HPP (`biaya_per_satuan`, `nominal_hpp`) memakai pecahan hingga 4 desimal.
Opsi yang dipertimbangkan: migrasi massal ke integer minor-unit.

## Keputusan

Pertahankan `REAL`. Alasan:

1. Migrasi tipe massal atas data produksi tiga shard tanpa akses inspeksi saat ini
   berisiko merusak histori (pembulatan, overflow, laporan berjalan).
2. Disiplin pembulatan sudah ada di batas tulis: `normalizeMoney`/`roundMoney`
   untuk uang, presisi 4 desimal untuk HPP (`ingredientCost`).
3. Tidak ada bukti selisih sen pada regresi paritas arsip/laporan/POS.

## Konsekuensi

- Semua penulisan nominal baru wajib lewat normalisasi yang ada; dilarang
  aritmetika float mentah pada nominal rupiah di kode baru.
- Bila suatu hari ditemukan drift sen pada data nyata, buka ulang ADR ini dengan
  bukti row-level, backup, dan rehearsal migrasi per shard.
