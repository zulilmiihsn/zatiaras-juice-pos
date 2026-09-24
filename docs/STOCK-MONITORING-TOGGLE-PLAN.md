# Rencana Implementasi Toggle Monitoring Stok Per Cabang

## 1. Metadata

| Item                     | Nilai                                                        |
| ------------------------ | ------------------------------------------------------------ |
| Status                   | Rencana, belum diimplementasikan                             |
| Area                     | POS, stok, pengaturan, checkout, offline, laporan, AI, arsip |
| Pemilik keputusan produk | Pemilik usaha                                                |
| Sasaran rilis            | Ditentukan setelah seluruh gate lulus                        |
| Sumber kebenaran         | Konfigurasi server per cabang                                |
| Default cabang lama      | Monitoring stok aktif                                        |

Dokumen ini menjadi kontrak implementasi. Perubahan perilaku di luar dokumen ini harus dibahas dan dicatat sebelum kode dibuat.

## 2. Ringkasan Keputusan

ZatiarasPOS akan memiliki satu pengaturan utama per cabang:

```ts
type StockPolicyMode = 'tracked' | 'ignored';
```

Arti mode:

| Mode      | Arti                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| `tracked` | Sistem memonitor, menampilkan, memvalidasi, dan mengurangi stok seperti perilaku sekarang.        |
| `ignored` | POS tidak menampilkan, memvalidasi, mengurangi, atau menganalisis stok. Penjualan tetap berjalan. |

Keputusan yang dikunci:

- Pengaturan berlaku per cabang, bukan global dan bukan per perangkat.
- Hanya `pemilik` cabang yang boleh mengubah mode.
- Mode default untuk cabang tanpa konfigurasi adalah `tracked`.
- Konfigurasi hilang atau rusak harus fail-safe ke `tracked`.
- Mode `ignored` tidak menghapus produk, bahan, resep, HPP, saldo stok lama, atau riwayat mutasi.
- Resep dan HPP tetap dihitung dalam mode `ignored`.
- Checkout dalam mode `ignored` tidak menulis perubahan stok produk.
- Checkout dalam mode `ignored` tidak menulis perubahan stok bahan.
- Checkout dalam mode `ignored` tidak membuat mutasi bahan sumber POS.
- Checkout dalam mode `ignored` tidak gagal karena stok produk atau bahan tidak cukup.
- Laporan penjualan, buku kas, struk, pajak, omzet, dan laba berbasis HPP tetap berjalan.
- Aktivasi ulang ke `tracked` membutuhkan konfirmasi rekonsiliasi fisik.
- Retry idempotent selalu mengembalikan hasil transaksi asli, walau mode cabang telah berubah.
- Mode stok tidak dimasukkan ke fingerprint idempotency.
- Server checkout tetap menjadi otoritas akhir. Nilai dari browser tidak dipercaya untuk menentukan mutasi stok.

## 3. Latar Belakang

Saat ini aplikasi memiliki pengaturan browser bernama "Kunci Saat Stok Habis" di:

- `src/lib/services/stockAlertService.ts`
- `src/routes/pengaturan/pemilik/stok/+page.svelte`

Pengaturan tersebut hanya disimpan di `localStorage`. Nilainya berlaku per perangkat, tidak per cabang, tidak diaudit, dan tidak dibaca backend checkout.

Akibat perilaku sekarang:

- UI dapat menampilkan mode "Bebas".
- Kasir dapat melewati validasi stok di browser.
- Backend tetap membuat pengurangan stok.
- Trigger D1 tetap dapat menolak transaksi dengan `INSUFFICIENT_STOCK` atau `INSUFFICIENT_INGREDIENT`.
- Pengalaman UI dan kontrak server tidak sama.

Checkout juga menggabungkan dua tanggung jawab dalam satu alur:

- Menghitung HPP dari resep.
- Mengurangi stok bahan berdasarkan resep.

Mematikan capability bahan saat ini akan ikut mematikan HPP. Itu tidak boleh dilakukan karena dapat membuat laba terlihat lebih besar dari kondisi sebenarnya.

Void transaksi produk juga memakai konfigurasi produk saat void dilakukan, bukan bukti mutasi saat transaksi dibuat. Setelah toggle tersedia, perilaku tersebut dapat menambah stok yang sebelumnya tidak pernah dikurangi.

## 4. Tujuan

### 4.1 Tujuan Produk

- Pemilik dapat memilih penggunaan monitoring stok untuk setiap cabang.
- Cabang sederhana dapat memakai POS tanpa beban operasional stok.
- Cabang yang membutuhkan inventaris dapat mempertahankan perilaku sekarang.
- Kasir tidak melihat konsep stok saat cabang memakai mode `ignored`.
- Pergantian mode tidak merusak transaksi, HPP, laporan, atau data historis.

### 4.2 Tujuan Teknis

- Satu sumber kebenaran kebijakan stok di server.
- Isolasi konfigurasi berdasarkan `cabang_id`.
- Checkout tetap atomik dan idempotent.
- HPP terpisah dari keputusan mutasi inventaris.
- Void mengembalikan stok hanya jika transaksi asli benar-benar menguranginya.
- Kontrak offline lama tetap dapat dibaca.
- UI bereaksi terhadap perubahan konfigurasi secara realtime, tetapi kegagalan realtime tidak memengaruhi kebenaran checkout.
- Rollout aman untuk seluruh cabang lama.

## 5. Non-Tujuan dan Hal yang Tidak Diinginkan

Implementasi ini tidak bertujuan:

- Menghapus tabel `produk`, `bahan`, `resep_produk`, atau `bahan_mutasi`.
- Menghapus nilai stok lama saat mode dinonaktifkan.
- Mengubah harga produk atau tambahan.
- Mengubah format struk pelanggan.
- Mengubah kalkulasi pajak.
- Mengubah metode pembayaran.
- Mengubah sesi buka atau tutup toko.
- Mengubah kontrak idempotency `(cabang_id, idempotency_key)`.
- Mengurangi stok secara retroaktif untuk transaksi selama mode `ignored`.
- Menambah stok secara retroaktif saat transaksi mode `ignored` di-void.
- Mengizinkan stok negatif sebagai cara melewati validasi.
- Menjadikan `localStorage`, cookie, session, atau payload browser sebagai sumber kebenaran.
- Menyimpan pengaturan berdasarkan binding D1 karena beberapa cabang dapat memakai binding sama.
- Menonaktifkan HPP, resep, margin, atau laporan laba saat monitoring stok mati.
- Menghapus atau menulis ulang data historis ketika mode berubah.
- Menambah role baru.
- Menganggap realtime sebagai syarat commit konfigurasi atau transaksi.
- Menjalankan migrasi produksi otomatis dari build atau deploy aplikasi.

Implementasi berikut dilarang:

- Hanya menyembunyikan menu tanpa mengubah backend checkout.
- Menggunakan nilai `zatiaras_strict_stock_checkout` lama sebagai konfigurasi cabang.
- Memaksa semua `lacak_stok` dan `lacak_bahan` menjadi `false` saat mode dimatikan.
- Mengosongkan resep ketika kontrol stok disembunyikan.
- Menggunakan `ingredientTrackingAvailable = false` untuk mode `ignored`.
- Memasukkan mode atau revision stok ke fingerprint idempotency.
- Mengandalkan flag produk saat ini untuk menentukan efek void transaksi baru.
- Menghapus trigger stok negatif dari database.
- Mengabaikan cabang pada query konfigurasi.

## 6. Definisi Istilah

| Istilah            | Definisi                                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| Monitoring stok    | Tampilan saldo, peringatan, validasi ketersediaan, dan analisis inventaris.           |
| Mutasi inventaris  | Perubahan `produk.stok`, `bahan.stok_saat_ini`, dan ledger `bahan_mutasi`.            |
| Costing            | Kalkulasi HPP dari harga bahan, yield, konversi satuan, resep, dan tambahan.          |
| Rekonsiliasi       | Penyesuaian saldo sistem terhadap hitung fisik sebelum monitoring diaktifkan kembali. |
| Policy revision    | Nomor perubahan konfigurasi stok suatu cabang.                                        |
| Provenance         | Bukti mode dan jumlah stok yang benar-benar diterapkan saat transaksi commit.         |
| Legacy transaction | Transaksi sebelum kolom provenance tersedia.                                          |

## 7. Kontrak Perilaku Utama

### 7.1 Matriks Perilaku

| Area                    | `tracked`                               | `ignored`                                                     |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Penjualan POS           | Berjalan                                | Berjalan                                                      |
| Validasi stok browser   | Aktif, bersifat advisory                | Tidak dijalankan                                              |
| Validasi stok server    | Aktif melalui mutasi atomik dan trigger | Tidak dijalankan karena tidak ada mutasi stok                 |
| Pengurangan stok produk | Aktif untuk `lacak_stok`                | Tidak ada                                                     |
| Pengurangan stok bahan  | Aktif untuk resep dan tambahan          | Tidak ada                                                     |
| Mutasi bahan sumber POS | Dibuat                                  | Tidak dibuat                                                  |
| HPP resep               | Dihitung                                | Tetap dihitung                                                |
| HPP tambahan            | Dihitung                                | Tetap dihitung                                                |
| Buku kas                | Ditulis                                 | Ditulis                                                       |
| Ringkasan penjualan     | Ditulis                                 | Ditulis                                                       |
| Struk                   | Dibuat                                  | Dibuat, tanpa perubahan format                                |
| Pajak                   | Normal                                  | Normal                                                        |
| Navbar stok             | Tampil                                  | Hilang                                                        |
| Halaman stok harian     | Tampil                                  | Tidak tersedia, kecuali alur rekonsiliasi pemilik             |
| Peringatan stok         | Aktif                                   | Tidak aktif                                                   |
| Dashboard stok          | Tampil                                  | Disembunyikan atau menampilkan status dijeda                  |
| AI tentang stok         | Memakai data stok                       | Menjelaskan monitoring dijeda, tanpa klaim saldo              |
| Void                    | Mengembalikan efek mutasi aktual        | Tidak menambah stok jika transaksi asli tidak mengurangi stok |

### 7.2 Data Saat Mode Dinonaktifkan

Saat `tracked` berubah menjadi `ignored`:

- Saldo produk disimpan apa adanya.
- Saldo bahan disimpan apa adanya.
- Ambang stok disimpan apa adanya.
- Flag produk `lacak_stok` dan `lacak_bahan` disimpan apa adanya.
- Resep disimpan apa adanya.
- Riwayat mutasi disimpan apa adanya.
- Tidak ada backfill atau pengurangan untuk penjualan berikutnya.
- Timestamp penonaktifan disimpan pada konfigurasi.
- Data stok dianggap dijeda dan tidak lagi merepresentasikan konsumsi POS setelah timestamp tersebut.

### 7.3 Aktivasi Ulang

Saat `ignored` akan berubah menjadi `tracked`:

- UI wajib menjelaskan bahwa saldo lama dapat basi.
- Pemilik wajib membuat job rekonsiliasi server-side.
- Job menangkap revision policy dan daftar lengkap produk tracked serta bahan aktif pada awal proses.
- Pemilik wajib mengirim hasil hitung fisik untuk setiap item pada snapshot job.
- Server menolak jumlah negatif, non-finite, ID duplikat, ID lintas cabang, item kurang, atau item tambahan.
- Finalisasi menerapkan seluruh saldo, menandai job selesai, mencatat cutoff, dan mengaktifkan `tracked` dalam satu transaksi database.
- Server menolak finalisasi jika policy revision atau susunan inventaris berubah selama rekonsiliasi.
- Checkbox atau boolean dari browser saja tidak cukup untuk membuktikan rekonsiliasi.
- Timestamp cutoff rekonsiliasi disimpan untuk menentukan nasib replay offline lama.
- Tidak ada pengurangan stok retroaktif.
- Peringatan stok aktif kembali setelah konfigurasi berhasil commit.

