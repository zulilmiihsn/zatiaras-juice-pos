# ZatiarasPOS — Developer Guide

Panduan teknis dan referensi domain arsitektur untuk tim pengembang (termasuk junior engineer).

---

## 1. Domain Glossary (Istilah Bisnis)

| Istilah                               | Definisi                                                                                                                                                                         |
| :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cabang (`cabang_id`)**              | Unit operasional fisik independen (contoh: `samarinda`, `balikpapan`, `berau`). Seluruh data transaksi, kas, stok, dan gambar diisolasi per cabang.                              |
| **Bahan (`bahan`)**                   | Komponen mentah inventaris (contoh: gula, teh, cup, sedotan).                                                                                                                    |
| **Yield (`yield_persen`)**            | Persentase bahan mentah yang dapat digunakan secara efektif ($0 < \text{yield} \le 100\%$). Digunakan untuk menghitung HPP efektif.                                              |
| **HPP (`biaya_per_satuan`)**          | Harga Pokok Penjualan efektif = $\frac{\text{Harga Beli}}{\text{Jumlah Usable}}$, presisi 4 desimal.                                                                             |
| **Resep (`resep_produk`)**            | Komposisi bahan baku per varian porsi (`biasa`, `jumbo`) untuk satu produk.                                                                                                      |
| **Idempotency Key**                   | Kunci unik `(cabang_id, idempotency_key)` untuk memastikan 1 transaksi penjualan POS hanya dicatat 1 kali di ledger kas dan inventaris.                                          |
| **Receipt Snapshot**                  | Snapshot struk permanen (`buku_kas.receipt_snapshot`) yang dibentuk sekali saat transaksi berhasil, menjamin struk cetak ulang tidak berubah bila harga katalog kemudian diedit. |
| **Omzet Usaha (`omzetUsaha`)**        | Total omzet bruto operasional (penjualan POS + kas masuk kategori `pendapatan_usaha`). Menjadi dasar pengenaan PPh Final UMKM 0.5% (PP 55/2022).                                 |
| **Ambang Batas PPh (Threshold 500M)** | Fasilitas pembebasan pajak untuk omzet kumulatif tahunan $\le$ Rp 500 Juta per cabang.                                                                                           |
| **Outbox Log / Queue**                | Pola resilience untuk audit log & sinkronisasi offline (D1 outbox / IndexedDB queue).                                                                                            |

---

## 2. Alur Dependensi Arsitektur (Dependency Flow)

```text
Svelte Page / Component (UI)
   │
   ▼
Typed Store / Orchestrator ($lib/stores/*.svelte.ts)
   │
   ▼
Typed Client Service ($lib/services/*.ts)
   │
   ▼ (HTTP Fetch / CSRF Token)
API Route Boundary Validation (src/routes/api/*/+server.ts)
   │
   ▼
Domain Utilities & Helpers ($lib/utils/* & $lib/server/*)
   │
   ▼
Cloudflare Adapters (D1 via Drizzle, R2 Object Storage, Durable Objects Realtime)
```

---

## 3. Peta Alur Kritis (Critical Flow Maps)

### A. Alur Checkout POS (Kasir)

1. **Penyusunan Pesanan**: `posCart.svelte.ts` menghitung total item & opsi (biasa/jumbo/tambahan).
2. **Pembayaran (`/pos/bayar`)**: `bayarState.svelte.ts` memilih metode bayar & mengisi nominal uang tunai.
3. **Kirim Transaksi (`POST /api/pos/transaction`)**:
   - Validasi runtime `body.mode` (`'online'` atau `'offline_replay'`).
   - Cek `(cabang_id, idempotency_key)`: jika sudah ada, kembalikan `receipt_snapshot` lama tanpa mutasi ulang stok.
   - Deduksi stok bahan sesuai resep produk secara atomik.
   - Catat jurnal kas masuk di `buku_kas` & simpan `receipt_snapshot`.
   - Update agregat harian di `ringkasan_kas_harian`.
4. **Cetak & Tampilan Struk**: Menggunakan `committedReceipt` yang diarsip permanen.

### B. Alur Transaksi Offline & Replay

