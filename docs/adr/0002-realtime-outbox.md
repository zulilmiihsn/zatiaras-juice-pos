# ADR 0002: Realtime Tetap Best-Effort Publish-After-Commit

Tanggal: 2026-09-23. Status: diterima (spike, tanpa perubahan kode).

## Konteks

`publishBranchEvent` dipanggil setelah commit D1. Bila Durable Object down,
event hilang tetapi commit tetap sah. Opsi: transactional outbox (tulis baris
event dalam batch yang sama + relay terpisah).

## Hasil spike

1. Konsumen realtime (badge stok, refresh katalog/laporan) sudah toleran loss:
   ada refetch dan `refreshBus`/retry client.
2. Outbox penuh butuh relay worker + dedup konsumen + retensi — biaya
   operasional nyata untuk insiden yang belum pernah teramati.
3. Kegagalan publish tidak pernah mengubah hasil commit (sudah diuji
   `pos-integrity` dan review `realtimePublisher`).

## Keputusan

Pertahankan best-effort. Adopsi outbox hanya bila salah satu terjadi dan
tercatat sebagai insiden: event hilang menyebabkan keputusan kasir salah,
atau DO downtime berulang. Saat itu, rancang relay + tabel outbox dengan
kontrak dedup per `(cabang_id, table, id)` sebelum implementasi.