Alur rekonsiliasi memakai halaman stok dalam mode khusus pemilik. Halaman tersebut tidak muncul di navbar selama mode `ignored` dan hanya dapat dibuka dengan ID job aktif milik cabang yang sama.

### 7.4 State Machine Policy

Transisi yang sah:

| Dari                        | Ke            | Syarat                                              |
| --------------------------- | ------------- | --------------------------------------------------- |
| Missing virtual `tracked@0` | `ignored@1`   | PUT pemilik dan CAS missing-row berhasil            |
| Missing virtual `tracked@0` | `tracked@0`   | No-op, tidak membuat row                            |
| `tracked@n`                 | `ignored@n+1` | PUT pemilik dan CAS revision berhasil               |
| `tracked@n`                 | `tracked@n`   | No-op, revision dan timestamp tidak berubah         |
| `ignored@n`                 | `ignored@n`   | No-op, revision dan timestamp tidak berubah         |
| `ignored@n`                 | `tracked@n+1` | Finalisasi job rekonsiliasi, bukan PUT toggle biasa |

Policy malformed tidak boleh diperbaiki otomatis oleh request user. Read memakai fallback `tracked` dan write mengembalikan 409 sampai operator memperbaiki row melalui prosedur terkontrol.

## 8. Peran dan Otorisasi

| Aksi                              | Kasir                 | Pemilik                          |
| --------------------------------- | --------------------- | -------------------------------- |
| Membaca mode cabang aktif         | Ya                    | Ya                               |
| Mengubah mode                     | Tidak                 | Ya                               |
| Melihat stok saat `tracked`       | Sesuai akses sekarang | Ya                               |
| Melihat menu stok saat `ignored`  | Tidak                 | Tidak, kecuali alur rekonsiliasi |
| Menjalankan rekonsiliasi aktivasi | Tidak                 | Ya                               |
| Checkout                          | Ya, sesuai sesi toko  | Ya, sesuai aturan sekarang       |

Aturan tambahan:

- Semua endpoint memakai session valid.
- Semua endpoint memakai `requireSessionBranch`.
- Tidak ada penerimaan `cabang_id` mentah tanpa validasi session.
- PUT konfigurasi memerlukan CSRF sesuai middleware aplikasi.
- Akses `admin` tidak diperluas oleh fitur ini. Jika platform admin perlu akses, keputusan terpisah wajib dibuat.

## 9. Desain Konfigurasi Kanonikal

### 9.1 Lokasi Penyimpanan

Gunakan tabel terstruktur `stock_policy`. Tabel key-value `pengaturan` tidak dipakai karena checkout membutuhkan perbandingan mode dan revision yang dapat dijaga atomik oleh database tanpa parsing JSON longgar.

```text
stock_policy
- cabang_id TEXT PRIMARY KEY
- mode TEXT NOT NULL CHECK(mode IN ('tracked', 'ignored'))
- revision INTEGER NOT NULL CHECK(revision >= 1)
- disabled_at TEXT NULL
- reconciled_at TEXT NULL
- updated_at TEXT NOT NULL
- updated_by TEXT NOT NULL
- updated_by_role TEXT NOT NULL
- reconciliation_job_id TEXT NULL
```

Missing row memiliki arti virtual `tracked`, revision `0`. Read tidak otomatis menulis row.

Tambahkan tabel histori durable:

```text
stock_policy_transitions
- cabang_id TEXT NOT NULL
- revision INTEGER NOT NULL
- previous_revision INTEGER NOT NULL
- previous_mode TEXT NOT NULL CHECK(previous_mode IN ('tracked', 'ignored'))
- mode TEXT NOT NULL CHECK(mode IN ('tracked', 'ignored'))
- effective_at TEXT NOT NULL
- disabled_at TEXT NULL
- reconciled_at TEXT NULL
- actor_user_id TEXT NOT NULL
- actor_role TEXT NOT NULL
- reconciliation_job_id TEXT NULL
- PRIMARY KEY(cabang_id, revision)
```

Histori adalah bagian transaksi policy, bukan audit best-effort. Histori dipakai untuk offline epoch, investigasi, dan rollback decision.

Tambahkan tabel workflow rekonsiliasi:

```text
stock_reconciliations
- id TEXT PRIMARY KEY
- cabang_id TEXT NOT NULL
- expected_policy_revision INTEGER NOT NULL
- status TEXT NOT NULL CHECK(status IN ('draft', 'ready', 'applied', 'cancelled'))
- inventory_fingerprint TEXT NOT NULL
- created_by TEXT NOT NULL
- created_at TEXT NOT NULL
- finalized_at TEXT NULL

stock_reconciliation_items
- job_id TEXT NOT NULL
- cabang_id TEXT NOT NULL
- entity_type TEXT NOT NULL CHECK(entity_type IN ('produk', 'bahan'))
- entity_id TEXT NOT NULL
- counted_quantity REAL NULL CHECK(counted_quantity >= 0)
- PRIMARY KEY(job_id, entity_type, entity_id)
```

`counted_quantity` produk wajib integer. `counted_quantity` bahan boleh desimal dan harus dinormalisasi sesuai aturan kuantitas proyek.

### 9.2 Invariant Database

- Satu row policy maksimum per cabang.
- Satu transition maksimum per `(cabang_id, revision)`.
- Revision bertambah tepat satu.
- Trigger `stock_policy` menulis transition row pada INSERT/UPDATE sehingga histori tidak dapat terpisah dari policy commit.
- Row policy tidak boleh memiliki mode lain.
- `disabled_at` wajib terisi pada `ignored`.
- `reconciled_at` wajib terisi pada aktivasi hasil job.
- Job hanya dapat difinalisasi satu kali.
- Semua item job wajib memiliki `cabang_id` sama dengan job.
- Finalisasi wajib membandingkan inventory fingerprint terbaru.
- Trigger `buku_kas` menolak insert POS live jika policy mode/revision pada transaksi tidak sama dengan policy database saat commit.
- Trigger policy guard serta approval review/consumption tidak berjalan untuk `restored_from_archive = 1`.
- Permanent void-replay guard seperti `trg_buku_kas_block_void_replay` tetap aktif saat restore agar transaksi yang sudah di-void tidak dapat hidup kembali.
- Trigger inventaris tidak berjalan saat restore karena restore tidak memasukkan ledger mutasi aktif.
- Missing policy hanya cocok dengan `tracked@0`.

### 9.3 Domain Helper

Buat helper kanonikal di:

```text
src/lib/server/stockPolicy.ts
```

Tanggung jawab helper:

- Membaca policy berdasarkan `BranchContext`.
- Menghasilkan default aman.
- Menulis dengan compare-and-swap revision.
- Menjaga timestamp transisi.
- Membuat transition history dalam transaksi yang sama.
- Membuat dan memfinalisasi job rekonsiliasi.
- Menghasilkan inventory fingerprint deterministik dari ID dan revision/update marker inventaris, bukan format locale.
- Tidak mengimpor route, UI, store Svelte, atau global browser.

### 9.4 Rollout Gate

Allowlist pilot disimpan di D1 (`stock_feature_rollout`, feature `stock_monitoring`), bukan env var. Env dashboard terbukti tidak sampai ke runtime Pages sehingga gate wajib berbasis database. Fail-closed: row hilang atau error baca = tidak ada cabang diizinkan.

- Nilai adalah daftar branch ID exact dipisah koma, atau `*` setelah general availability. Default migrasi: string kosong (tertutup).
- Operator mengubah langsung via SQL (`UPDATE stock_feature_rollout SET branches = '...' WHERE feature = 'stock_monitoring'`); tanpa redeploy.
- GET mengembalikan `can_manage_policy`.
- PUT dan endpoint rekonsiliasi/review menolak branch di luar allowlist dengan 403.
- Checkout tetap membaca row policy yang sudah ada walau branch dikeluarkan dari allowlist.
- Kasir tidak pernah menerima nilai allowlist mentah.
- Pilot hanya mengizinkan satu cabang.

## 10. Kontrak API

### 10.1 GET `/api/pengaturan/stok`

Hak akses:

- Session wajib.
- `kasir` dan `pemilik` boleh membaca.
- `admin` ditolak eksplisit. Jangan memakai bypass implicit `requireAnyRole` sebagai izin fitur.
- Query menerima `branch` optional.
- Jika `branch` tidak ada, gunakan cabang session.
- Jika `branch` ada, panggil `requireSessionBranch(locals, branch)` dan tolak mismatch.
- Query parameter tidak dikenal ditolak.

Respons sukses:

```json
{
	"ok": true,
	"data": {
		"can_manage_policy": true,
		"revision": 3,
		"mode": "ignored",
		"disabled_at": "2026-09-23T10:00:00.000Z",
		"reconciled_at": null,
		"updated_at": "2026-09-23T10:00:00.000Z"
	}
}
```

### 10.2 PUT `/api/pengaturan/stok`

Hak akses:

- Session wajib.
- Hanya `pemilik`.
- `admin` ditolak eksplisit.
- CSRF wajib.
- Body wajib memuat `branch`, `expected_revision`, dan `mode`.
- `requireSessionBranch(locals, body.branch)` wajib dipanggil.
- Field tidak dikenal ditolak.

Request menonaktifkan:

```json
{
	"branch": "samarinda",
	"expected_revision": 3,
	"mode": "ignored"
}
```

Aktivasi ulang tidak dilakukan oleh PUT ini. Request `ignored -> tracked` selalu ditolak 409 dan diarahkan ke finalisasi rekonsiliasi.

Request `tracked -> tracked` atau `ignored -> ignored` adalah no-op idempotent jika `expected_revision` sama. Respons 200 mengembalikan row yang sama tanpa menaikkan revision atau mengubah timestamp.

### 10.3 API Rekonsiliasi

Endpoint:

```text
POST /api/pengaturan/stok/reconciliation
PUT  /api/pengaturan/stok/reconciliation/:id/items
POST /api/pengaturan/stok/reconciliation/:id/finalize
DELETE /api/pengaturan/stok/reconciliation/:id
```

Semua endpoint:

- Hanya `pemilik` cabang.
- `admin` ditolak eksplisit.
- Session, CSRF, dan `requireSessionBranch` wajib.
- Job ID harus milik cabang session.
- Create hanya diizinkan saat mode `ignored`.
- Hanya satu job `draft` atau `ready` per cabang.
- Upload item dapat dicicil, tetapi finalisasi hanya jika coverage tepat 100%.
- Finalisasi memakai `expected_policy_revision` dari job.
- Finalisasi menerapkan hitung fisik dan aktivasi policy dalam satu transaksi database.
- Finalisasi gagal 409 jika policy berubah, inventory fingerprint berubah, coverage tidak lengkap, atau queue quarantine belum diselesaikan.

Contoh finalisasi:

```json
{
	"branch": "samarinda",
	"expected_policy_revision": 4
}
```

ID job hanya berasal dari path `:id`. Body yang mengirim `job_id` ditolak sebagai field tidak dikenal sehingga tidak ada dua sumber authority.

Aturan respons:

| Kondisi                      | Status |
| ---------------------------- | ------ |
| Berhasil                     | 200    |
| Body tidak valid             | 400    |
| Belum login                  | 401    |
| Role tidak diizinkan         | 403    |
| Cabang tidak sesuai session  | 403    |
| Revision berubah bersamaan   | 409    |
| Transisi butuh rekonsiliasi  | 409    |
| Policy berubah saat checkout | 412    |
| Replay butuh review pemilik  | 428    |
| Kegagalan database           | 500    |

Gunakan kontrak Tier A `{ ok: true, data }` dan `kitError` untuk error. Client membedakan state machine memakai status HTTP, bukan field code baru:

- 412 dari checkout policy race berarti reload policy lalu konfirmasi ulang.
- 428 dari offline replay berarti simpan queue dan buka alur review pemilik.
- Error stok biasa tetap 409 sesuai kontrak sekarang.
- `offlineSync` tidak boleh menghapus queue pada 428.

### 10.4 Compare-and-Swap

