# Checklist UAT pemilik — remediasi audit

UAT manual di production sesuai DoD [plan §6.13](AUDIT-REMEDIATION-PLAN.md#613-revisi-dod-oleh-pemilik--13-oktober-2026). Isi kolom **Hasil** dengan `Lulus` atau `Gagal: <apa yang terlihat>`, lalu beri tahu agen. Kartu baru naik `Completed` setelah lulus.

Jangan menempel password, cookie, atau data pelanggan ke chat/repo. Tangkapan layar boleh bila tidak memuat data sensitif.

## Batch 1 — 13 Oktober 2026

| Kartu   | Langkah                                                                                                                                             | Hasil yang diharapkan                                                                                      | Hasil |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| AUD-007 | Di **Stok**, pilih bahan dengan satuan dasar gram dan satuan beli kg. Catat kulakan 1 kg. Buka form kulakan bahan itu lagi.                         | Preset jumlah beli terakhir tampil **1 kg** (bukan 1000 kg). Stok bertambah 1000 gram, bukan 1.000.000.    |       |
| AUD-014 | Buat transaksi POS: total Rp10.000, bayar tunai Rp12.000. Ubah harga produk itu di katalog. Buka **Riwayat**, cetak ulang struk transaksi tadi.     | Struk cetak ulang tetap total Rp10.000, tunai Rp12.000, kembali Rp2.000, harga item sesuai saat transaksi. |       |
| AUD-025 | Di **POS**, buka item kustom (pemilik) atau modal pembayaran tunai. Ketik di input lalu tekan **Enter**.                                            | Form tidak tertutup/terbuang. Enter hanya submit sekali. Tombol Batal dan Escape tetap menutup.            |       |
| AUD-026 | Ubah zona waktu perangkat ke WIB (atau UTC). Buka **Catat**, simpan transaksi tanpa mengubah tanggal/jam default. Kembalikan zona waktu perangkat.  | Tanggal dan jam default sesuai **WITA** saat itu; transaksi muncul di laporan hari WITA yang benar.        |       |
| AUD-029 | Login sebagai pengguna cabang selain Samarinda (mis. Balikpapan). Buka **Dashboard**, lalu reload halaman. Ulangi dengan akun cabang lain bila ada. | Label cabang di dashboard sesuai cabang akun, tidak selalu "Samarinda", dan tidak tercampur saat reload.   |       |

## Batch 2 — perbaikan hasil code review, 13 Oktober 2026

| Kartu   | Langkah                                                                                                                                                                                       | Hasil yang diharapkan                                                                                | Hasil |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----- |
| AUD-033 | Di **Catat**, simpan satu pemasukan manual tunai. Buka **Pengaturan → Pemilik → Riwayat**, pilih transaksi itu, ubah Jenis Pembayaran ke non-tunai. Ulangi ubah balik ke tunai.               | Kedua perubahan berhasil dengan toast "Jenis pembayaran berhasil diubah", tidak muncul error revisi. |       |
| AUD-039 | **Perhatian: arsip memindahkan transaksi keluar dari database aktif.** Lakukan hanya pada data uji. Di **Pengaturan → Pemilik → Arsip**, arsipkan tahun lama yang punya transaksi (bila ada). | Semua file bagian arsip terunduh otomatis; pesan menyebut jumlah bagian bila lebih dari satu.        |       |
| AUD-050 | Login di satu HP, logout, lalu login dengan akun lain di HP yang sama. Lakukan satu transaksi POS.                                                                                            | Transaksi berhasil tanpa error CSRF; Antrean di perangkat lain menerima notifikasi realtime.         |       |
