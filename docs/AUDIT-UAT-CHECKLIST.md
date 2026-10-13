# Checklist UAT pemilik — remediasi audit

UAT manual di production sesuai DoD [plan §6.13](AUDIT-REMEDIATION-PLAN.md#613-revisi-dod-oleh-pemilik--13-oktober-2026). Isi kolom **Hasil** dengan `Lulus` atau `Gagal: <apa yang terlihat>`, lalu beri tahu agen. Kartu baru naik `Completed` setelah lulus.

Jangan menempel password, cookie, atau data pelanggan ke chat/repo. Tangkapan layar boleh bila tidak memuat data sensitif.

## Batch 1 — 13 Oktober 2026

| Kartu   | Langkah                                                                                                                                             | Hasil yang diharapkan                                                                                      | Hasil          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| AUD-007 | Di **Stok**, pilih bahan dengan satuan dasar gram dan satuan beli kg. Catat kulakan 1 kg. Buka form kulakan bahan itu lagi.                         | Preset jumlah beli terakhir tampil **1 kg** (bukan 1000 kg). Stok bertambah 1000 gram, bukan 1.000.000.    | Lulus (13 Okt) |
| AUD-014 | Buat transaksi POS: total Rp10.000, bayar tunai Rp12.000. Ubah harga produk itu di katalog. Buka **Riwayat**, cetak ulang struk transaksi tadi.     | Struk cetak ulang tetap total Rp10.000, tunai Rp12.000, kembali Rp2.000, harga item sesuai saat transaksi. | Lulus (13 Okt) |
| AUD-025 | Di **POS**, buka item kustom (pemilik) atau modal pembayaran tunai. Ketik di input lalu tekan **Enter**.                                            | Form tidak tertutup/terbuang. Enter hanya submit sekali. Tombol Batal dan Escape tetap menutup.            | Lulus (13 Okt) |
| AUD-026 | Ubah zona waktu perangkat ke WIB (atau UTC). Buka **Catat**, simpan transaksi tanpa mengubah tanggal/jam default. Kembalikan zona waktu perangkat.  | Tanggal dan jam default sesuai **WITA** saat itu; transaksi muncul di laporan hari WITA yang benar.        | Lulus (13 Okt) |
| AUD-029 | Login sebagai pengguna cabang selain Samarinda (mis. Balikpapan). Buka **Dashboard**, lalu reload halaman. Ulangi dengan akun cabang lain bila ada. | Label cabang di dashboard sesuai cabang akun, tidak selalu "Samarinda", dan tidak tercampur saat reload.   | Lulus (13 Okt) |

## Batch 2 — perbaikan hasil code review, 13 Oktober 2026

| Kartu   | Langkah                                                                                                                                                                                       | Hasil yang diharapkan                                                                                 | Hasil          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| AUD-033 | Di **Catat**, simpan satu pemasukan manual tunai. Buka **Pengaturan → Pemilik → Riwayat**, pilih transaksi itu, ubah Jenis Pembayaran ke non-tunai. Ulangi ubah balik ke tunai.               | Kedua perubahan berhasil dengan toast "Jenis pembayaran berhasil diubah", tidak muncul error revisi.  | Lulus (13 Okt) |
| AUD-027 | Di **Catat**, simpan 6 transaksi hari ini dengan jam berbeda. Lihat kartu **Aktivitas Hari Ini**.                                                                                             | Tampil tepat 5 transaksi terbaru hari ini (WITA), urut terbaru di atas; transaksi kemarin tidak ikut. | Lulus (13 Okt) |
| AUD-039 | **Perhatian: arsip memindahkan transaksi keluar dari database aktif.** Lakukan hanya pada data uji. Di **Pengaturan → Pemilik → Arsip**, arsipkan tahun lama yang punya transaksi (bila ada). | Semua file bagian arsip terunduh otomatis; pesan menyebut jumlah bagian bila lebih dari satu.         | Lulus (13 Okt) |
| AUD-050 | Login di satu HP, logout, lalu login dengan akun lain di HP yang sama. Lakukan satu transaksi POS.                                                                                            | Transaksi berhasil tanpa error CSRF; Antrean di perangkat lain menerima notifikasi realtime.          | Lulus (13 Okt) |

## Batch 4 — suara Antrean dan fokus dialog, 13 Oktober 2026

Berlaku pada deploy `9d25d05` (memuat perbaikan `b354e9c`), sudah live 13 Oktober 2026. Untuk keyboard, pakai laptop/PC atau keyboard Bluetooth di tablet.

| Kartu   | Langkah                                                                                                                                                                                                     | Hasil yang diharapkan                                                                                                                          | Hasil          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| AUD-003 | Di HP A, buka **Pengaturan → Antrean**, matikan **Suara pesanan baru**. Reload halaman. Buka halaman yang sama di tab kedua HP A. Buka halaman itu di HP B.                                                 | Setelah reload dan di tab kedua switch tetap **mati**. HP B tidak ikut berubah. Switch tidak pernah hilang; saat memuat tampil teks "Memuat…". | Lulus (13 Okt) |
| AUD-003 | Di HP A dengan suara mati, aktifkan mode pesawat lalu reload halaman (bila aplikasi terpasang sebagai PWA).                                                                                                 | Switch tetap tampil **mati**, bukan kembali aktif.                                                                                             | Lulus (13 Okt) |
| AUD-023 | Di **Pengaturan**, tekan **Logout** dengan keyboard (Tab lalu Enter). Tekan Tab berkali-kali, lalu Escape. Ulangi di **Antrean** pada detail pesanan.                                                       | Fokus berputar hanya di dalam dialog; latar tidak bisa diklik; Escape menutup dialog dan fokus kembali ke tombol pemicu.                       | Lulus (13 Okt) |
| AUD-024 | Di **Stok**, buka **Tambah Bahan** dengan keyboard, isi nama, tekan Enter. Buka **Masuk** pada satu bahan, ketik jumlah, tekan Escape. Buka **Hapus bahan**, Tab ke **Ya, Hapus**, Enter (pakai bahan uji). | Bahan tersimpan lewat Enter; Escape dari input menutup dialog tanpa menyimpan; hapus berjalan sekali; preview stok akhir tetap tampil.         | Lulus (13 Okt) |
| AUD-024 | Ulangi langkah Stok di atas pada HP (lebar layar sempit).                                                                                                                                                   | Dialog bisa digulir, tombol tidak tertutup keyboard layar, kulakan dan preset jumlah beli tetap benar.                                         | Lulus (13 Okt) |

## Batch 5 — AUD-053 slice Stok, 13 Oktober 2026

Berlaku pada deploy `965084e`. Pakai bahan uji, lalu hapus setelah selesai.

| Kartu   | Langkah                                                                                                                                                                                 | Hasil yang diharapkan                                                                                       | Hasil          |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| AUD-053 | Di **Stok**, Tambah Bahan "Uji Jeruk" tipe Berat, satuan beli kg, jumlah 2, biaya 20.000, centang Hitung Susut 45%. Perhatikan "Modal: Rp …/gram" di dialog, lalu simpan dan buka Edit. | Angka modal per gram di dialog sama dengan yang tersimpan; form edit menampilkan jumlah 2 kg dan susut 45.  | Lulus (13 Okt) |
| AUD-053 | Buka Edit "Uji Jeruk" lalu langsung Simpan tanpa mengubah apa pun. Ulangi di **Pengaturan → Pemilik → Manajemen Menu → Bahan**.                                                         | Jumlah beli dan modal per satuan tidak berubah setelah disimpan ulang di kedua halaman.                     | Lulus (13 Okt) |
| AUD-053 | Tambah Bahan "Uji Susu" tipe Cairan, satuan beli liter, jumlah 1, biaya 35.000.                                                                                                         | Tidak ada pilihan Hitung Susut; modal tampil dan tersimpan Rp 35/ml.                                        | Lulus (13 Okt) |
| AUD-053 | Pada "Uji Jeruk", catat **Masuk** (kulakan) lalu **Keluar** (koreksi).                                                                                                                  | Stok berubah sesuai; notifikasi muncul di **setiap** aksi, bukan hanya yang pertama; riwayat mutasi tampil. | Lulus (13 Okt) |
| AUD-053 | Hapus "Uji Jeruk": tekan Hapus lalu Batal, lalu Hapus lagi dan konfirmasi. Hapus juga "Uji Susu".                                                                                       | Batal tidak menghapus; konfirmasi menghapus tepat bahan itu. Pencarian dan filter kategori tetap berfungsi. | Lulus (13 Okt) |

## Batch 6 — AUD-053 slice POS, 13 Oktober 2026

Berlaku pada deploy `92359b9`. Coba di HP (layar sempit) dan di tablet/laptop (panel keranjang di kanan).

| Kartu   | Langkah                                                                                                                        | Hasil yang diharapkan                                                                                           | Hasil |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----- |
| AUD-053 | Di **POS**, cari produk lewat kolom pencarian, lalu pilih kategori lain dan "Semua".                                           | Daftar produk tersaring sesuai ketikan dan kategori.                                                            | —     |
| AUD-053 | Ketuk satu produk, pilih Jumbo, tambah satu ekstra, ubah gula/es, isi catatan, ubah jumlah dengan tombol + / −, lalu Tambah.   | Harga di tombol mengikuti pilihan; item masuk keranjang dengan varian, ekstra, gula/es, dan catatan yang benar. | —     |
| AUD-053 | Di HP buka **Keranjang** (tombol bawah); di tablet/laptop lihat panel kanan. Tambah/kurangi jumlah item, kurangi sampai habis. | Total dan jumlah item ikut berubah; item hilang saat jumlahnya 0.                                               | —     |
| AUD-053 | Tambah item kustom (tombol custom item), lalu lanjut **Bayar** dan selesaikan transaksi tunai uji.                             | Item kustom ikut; halaman Bayar menampilkan total yang sama; transaksi tersimpan dan keranjang kosong lagi.     | —     |
| AUD-053 | Dengan monitoring stok aktif, coba tambah produk yang stoknya hampir habis melebihi sisa.                                      | Muncul peringatan stok; jumlah tidak melewati sisa.                                                             | —     |
