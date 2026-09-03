-- Rebuild POS daily summary tables from historical buku_kas/transaksi_kasir rows.
-- Run after 0004_ringkasan_penjualan_harian and 0005_transaction_snapshots are applied.

DELETE FROM ringkasan_penjualan_harian;
--> statement-breakpoint
INSERT INTO ringkasan_penjualan_harian (
	id,
	cabang_id,
	tanggal_penjualan,
	jumlah_transaksi,
	jumlah_item,
	penjualan_kotor,
	penjualan_tunai,
	penjualan_nontunai,
	created_at,
	updated_at
)
SELECT
	cabang_id || ':' || date(datetime(waktu, '+8 hours')) AS id,
	cabang_id,
	date(datetime(waktu, '+8 hours')) AS tanggal_penjualan,
	COUNT(DISTINCT transaction_id) AS jumlah_transaksi,
	COALESCE(SUM(jumlah), 0) AS jumlah_item,
	COALESCE(SUM(nominal), 0) AS penjualan_kotor,
	COALESCE(SUM(CASE WHEN metode_bayar = 'tunai' THEN nominal ELSE 0 END), 0) AS penjualan_tunai,
	COALESCE(SUM(CASE WHEN metode_bayar <> 'tunai' THEN nominal ELSE 0 END), 0) AS penjualan_nontunai,
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
FROM buku_kas
WHERE sumber = 'pos' AND tipe = 'in'
GROUP BY cabang_id, tanggal_penjualan;
--> statement-breakpoint
DELETE FROM penjualan_produk_harian;
--> statement-breakpoint
INSERT INTO penjualan_produk_harian (
	id,
	cabang_id,
	tanggal_penjualan,
	produk_id,
	nama_produk,
	jumlah,
	penjualan_kotor,
	jumlah_transaksi,
	created_at,
	updated_at
)
SELECT
	tk.cabang_id || ':' || date(datetime(bk.waktu, '+8 hours')) || ':' || tk.produk_id AS id,
	tk.cabang_id,
	date(datetime(bk.waktu, '+8 hours')) AS tanggal_penjualan,
	tk.produk_id,
	COALESCE(tk.nama_produk, p.nama, tk.nama_kustom, 'Item Custom') AS nama_produk,
	COALESCE(SUM(tk.jumlah), 0) AS jumlah,
	COALESCE(SUM(tk.nominal), 0) AS penjualan_kotor,
	COUNT(DISTINCT tk.transaction_id) AS jumlah_transaksi,
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
FROM transaksi_kasir tk
INNER JOIN buku_kas bk ON bk.cabang_id = tk.cabang_id AND bk.id = tk.buku_kas_id
LEFT JOIN produk p ON p.cabang_id = tk.cabang_id AND p.id = tk.produk_id
WHERE tk.produk_id IS NOT NULL AND bk.sumber = 'pos' AND bk.tipe = 'in'
GROUP BY tk.cabang_id, tanggal_penjualan, tk.produk_id;
