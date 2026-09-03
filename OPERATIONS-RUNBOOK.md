# Runbook Operasional ZatiarasPOS

## Pemeriksaan harian

Sebelum toko buka:

- Halaman utama dan Login dapat dibuka.
- Cabang perangkat benar.
- Hanya satu sesi toko aktif.
- Produk UAT/produk utama dan harga tampil wajar.
- Antrean offline nol atau sudah mempunyai penanggung jawab.
- Printer diuji bila perangkat/printer berubah.

Pemeriksaan read-only:

```powershell
rtk curl -sS -o NUL -w "%{http_code}" https://zatiaraspos.pages.dev/
rtk curl -sS -o NUL -w "%{http_code}" https://zatiaraspos.pages.dev/login
rtk curl -sS -o NUL -w "%{http_code}" "https://zatiaraspos.pages.dev/api/produk?branch=samarinda"
rtk curl -sS -o NUL -w "%{http_code}" "https://zatiaraspos.pages.dev/api/pos/catalog?branch=samarinda"
rtk curl -sS -o NUL -w "%{http_code}" "https://zatiaraspos.pages.dev/api/realtime?branch=samarinda"
rtk curl -sS https://zatiaraspos-realtime.zulilmiihsn.workers.dev/health
```

Ekspektasi: halaman `200`, API terlindungi tanpa login `401`, dan Worker mengembalikan status sehat. Jangan menempelkan cookie atau token ke perintah pemeriksaan.

## Backup production

Backup harus berada pada path absolut di luar repository dan di luar workspace `D:\Projects`. Jangan memakai folder sementara, home, atau `backups/` di repository.

Siapkan folder Windows satu kali:

```powershell
rtk powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'D:\ZatiarasPOS-Backups' | Out-Null"
rtk icacls D:\ZatiarasPOS-Backups /inheritance:r
rtk powershell -NoProfile -Command "& rtk icacls 'D:\ZatiarasPOS-Backups' /grant:r (('{0}:(OI)(CI)F' -f [System.Security.Principal.WindowsIdentity]::GetCurrent().Name)) 'SYSTEM:(OI)(CI)F'"
rtk icacls D:\ZatiarasPOS-Backups
```

Jalankan backup:

```powershell
rtk pnpm d1:backup -- --output-dir D:\ZatiarasPOS-Backups --env-file .env
```

Perintah berhasil hanya jika tiga identitas D1 production cocok, tiga ekspor SQL reguler tidak kosong, manifest SHA-256 terbaca ulang, dan file `COMPLETE` dibuat. Salin path manifest dari keluaran aman, lalu verifikasi:

```powershell
rtk pnpm d1:backup -- --verify-manifest D:\ZatiarasPOS-Backups\<run-id>\manifest.sha256.json
```

- `COMPLETE`: snapshot lengkap dan lolos verifikasi.
- `FAILED.json`: run parsial/gagal. Jangan dipakai sebagai backup lengkap.
- Tidak ada `COMPLETE`: perlakukan sebagai gagal.

Jangan membuka, menyalin, mengirim, atau memasukkan SQL/manifest ke Git, chat, tiket, atau dokumen. Pemilik menentukan retensi sesuai kebutuhan hukum dan kapasitas. Jangan menghapus snapshot lama otomatis; verifikasi backup baru sebelum penghapusan manual yang disetujui.

## Gate perubahan dan release

Jalankan gate sesuai tujuan; ketiganya bukan nama berbeda untuk pemeriksaan yang sama:

| Perintah                | Cakupan                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `rtk pnpm test:unit`    | Regresi hardening, store, antrean offline, integritas POS, keluaran struk, dan pengelompokan laporan.     |
| `rtk pnpm test:all`     | `test:operations`, `test:quality`, lalu seluruh `test:unit`. Tidak menjalankan build atau Playwright POS. |
| `rtk pnpm test:release` | Seluruh `test:all`, build production, lalu E2E POS lokal melalui Playwright. Ini gate kandidat release.   |

Pasang browser Playwright lebih dulu pada mesin release baru bila belum tersedia:

```powershell
rtk pnpm test:e2e:install
```

Jalankan `rtk pnpm test:release` dari commit yang akan diberi tag atau di-deploy. Catat waktu, SHA commit, dan hasil setiap tahap secara terpisah. Jangan memakai hasil run lama sebagai bukti commit baru; kegagalan atau tahap yang tidak dijalankan berarti gate release belum terpenuhi.

## Migrasi D1 terkontrol

Migrasi bukan pemeriksaan harian. Jalankan hanya sebagai perubahan production yang disetujui, setelah backup tiga shard menghasilkan `COMPLETE` dan manifestnya lolos verifikasi. File sumber migrasi berada di `drizzle/` dan harus diterapkan berurutan. Tidak ada perintah package yang menerapkan migrasi ke semua shard sekaligus; operator wajib menjalankan `wrangler d1 execute` dan mencatat hasil setiap shard secara terpisah.