- Client wajib mengirim `expected_revision`.
- Update hanya sukses jika revision database sama.
- Missing row hanya dapat dibuat dengan `expected_revision = 0`.
- Dua insert missing-row bersamaan: satu sukses, satu 409 karena unique/CAS conflict.
- Update existing memakai `WHERE cabang_id = ? AND revision = ?`.
- Dua perangkat yang mengubah mode bersamaan tidak boleh saling menimpa.
- Konflik mengembalikan 409 dan UI meminta reload.
- Revision bertambah tepat satu pada setiap perubahan berhasil.
- Lost response lalu retry dengan revision lama menghasilkan 409; client GET lalu menampilkan state current.
- Same-mode request dengan revision current adalah no-op 200.
- `disabled_at` diisi hanya pada transisi ke `ignored`.
- `disabled_at` dipertahankan selama mode tetap `ignored`.
- `reconciled_at` hanya diisi oleh finalisasi job.
- Tidak ada auto-repair row malformed.

### 10.5 Audit dan Realtime

Setiap perubahan berhasil wajib memiliki row durable di `stock_policy_transitions` dalam transaksi yang sama:

- Cabang.
- Actor user dan role.
- Mode lama.
- Mode baru.
- Revision lama.
- Revision baru.
- Timestamp.
- Job rekonsiliasi jika ada.

`audit_logs` umum tetap dicoba setelah commit sebagai observability best-effort. Kegagalannya tidak membatalkan policy karena transition history sudah menjadi bukti durable.

Setelah commit, publish event best-effort:

```text
table: stock_policy
action: update
key: cabang_id
```

Kegagalan audit observability atau realtime setelah commit tidak boleh membatalkan konfigurasi yang sudah sah. Counter/log failure wajib tersedia untuk operator.

## 11. Migrasi dan Provenance Transaksi

### 11.1 Alasan Migrasi

Void saat ini membaca `transaksi_kasir.jumlah`, lalu menambah stok jika produk saat void masih memiliki `lacak_stok = 1`.

Perilaku itu tidak cukup setelah mode `ignored` tersedia. Transaksi yang tidak mengurangi stok dapat menambah stok palsu ketika di-void setelah cabang kembali ke `tracked`.

### 11.2 Kolom Additive

Migrasi fitur bersifat additive dan menambahkan:

```text
stock_policy table
stock_policy_transitions table
stock_reconciliations table
stock_reconciliation_items table
offline_stock_reviews table
produk_mutasi table
buku_kas.stock_policy_mode TEXT NULL
buku_kas.stock_policy_revision INTEGER NULL
buku_kas.stock_replay_disposition TEXT NULL
buku_kas.restored_from_archive INTEGER NOT NULL DEFAULT 0
```

Semantik:

| Nilai                                          | Arti                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `stock_policy_mode = 'tracked'`                | Checkout memakai kebijakan aktif.                                     |
| `stock_policy_mode = 'ignored'`                | Checkout sengaja tidak menerapkan inventaris.                         |
| `stock_policy_mode IS NULL`                    | Transaksi legacy sebelum fitur.                                       |
| Row `produk_mutasi` sumber `pos`               | Bukti stok produk benar-benar dikurangi.                              |
| Tidak ada row mutasi pada transaksi non-legacy | Stok produk tidak dikurangi.                                          |
| `restored_from_archive = 1`                    | Transaksi hasil restore hanya direstorasi secara finansial saat void. |

Constraint minimum:

- `buku_kas.stock_policy_mode` hanya `tracked`, `ignored`, atau `NULL`.
- `buku_kas.stock_policy_revision` nonnegatif atau `NULL`.
- Mode dan revision pada header keduanya terisi atau keduanya `NULL`.
- `stock_replay_disposition` hanya nilai registry pada bagian offline atau `NULL`.
- `restored_from_archive` hanya `0` atau `1`.
- `produk_mutasi.delta_jumlah` tidak boleh nol.
- Unique `(cabang_id, referensi_id, produk_id, sumber)` mencegah efek ganda.

### 11.3 Penerapan Stok Produk yang Terbukti

Jangan lagi membuat update stok produk tanpa ledger. Tambahkan `produk_mutasi` setara dengan `bahan_mutasi`:

```text
produk_mutasi
- id TEXT PRIMARY KEY
- cabang_id TEXT NOT NULL
- produk_id TEXT NOT NULL
- delta_jumlah INTEGER NOT NULL CHECK(delta_jumlah <> 0)
- stok_setelah INTEGER NOT NULL
- sumber TEXT NOT NULL CHECK(sumber IN ('pos', 'void', 'manual', 'reconciliation'))
- referensi_id TEXT NOT NULL
- dibuat_oleh TEXT
- created_at TEXT NOT NULL
- UNIQUE(cabang_id, referensi_id, produk_id, sumber)
```

Trigger pada insert ledger:

- Trigger memverifikasi produk ada pada cabang sama.
- Sumber `pos` wajib memiliki delta negatif dan produk `lacak_stok = 1`.
- Sumber `void` wajib memiliki delta positif dan referensi mutasi POS asli.
- Delta `void` wajib tepat sama dengan kebalikan delta POS asli untuk branch, transaction, dan produk yang sama; partial atau excess restore meng-abort batch.
- Sumber `manual` dan `reconciliation` memakai delta dari saldo current ke saldo target.
- Insert ledger selalu memakai `VALUES`, bukan `INSERT ... SELECT` yang dapat sukses dengan nol row.
- Trigger memverifikasi `stok_setelah = current_stock + delta`; mismatch concurrency meng-abort batch.
- Trigger menerapkan delta ke `produk.stok`.
- Trigger stok negatif yang sudah ada tetap menolak saldo kurang.
- Produk hilang atau tracking flag berubah sebelum commit menghasilkan abort, bukan sale tanpa deduction.
- Insert ledger dan update stok adalah satu efek database; kegagalan update membatalkan batch.
- Header, ledger, line transaksi, buku kas, dan summary tetap satu batch atomik.

Dengan desain ini, row ledger yang commit adalah bukti deduction aktual. Checkout mode `ignored` tidak membuat row ledger.

Seluruh perubahan stok produk setelah migrasi wajib melewati `produk_mutasi`:

- Product create dimulai dari stok `0`; stok awal positif diterapkan sebagai mutasi `manual` pada mode tracked.
- Product edit tracked tidak boleh menjalankan `UPDATE produk SET stok = ?` langsung.
- Rekonsiliasi memakai sumber `reconciliation` untuk setiap delta nonzero.
- Saldo yang tidak berubah tidak membutuhkan ledger delta nol.
- Perubahan metadata produk tanpa perubahan stok tidak membuat ledger.

Kolom harus ditambahkan ke:

- `src/lib/database/schema.ts`.
- Migrasi SQL Drizzle baru.
- Manifest migrasi dan checksum terkait.
- Insert checkout dan trigger ledger.
- Query void.
- Archive export, cleanup ledger, dan restore marker.
- Tipe transaksi yang relevan.
- Test SQLite fresh dan D1/workerd.

### 11.4 Aturan Void Baru

Untuk transaksi baru:

- Void membaca `produk_mutasi` sumber `pos` dengan `referensi_id = transaction_id`.
- Void membuat mutasi sumber `void` sebesar kebalikan delta aktual.
- Tidak ada row POS berarti tidak ada restore produk.
- Void bahan tetap memakai bukti `bahan_mutasi` sumber POS yang benar-benar ada.
- Mode cabang saat void tidak mengubah efek transaksi asli.
- Flag `lacak_stok` produk saat void tidak boleh menentukan efek transaksi baru.
- Transaksi `restored_from_archive = 1` tidak mengembalikan inventaris karena restore tidak menerapkan deduction historis.

Untuk transaksi legacy:

- Header policy `NULL` dan `restored_from_archive = 0` memakai fallback perilaku legacy agar transaksi lama tetap dapat di-void.
- Fallback wajib terisolasi dan diberi komentar alasan kompatibilitas data persisten.
- Audit void menandai penggunaan fallback legacy.
- Tidak dilakukan backfill spekulatif karena tidak ada bukti mutasi produk historis yang cukup.

### 11.5 Archive dan Restore

- Archive `SELECT *` akan membawa kolom baru.
- Restore allowlist wajib ditambah agar provenance tidak hilang.
- Archive schema wajib naik ke versi 3.
- `BK_FIELDS` restore wajib memuat mode, revision, dan replay disposition.
- Restore memvalidasi mode, revision nonnegatif, disposition, dan pasangan mode/revision.
- Archive snapshot v3 menyertakan `produk_mutasi` terkait sebagai bukti audit, lalu cleanup menghapus exact ledger ID setelah snapshot readback.
- Restore tidak memasukkan ulang `produk_mutasi` ke ledger aktif dan selalu menulis `restored_from_archive = 1`.
- Marker restore ditulis langsung pada INSERT `buku_kas`, bukan UPDATE setelah insert, sehingga trigger policy dapat mengecualikan row restore dengan aman.
- Pengecualian berlaku untuk policy guard, replay approval verification, dan approval consumption.
- Pengecualian trigger hanya berlaku untuk marker restore yang berasal dari restore use case terotorisasi; API checkout tidak menerima field tersebut dari client.
- Archive versi lama tetap dapat dipulihkan dengan mode/revision `NULL` serta marker restore `1`.
- Restore tidak boleh mengulang pengurangan stok historis.
- Void transaksi hasil restore tidak boleh mengubah inventaris.
- Fixture archive v3 malformed dan delta ledger nol/invalid wajib ditolak sebelum apply.

## 12. Perubahan Checkout

### 12.1 Pemisahan Capability dan Policy

`CheckoutCapabilities` saat ini menunjukkan ketersediaan skema. Jangan gunakan capability sebagai toggle bisnis.

Tambahkan policy terpisah ke context checkout:

```ts
interface StockPolicy {
	mode: 'tracked' | 'ignored';
	revision: number;
}

type InventoryApplication = 'apply' | 'skip_policy_ignored' | 'skip_reconciled_replay';
```

Capability tetap menjawab pertanyaan seperti "apakah kolom atau tabel tersedia". Policy menjawab "apakah cabang ingin menerapkan inventaris pada transaksi ini".

### 12.2 Urutan Checkout Baru

1. Validasi session dan `BranchContext`.
2. Normalisasi request dan validasi idempotency.
3. Jika idempotency key sudah commit, kembalikan receipt lama sebelum menerapkan policy baru.
4. Baca capability skema.
5. Baca stock policy cabang dari server.
6. Muat produk, tambahan, resep, dan biaya bahan.
7. Hitung harga, HPP, snapshot HPP, dan total transaksi.
8. Hitung kebutuhan inventaris untuk observability.
9. Tentukan `InventoryApplication` dari policy dan replay disposition terverifikasi.
10. Hanya `apply` yang membentuk deduction bahan dan mutasi produk.
11. Kedua nilai `skip_*` tidak membentuk deduction atau ledger inventaris.
12. Insert header `buku_kas` lebih dahulu dengan policy mode, revision, dan replay disposition.
13. Trigger header membandingkan policy transaksi dengan row policy database.
14. Jika policy berubah, trigger abort dengan policy conflict dan route memetakan ke HTTP 412; seluruh batch rollback.
15. Untuk `apply`, insert ledger produk dan deduction bahan.
16. Trigger ledger menerapkan deduction produk yang terbukti.
17. Commit summary dan seluruh efek transaksi dalam batch D1 yang sama.
18. Publish realtime dan audit secara best-effort setelah commit.

### 12.3 Aturan `tracked`

- Produk `lacak_stok = 1` menghasilkan pengurangan `produk.stok`.
- Deduction produk dilakukan oleh trigger `produk_mutasi` dari delta ledger.
- Produk `lacak_bahan = 1` tetap membutuhkan resep valid.
- Resep menghasilkan HPP dan pengurangan bahan.
- Tambahan yang terhubung bahan menghasilkan HPP dan pengurangan bahan.
- Trigger stok negatif tetap aktif.
- Kekurangan stok membatalkan seluruh batch.
- Tidak ada buku kas, summary, receipt, atau idempotency row parsial.

