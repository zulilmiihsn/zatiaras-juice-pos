-- Gate pilot pemantauan stok sudah tidak dibaca aplikasi (kebijakan stok diatur pemilik
-- di /pengaturan/pemilik/stok untuk semua cabang). Tabel ini tinggal sisa; isinya hanya satu
-- baris seed 'stock_monitoring'.
DROP TABLE IF EXISTS `stock_feature_rollout`;
