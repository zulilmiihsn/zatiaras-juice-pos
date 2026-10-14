# ZatiarasPOS — Developer Guide

Panduan teknis untuk mengubah kode ZatiarasPOS dengan aman: domain, struktur,
alur kritis, konvensi, dan cara menguji. Prosedur produksi ada di
[docs/OPERATOR-RUNBOOK.md](docs/OPERATOR-RUNBOOK.md); keputusan arsitektur di
[docs/adr/](docs/adr/).

## 1. Istilah domain

| Istilah                 | Arti                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cabang (`cabang_id`)    | `samarinda`, `samarinda2`, `balikpapan`, `balikpapan2`, `berau`. Semua data diisolasi per cabang.              |
| Shard D1                | Satu database per grup: `DB_SAMARINDA_GROUP` (samarinda, samarinda2), `DB_BALIKPAPAN_GROUP`, `DB_BERAU_GROUP`. |
| Sesi toko (`sesi_toko`) | Shift buka–tutup toko dengan modal awal. Kasir hanya boleh berjualan saat ada sesi aktif.                      |
| Buku kas (`buku_kas`)   | Ledger kas: satu baris per transaksi POS (`sumber = 'pos'`) atau catatan manual (`sumber = 'catat'`).          |
| `transaksi_kasir`       | Baris item per transaksi POS (snapshot nama, harga, tambahan, HPP).                                            |
| Bahan, resep, HPP       | Bahan baku; resep per produk per porsi (`reguler`/`jumbo`); HPP = biaya per satuan efektif (4 desimal).        |
| Kebijakan stok          | Per cabang `tracked` atau `ignored`. Mode `ignored` tidak mengurangi stok, tetapi HPP tetap dihitung.          |
| Nomor harian            | Nomor pesanan `001+` per cabang per tanggal WITA, dialokasi atomik saat commit di server.                      |
| Idempotency key         | Kunci unik `(cabang_id, idempotency_key)`: satu transaksi POS dicatat tepat sekali.                            |
| Receipt snapshot        | `buku_kas.receipt_snapshot`, dibuat sekali saat commit; cetak ulang tidak berubah walau katalog diedit.        |
| WITA                    | Zona `Asia/Makassar` (UTC+8). Semua tanggal bisnis memakai WITA.                                               |

## 2. Struktur kode dan arah dependensi

```text
UI (src/routes, src/lib/components)
  -> store/state ($lib/stores/*.svelte.ts) -> service klien ($lib/services)
  -> route HTTP (src/routes/api/**/+server.ts: auth + parse + respons)
  -> use case/service server ($lib/server) -> policy/domain murni ($lib/utils, $lib/tax)
  -> adapter Cloudflare (D1, R2, Durable Object, OpenRouter)
```

- Route tipis: hanya auth, parse, dan pemetaan respons. SQL bisnis dan logika uang ada
  di `$lib/server` (allowlist import DB dari route dijaga `test:maintainability`).
- Use case kritis menerima `BranchContext` dari `requireSessionBranch`, bukan string
  cabang mentah. Setiap query tenant wajib memakai predicate `cabang_id`
  (dijaga `test:tenant-scope`).
- Kode domain tidak mengimpor route, store Svelte, atau global browser.

| Area               | Lokasi                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Checkout POS       | `src/lib/server/checkout/` (`checkoutUseCase.ts`, loader, statement builder)                                 |
| Auth dan sesi      | `src/hooks.server.ts`, `src/lib/server/{apiAuth,sessionStore,pageAccess}.ts`                                 |
| Resource CRUD      | `src/lib/server/resourceRouteHelpers.ts` (`makeResourceRoute`)                                               |
| Ledger dan stok    | `src/lib/server/services/`, `purchaseUseCase.ts`, `stockReconciliation.ts`                                   |
| Antrean/notifikasi | `src/lib/server/orderQueue/`, `src/lib/server/orderNotifications/`                                           |
| Arsip/restore      | `src/lib/server/archiveUseCase.ts`, `archiveSnapshot.ts`, `archiveService.ts`, `scripts/restore-archive.mjs` |
| Laporan dan pajak  | `src/lib/server/reportQueries.ts`, `src/lib/tax/engine.ts`, `src/lib/services/taxService.ts`                 |
| AI                 | `src/lib/server/aiGateway.ts`, `src/lib/server/ai/`                                                          |
| Offline            | `src/sw.ts`, `src/lib/services/offlineSync.ts`, `src/lib/utils/offlineQueue.ts`                              |
| Realtime           | `src/lib/server/realtimeWorker.js`, `realtimeDurableObject.js`, `src/lib/realtime/`                          |
| Skema              | `src/lib/database/schema.ts`, migrasi SQL di `drizzle/`                                                      |