### 12.4 Aturan `ignored`

- Produk tetap harus aktif dan valid.
- Harga dan token harga tetap divalidasi.
- Resep tetap dimuat untuk costing.
- HPP dan snapshot HPP tetap dihitung.
- Missing recipe yang dibutuhkan untuk costing tetap mengikuti kontrak HPP yang diputuskan aplikasi; toggle tidak boleh diam-diam mengubah aturan kualitas HPP.
- `stockDeductions` yang diterapkan harus kosong.
- `ingredientDeductions` yang diterapkan harus kosong.
- Tidak ada update `produk.stok`.
- Tidak ada update `bahan.stok_saat_ini`.
- Tidak ada insert `bahan_mutasi` sumber POS.
- Tidak ada error insufficient stock.
- Penjualan, receipt, buku kas, ringkasan, dan idempotency tetap commit.
- Tidak ada row `produk_mutasi` sumber POS.

### 12.5 Inventory Application untuk Replay

| Kondisi                                             | InventoryApplication                                |
| --------------------------------------------------- | --------------------------------------------------- |
| Online/current tracked                              | `apply`                                             |
| Replay `owner_approved_current` dan current tracked | `apply`                                             |
| Current ignored                                     | `skip_policy_ignored`                               |
| Replay `stale_to_ignored`                           | `skip_policy_ignored`                               |
| Replay immutable `owner_approved_after_recount`     | `skip_reconciled_replay` tanpa melihat mode current |

Aturan:

- `owner_approved_after_recount` selalu menghasilkan nol `produk_mutasi` dan nol `bahan_mutasi` POS.
- Header tetap menyimpan policy current agar policy guard atomik tetap berlaku.
- `stock_replay_disposition` membuktikan alasan skip inventaris pada policy current `tracked`.
- Trigger approval memverifikasi job applied sebelum mengizinkan `skip_reconciled_replay`.
- Client tidak dapat meminta inventory application langsung.

### 12.6 Defense in Depth

- `statementBuilder` menerima policy dan `InventoryApplication` secara eksplisit.
- Builder tidak membuat statement stok untuk kedua nilai `skip_*`, walau map deduction terisi karena bug upstream.
- Test harus membuktikan tidak ada SQL mutasi inventaris pada mode `ignored`.
- Audit checkout mencatat policy mode dan revision.
- Monitoring mendeteksi jika transaksi `ignored` memiliki mutasi POS nonzero.
- Trigger header mencegah policy snapshot stale ikut commit.
- Trigger ledger mencegah provenance mutasi tanpa update produk aktual.
- SQL migration test membuktikan trigger benar-benar berjalan setelah seluruh rename schema.

### 12.7 Idempotency

- Mode dan revision tidak masuk fingerprint.
- Retry key sama dan payload sama mengembalikan transaksi lama.
- Retry tidak menerapkan ulang mutasi stok.
- Key sama dengan fingerprint berbeda tetap 409.
- Jika checkout gagal karena stok saat `tracked`, tidak ada idempotency row commit.
- Request yang sama dapat dicoba lagi setelah pemilik mengubah mode dengan key baru atau key lama yang belum pernah commit.

### 12.8 Concurrency

- Dua transaksi `tracked` yang berebut stok terakhir menghasilkan maksimum satu transaksi sukses.
- Dua transaksi `ignored` dapat sukses tanpa mengubah stok.
- Policy dibaca pada evaluasi checkout dan diperiksa ulang oleh trigger saat commit.
- Checkout dan toggle memiliki urutan linear: salah satu commit lebih dahulu.
- Checkout dengan revision stale gagal atomik dengan HTTP 412 policy conflict.
- Client reload policy lalu meminta konfirmasi ulang bila perilaku efektif berubah.
- Tidak ada silent retry mutation.
- Perubahan policy tidak boleh mengubah transaksi yang sudah commit.

## 13. Catalog, POS, dan Offline

### 13.1 Catalog POS

Tambahkan field optional agar cache lama tetap dapat dibaca:

```ts
stock_policy?: {
  mode: 'tracked' | 'ignored';
  revision: number;
  updated_at?: string | null;
  epoch_token: string;
};
```

Aturan:

- Field dipakai untuk UX, bukan otoritas checkout.
- `epoch_token` ditandatangani server dan mengikat branch, mode, revision, serta waktu terbit.
- Signature memakai primitive server existing dengan domain separation `stock-policy-epoch:v1`; key tidak pernah dikirim ke client atau log.
- Token tidak dapat dibuat atau diubah browser.
- Cache lama tanpa field dianggap `tracked`.
- Catalog tetap membawa data yang dibutuhkan HPP dan transaksi.
- Tidak perlu memutus cache lama hanya untuk field optional.
- Perubahan policy memicu refresh catalog/state bila client online.

### 13.2 POS Mode `ignored`

- Tidak menampilkan label "Habis".
- Tidak menonaktifkan kartu produk karena stok.
- Tidak membatasi jumlah cart berdasarkan stok.
- Tidak menjalankan strict stock check sebelum pembayaran.
- Tidak menampilkan low-stock banner.
- Tidak memainkan suara stok.
- Tidak meminta atau mengirim notifikasi stok.
- Tidak menampilkan badge jumlah stok.
- Tidak menampilkan pesan error stok dari validasi client.
- Error checkout non-stok tetap ditampilkan normal.

### 13.3 Pengaturan Browser Lama

- `zatiaras_strict_stock_checkout` tidak dimigrasikan ke server.
- Nilai lama tidak menentukan policy cabang.
- Kontrol "Kunci Saat Stok Habis" lama dihapus atau diganti dengan penjelasan policy server.
- Preferensi suara boleh tetap lokal, tetapi hanya efektif saat policy `tracked`.
- Data localStorage lama boleh diabaikan tanpa cleanup paksa.

### 13.4 Offline

Kontrak backward-compatible:

- Queue IndexedDB lama tetap kompatibel.
- Tidak ada field queue lama yang dihapus atau diubah makna.
- UI offline memakai policy terakhir dari catalog cache.
- Cache tanpa policy memakai fallback `tracked`.
- Queue baru menyimpan `stock_policy_epoch_token`, mode, dan revision sebagai field optional.
- Server memverifikasi signature, branch, waktu terbit, dan revision token.
- Token browser tidak langsung menentukan mutasi; token hanya membuktikan epoch saat catalog diterbitkan.
- Retry replay tetap memakai idempotency key asli.
- Receipt offline yang sudah dibuat tidak berubah.

Aturan replay:

| Kondisi                                                                                 | Disposisi                                                                     |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Token revision sama dengan current policy                                               | Terapkan current policy.                                                      |
| Current mode `ignored`, token valid lebih lama                                          | Commit finansial tanpa inventaris dan catat stale epoch.                      |
| Current mode `tracked`, token revision stale dalam kondisi apa pun                      | Tolak HTTP 428; queue tetap utuh. Waktu client tidak dianggap bukti otomatis. |
| Token hilang pada queue legacy dan cabang belum pernah berubah dari virtual `tracked@0` | Replay normal sebagai tracked.                                                |
| Token hilang atau invalid setelah cabang memiliki transition history                    | Quarantine dan minta review pemilik.                                          |
| Token lebih tua dari lebih dari satu transition dan tidak dapat dipetakan aman          | Quarantine dan minta review pemilik.                                          |

Tambahkan metadata header nullable:

```text
buku_kas.stock_replay_disposition TEXT NULL
```

Nilai yang diizinkan:

```text
normal
stale_to_ignored
owner_approved_current
owner_approved_after_recount
```

Quarantine server-side menyimpan metadata minimum, bukan isi receipt penuh:

```text
offline_stock_reviews
- cabang_id TEXT NOT NULL
- idempotency_key TEXT NOT NULL
- request_fingerprint TEXT NOT NULL
- queued_at INTEGER NOT NULL
- policy_revision_at_queue INTEGER NULL
- current_policy_revision INTEGER NOT NULL
- revision INTEGER NOT NULL DEFAULT 0
- status TEXT NOT NULL CHECK(status IN ('pending', 'attached_to_reconciliation', 'approved_current', 'approved_after_recount', 'consumed'))
- resolution TEXT NULL CHECK(resolution IN ('apply_current', 'after_recount') OR resolution IS NULL)
- reconciliation_job_id TEXT NULL
- approved_policy_revision INTEGER NULL
- reviewed_by TEXT NULL
- reviewed_at TEXT NULL
- consumed_at TEXT NULL
- PRIMARY KEY(cabang_id, idempotency_key)
```

Resolusi pemilik:

- `owner_approved_current`: replay menerapkan policy current setelah pemilik meninjau.
- `owner_approved_after_recount`: replay tidak menerapkan inventaris karena job rekonsiliasi yang dirujuk sudah mencakup sale.
- Pilihan after-recount mengubah review menjadi `attached_to_reconciliation` pada job draft cabang sama.
- Finalisasi job atomik mengubah seluruh review attached menjadi `approved_after_recount` dan mengikat revision policy hasil finalisasi.
- Pilihan apply-current langsung menghasilkan `approved_current` melalui CAS review revision dan mengikat revision policy saat approval.
- Approval terikat pada branch, idempotency key, dan fingerprint.
- Trigger insert `buku_kas` memverifikasi approval, fingerprint, dan disposition, lalu menandai review `consumed` dalam transaksi checkout yang sama.
- Jika policy revision berubah setelah `approved_current` tetapi sebelum replay, replay preflight mengembalikan review ke `pending` melalui CAS dan merespons 428; trigger tetap menolak approval revision stale sebagai defense in depth.
- Approval hanya dapat dipakai satu kali; dua replay bersamaan menghasilkan satu commit/idempotent result.
- Queue tidak boleh dihapus pada HTTP 428.

State machine review yang diizinkan:

| Dari                           | Ke                               | Pelaku           | Guard                                          |
| ------------------------------ | -------------------------------- | ---------------- | ---------------------------------------------- |
| Tidak ada                      | `pending@0`                      | Replay preflight | Unique branch/key dan fingerprint tersimpan    |
| `pending@n`                    | `approved_current@n+1`           | Pemilik          | CAS revision, current policy revision diikat   |
| `pending@n`                    | `attached_to_reconciliation@n+1` | Pemilik          | CAS revision, job draft cabang sama            |
| `attached_to_reconciliation@n` | `approved_after_recount@n+1`     | Finalisasi job   | Job sama, finalisasi atomik                    |
| `attached_to_reconciliation@n` | `pending@n+1`                    | Pembatalan job   | Otomatis dalam transaksi pembatalan job        |
| `approved_current@n`           | `consumed@n+1`                   | Trigger checkout | Fingerprint dan approved policy revision cocok |
| `approved_after_recount@n`     | `consumed@n+1`                   | Trigger checkout | Fingerprint, job applied, dan revision cocok   |
| `approved_current@n`           | `pending@n+1`                    | Pemilik          | Withdraw approval sebelum konsumsi             |
| `approved_current@n`           | `pending@n+1`                    | Replay preflight | Approved policy revision sudah stale           |

Aturan state machine:

- Setiap transisi wajib menambah review revision tepat satu.
- Semua transisi memakai `WHERE revision = expected_revision AND status = expected_status`.
- Tidak ada transisi langsung antar dua status approval.
- `consumed` terminal dan tidak dapat diedit.
- `approved_after_recount` immutable selain transisi ke `consumed`; status ini tidak dapat di-withdraw, diubah menjadi apply-current, atau dibuat stale oleh perubahan policy berikutnya.
- Bukti job applied membuat `approved_after_recount` selalu memakai zero inventory effect saat replay.
- PUT stale tidak boleh menimpa status hasil finalisasi job.
- Pembatalan job wajib melepaskan seluruh review attached menjadi pending dalam transaksi yang sama.
- Setiap transisi kembali ke `pending`, baik karena withdraw approval-current, pembatalan job, atau approval-current stale, wajib mengosongkan `resolution`, `reconciliation_job_id`, `approved_policy_revision`, `reviewed_by`, `reviewed_at`, dan `consumed_at`.
- Finalisasi job ditolak jika terdapat review `pending` atau `approved_current` yang belum consumed.
- Sebelum finalisasi, setiap `approved_current` harus consumed atau di-withdraw ke pending lalu di-attach ke job aktif.
- Konsumsi approval, insert buku kas, inventaris, idempotency, dan receipt berada dalam satu batch atomik.

