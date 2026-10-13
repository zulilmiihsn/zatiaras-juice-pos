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

## Audit bukan invalidasi realtime umum

Remediasi AUD-049 (10 Oktober 2026) menempatkan intent audit checkout dalam
`audit_log_outbox` pada batch D1 yang sama dengan transaksi/stok/event Antrean.
Identitas intent terikat sale yang menang; replay tidak membuat intent kedua.
Outbox unavailable menggagalkan business batch, bukan sale sah tanpa audit.
Delivery audit diserahkan ke drain terjadwal; outage sink setelah commit tidak
menghapus intent atau menuntut pembayaran ulang. Ini tidak mengubah keputusan
best-effort fanout katalog di atas, dan tidak membackfill audit legacy tebakan.
Remediasi lokal AUD-051 memakai canonical audit envelope/drain dan guarded
sink/quarantine+exact-source-delete dalam satu batch. Source time/zero/actor/metadata
terpelihara; source invalid/oversize/too-old masuk quarantine, transient outage tetap
outbox. Audit drain minute/daily, retention90hari hanya daily; retry eligible
2min×attempt capped60min, bounded isolation/rotating shard priority. Default40SQL
maintenance (daily reserve32), higher1–900 hanya dengan approved quota; tidak
menghitung relay/provider sebagai tersertifikasi. Registry foreign tombstones
held sampai cross-shard atomic/owner-ADR tersedia. Actual local compiled scheduled
controller dan synthetic backlog bukan staging/approved-volume/memory/CI sign-off;
full acceptance AUD-051 tetap terbuka.

Realtime checkout menggunakan execution context bila tersedia; fallback
menunggu hanya dalam budget. Publisher memakai satu owned abort timer dan
parent cancellation, dibersihkan pada success/error/deadline. SQLite/workerd
serta imported actual handler tests bukan staging/compiled Worker sign-off.

## Pengecualian spesifik: notifikasi kedatangan Antrean

Notifikasi pesanan baru mempunyai kebutuhan replay dan Web Push saat aplikasi tertutup yang tidak dipenuhi invalidasi realtime umum. [ADR 0004](0004-antrean-notifications.md) menambahkan event/delivery khusus pada checkout; tidak memigrasikan fanout katalog, stok, atau laporan ke outbox umum. Kegagalan publish/relay/provider setelah commit tetap tidak membatalkan transaksi.