Ganti `<migration-file.sql>` dengan nama file SQL yang sudah direview, lalu jalankan file yang sama pada ketiga database yang tercantum di `wrangler.pages.jsonc`:

```powershell
rtk pnpm exec wrangler d1 execute zatiaras-samarinda-group --config wrangler.pages.jsonc --remote --file drizzle/<migration-file.sql>
rtk pnpm exec wrangler d1 execute zatiaras-balikpapan-group --config wrangler.pages.jsonc --remote --file drizzle/<migration-file.sql>
rtk pnpm exec wrangler d1 execute zatiaras-berau-group --config wrangler.pages.jsonc --remote --file drizzle/<migration-file.sql>
```

Sebelum pindah ke file migrasi berikutnya, pastikan file saat ini berhasil pada Samarinda, Balikpapan, dan Berau. Bila satu shard gagal, hentikan urutan, simpan bukti shard yang sudah/belum berubah, dan eskalasi; jangan mengulang buta atau menganggap shard lain ikut termigrasi. Setelah semua shard selesai, jalankan smoke check read-only dan gate release yang relevan sebelum deployment.

## Insiden antrean offline

1. Catat perangkat, cabang, waktu, jumlah `pending/failed`, dan pesan yang tampil.
2. Jangan hapus data situs atau uninstall PWA.
3. Pulihkan koneksi, buka PWA, dan tunggu retry.
4. Gunakan retry satu item lebih dulu bila tersedia.
5. Ekspor bukti antrean melalui UI bila perlu; simpan di lokasi terbatas.
6. Pastikan antrean nol dan transaksi tidak ganda.
7. Bila konflik permanen, pemilik meninjau sebelum menghapus item lokal.

Browser/OS dapat menunda background sync. Membuka PWA saat online memicu sinkronisasi kembali.

## Gangguan login, otorisasi, dan realtime

Login:

- Pastikan cabang, akun, dan PIN/password benar.
- Periksa jam perangkat.
- Jangan mengirim password, cookie, CSRF, atau header.
- Jika akun terkunci/rate-limited, hentikan percobaan berulang dan catat waktu/status HTTP.

Otorisasi:

- `401`: sesi tidak ada/kedaluwarsa.
- `403`: peran atau cabang tidak diizinkan.
- `409` kasir saat toko tutup: buka satu sesi toko melalui alur normal, bukan lewat script.

Realtime:

- Muat ulang satu perangkat setelah koneksi pulih.
- Bandingkan cabang dan ID transaksi yang sama.
- Periksa health Worker.
- Realtime terlambat tidak membatalkan commit D1; verifikasi transaksi melalui riwayat sebelum mengulang pembayaran.

## Bukti dan eskalasi

Sertakan hanya:

- waktu WITA dan UTC;
- cabang dan peran;
- path/fitur;
- status HTTP;
- ID transaksi/ledger yang memang aman untuk dukungan internal;
- langkah reproduksi;
- status antrean dan hasil cleanup.

Jangan sertakan password, token, `.env`, cookie, CSRF, header mentah, SQL, manifest mentah, atau data pelanggan berlebih.

Eskalasi segera bila:

- transaksi tampak ganda;
- total/stock/ledger tidak konsisten;
- cleanup transaksi uji tidak terbukti nol;
- backup tidak menghasilkan tiga shard dan `COMPLETE`;
- ada journal UAT unresolved;
- akses akun/Cloudflare/GitHub dicurigai bocor.

## Rotasi credential

Setelah serah akses:

1. Pemilik mengaktifkan 2FA.
2. Hapus akses orang yang tidak lagi bertugas.
3. Rotasi token Cloudflare, credential GitHub, akses domain, dan akun aplikasi.
4. Simpan nilai baru hanya di password manager/secret store.
5. Verifikasi build/deploy tooling secara read-only sebelum mencabut token lama.
6. Jangan mengirim `.env` melalui chat.

## Restore

Restore bersifat destruktif dan tidak termasuk otomasi handover ini. Jangan menjalankan `d1:restore`, migration, Time Travel restore, atau SQL mutation dari runbook harian.

Restore hanya boleh dilakukan dengan rencana pemulihan terpisah yang disetujui, berisi:

- identitas database target (binding, nama, UUID, environment);
- backup berstatus `COMPLETE` yang baru diverifikasi;
- dampak dan pemilik keputusan;
- maintenance window;
- rencana rollback;
- bukti pasca-restore untuk tabel utama, transaksi, ledger, stok, sesi, login, dan realtime.

Tanpa semua hal tersebut, hentikan pekerjaan dan eskalasi.