Kontrak API review:

```text
GET /api/pengaturan/stok/offline-reviews?branch=<branch>
PUT /api/pengaturan/stok/offline-reviews/:idempotency_key
```

Body PUT:

```json
{
	"branch": "samarinda",
	"expected_review_revision": 0,
	"action": "approve_current",
	"reconciliation_job_id": null
}
```

Aturan API:

- Hanya pemilik cabang; admin ditolak eksplisit.
- CSRF dan `requireSessionBranch` wajib.
- `action` hanya `approve_current`, `attach_to_reconciliation`, atau `withdraw`.
- `attach_to_reconciliation` wajib membawa job draft cabang sama.
- `approve_current` dan `withdraw` wajib membawa job `null`.
- `withdraw` hanya sah dari `approved_current`; `approved_after_recount` tidak dapat diubah.
- CAS conflict menghasilkan 409.
- Review consumed tidak dapat diubah.
- Request fingerprint tidak pernah dapat diedit melalui endpoint.

Batas operasional tetap berlaku:

- UI meminta semua perangkat online sebelum toggle.
- Ketidakmampuan membuktikan seluruh IndexedDB kosong bukan alasan menganggap queue aman.
- Rekonsiliasi hanya dapat difinalisasi jika setiap review non-consumed selain immutable `approved_after_recount` berstatus `attached_to_reconciliation` dan menunjuk job yang sama; review attached tersebut diselesaikan atomik oleh finalisasi.
- Queue perangkat yang belum pernah replay tetap akan dikarantina jika muncul setelah aktivasi; cutoff client tidak pernah dipercaya otomatis.
- Kegagalan replay tetap terlihat dan tidak boleh dihapus diam-diam.

## 14. Perubahan UI dan Navigasi

### 14.1 Lokasi Master Toggle

Master toggle harus selalu dapat ditemukan pemilik di pengaturan pemilik. Label yang disarankan:

```text
Monitoring Stok
Pantau dan kurangi stok otomatis saat penjualan
```

Status:

```text
Aktif
POS memantau dan mengurangi stok.
```

```text
Nonaktif
POS berjalan tanpa monitoring atau pengurangan stok.
```

### 14.2 Alur Menonaktifkan

1. Pemilik menekan toggle.
2. Modal menjelaskan dampak.
3. Modal mengingatkan sinkronisasi antrean offline semua perangkat.
4. Pemilik mengonfirmasi.
5. PUT memakai expected revision.
6. Setelah sukses, UI menyembunyikan permukaan stok.
7. Jika realtime gagal, halaman tetap memakai respons PUT yang sudah sukses.

Teks konfirmasi wajib menyatakan:

- Penjualan tetap berjalan.
- Stok tidak berkurang otomatis.
- Peringatan stok berhenti.
- Data lama tidak dihapus.
- Aktivasi ulang membutuhkan rekonsiliasi.

### 14.3 Alur Mengaktifkan

1. Pemilik menekan "Aktifkan kembali".
2. UI menampilkan status data sejak penonaktifan.
3. Client membuat job rekonsiliasi server-side.
4. Pemilik membuka halaman job dan mengisi setiap produk tracked serta bahan aktif.
5. UI menampilkan coverage item dan offline review berstatus pending.
6. Pemilik memilih apply-current atau memasang review ke job sebagai after-recount.
7. Approval apply-current wajib direplay sampai `consumed`; jika perangkat tidak tersedia, approval di-withdraw lalu review dipasang ke job.
8. Pastikan tidak ada pending atau `approved_current` unconsumed; `approved_after_recount` immutable dari job lama boleh tetap menunggu replay.
9. Pemilik mengirim finalisasi job.
10. Server memeriksa policy revision, fingerprint inventaris, coverage, jumlah, dan review queue.
11. Server atomik menerapkan saldo fisik, mencatat cutoff, mengubah review attached menjadi approved-after-recount, dan mengubah policy ke `tracked`.
12. Setelah sukses, navbar dan monitoring stok tampil kembali.

### 14.4 Permukaan Yang Disembunyikan Saat `ignored`

- Item Stok pada bottom navigation.
- Shortcut stok pada dashboard.
- Widget stok menipis.
- Grafik atau daftar pemakaian bahan berbasis mutasi POS.
- Low-stock alert banner.
- Badge stok pada produk POS.
- Kontrol strict checkout stok.
- Alarm dan notifikasi stok.
- Field stok awal dan tracking stok langsung pada form produk.
- Field ambang stok pada alur harian.
- Tombol mutasi stok harian.
- Prompt atau shortcut AI tentang stok.
- Link langsung ke `/stok` selain alur rekonsiliasi pemilik.

### 14.5 Permukaan Yang Tetap Ada Saat `ignored`

- Produk dan kategori.
- Harga reguler dan jumbo.
- Tambahan produk.
- Resep untuk costing.
- Harga beli bahan.
- Yield dan konversi satuan.
- HPP produk dan tambahan.
- Margin dan laporan laba.
- Buku kas dan riwayat transaksi.
- Pajak dan laporan omzet.
- Struk dan cetak ulang.

Label yang mencampur costing dan stok harus diperjelas. Contoh:

| Label Lama                  | Label Saat `ignored`    |
| --------------------------- | ----------------------- |
| Lacak Bahan dan Potong Stok | Gunakan Resep untuk HPP |
| Resep Bahan Baku            | Resep dan Biaya Bahan   |
| Inventaris Bahan dan Menu   | Data Biaya Bahan        |

### 14.6 Direct Route Guard

- `/stok` tidak boleh hanya disembunyikan dari navbar.
- Tambah `src/routes/stok/+page.server.ts` yang membaca policy dan job rekonsiliasi.
- Kasir pada mode `ignored` diarahkan ke halaman yang sesuai atau menerima status tidak tersedia.
- Pemilik mode `ignored` hanya dapat masuk dengan job rekonsiliasi aktif milik cabang sama.
- API tetap menerapkan auth dan branch scope; route guard bukan kontrol keamanan tunggal.

### 14.7 Mutation API Saat `ignored`

- `POST /api/bahan-mutasi` normal ditolak 409 saat `ignored`.
- `PATCH /api/bahan` yang membawa `stok_saat_ini` atau `ambang_stok` ditolak 409 saat `ignored`.
- `POST /api/bahan` saat `ignored` hanya menerima data costing dan server memaksa stok awal `0`; payload stok nonzero atau ambang stok ditolak 409.
- Product update yang membawa perubahan `stok` atau `lacak_stok` ditolak 409; field tidak boleh diabaikan diam-diam.
- Product update tanpa field tersebut mempertahankan nilai existing.
- Product create saat `ignored` memakai `stok = 0` dan `lacak_stok = false` dari server.
- `lacak_bahan` tetap dapat diubah melalui kontrol "Gunakan Resep untuk HPP" karena field tersebut diperlukan costing.
- CRUD resep, harga bahan, yield, konversi, dan biaya tetap tersedia untuk HPP.
- Penyesuaian jumlah saat `ignored` hanya lewat item job rekonsiliasi.
- Endpoint reconciliation tidak memakai API mutation harian.
- Seluruh mutation dan job tetap branch-scoped dan owner-only.

Saat `tracked`:

- Create bahan dengan stok awal positif membuat bahan pada nol lalu satu `bahan_mutasi` manual.
- PATCH saldo bahan menghasilkan satu delta `bahan_mutasi`, bukan direct update tanpa ledger.
- POST bahan-mutasi menghasilkan tepat satu update saldo dan satu ledger.
- Create produk dengan stok awal positif membuat produk pada nol lalu satu `produk_mutasi` manual.
- Edit saldo produk menghasilkan satu delta `produk_mutasi`, bukan direct update tanpa ledger.

## 15. Dashboard, Laporan, Pajak, dan AI

### 15.1 Dashboard

Saat `ignored`:

- Pendapatan, jumlah transaksi, best seller, HPP, dan laba tetap tampil.
- Query stok yang tidak dibutuhkan tidak dijalankan.
- `dashboardService` tidak memanggil query bahan, low-stock, atau usage.
- Widget stok tidak dirender. Satu status non-metrik "Monitoring stok dijeda" boleh tampil di pengaturan, bukan sebagai angka dashboard.
- Data mutasi nol tidak boleh ditafsirkan sebagai tidak ada konsumsi bahan.

### 15.2 Laporan dan Pajak

- Query buku kas tetap sama.
- Ringkasan penjualan tetap sama.
- HPP tetap masuk `total_hpp`.
- Pajak tetap memakai omzet usaha.
- Archive parity laporan tidak boleh berubah.
- Tidak ada filter laporan keuangan berdasarkan mode stok kecuali metadata observability.

### 15.3 AI

Saat `ignored`:

- Backend tidak mengirim saldo stok stale sebagai fakta terkini ke model.
- Prompt stok dihilangkan.
- Shortcut pertanyaan stok disembunyikan.
- Inventory intent dihentikan sebelum `aiGateway` dipanggil.
- Pertanyaan stok menghasilkan respons deterministik exact semantic: monitoring dijeda, saldo sistem tidak current, dan hitung fisik diperlukan.
- Analisis penjualan, omzet, HPP, margin, dan pajak tetap tersedia.
- Daftar stok kosong tidak boleh diterjemahkan menjadi "semua stok aman".

## 16. Realtime dan Cache

- Event policy menggunakan channel cabang yang sudah ada.
- POS berlangganan perubahan `stock_policy`; allowlist realtime diperluas secara eksplisit.
- Dashboard dan halaman pengaturan melakukan refresh policy saat event diterima.
- Cache policy selalu memiliki namespace cabang.
- Tidak ada cache global lintas cabang.
- Perpindahan session atau cabang membersihkan state policy efektif.
- Kegagalan realtime tidak mengubah hasil commit.
- Checkout selalu membaca policy server sehingga client stale tidak dapat memaksa mode.

## 17. Observability dan Data Health

Audit checkout minimum:

- `stock_policy_mode`.
- `stock_policy_revision`.
- Product deductions yang diterapkan.
- Ingredient deductions yang diterapkan.
- Apakah fallback legacy dipakai saat void.

Kondisi yang harus dapat dideteksi:

- Transaksi `ignored` menghasilkan mutasi POS nonzero.
- HPP mendadak nol setelah mode berubah.
- Checkout `tracked` gagal karena stok tidak cukup.
- Policy malformed dan fallback `tracked` dipakai.
- Realtime publish policy gagal.
- Aktivasi dilakukan setelah periode `ignored`.
- Void legacy memakai inferensi lama.

Detector stok negatif tetap aktif. Mode `ignored` tidak melegalkan stok negatif.

## 18. Peta File Yang Diperkirakan Berubah

Daftar ini menjadi panduan awal. Implementasi boleh menemukan file tambahan, tetapi scope tambahan harus dijelaskan pada review.

### 18.1 Domain dan Server

- `src/lib/server/stockPolicy.ts` baru.
- `src/lib/server/checkout/types.ts`.
- `src/lib/server/checkout/dataLoader.ts`.
- `src/lib/server/checkout/financials.ts`.
- `src/lib/server/checkout/statementBuilder.ts`.
- `src/lib/server/checkout/checkoutUseCase.ts`.
- `src/lib/server/realtimePublisher.ts`.
- `src/lib/server/services/transaksiKasirService.ts`.
- `src/lib/server/services/bahanService.ts`.
- `src/lib/server/ai/reportData.ts`.
- `src/lib/server/ai/aiChatUseCase.ts`.
- `src/lib/server/ai/prompts.ts`.
- `src/lib/server/aiPeriod.ts`.
- `src/lib/services/dashboardService.ts`.
- `src/lib/database/schema.ts`.