1. **Deteksi Offline**: Saat offline, transaksi disimpan ke IndexedDB `pending-transactions`.
2. **Snapshot Struk Offline**: `bayarState.svelte.ts` membuat `committedReceipt` lokal sebelum cart dibersihkan.
3. **Replay Sinkronisasi**: Saat koneksi kembali, `offlineSync.ts` memutar ulang request dengan `mode: 'offline_replay'` dan `idempotency_key` asli.

### C. Alur Manajemen Menu & Resep

1. **Input Data**: Pemilik memasukkan nama produk, harga, kategori, dan resep bahan baku.
2. **Ekstraksi ID**: Menyimpan produk dan resep terhubung dengan `result?.data?.[0]?.id || result?.id`.
3. **Mutasi Stok Realtime**: Perubahan menu/bahan memicu broadcast event via `realtimeManager.ts`.

### D. Alur Pengarsipan Data (Archive)

1. **Preview**: `GET /api/archive` mengkalkulasi jumlah baris di bawah cutoff tanggal (WITA UTC+8).
2. **Eksekusi Snapshot**: Serialisasi transaksi terpilih ke format JSON unik di Cloudflare R2 (`arsip/<branch>/<year>/<uuid>.json`).
3. **Batch Deletion Anti-TOCTOU**: Menghapus baris dari D1 aktif hanya untuk exact ID yang telah terverifikasi tersimpan di snapshot R2 (chunked per 50 item).
4. **Restore**: Menggunakan script CLI [scripts/restore-archive.mjs](file:///d:/Projects/zatiaraspos/scripts/restore-archive.mjs).

---

## 4. Entry Point & Lokasi Uji (Test Entry Points)

| Kategori Pengujian                 | Perintah               | File Skrip Utama                                 |
| :--------------------------------- | :--------------------- | :----------------------------------------------- |
| **Tipe Data & Diagnostik Svelte**  | `pnpm check`           | `svelte-check`                                   |
| **Formatting & Linting**           | `pnpm lint`            | `.prettierrc`, `eslint.config.js`                |
| **Unit & Hardening Test**          | `pnpm test:unit`       | `src/tests/*-tests.ts`                           |
| **Kalkulasi Yield & HPP**          | `pnpm test:yield`      | `src/tests/ingredient-yield-tests.ts`            |
| **Kalkulasi Pajak PP 55/2022**     | `pnpm test:tax`        | `src/tests/tax-calculation-tests.ts`             |
| **Operasi D1 Backup & UAT Safety** | `pnpm test:operations` | `scripts/d1-backup.test.mjs`                     |
| **Playwright Browser E2E**         | `pnpm test:e2e:pos`    | `e2e/pos.spec.ts`                                |
| **Verifikasi Menyeluruh Kualitas** | `pnpm test:quality`    | `src/tests/code-quality-tests.ts`                |
| **Production Build**               | `pnpm build`           | `vite.config.ts`, `@sveltejs/adapter-cloudflare` |

---

## 5. Jebakan Umum Pengembang (Common Developer Traps)

1. ⚠️ **Jangan gunakan `(window as any).__refreshXxx`**: Gunakan `refreshBus` dari `$lib/utils/refreshBus`.
2. ⚠️ **Jangan panggil `unsubscribeAll()` pada lifecyle komponen**: `realtimeManager.subscribe(table, cb)` mengembalikan fungsi `dispose()`. Panggil `dispose()` pada `onDestroy` / `$effect` teardown.
3. ⚠️ **Jangan hitung pajak dari laba kotor**: Sesuai PP 55/2022, PPh Final UMKM dihitung dari `omzetUsaha` (bruto) setelah memperhitungkan threshold Rp 500 Juta kumulatif tahunan.
4. ⚠️ **Jangan gunakan `result.id` secara naif**: Respon mutation D1 dari backend membungkus data dalam array; selalu gunakan helper `result?.data?.[0]?.id || result?.id`.
5. ⚠️ **Jangan hardcode URL upload R2**: Selalu gunakan namespace per cabang (`produk/<branch>/<uuid>.<ext>`) agar tidak terjadi konflik lintas cabang.
