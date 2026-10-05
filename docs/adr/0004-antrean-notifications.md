# ADR 0004: Notifikasi Antrean Durable dan Web Push Per Perangkat

Status: diterima pada source; bukan persetujuan atau catatan deployment production.

## Konteks

Event WebSocket umum adalah invalidasi best-effort dan dapat digabung per tabel. Jumlah pending dapat tetap sama ketika satu pesanan selesai dan satu masuk. Keduanya tidak menjadi log kedatangan yang lengkap; aplikasi tertutup juga tidak memiliki listener WebSocket/audio aktif.

Perangkat berarti browser profile/storage origin, bukan hardware atau akun. Dua perangkat dengan akun yang sama tetap berbeda penerima. Membuka Antrean menghentikan alarm profil itu saja; checkout asal tidak memanggil dirinya sendiri.

## Keputusan

- Simpan satu event `order_created` per `(cabang_id, idempotency_key)` dalam batch D1 checkout baru. Gagal batch berarti tidak ada penjualan/event; retry idempotent tidak membuat event kedua. Metadata asal di luar fingerprint finansial dan receipt.
- Registry identitas/subscription menjadi control-plane global di `DB_SAMARINDA_GROUP` (binding `DB` pada harness). Token acak terpisah dari UUID di-hash; UPSERT dengan proof token menjaga ownership. Satu row aktif per identitas dan satu endpoint aktif per identitas mencegah asosiasi lintas akun/cabang/perangkat. Event/delivery tetap branch-scoped pada shard bisnis.
- HTTP registry/ACK membatasi stream body 16 KiB. JSON rusak atau pembacaan body terputus menjadi HTTP 400 sebelum mutasi DB, bukan exception HTTP 500. Auth/role/cabang diperiksa sebelum parsing; response dan error memakai no-store.
- Realtime membangunkan feed cursor berhalaman. Mount, online, focus, session refresh, dan pesan SW memulihkan backlog. Push dapat tiba out-of-order dan tidak memajukan cursor feed kontigu. Initial/rebind baseline menahan banjir histori.
- State lokal kanonik berada dalam IndexedDB terpisah, dipakai page/SW melalui update atomik. Preferensi suara default ON tidak menyatakan audio/push sudah diizinkan. BroadcastChannel, Web Locks, dan lease lokal menyatukan acknowledgement/audio antartab.
- Banner persisten dan tiga chime sekitar setiap 5 detik berjalan hanya bila audio benar-benar running, sound ON, session/scope berhak, serta ada event belum dilihat. Antrean yang terlihat dan lolos akses/PIN mengakui event lokal; tab tersembunyi bukan bukti melihat. ACK tidak mengubah status persiapan, uang, stok, HPP, atau struk.
- Delivery server terpisah dari ACK pengguna melihat. Relay best-effort sesudah commit dan cron satu menit memakai lease CAS 60 detik, maksimal 8 attempt, timeout 15 detik, dan backoff 30 detik–1 jam. Pemeriksaan role/session/branch/source/ACK diulang sebelum send. Provider 404/410 melepas subscription; outage provider/realtime tidak membatalkan checkout sah.
- Gunakan `@block65/webcrypto-web-push` versi 2.0.0 untuk aes128gcm/VAPID pada Web Crypto. HTTPS provider allowlist, validasi point/key, timeout, dan manual redirect yang ditolak membatasi egress. Workers tidak mendukung `redirect: 'error'`. Private key hanya pada secret runtime; endpoint/key/token tidak masuk payload generik, response feed, atau log.
- Satu service worker custom `src/sw.ts` melalui InjectManifest, output `/sw.js`. PWA menjadi pemilik registrasi; registrasi native SvelteKit dimatikan. Worker waiting ditampilkan lewat tombol **Perbarui aplikasi**; hanya persetujuan ini mengirim SKIP_WAITING dan me-reload tab. Pertahankan navigasi offline POS/Antrean dan API NetworkOnly.
- Readiness push memerlukan handshake version 1 dengan worker aktif, bukan sekadar Push API/subscription tersedia. Worker GenerateSW lama tidak mengaku siap; aktivasi ditahan sampai pengguna menerima update dan memuat ulang, tanpa auto-skipWaiting.
- Push genuine mempunyai jalur `showNotification` user-visible generik, bukan silent push untuk menjaga worker hidup. Duplicate/foreground memperbarui tag tanpa renotify dan meminta silent; sound OFF tanpa vibrate. Klik membuka `/antrean` melalui auth/PIN normal. Pending delivery/event tidak dipangkas otomatis, agar pekerjaan belum diproses tidak hilang diam-diam.

## Konsekuensi dan batas

Durable capture menambah satu statement pada checkout. Migrasi 0037 wajib schema-first pada tiga shard; ketiadaan schema menolak checkout dengan petunjuk migrasi, bukan kehilangan event diam-diam. Realtime umum tetap best-effort menurut ADR 0002.

Registrasi awal/reset/rebind dapat melepas native subscription lama jika ownership server hilang. Rotasi VAPID memerlukan deaktivasi/aktivasi ulang perangkat. Logout/session expiry/perubahan role menghentikan pengiriman berikutnya; push yang sudah in-flight tidak dapat ditarik dari provider. Handler menolak context lama dan tidak mengulang alarm aplikasi, tetapi tidak menjamin zero-flash notifikasi OS.

Aplikasi tertutup/HP terkunci bergantung Push API, permission, instalasi Home Screen iOS/iPadOS yang mendukung, jaringan, browser, Focus/DND, dan kebijakan daya OS. Tidak ada jaminan suara custom atau alarm berulang di latar, atau jaminan membangunkan operator. Provider 201 bukan bukti handset menampilkan atau operator mendengar.

## Verifikasi dan gate rilis

Suite `antrean-notification-tests.ts` mencakup crypto/config, auth/role/tenant/ownership, checkout batch/rollback/idempotency, baseline/feed, origin proof termasuk registry outage, rebind/revoke, lease/concurrency, failure/retry, dan ACK-crash. Jalankan pada SQLite dan D1/workerd dengan `--d1`. Browser memakai `e2e/antrean-notifications.spec.ts`; gate umum di AGENTS tetap berlaku.

Smoke aktual workerd telah memverifikasi sender native: aes128gcm dapat didekripsi receiver RFC 8291, signature VAPID valid, pasangan kunci salah/redirect ditolak. Provider diintersep pada transport smoke; ini bukan pengiriman provider eksternal/HP terkunci. Smoke fisik perangkat operasional dan CI/artifact/provenance tetap prasyarat rilis, dicatat di runbook, bukan diasumsikan dari tes lokal.
