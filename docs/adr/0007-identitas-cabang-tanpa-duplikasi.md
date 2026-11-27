# Identitas cabang pada tabel staging restore

## Keputusan

Pemisahan akun tidak mengubah model identitas sesi atau format data arsip. Hindari
menyimpan cabang dua kali jika kepemilikan sudah ditentukan oleh relasi yang wajib.
Langkah pertama hanya menyederhanakan `archive_restore_rows`: job induk
`archive_restore_jobs` menentukan cabang melalui `job_id`. Kunci per jenis dan ID
baris tetap sama; tidak ada perubahan pada tabel kasir, stok, sesi, atau buku kas.
Payload JSON arsip tetap membawa `cabang_id` sebagai bagian dari format pertukaran.

Query CLI memilih job berdasarkan ID, cabang, dan digest. Guard penyimpanan
memastikan payload dan induk memiliki cabang yang sama, juga ketika baris atau
induk diperbarui. Ini menjaga konsistensi internal; pengecekan akun/database tujuan
sebelum restore tetap tanggung jawab alat Data Ops.

## Rilis dan rollback

Perubahan ini membangun ulang tabel staging, jadi jangan menerapkannya ke produksi
saat ada pemulihan arsip berjalan. Siapkan backup terverifikasi untuk setiap D1
aktif sebelum migrasi. Uji upgrade dengan staging yang belum selesai pada SQLite
serta D1/Workerd; bandingkan seluruh payload dan lanjutkan restore dari job lama.
Migrasi menolak baris tanpa induk atau dengan cabang yang berbeda, bukan memperbaiki
atau membuangnya diam-diam.

Rilis CLI baru bersama schema baru pada semua target restore. Jangan jalankan CLI
lama terhadap schema baru. Jika perlu membatalkan sebelum CLI baru dipakai,
pulihkan backup pra-migrasi hanya pada target yang tidak menerima penulisan sejak
backup. Bila target sudah menerima penulisan, pertahankan data terbaru: buat
backup baru, bekukan restore, dan uji migrasi balik pada salinan. Bentuk lama dapat
dibangun ulang dari `archive_restore_rows` dengan `archive_restore_jobs.cabang_id`
melalui `job_id`, lalu cocokkan baris, JSON, dan foreign key sebelum mengganti CLI.
Jangan memulihkan snapshot lama di atas transaksi baru.