### 18.2 Routes API

- `src/routes/api/pengaturan/stok/+server.ts` baru.
- `src/routes/api/pengaturan/stok/reconciliation/+server.ts` baru.
- Route item/finalize/cancel reconciliation baru.
- Route review offline stock baru.
- `src/routes/api/bahan/+server.ts`.
- `src/routes/api/bahan-mutasi/+server.ts`.
- `src/routes/api/produk/save-atomic/+server.ts`.
- `src/routes/api/pos/catalog/+server.ts`.

### 18.3 UI, Store, dan Service

- `src/lib/services/stockPolicyService.ts` baru.
- `src/lib/services/stockAlertService.ts`.
- `src/lib/stores/posState.svelte.ts`.
- `src/lib/stores/bayarState.svelte.ts`.
- `src/lib/components/shared/bottomNav.svelte`.
- `src/lib/components/shared/LowStockAlertBanner.svelte`.
- `src/lib/components/pos/ProductGrid.svelte`.
- `src/lib/components/laporan/LaporanAISection.svelte`.
- `src/routes/+page.svelte`.
- `src/routes/pos/+page.svelte`.
- `src/routes/stok/+page.svelte`.
- `src/routes/stok/+page.server.ts` baru.
- `src/routes/pengaturan/pemilik/+page.svelte`.
- `src/routes/pengaturan/pemilik/stok/+page.svelte`.
- `src/routes/pengaturan/pemilik/manajemenmenu/+page.svelte`.
- `src/lib/components/pengaturan/manajemenmenu/BahanTab.svelte`.
- `src/lib/components/pengaturan/manajemenmenu/HppTab.svelte` untuk label costing terpisah.

### 18.4 Offline, Archive, Test, dan Dokumen

- `src/lib/types/posCatalog.ts`.
- `src/lib/utils/offlineQueue.ts` untuk field optional epoch.
- `src/lib/services/offlineSync.ts` untuk quarantine dan resolution.
- `src/lib/services/productService.ts` untuk parser cache policy.
- `src/lib/utils/cacheOrchestrator.ts`.
- `scripts/restore-archive-lib.mjs`.
- Migrasi baru di `drizzle/`.
- `drizzle/meta/manifest.json` dan metadata Drizzle terkait.
- `src/tests/stock-policy-tests.ts` baru.
- Test checkout, offline, archive, tenant, error contract, dan migration matrix yang relevan.
- E2E stock policy baru.
- `package.json` untuk script test baru dan rantai `test:unit`.
- Workflow CI jika script baru perlu step eksplisit.
- `README.md` dan `DEVELOPER-GUIDE.md` setelah perilaku diimplementasikan.
- `docs/OPERATOR-RUNBOOK.md` untuk rollout, rollback, dan rekonsiliasi.
- Migrasi `0034_stock_feature_rollout.sql` dan helper `loadStockRolloutBranches` untuk pilot allowlist D1.

## 19. Tahapan Implementasi

### Fase 0 - Reproduksi Kontrak Lama

Pekerjaan:

- Tambah characterization test yang lulus dan membuktikan toggle localStorage tidak mengubah backend.
- Tambah characterization test yang lulus dan membuktikan void memakai flag produk saat ini.
- Tambah characterization test yang lulus dan membuktikan HPP dan deduction masih tergabung.
- Tambah desired-contract test terpisah yang gagal karena backend belum mengenal `ignored`, void belum memakai provenance, dan HPP belum terpisah.
- Catat baseline seluruh test terkait.

Exit criteria:

- Characterization test lulus dan mengunci perilaku lama.
- Desired-contract test gagal pada assertion fitur yang belum ada, bukan karena setup atau syntax.
- Tidak ada assertion lama yang diturunkan.
- Tidak ada production behavior berubah pada fase ini.

### Fase 1 - Domain Policy dan API

Pekerjaan:

- Buat tipe dan parser stock policy.
- Buat loader branch-scoped.
- Buat compare-and-swap writer.
- Buat tabel policy, transition, reconciliation, dan offline review.
- Buat database guard untuk policy revision saat checkout.
- Buat GET dan PUT API.
- Buat API job rekonsiliasi.
- Tambah auth, role, branch, CSRF, audit, dan realtime.
- Tambah service client typed.

Exit criteria:

- Missing config menghasilkan `tracked` revision 0.
- Constraint database menolak row malformed; read defensif tetap fail-safe ke `tracked` dan observable.
- Kasir tidak dapat PUT.
- Pemilik cabang A tidak dapat mengubah cabang B.
- Konflik revision menghasilkan 409.
- Perubahan cabang A tidak memengaruhi cabang B walau memakai binding sama.

### Fase 2 - Migrasi Provenance dan Void

Pekerjaan:

- Tambah kolom additive.
- Update schema dan manifest.
- Simpan provenance pada transaksi baru.
- Terapkan deduction produk melalui trigger `produk_mutasi` agar ledger selalu aktual.
- Refactor void memakai jumlah aktual.
- Pertahankan fallback legacy terisolasi.
- Update archive dan restore.

Exit criteria:

- Fresh SQLite dan D1/workerd menerima migrasi.
- Transaksi baru dengan deduction `0` tidak menambah stok saat void.
- Transaksi baru dengan deduction positif mengembalikan jumlah tepat.
- Void idempotent tetap aman.
- Archive baru mempertahankan provenance.
- Archive lama tetap dapat dipulihkan.

### Fase 3 - Pemisahan HPP dan Inventaris Checkout

Pekerjaan:

- Tambah policy ke checkout context.
- Pisahkan costing dari inventory application.
- Pertahankan recipe validation dan HPP.
- Gate statement stok pada policy.
- Simpan policy mode dan revision.
- Perluas audit checkout.

Exit criteria:

- Seluruh baseline characterization mode tracked lulus tanpa perubahan expected value.
- `ignored` menjual produk stok nol tanpa mutasi stok.
- HPP mode `ignored` sama dengan HPP mode `tracked` untuk payload sama.
- Tidak ada `bahan_mutasi` POS pada `ignored`.
- Idempotency dan concurrency lulus.
- Trigger stok negatif tetap ada dan efektif pada `tracked`.

### Fase 4 - Catalog, POS, dan UI Pengaturan

Pekerjaan:

- Tambah policy optional ke catalog.
- Simpan state policy per cabang.
- Ganti toggle localStorage lama dengan toggle server.
- Buat modal dampak dan konflik revision.
- Hilangkan validasi dan indikator stok pada `ignored`.
- Tambah direct route guard.
- Tambah alur rekonsiliasi aktivasi.

Exit criteria:

- Kasir tidak melihat menu atau indikator stok pada `ignored`.
- Direct navigation tidak membuka stok harian.
- Pemilik selalu dapat menemukan master toggle.
- Policy berubah tanpa reload penuh saat realtime berhasil.
- Client stale tidak dapat mengubah keputusan checkout server.
- Rekonsiliasi mencakup tepat 100% snapshot produk tracked dan bahan aktif.
- Finalisasi gagal bila inventory fingerprint atau policy revision berubah.
- Mobile dan desktop berfungsi.
- Fokus keyboard, label switch, modal, dan screen reader state benar.

### Fase 5 - Dashboard, AI, Realtime, dan Offline

Pekerjaan:

- Gate widget dan query inventaris dashboard.
- Gate prompt dan shortcut stok AI.
- Hubungkan refresh policy realtime.
- Pastikan cache branch-scoped.
- Uji catalog lama dan queue lama.
- Tambah signed policy epoch pada catalog dan queue baru.
- Tambah quarantine serta resolusi owner untuk stale replay.

Exit criteria:

- AI tidak mengklaim saldo stok ketika `ignored`.
- Dashboard tidak menampilkan data inventaris stale sebagai current.
- Queue lama pada cabang tanpa transition history tetap replay.
- Queue ambigu setelah transition masuk quarantine tanpa kehilangan payload lokal.
- Receipt offline tetap sama.
- Replay stale ke mode tracked selalu quarantine sampai pemilik memilih apply-current atau after-recount.
- Kegagalan realtime tidak membatalkan commit.

### Fase 6 - Dokumentasi, Rollout, dan Release Gate

Pekerjaan:

- Update README dan developer guide.
- Update operator runbook.
- Dokumentasikan re-enable dan rekonsiliasi.
- Jalankan seluruh gate lokal.
- Pilot satu cabang.
- Verifikasi observability dan rollback procedure.

Exit criteria:

- Seluruh kriteria penerimaan terpenuhi.
- Bukti test tercatat.
- Tidak ada scope creep tanpa catatan.
- Rilis memakai artifact dan SHA yang terverifikasi.

## 20. Test Matrix Wajib

### 20.1 Policy dan Akses

| ID     | Skenario                                      | Hasil yang Diharapkan                                  |
| ------ | --------------------------------------------- | ------------------------------------------------------ |
| SP-001 | Config tidak ada                              | `tracked`, revision 0                                  |
| SP-002 | Row malformed lewat SQL langsung              | Constraint menolak; defensive read observable          |
| SP-003 | Kasir GET                                     | 200                                                    |
| SP-004 | Kasir PUT                                     | 403                                                    |
| SP-005 | Pemilik PUT valid                             | 200 dan revision naik satu                             |
| SP-006 | Revision stale                                | 409, data tidak berubah                                |
| SP-007 | Cabang A mencoba cabang B                     | 403                                                    |
| SP-008 | Cabang A ignored, B tracked pada binding sama | Policy dan checkout tetap terisolasi                   |
| SP-009 | Admin GET/PUT                                 | 403 eksplisit                                          |
| SP-010 | Dua insert dari revision 0                    | Satu sukses, satu 409                                  |
| SP-011 | Same-mode dengan revision current             | 200 no-op, revision/timestamp tetap                    |
| SP-012 | Lost-response retry revision lama             | 409 lalu GET current                                   |
| SP-013 | Aktivasi lewat PUT biasa                      | 409                                                    |
| SP-014 | Job coverage kurang/lebih                     | Finalisasi 409, saldo tetap                            |
| SP-015 | Inventory berubah selama job                  | Fingerprint conflict 409                               |
| SP-016 | Finalisasi valid                              | Saldo dan policy commit atomik                         |
| SP-017 | PATCH bahan membawa stok saat ignored         | 409, row tidak berubah                                 |
| SP-018 | POST bahan stok nonzero saat ignored          | 409, row tidak dibuat                                  |
| SP-019 | Product save mengubah stok saat ignored       | 409, hidden field tetap                                |
| SP-020 | POST bahan-mutasi saat ignored                | 409, stok dan ledger bahan tetap                       |
| SP-021 | Product create saat ignored                   | Stok 0 dan `lacak_stok=false`                          |
| SP-022 | Product update `lacak_stok` saat ignored      | 409, flag tetap                                        |
| SP-023 | Product stock edit saat tracked               | Tepat satu `produk_mutasi` manual dan satu delta saldo |
| SP-024 | Bahan create positif saat tracked             | Tepat satu `bahan_mutasi` manual                       |
| SP-025 | Bahan PATCH stok saat tracked                 | Tepat satu delta ledger, saldo exact                   |
| SP-026 | POST bahan-mutasi saat tracked                | Tepat satu update dan satu ledger                      |
| SP-027 | Product create positif saat tracked           | Tepat satu `produk_mutasi` manual                      |
| SP-028 | Metadata-only product/bahan update            | Nol mutation ledger baru                               |
| SP-029 | Create bahan costing-only saat ignored        | 200, stok 0, data biaya tersimpan                      |
| SP-030 | Update harga/yield bahan saat ignored         | 200, costing berubah, stok tetap                       |
| SP-031 | Update metadata produk saat ignored           | 200, metadata berubah, hidden stock tetap              |
| SP-032 | CRUD resep dan `lacak_bahan` saat ignored     | 200, HPP baru terhitung, nol mutasi stok               |

