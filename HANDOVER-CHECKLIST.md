# Checklist Serah Terima ZatiarasPOS

Semua item penerimaan manusia dan release tag sengaja belum dicentang. Isi tanggal, penanggung jawab, dan bukti tanpa menempelkan secret.

## Akses dan kepemilikan

- [ ] Pemilik menerima akses repository GitHub dengan least privilege.
- [ ] Pemilik menerima akses akun Cloudflare yang mengelola Pages, Worker, D1, R2, dan Durable Objects.
- [ ] Pemilik menerima akses registrar/DNS domain.
- [ ] Pemilik menerima akun `pemilik` aplikasi.
- [ ] Semua credential disimpan di password manager, bukan chat atau dokumen.
- [ ] 2FA aktif untuk GitHub, Cloudflare, domain, dan password manager.
- [ ] Daftar anggota/kolaborator ditinjau; akses tidak perlu dicabut.
- [ ] Kontak pemulihan akun dimiliki pemilik.

## Kandidat teknis

- [x] Catat `RELEASE_COMMIT_SHA` dari candidate HEAD: `fd109d350c6c531e4416aa8b5cc01bb042edb264`
- [x] Tinjau manifest/diff `RELEASE_COMMIT_SHA`; catat seluruh file source, test, dependency, dan dokumen yang masuk release.
- [ ] Pastikan branch release yang disepakati di origin memuat commit tersebut (saat ini branch lokal ahead 3, siap di-push ke origin).
- [x] Pastikan tidak ada SQL, manifest, `.env`, cookie, token, atau secret dalam commit.
- [x] Pastikan tidak ada Cloudflare deployment yang dilakukan oleh task handover.
- [x] Backup production baru memiliki tiga shard, manifest terverifikasi, dan `COMPLETE`.
- [x] Lokasi backup berada di luar repository/workspace dan ACL terbatas.
- [x] Jalankan `rtk pnpm test:unit`; catat SHA, waktu, dan hasil regresi unit/domain tanpa menyebutnya sebagai build atau E2E.
- [x] Jalankan `rtk pnpm test:all`; pastikan operations, quality, dan unit tercatat, tanpa menyebutnya sebagai build atau E2E.
- [x] Jalankan `rtk pnpm test:release` dari `RELEASE_COMMIT_SHA`; pastikan `test:all`, build, dan E2E POS lokal tercatat sebagai tiga tahap gate release.
- [x] Jangan membawa status lulus dari commit/run lama; tahap gagal atau tidak dijalankan tetap berstatus belum diterima.
- [x] Bila release membawa file SQL baru di `drizzle/`, ikuti prosedur migrasi terkontrol di `OPERATIONS-RUNBOOK.md`.
- [x] Terapkan setiap file migrasi secara manual dan berurutan dengan `wrangler d1 execute` ke Samarinda, Balikpapan, dan Berau; simpan bukti per shard.

## UAT pemilik

- [ ] Login sebagai pemilik pada cabang yang benar.
- [ ] Login sebagai kasir pada cabang yang benar.
- [ ] Buka tepat satu sesi toko melalui aplikasi.
- [ ] Tambah/ubah satu produk uji lalu periksa katalog.
- [ ] Selesaikan transaksi tunai dan periksa kembalian.
- [ ] Selesaikan transaksi QRIS kecil setelah konfirmasi merchant manual.
- [ ] Cetak struk dan cetak ulang dari riwayat.
- [ ] Periksa laporan cabang dan periode yang dipilih.
- [ ] Uji transaksi tunai offline setelah warm-up online.
- [ ] Pulihkan koneksi dan pastikan antrean menjadi nol tanpa transaksi ganda.
- [ ] Catat semua ID transaksi uji.
- [ ] Hapus/void semua transaksi uji melalui akun pemilik.
- [ ] Buktikan transaksi, ledger, dan idempotency UAT tidak menyisakan residu.
- [ ] Tutup sesi toko melalui aplikasi setelah pengujian.

## Dokumentasi dan operasi

- [ ] Pemilik membaca `OWNER-GUIDE.md`.
- [ ] Operator membaca `OPERATIONS-RUNBOOK.md`.
- [ ] Pemilik menerima `KNOWN-LIMITATIONS.md`.
- [ ] Jadwal backup manual atau scheduler eksternal ditetapkan.
- [ ] Kebijakan retensi backup ditetapkan pemilik.
- [ ] Penanggung jawab insiden dan jalur eskalasi ditetapkan.
- [ ] Daftar perangkat dan printer operasional dicatat.

## Release setelah persetujuan eksplisit

- [ ] Pemilik menyatakan UAT diterima secara eksplisit.
- [ ] Fetch ulang branch dan tag lokal/remote.
- [ ] Tentukan `RELEASE_TAG`; cek tag lokal dan remote. Jika tag sudah ada, verifikasi targetnya atau pilih versi baru—jangan menimpa tag release.
- [ ] Pastikan `RELEASE_COMMIT_SHA` tetap menunjuk commit kandidat yang manifest/diff-nya sudah ditinjau, bukan commit metadata.
- [ ] Pastikan gate `rtk pnpm test:release` terbaru dijalankan tepat dari `RELEASE_COMMIT_SHA` dan semua tahap berhasil.
- [ ] Jika ada migrasi, pastikan file SQL yang sama sudah berhasil pada tiga shard dan bukti backup pra-migrasi tersedia.
- [ ] Buat annotated tag baru tepat pada `RELEASE_COMMIT_SHA`.
- [ ] Push tag setelah persetujuan.
- [ ] Lakukan deployment hanya melalui keputusan/release workflow terpisah.
- [ ] Verifikasi live setelah deployment terpisah.

Perintah tag untuk dijalankan nanti, bukan bagian task otomatis ini:

```powershell
rtk git tag -a <RELEASE_TAG> <RELEASE_COMMIT_SHA> -m "ZatiarasPOS owner handover <RELEASE_TAG>"
rtk git push origin <RELEASE_TAG>
```

## Rotasi dan dukungan

- [ ] Credential dirotasi setelah akses baru terbukti bekerja.
- [ ] Token lama dicabut.
- [ ] Masa dukungan 7–14 hari disepakati: mulai `[tanggal]` selesai `[tanggal]`.
- [ ] Issue log bersama dibuat dengan pemilik dan prioritas.
- [ ] Semua blocker UAT ditutup atau diterima tertulis sebagai limitation.

## Penerimaan

- [ ] Pemilik menerima aplikasi dan batasannya.

Nama pemilik: `[isi nama]`

Nama penyerah: `[isi nama]`

Tanggal dan zona waktu: `[isi tanggal dan zona waktu]`

Referensi issue/berita acara: `[isi referensi]`

Catatan penerimaan: `[isi catatan]`
