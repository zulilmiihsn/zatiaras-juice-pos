# Panduan Pemilik ZatiarasPOS

## Masuk dan memilih cabang

1. Buka `https://zatiaraspos.pages.dev/login`.
2. Masukkan nama pengguna dan PIN/password yang diberikan melalui password manager.
3. Pilih cabang yang benar sebelum masuk.
4. Periksa nama cabang pada aplikasi sebelum mencatat atau menjual. Data dan laporan mengikuti cabang terpilih.

Peran utama:

- `kasir`: menjalankan penjualan dan pencatatan harian yang diizinkan. Kasir hanya dapat bertransaksi ketika ada satu sesi toko aktif.
- `pemilik`: melihat laporan, mengelola data usaha, meninjau/menghapus transaksi, dan dapat bertransaksi ketika toko belum dibuka. Aplikasi menampilkan peringatan karena transaksi tersebut tidak terhubung ke sesi toko.
- `admin`: mengelola bagian administratif yang diizinkan. Beberapa layar masih membedakan akses admin dan pemilik; lihat `KNOWN-LIMITATIONS.md`.

Jangan memakai satu akun bersama. Keluar dari aplikasi setelah selesai memakai perangkat bersama.

## Buka dan tutup toko

1. Masuk ke halaman pencatatan/beranda cabang.
2. Buka toko satu kali sebelum kasir mulai menjual.
3. Pastikan hanya satu sesi aktif untuk cabang tersebut.
4. Saat operasional selesai, cocokkan kas dan transaksi, lalu tutup sesi toko.

Jangan membuka sesi kedua untuk cabang yang sama. Bila status sesi tidak jelas, hentikan transaksi kasir dan minta operator memeriksa sesi aktif.

## Produk dan menu

1. Buka Pengaturan Pemilik lalu Manajemen Menu.
2. Pilih cabang yang benar.
3. Tambah atau ubah produk, kategori, tambahan, resep, harga, dan status aktif sesuai kebutuhan.
4. Uji satu produk setelah perubahan harga atau resep.

Perubahan stok dan resep memengaruhi transaksi berikutnya. Riwayat transaksi lama memakai snapshot transaksi yang sudah tersimpan.

## Penjualan tunai

1. Buka POS dan pilih produk.
2. Periksa jumlah, tambahan, dan catatan.
3. Pilih Bayar lalu Tunai.
4. Masukkan uang yang diterima.
5. Periksa total dan kembalian, kemudian konfirmasi.
6. Tunggu layar Transaksi Berhasil sebelum memulai transaksi baru.

Jika koneksi terputus, baca bagian antrean offline sebelum menutup atau membersihkan browser.

## Penjualan QRIS

QRIS memerlukan koneksi dan konfirmasi manusia. ZatiarasPOS belum menerima konfirmasi otomatis dari payment gateway.

1. Pilih QRIS pada pembayaran.
2. Tunjukkan kode/metode pembayaran yang berlaku.
3. Periksa aplikasi merchant atau bukti pembayaran yang sah.
4. Konfirmasi transaksi di POS hanya setelah dana benar-benar diterima.

Jangan menganggap screenshot pelanggan sebagai konfirmasi final.

## Struk dan cetak ulang

- Setelah transaksi berhasil, periksa nama item, jumlah, metode pembayaran, total, dan kembalian.
- Cetak atau bagikan struk dari layar hasil transaksi.
- Untuk cetak ulang, buka riwayat transaksi, pilih transaksi yang tepat, lalu gunakan aksi cetak.
- Hasil cetak bergantung pada browser, sistem operasi, dan printer. Lakukan satu tes cetak setelah mengganti perangkat.

## Laporan dan peninjauan transaksi

- Buka Laporan lalu pilih tanggal/periode.
- Pastikan cabang terpilih benar. Laporan saat ini bukan gabungan semua cabang.
- Cocokkan omzet, jumlah transaksi, kas masuk/keluar, dan sesi toko.
- Buka Riwayat untuk meninjau detail transaksi.
- Penghapusan/void transaksi hanya dilakukan pemilik setelah memastikan ID dan alasan. Proses mengembalikan stok serta membalikkan catatan keuangan yang terkait.

Catat transaksi uji dan hapus setelah verifikasi. Jangan menghapus transaksi usaha untuk merapikan laporan tanpa bukti dan persetujuan.

## POS offline dan sinkronisasi

Offline hanya mendukung transaksi tunai setelah perangkat pernah dibuka online dan sudah menyimpan app shell, katalog, login, serta sesi toko.

1. Saat offline, pastikan aplikasi menyatakan transaksi masuk antrean.
2. Jangan memilih QRIS.
3. Jangan menghapus data situs, IndexedDB, cache, atau aplikasi PWA.
4. Sambungkan internet dan buka kembali aplikasi.
5. Tunggu jumlah antrean menjadi nol.
6. Periksa transaksi hanya tercatat satu kali di server.

Jika antrean berstatus gagal, simpan bukti waktu, cabang, kode transaksi, dan pesan aman yang tampil. Jangan mengedit payload atau membuat transaksi pengganti sebelum pemilik meninjau.

## Keluar

1. Pastikan transaksi sudah berhasil atau antrean offline sudah dipahami.
2. Pilih Keluar.
3. Pada perangkat bersama, pastikan halaman kembali ke Login.
4. Jangan menghapus data situs jika antrean offline belum nol.