### 20.2 Checkout

| ID     | Mode    | Skenario                                             | Hasil yang Diharapkan                                      |
| ------ | ------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| SC-001 | tracked | Produk langsung cukup                                | Sale commit, stok berkurang sekali                         |
| SC-002 | tracked | Produk langsung kurang                               | 409, tidak ada mutasi finansial                            |
| SC-003 | ignored | Produk stok nol                                      | Sale commit, stok tetap                                    |
| SC-004 | tracked | Resep cukup                                          | HPP dan mutasi bahan tepat                                 |
| SC-005 | tracked | Resep kurang                                         | 409 atomik                                                 |
| SC-006 | ignored | Bahan nol                                            | Sale commit, HPP tetap, bahan tetap                        |
| SC-007 | ignored | Tambahan memakai bahan                               | HPP tambahan tetap, tanpa mutasi                           |
| SC-008 | kedua   | Item kustom                                          | Tidak ada efek stok                                        |
| SC-009 | tracked | Produk punya dua tracking flag                       | Deduct produk `jumlah` dan bahan sesuai resep tepat sekali |
| SC-010 | ignored | Statement builder menerima map terisi                | Tetap tidak membuat SQL stok                               |
| SC-011 | tracked | Produk dihapus sebelum batch                         | Batch abort, nol buku kas/summary                          |
| SC-012 | tracked | `lacak_stok` true saat load lalu false sebelum batch | Trigger ledger abort, nol buku kas/summary                 |

### 20.3 Idempotency dan Concurrency

| ID     | Skenario                                   | Hasil yang Diharapkan                                        |
| ------ | ------------------------------------------ | ------------------------------------------------------------ |
| SI-001 | Retry key sama setelah mode berubah        | Satu sale, receipt lama dikembalikan                         |
| SI-002 | Key sama fingerprint berbeda               | 409, tanpa mutasi baru                                       |
| SI-003 | Dua checkout tracked berebut stok terakhir | Maksimum satu sukses                                         |
| SI-004 | Dua checkout ignored                       | Keduanya boleh sukses, stok tetap                            |
| SI-005 | Toggle menang race sebelum checkout        | Checkout 412 policy conflict, nol efek                       |
| SI-006 | Checkout menang race sebelum toggle        | Checkout commit utuh, toggle berikutnya commit revision baru |

### 20.4 Void

| ID     | Skenario                               | Hasil yang Diharapkan                     |
| ------ | -------------------------------------- | ----------------------------------------- |
| SV-001 | Sale tracked lalu void saat tracked    | Restore jumlah aktual                     |
| SV-002 | Sale tracked lalu void saat ignored    | Restore jumlah aktual transaksi           |
| SV-003 | Sale ignored lalu void saat ignored    | Tidak ada stok bertambah                  |
| SV-004 | Sale ignored lalu void setelah tracked | Tidak ada stok bertambah                  |
| SV-005 | Void dipanggil dua kali                | Efek maksimum sekali                      |
| SV-006 | Transaksi legacy                       | Fallback lama, audit menandai legacy      |
| SV-007 | Ingredient mutation tersedia           | Restore dari ledger aktual                |
| SV-008 | Product mutation tersedia              | Restore dari ledger aktual tepat sekali   |
| SV-009 | Transaksi hasil archive restore        | Void finansial tanpa perubahan inventaris |
| SV-010 | Delta void partial atau berlebih       | Trigger abort, saldo dan ledger tetap     |

### 20.5 UI dan Navigasi

| ID     | Skenario                           | Hasil yang Diharapkan                                   |
| ------ | ---------------------------------- | ------------------------------------------------------- |
| SU-001 | Kasir tracked                      | Menu stok dan indikator tampil                          |
| SU-002 | Kasir ignored                      | Menu stok dan indikator hilang                          |
| SU-003 | Kasir membuka `/stok` saat ignored | Tidak mendapat halaman stok                             |
| SU-004 | Pemilik ignored                    | Master toggle tetap terlihat                            |
| SU-005 | Pemilik aktivasi ulang             | Rekonsiliasi dan konfirmasi wajib                       |
| SU-006 | Policy berubah realtime            | UI efektif berubah tanpa kebocoran cabang               |
| SU-007 | Realtime gagal                     | Reload membaca policy benar dari server                 |
| SU-008 | Mobile                             | Navbar tidak meninggalkan slot kosong atau layout rusak |
| SU-009 | Keyboard dan screen reader         | Switch dan modal dapat dioperasikan                     |

### 20.6 Offline, AI, Laporan, dan Archive

| ID      | Skenario                                        | Hasil yang Diharapkan                                            |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| SX-001  | Catalog lama tanpa policy                       | Fallback tracked                                                 |
| SX-002  | Queue lama, belum ada transition                | Replay tracked dan tetap idempotent                              |
| SX-003  | Queue stale, current ignored                    | Commit tanpa inventaris, disposition tercatat                    |
| SX-004  | Receipt offline                                 | Tidak berubah                                                    |
| SX-005  | Replay stale sebelum cutoff                     | Quarantine; after-recount approval commit tanpa double deduction |
| SX-006  | Replay stale setelah cutoff                     | 428 review required, queue lokal tetap                           |
| SX-007  | Queue legacy setelah transition                 | Quarantine, bukan asumsi mode                                    |
| SX-007A | Dua approval CAS bersamaan                      | Satu sukses, satu 409                                            |
| SX-007B | Dua replay memakai satu approval                | Satu commit, satu idempotent result, consumed sekali             |
| SX-007C | Review attached lalu job finalize               | Approval after-recount dibuat atomik bersama job                 |
| SX-007D | Job finalize dengan approved-current unconsumed | 409, policy dan saldo tetap                                      |
| SX-007E | Withdraw approval lalu attach ke job            | Dua transisi CAS, revision naik dua, tidak ada overwrite         |
| SX-007F | Cancel job dengan review attached               | Review kembali pending dalam transaksi cancel                    |
| SX-007G | Withdraw approved-after-recount                 | 409, status dan job tetap immutable                              |
| SX-007H | Replay approved-after saat current tracked      | Commit finansial, nol ledger produk/bahan                        |
| SX-008  | AI ignored                                      | Gateway call count 0 untuk inventory intent                      |
| SX-009  | Dashboard ignored                               | Query inventory call count 0 dan widget tidak dirender           |
| SX-010  | HPP kedua mode                                  | Fixture nominal HPP exact sama                                   |
| SX-011  | Pajak kedua mode                                | Fixture nominal pajak exact sama                                 |
| SX-012  | Archive v3 restore                              | Policy provenance dipertahankan; ledger hanya audit snapshot     |
| SX-013  | Archive v1/v2 restore                           | Kompatibel dengan provenance NULL                                |
| SX-014  | Archive v3 mode/revision/delta malformed        | Preflight menolak sebelum apply                                  |
| SX-015  | Restore transaksi ignored lalu void             | Tidak menambah stok                                              |
| SX-016  | Restore policy historis beda dari current       | Insert lolos via marker restore, tanpa mutasi inventaris         |
| SX-017  | Restore transaksi dengan void marker            | Permanent void-replay guard menolak resurrection                 |

## 21. Kriteria Penerimaan Produk

Fitur dianggap sesuai hanya jika seluruh kondisi berikut benar:

### AC-01 Menonaktifkan Stok

Given pemilik berada pada cabang mode `tracked`, when pemilik menonaktifkan monitoring dan konfirmasi berhasil, then cabang berubah ke `ignored`, data stok lama tetap ada, dan seluruh UI stok harian hilang.

### AC-02 Penjualan Tanpa Stok

Given cabang mode `ignored` dan saldo produk atau bahan nol, when kasir menyelesaikan transaksi valid, then transaksi berhasil, receipt tercipta, buku kas bertambah, HPP tercatat, dan tidak ada saldo stok atau mutasi bahan berubah.

### AC-03 Perilaku Lama Tetap Aman

Given fixture stok produk 5, resep bahan 10 gram per item, saldo bahan 100 gram, dan quantity 2 pada mode `tracked`, when checkout commit, then stok produk menjadi 3, bahan menjadi 80 gram, satu sale tercatat, dan checkout quantity 6 terhadap stok produk 5 menghasilkan 409 dengan nol efek finansial.

### AC-04 HPP Tidak Hilang

Given produk memiliki resep, when payload sama dihitung pada kedua mode, then nominal HPP sama walau hanya mode `tracked` menerapkan inventaris.

### AC-05 Isolasi Cabang

Given dua cabang memakai binding D1 sama, when cabang A memakai `ignored` dan cabang B memakai `tracked`, then transaksi dan UI masing-masing cabang mengikuti policy sendiri tanpa kebocoran.

### AC-06 Void Aman

Given transaksi commit pada mode `ignored`, when transaksi di-void setelah mode berubah ke `tracked`, then stok tidak bertambah karena transaksi asli tidak menguranginya.

### AC-07 Idempotency Aman

Given transaksi sudah commit, when request sama diulang setelah policy berubah, then hanya satu transaksi dan maksimum satu efek inventaris ada.

### AC-08 Aktivasi Ulang Aman

Given cabang pernah memakai `ignored`, when pemilik mencoba mengaktifkan lewat PUT biasa atau job dengan coverage kurang dari 100%, then server menolak 409 dan saldo tetap. When job valid difinalisasi, then seluruh saldo hasil hitung fisik dan policy `tracked` commit atomik dengan satu cutoff.

### AC-09 Offline Kompatibel

Given perangkat memiliki antrean lama pada cabang tanpa transition history, when aplikasi diperbarui, then replay tetap memakai idempotency asli. Given replay stale melewati transition dan tidak dapat dibuktikan aman, then request masuk quarantine, mengembalikan HTTP 428, dan queue lokal tidak dihapus.

### AC-10 Informasi Tidak Menyesatkan

Given cabang mode `ignored`, when dashboard dimuat, then tidak ada query inventory dan tidak ada widget metrik stok dirender. When inventory intent dikirim ke AI, then `aiGateway` tidak dipanggil dan respons paused deterministik dikembalikan.

### AC-11 Urutan Atomik

Given checkout dan toggle memakai revision sama serta dijalankan bersamaan, when salah satu commit lebih dahulu, then operasi lain commit utuh sebelum transisi atau gagal HTTP 412 policy conflict; tidak ada transaksi dengan header, inventaris, dan policy campuran.

## 22. Gate Verifikasi

Perintah minimum sebelum merge:

```powershell
rtk pnpm check
rtk pnpm lint
rtk pnpm test:unit
rtk pnpm test:operations
rtk pnpm build
rtk pnpm test:e2e:all
rtk pnpm deploy:check
rtk git diff --check
```

Gate tambahan wajib:

- Test policy baru masuk rantai `test:unit`.
- Test handler positif dan negatif role, branch, CSRF, malformed body, serta CAS.
- Test SQLite fresh migration.
- Test D1/workerd dengan `--d1` untuk trigger dan batch atomik.
- Test concurrency stok terakhir.
- Test race policy-toggle versus checkout dengan database guard aktual.
- Test idempotency lintas perubahan mode.
- Test offline queue backward compatibility.
- Test signed epoch, cutoff rekonsiliasi, quarantine, dan approval sekali pakai.
- Test archive restore v1/v2 dan versi baru.
- Test mapping HTTP 412 policy conflict dan HTTP 428 review required.
- E2E desktop dan mobile untuk nav, checkout, toggle, dan re-enable.
- Diff review untuk secret, scope creep, dan query tanpa `cabang_id`.

Kriteria gate:

- Semua perintah exit code 0.
- Typecheck menghasilkan 0 error dan 0 warning.
- Tidak ada test skip baru.
- Tidak ada retry buta.
- Tidak ada assertion diturunkan.
- Tidak ada `any` baru.
- Tidak ada `catch {}` kosong baru.
- Tidak ada error user-facing berbahasa selain Indonesia.
- Tidak ada query tenant baru tanpa predicate cabang.
- Tidak ada perubahan uang memakai float mentah di luar util kanonikal.