## 3. Alur kritis

### 3.1 Checkout online

1. `GET /api/pos/catalog` mengirim katalog dengan token harga HMAC per produk/tambahan
   (berlaku 1 hari, kunci `POS_PRICE_SIGNING_KEY`).
2. `POST /api/pos/quote` menghitung ulang total di server dan mengembalikan
   `quote_token` (berlaku 5 menit).
3. `POST /api/pos/transaction` (`executeCheckout`):
   - rate limit per user, validasi payload, verifikasi `quote_token`;
   - idempotency: key yang sama dengan fingerprint sama mengembalikan hasil lama,
     fingerprint berbeda ditolak 409;
   - membaca kebijakan stok, produk, tambahan, resep; menghitung nominal dan HPP;
   - mengalokasi nomor harian tepat sebelum commit (nomor yang terbuang menjadi gap);
   - satu `db.batch` atomik: `buku_kas`, `transaksi_kasir`, pengurangan stok, ringkasan
     harian, intent audit (`audit_log_outbox`), dan event Antrean;
   - sesudah commit: publish realtime dan pengiriman push (best-effort; kegagalan tidak
     membatalkan transaksi).

### 3.2 Transaksi offline dan replay

- Offline hanya untuk tunai dan hanya bila katalog bertoken masih berlaku di perangkat.
- Transaksi disimpan di IndexedDB dengan `mode: 'offline_replay'`, `queued_at`, dan
  `idempotency_key` asli; `offlineSync.ts` memutar ulang saat online.
- Server memverifikasi token harga pada waktu `queued_at`, tetapi `queued_at` berasal
  dari perangkat sehingga dibatasi: replay lebih tua dari 3 hari ditolak 409, dan
  `queued_at` wajib berada di jendela buka–tutup sesi yang dirujuk (toleransi 15 menit).
- Replay tercatat pada jam transaksi (`queued_at`): `buku_kas.waktu`,
  `transaksi_kasir.created_at`, tanggal ringkasan harian, dan nomor harian memakai tanggal
  itu, sehingga penjualan 23.50 tetap masuk laporan hari tersebut. `created_at` buku kas,
  `updated_at`, dan mutasi stok memakai jam commit server.
- Replay yang melewati perubahan kebijakan stok dikarantina (HTTP 428) sampai pemilik
  menyetujui di `/pengaturan/pemilik/stok`.
- Klien mengklasifikasi kegagalan: 401/403 `auth`, 4xx konflik permanen, 429 dan 5xx
  dicoba ulang dengan backoff. Item konflik tetap di antrean dan bisa diekspor.

### 3.3 Autentikasi, peran, dan kunci halaman

- Login `POST /api/veriflogin`: rate limit per IP dan per username, bcrypt, pesan gagal
  seragam. Sesi disimpan di tabel `auth_sessions` shard cabang, cookie `zatiaras_sid`
  (`httpOnly`, `SameSite=Lax`, 24 jam). Peran dibaca ulang dari `profil` di setiap request.
- CSRF double-submit: cookie `zatiaras_csrf` harus sama dengan header `x-csrf-token`
  untuk semua mutasi `/api/*` (kecuali `csrf`, `veriflogin`, `logout`).
- Peran: `pemilik` (penuh), `kasir` (operasional), `admin` (lolos cek peran umum dan boleh
  membaca cabang lain; tulis tetap di cabang sesinya; tidak boleh mengakses endpoint
  Antrean). Peran tak dikenal ditolak.
- Kunci PIN: pemilik memilih halaman (`beranda`, `laporan`, `pengaturan`, `catat`) yang
  memerlukan PIN untuk kasir. Penegakan ada di server (`pageAccess.ts`), termasuk
  endpoint data di balik halaman itu. Kasir tetap boleh membaca laci sesi yang sedang
  aktif dan detail satu transaksi untuk cetak ulang.

### 3.4 Ledger manual dan kulakan

- `PATCH /api/buku-kas` untuk baris manual wajib membawa `revision`; update memakai
  compare-and-swap dan konflik 409 tanpa perubahan.
- `POST /api/bahan/purchase` menulis stok, mutasi, kas, dan HPP dalam satu batch dengan
  `operation_key` idempoten.

### 3.5 Katalog

- Produk dan resepnya disimpan dalam satu batch lewat `POST /api/produk/save-atomic`. Saldo
  stok produk tidak pernah ditulis dari payload edit; perubahan saldo lewat mutasi atau
  rekonsiliasi.
- `/api/produk`, `/api/kategori`, `/api/tambahan` memakai `makeResourceRoute`; field
  nama dan harga divalidasi di server (`assertCatalogFields`).
