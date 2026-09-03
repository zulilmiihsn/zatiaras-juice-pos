# Batasan ZatiarasPOS Saat Ini

Dokumen ini harus dibaca sebelum penerimaan pemilik.

## Pembayaran QRIS

- QRIS hanya tersedia ketika online.
- Konfirmasi pembayaran dilakukan manusia melalui aplikasi merchant/bukti resmi.
- POS belum menerima status settlement otomatis dari payment gateway.
- Kesalahan konfirmasi dapat membuat transaksi tercatat walau dana belum diterima. Kasir wajib memeriksa penerimaan dana sebelum konfirmasi.

## POS offline

- Offline hanya mendukung pembayaran tunai.
- Perangkat wajib pernah warm-up online untuk menyimpan app shell, katalog cabang, login, dan sesi toko.
- Snapshot login mengikuti masa berlaku server. Snapshot sesi toko maksimal 24 jam.
- Transaksi tertunda berada di IndexedDB. Jumlah pending wajib nol sebelum menghapus data situs, cache, browser profile, atau PWA.
- Browser/OS dapat menghentikan background sync. Buka kembali PWA ketika online untuk memicu sinkronisasi.
- Perangkat baru atau browser yang dibersihkan tidak langsung siap offline.

## Cabang dan laporan

- Laporan mengikuti cabang yang sedang dipilih.
- Belum ada laporan gabungan seluruh cabang dalam satu tampilan.
- Pemilik harus memeriksa label cabang dan periode sebelum mengambil keputusan.

## Sesi toko

- Kasir memerlukan tepat satu sesi toko aktif untuk transaksi online.
- Pemilik dapat bertransaksi tanpa sesi aktif, dengan peringatan; transaksi tersebut tidak terkait sesi toko.
- Sesi ganda/ambigu harus diselesaikan melalui alur operasional normal, bukan script otomatis.

## Realtime dan koneksi

- Update antarpengguna bergantung pada Worker realtime, jaringan, browser, dan status background aplikasi.
- Keterlambatan event realtime tidak selalu berarti transaksi gagal. Riwayat/server harus diperiksa sebelum mengulang checkout.
- Sinkronisasi latar belakang tidak dijamin ketika OS menangguhkan PWA.

## Cetak

- Format, ukuran, margin, izin pop-up, dan kualitas cetak bergantung pada browser, OS, driver, serta printer.
- Perangkat/printer baru memerlukan tes cetak.
- Kegagalan cetak tidak membatalkan transaksi yang sudah commit.

## Backup dan restore

- Backup production berjalan manual sampai scheduler eksternal disiapkan.
- Backup lengkap hanya yang memiliki tiga shard, manifest lolos verifikasi, dan `COMPLETE`.
- Retensi dipilih pemilik; aplikasi belum menghapus backup lama otomatis.
- Restore bersifat destruktif dan tidak termasuk alur otomatis. Restore memerlukan rencana terpisah, identitas target exact, maintenance window, persetujuan, serta verifikasi pasca-restore.

## Peran admin dan pemilik

- Beberapa halaman/aksi administratif masih memiliki batas akses admin dan pemilik yang belum sepenuhnya konsisten.
- Jangan mengubah peran hanya untuk melewati penolakan akses. Catat halaman, cabang, peran, dan status HTTP lalu eskalasi.
- Penyempurnaan role matrix masuk backlog dan bukan blocker handover bila alur pemilik/kasir yang disetujui lulus UAT.