## 23. UAT Manual

### UAT A - Cabang Tanpa Stok

1. Login pemilik pada cabang pilot.
2. Pastikan antrean perangkat kosong.
3. Nonaktifkan monitoring stok.
4. Login kasir cabang sama.
5. Pastikan item Stok hilang.
6. Pastikan produk stok nol tetap dapat dipilih.
7. Checkout tunai.
8. Pastikan struk benar.
9. Pastikan buku kas dan riwayat benar.
10. Pastikan stok produk dan bahan tidak berubah.
11. Pastikan tidak ada mutasi bahan POS.
12. Pastikan HPP transaksi tetap ada.

### UAT B - Isolasi Cabang

1. Atur cabang A `ignored`.
2. Biarkan cabang B `tracked`.
3. Jalankan transaksi produk stok nol pada kedua cabang.
4. Pastikan cabang A sukses tanpa mutasi.
5. Pastikan cabang B ditolak.
6. Pastikan perubahan UI cabang A tidak muncul pada cabang B.

### UAT C - Void

1. Buat transaksi pada `ignored`.
2. Aktifkan kembali setelah rekonsiliasi.
3. Void transaksi tersebut.
4. Pastikan stok tidak bertambah.
5. Buat transaksi baru pada `tracked`.
6. Void transaksi baru.
7. Pastikan stok kembali tepat satu kali.

### UAT D - Offline

1. Warm-up PWA saat online.
2. Pastikan policy catalog tersimpan.
3. Putus koneksi.
4. Buat transaksi tunai offline.
5. Ubah policy di perangkat pemilik lain.
6. Sambungkan koneksi.
7. Pastikan replay aman commit sesuai tabel disposition atau masuk quarantine.
8. Untuk quarantine, pastikan queue lokal tetap ada.
9. Selesaikan review sebagai pemilik.
10. Pastikan replay satu kali dan approval tidak dapat dipakai ulang.
11. Pastikan receipt lokal dan committed receipt konsisten.

### UAT E - Aktivasi Ulang

1. Cabang berada pada `ignored` setelah beberapa penjualan.
2. Tekan aktifkan kembali.
3. Pastikan peringatan saldo basi muncul.
4. Pastikan aktivasi langsung tanpa job ditolak.
5. Buat job dan isi sebagian item; pastikan finalisasi ditolak.
6. Lengkapi hitung fisik seluruh snapshot.
7. Selesaikan seluruh offline review.
8. Finalisasi job.
9. Pastikan saldo, cutoff, transition history, dan policy commit bersama.
10. Pastikan monitoring, navbar, dan alert aktif kembali.

## 24. Rollout Produksi

Urutan rollout:

1. Backup seluruh shard D1 dan verifikasi manifest.
2. Terapkan migrasi additive pada setiap binding secara manual.
3. Verifikasi schema dan trigger setiap binding.
4. Deploy kode dengan default virtual `tracked`, lalu isi allowlist pilot via SQL per shard (tanpa redeploy): `UPDATE stock_feature_rollout SET branches = '<cabang-pilot>' WHERE feature = 'stock_monitoring'`.
5. Jangan langsung menonaktifkan cabang mana pun.
6. Warm-up perangkat POS agar catalog baru tersimpan.
7. Minta acknowledgement perangkat terdaftar; antrean yang tidak dapat dibuktikan kosong diperlakukan sebagai potensi quarantine.
8. Pilot mode `ignored` pada satu cabang.
9. Jalankan UAT A sampai E.
10. Pantau audit, error, HPP, dan mutasi stok.
11. Perluas allowlist hanya setelah kriteria pilot lulus.

Tidak ada seed massal `ignored`. Perubahan harus eksplisit per cabang oleh pemilik.

Kriteria pilot lulus:

- Berjalan minimum satu hari operasional penuh dan minimum 25 transaksi, gunakan batas yang tercapai paling akhir.
- Nol mutasi `produk.stok` dan `bahan_mutasi` sumber POS untuk transaksi `ignored`.
- Nol policy-related HTTP 500.
- Nol selisih HPP terhadap fixture dan sample transaksi yang diperiksa.
- Seluruh quarantine diketahui statusnya; tidak ada review hilang.
- UAT A sampai E ditandatangani pemilik cabang pilot dan technical owner.
- Go/no-go perlu persetujuan kedua pihak tersebut.

## 25. Rollback

Rollback kode lama berbahaya ketika ada cabang `ignored`, karena aplikasi lama tidak membaca policy dan akan kembali mencoba mengurangi stok.

Sebelum rollback aplikasi:

1. Hentikan perubahan mode.
2. Cabut semua cabang dari rollout allowlist agar tidak ada perubahan baru.
3. Sinkronkan perangkat yang dapat dijangkau dan selesaikan seluruh server quarantine.
4. Identifikasi cabang `ignored`.
5. Rekonsiliasi saldo cabang tersebut.
6. Ubah semua cabang menjadi `tracked` memakai versi aplikasi baru.
7. Verifikasi checkout dan void.
8. Baru rollback artifact aplikasi.

Migrasi additive tidak perlu dihapus saat rollback. Kolom baru boleh tetap ada. Jangan memakai migrasi destruktif untuk menghapus provenance.

Jika seluruh queue perangkat tidak dapat dibuktikan aman, transition history atau quarantine belum selesai, atau aplikasi baru tidak dapat menyelesaikan rekonsiliasi, rollback ke aplikasi lama dilarang. Gunakan forward fix karena aplikasi lama tidak memahami policy maupun provenance baru.

## 26. Risiko dan Mitigasi

| Risiko                               | Dampak                                    | Mitigasi                                            |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------- |
| Toggle hanya bekerja di UI           | Server tetap menolak atau mengurangi stok | Server policy wajib dibaca checkout                 |
| HPP ikut mati                        | Laba salah                                | Pisahkan costing dan inventory mutation             |
| Void menambah stok palsu             | Saldo rusak                               | Restore hanya dari `produk_mutasi` aktual           |
| Provenance positif tetapi update nol | Void menggelembungkan stok                | Trigger abort bila produk hilang/untracked          |
| Config bocor lintas cabang           | Tenant breach                             | `BranchContext` dan predicate `cabang_id`           |
| Checkout memakai revision stale      | Efek campuran setelah toggle              | Trigger header policy dan 412 atomic                |
| Config stale di browser              | UI berbeda dari server                    | Server authoritative, realtime hanya refresh        |
| Offline replay melewati rekonsiliasi | Double deduction atau deduction hilang    | Signed epoch, cutoff, quarantine, owner resolution  |
| Re-enable memakai saldo lama         | Alert dan keputusan stok salah            | Job rekonsiliasi exact coverage                     |
| AI memakai data stale                | Saran menyesatkan                         | Gate report data dan deterministic paused response  |
| Rollback ke app lama                 | Deductions aktif tanpa disadari           | Rollout allowlist dan kondisi forward-fix-only      |
| Legacy void ambigu                   | Restore historis tidak pasti              | Fallback lama terisolasi dan diaudit                |
| Dua update policy bersamaan          | Lost update                               | CAS revision                                        |
| Policy malformed                     | Perlindungan mati diam-diam               | DB constraint, fail-safe `tracked`, operator repair |

## 27. Definition of Done

Fitur hanya dianggap selesai jika semua item berikut terpenuhi:

### Kontrak

- [ ] Mode `tracked` dan `ignored` diterapkan sesuai dokumen.
- [ ] Tujuan dan non-tujuan tidak berubah tanpa keputusan tertulis.
- [ ] Default cabang lama terbukti `tracked`.
- [ ] HPP terbukti independen dari mutasi inventaris.

### Backend

- [ ] Policy kanonikal branch-scoped tersedia.
- [ ] GET dan PUT memiliki auth, role, CSRF, branch validation, dan CAS.
- [ ] Admin ditolak eksplisit sesuai keputusan role.
- [ ] Checkout membaca policy server.
- [ ] Trigger database mencegah checkout revision stale commit.
- [ ] Mode `ignored` tidak menghasilkan statement mutasi stok.
- [ ] Idempotency tetap satu mutasi maksimum.
- [ ] Concurrency stok terakhir teruji.
- [ ] Audit dan realtime best-effort tidak membatalkan commit.

### Data

- [ ] Migrasi additive ditinjau.
- [ ] Provenance mode dan deduction tersimpan.
- [ ] Provenance positif hanya dapat commit bersama deduction aktual.
- [ ] Void transaksi baru memakai efek aktual.
- [ ] Fallback legacy terdokumentasi dan teruji.
- [ ] Archive dan restore mempertahankan provenance.
- [ ] Tidak ada penghapusan atau reset data saat toggle berubah.
- [ ] Rekonsiliasi exact coverage dan finalisasi atomik tersedia.
- [ ] Archive schema v3 dan validasi field baru tersedia.

### Frontend

- [ ] Master toggle selalu dapat ditemukan pemilik.
- [ ] Kasir tidak melihat stok saat `ignored`.
- [ ] Direct route stok dijaga.
- [ ] POS tidak memblokir item berdasarkan stok saat `ignored`.
- [ ] Dashboard dan AI tidak memberi klaim stok stale.
- [ ] Layout desktop dan mobile benar.
- [ ] Aksesibilitas switch, modal, fokus, dan label lulus.

### Offline dan Realtime

- [ ] Catalog lama tetap kompatibel.
- [ ] Queue lama tetap kompatibel.
- [ ] Replay tetap idempotent.
- [ ] Signed epoch dan quarantine owner mencegah replay stale otomatis setelah rekonsiliasi.
- [ ] Replay ambigu masuk quarantine dan tidak hilang dari IndexedDB.
- [ ] Review approval memakai CAS state machine dan dikonsumsi atomik tepat sekali.
- [ ] State policy tidak bocor lintas cabang.
- [ ] Realtime sukses memperbarui UI.
- [ ] Realtime gagal tidak merusak transaksi atau konfigurasi.

### Verifikasi

- [ ] Test positif, negatif, failure path, branch, role, CSRF, CAS tersedia.
- [ ] Test stok produk, bahan, tambahan, HPP, void, archive, dan offline tersedia.
- [ ] Seluruh test matrix wajib lulus.
- [ ] Seluruh gate lokal exit code 0.
- [ ] `git diff --check` bersih.
- [ ] Diff direview untuk secret dan scope creep.
- [ ] Tidak ada test skip, assertion lemah, atau retry buta baru.

### Operasional

- [ ] README, developer guide, dan runbook diperbarui.
- [ ] Backup dan rollback procedure diverifikasi.
- [ ] Rollout allowlist mencegah aktivasi di luar cabang pilot.
- [ ] Pilot memenuhi satu hari operasional, minimum 25 transaksi, dan seluruh threshold nol-error.
- [ ] Bukti UAT dicatat.
- [ ] CI remote hijau pada SHA yang sama.
- [ ] Artifact rilis terverifikasi.

## 28. Kriteria Lolos Final

Rilis dinyatakan lolos hanya jika:

1. Semua acceptance criteria AC-01 sampai AC-11 terbukti.
2. Semua test wajib SP, SC, SI, SV, SU, dan SX lulus.
3. Fixture tracked menghasilkan saldo, HPP, error insufficient, dan atomic rollback exact sesuai AC-03.
4. Query membuktikan setiap transaksi `ignored` memiliki nol `produk_mutasi` dan nol `bahan_mutasi` sumber POS.
5. Fixture payload sama menghasilkan nominal HPP exact sama pada kedua mode.
6. Void tidak pernah menambah stok yang tidak pernah dikurangi.
7. Isolasi dua cabang dalam binding sama terbukti.
8. Queue/catalog lama tanpa transition replay; queue ambigu setelah transition terjaga dalam quarantine.
9. Seluruh gate verifikasi exit code 0.
10. Pilot memenuhi seluruh angka pada bagian 24 dan mendapat dua persetujuan go/no-go.

Jika satu butir gagal, fitur belum selesai dan tidak boleh diaktifkan pada cabang produksi lain.