- Hapus produk ikut menghapus resepnya dalam satu batch; hapus kategori melepas produk
  dan menghapus kategori dalam satu batch.

### 3.6 Antrean dan notifikasi

Ringkasan di [ADR 0004](docs/adr/0004-antrean-notifications.md). Event pesanan ditulis di
batch checkout; perangkat membaca feed dengan cursor. Push dikirim cron tiap menit dengan
lease, backoff, dan maksimal 8 percobaan. Notifikasi bukan bukti pembayaran.

### 3.7 Arsip dan restore

Arsip memindahkan transaksi di bawah cutoff ke R2 per chunk: klaim job, tulis snapshot dan
baca ulang, lalu hapus ID yang persis sama dalam satu batch. Ringkasan harian arsip menjaga
laporan sebelum dan sesudah arsip tetap sama. Restore memakai CLI
`scripts/restore-archive.mjs` (dry-run default, staging, satu batch final).

### 3.8 Laporan dan pajak

Laporan menggabungkan data aktif dan ringkasan arsip. PPh Final UMKM dihitung dari omzet
usaha (bukan laba) dengan ambang kumulatif Rp 500 juta per tahun; tarif lain diatur
pemilik di `/pengaturan/pemilik/pajak`.

### 3.9 AI

Semua panggilan lewat `aiGateway.ts`: timeout, deadline stream, pesan error per kelas,
dan log teredaksi. Hanya model OpenRouter `:free` yang diizinkan; model diatur env
`AI_MODEL`.

## 4. Konvensi kode

- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`). Jangan menyalin store
  ke state lewat `$effect`; pakai `$derived`.
- **Uang**: `normalizeMoney`/`roundMoney`/`formatRupiah` dari `$lib/utils/currency`.
  `normalizeMoney` adalah kebijakan pembulatan, bukan validator input.
- **Tanggal**: helper `$lib/utils/dateTime` (WITA). Jangan menulis ulang konversi zona.
- **Kontrak API**: resource route mengembalikan `{ ok, data }` dan melempar
  `kitError(status, pesan)`. Endpoint auth/telemetri mengembalikan
  `{ success, code, message }`; nilai `code` adalah kontrak stabil
  (`test:error-codes`).
- **Error**: pesan untuk pengguna dalam bahasa Indonesia; `catch` kosong hanya untuk
  jalur best-effort dengan alasan tertulis.
- **Input**: rapikan dengan `trimInput`. Jangan memfilter teks dengan blocklist; Svelte
  sudah meng-escape output dan server tidak memercayai klien.
- **Komentar**: jelaskan kenapa, bukan apa. Jangan menulis ID tiket/sprint di kode;
  riwayat ada di git.

## 5. Pengujian

| Perintah                              | Cakupan                                                   |
| ------------------------------------- | --------------------------------------------------------- |
| `pnpm check` / `pnpm lint`            | Tipe, Prettier, ESLint                                    |
| `pnpm test:unit`                      | Seluruh `src/tests/*-tests.ts` paralel (SQLite in-memory) |
| `pnpm test:coverage`                  | `test:unit` + laporan coverage `src/lib`                  |
| `pnpm exec tsx src/tests/<file> --d1` | Tes yang mendukung D1/workerd lokal                       |
| `pnpm test:operations`                | Skrip backup/restore/wipe/rilis                           |
| `pnpm test:e2e:all`                   | Playwright, server dan D1 terisolasi per run              |
| `pnpm test:release`                   | Gate rilis penuh                                          |

`test:unit` memakai test runner bawaan Node (`node --test`, paralel 4) atas semua
`src/tests/*-tests.ts`; `pnpm test:coverage` menambah laporan coverage `src/lib`.
Benchmark manual (`*.bench.ts`) tidak ikut.

Menambah tes: buat `src/tests/<domain>-tests.ts` (otomatis ikut `test:unit`), daftarkan
`test:<domain>` di `package.json`, dan tambahkan langkahnya di `.github/workflows/ci.yml`.
`test:docs-drift` gagal bila salah satu terlewat. Tes harus deterministik: tanpa produksi, tanpa model
berbayar, waktu dibekukan bila relevan. Reproduksi bug dengan tes yang gagal dulu.

## 6. Jebakan umum

1. Jangan memanggil `realtimeManager.unsubscribeAll()` di komponen; pakai disposer dari
   `subscribe()`.
2. Jangan menghitung pajak dari laba kotor.
3. Jangan mempercayai waktu dari perangkat untuk keputusan uang tanpa batas.
4. Jangan menulis stok langsung lewat CRUD produk/bahan; pakai save-atomic, kulakan, atau
   rekonsiliasi.
5. Rollback aplikasi tidak mengembalikan schema D1.
