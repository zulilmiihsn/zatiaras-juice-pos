-- Backfill kolom penjualan_produk_harian.penjualan_tunai / penjualan_nontunai dari data lama.
--
-- Diperlukan sekali setelah migration 0008_daily_product_payment_split, supaya
-- rincian Pendapatan Usaha per produk (split QRIS/Tunai) di laporan periode lama
-- tetap akurat tanpa scan transaksi_kasir.
--
-- Split per produk per tanggal WITA berdasarkan metode_bayar buku_kas induk.
-- Idempoten: menulis ulang nilai (bukan increment), aman dijalankan berulang.
--
-- Jalankan per database cabang, mis:
--   npx wrangler d1 execute DB_SAMARINDA_GROUP --remote \
--     --config=wrangler.pages.jsonc --file=scripts/backfill-daily-product-split.sql

UPDATE penjualan_produk_harian
SET
	penjualan_tunai = COALESCE(
		(
			SELECT SUM(tk.nominal)
			FROM transaksi_kasir tk
			INNER JOIN buku_kas bk ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
			WHERE tk.cabang_id = penjualan_produk_harian.cabang_id
				AND tk.produk_id = penjualan_produk_harian.produk_id
				AND date(datetime(tk.created_at, '+8 hours')) = penjualan_produk_harian.tanggal_penjualan
				AND bk.metode_bayar = 'tunai'
		),
		0
	),
	penjualan_nontunai = COALESCE(
		(
			SELECT SUM(tk.nominal)
			FROM transaksi_kasir tk
			INNER JOIN buku_kas bk ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
			WHERE tk.cabang_id = penjualan_produk_harian.cabang_id
				AND tk.produk_id = penjualan_produk_harian.produk_id
				AND date(datetime(tk.created_at, '+8 hours')) = penjualan_produk_harian.tanggal_penjualan
				AND bk.metode_bayar != 'tunai'
		),
		0
	);
