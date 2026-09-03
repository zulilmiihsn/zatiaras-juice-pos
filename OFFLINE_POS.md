# POS Offline

## Cakupan

- Aplikasi harus pernah dibuka online agar app shell, katalog cabang, sesi pengguna, dan sesi toko tersimpan.
- Mode offline hanya mendukung transaksi tunai pada halaman `/pos` dan `/pos/bayar`.
- QRIS dan halaman non-POS tetap membutuhkan koneksi.
- Transaksi offline masuk IndexedDB dengan idempotency key lalu dikirim satu per satu saat koneksi pulih.
- Server tetap menjadi sumber kebenaran untuk stok, otorisasi cabang, dan hasil transaksi.
- Snapshot login mengikuti `expiresAt` dari server. Snapshot sesi toko berlaku paling lama 24 jam.

## Status Antrean

- `pending`: menunggu koneksi atau waktu retry.
- `syncing`: sedang dikirim ke server.
- `failed`: gagal permanen atau membutuhkan tindakan pengguna.
- Konflik dan kegagalan otorisasi tidak diulang terus-menerus.
- Gangguan jaringan, rate limit, dan error server memakai exponential backoff dengan batas maksimum lima menit.

## UAT Perangkat Nyata

1. Deploy build dan buka aplikasi saat online.
2. Login sebagai kasir, pilih cabang, buka sesi toko, lalu buka `/pos` dan `/pos/bayar` sekali.
3. Matikan Wi-Fi dan data seluler.
4. Reload `/pos`; pastikan katalog tetap tampil.
5. Buat transaksi tunai; pastikan status menyatakan menunggu sinkronisasi dan struk memiliki status yang sama.
6. Pastikan QRIS tidak dapat dipilih.
7. Tutup lalu buka kembali PWA; pastikan jumlah antrean tetap ada.
8. Nyalakan koneksi; pastikan antrean menjadi nol dan transaksi hanya tercatat satu kali di server.
9. Ulangi dengan koneksi putus saat proses pembayaran untuk menguji jalur fallback antrean.

## Batas Operasional

- Jangan hapus data situs/browser sebelum antrean nol. IndexedDB adalah penyimpanan transaksi yang belum terkirim.
- Perangkat baru atau cache yang dibersihkan tidak dapat membuka POS offline sebelum warm-up online.
- Sinkronisasi latar belakang tidak dijamin ketika browser atau OS menghentikan PWA. Membuka PWA saat online akan memicu sinkronisasi lagi.
