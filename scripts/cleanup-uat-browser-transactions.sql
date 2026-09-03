DELETE FROM transaksi_kasir
WHERE cabang_id = 'samarinda'
	AND transaction_id IN (
		SELECT transaction_id
		FROM buku_kas
		WHERE cabang_id = 'samarinda'
			AND nama_pelanggan = 'UAT Browser'
	);

DELETE FROM buku_kas
WHERE cabang_id = 'samarinda'
	AND nama_pelanggan = 'UAT Browser';
