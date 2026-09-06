/**
 * Seeding master data bahan baku dan resep (SOP Porsi) Zatiaras Juice cabang Samarinda
 * Sumber: [ZATIARAS] Daftar Menu, 18_06_2026.pdf & [ZATIARAS] SOP Porsi, 18_06_2026.pdf
 *
 * Menghubungkan seluruh 95 menu resmi Samarinda dan 7 extras ke resep bahan baku D1.
 *
 * Penggunaan:
 *   node scripts/seed-samarinda-recipes.mjs          # Seed ke local D1
 *   node scripts/seed-samarinda-recipes.mjs --remote # Seed ke remote production D1
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const isRemote = process.argv.includes('--remote');
const DB_NAME = 'zatiaras-samarinda-group';
const CABANG_ID = 'samarinda';

// Master Data Bahan Baku Samarinda
const ingredients = [
	// 1. Buah Segar & Frozen
	{ id: 'bhn-smd-alpukat', nama: 'Alpukat Frozen', satuan: 'gram', tipe_satuan: 'berat', isi: 500, satuan_beli: 'pack 500g', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 35 },
	{ id: 'bhn-smd-mangga', nama: 'Mangga Frozen', satuan: 'gram', tipe_satuan: 'berat', isi: 500, satuan_beli: 'pack 500g', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 30 },
	{ id: 'bhn-smd-buah-naga', nama: 'Buah Naga Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 25 },
	{ id: 'bhn-smd-jeruk-sunkist', nama: 'Jeruk Sunkist', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 5000 },
	{ id: 'bhn-smd-stroberi', nama: 'Stroberi Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'butir', kategori: 'Buah', stok: 1000, ambang: 50, biaya: 500 },
	{ id: 'bhn-smd-durian', nama: 'Durian Frozen', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'pack 1kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 70 },
	{ id: 'bhn-smd-jambu-guava', nama: 'Jambu Guava Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 18 },
	{ id: 'bhn-smd-sirsak', nama: 'Sirsak Frozen', satuan: 'gram', tipe_satuan: 'berat', isi: 500, satuan_beli: 'pack 500g', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 30 },
	{ id: 'bhn-smd-apel', nama: 'Apel Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 4000 },
	{ id: 'bhn-smd-melon', nama: 'Melon Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 15 },
	{ id: 'bhn-smd-semangka', nama: 'Semangka Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 10 },
	{ id: 'bhn-smd-nanas', nama: 'Nanas Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 12 },
	{ id: 'bhn-smd-pisang-cavendish', nama: 'Pisang Cavendish Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 2000 },
	{ id: 'bhn-smd-wortel', nama: 'Wortel Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 200, ambang: 20, biaya: 1000 },
	{ id: 'bhn-smd-tomat', nama: 'Tomat Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 200, ambang: 20, biaya: 1000 },
	{ id: 'bhn-smd-timun', nama: 'Timun Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 1500 },
	{ id: 'bhn-smd-bit-beetroot', nama: 'Bit / Beetroot Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 5000, ambang: 300, biaya: 35 },
	{ id: 'bhn-smd-pepaya', nama: 'Pepaya Segar', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'kg', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 10 },
	{ id: 'bhn-smd-mangga-kuini', nama: 'Mangga Kuini', satuan: 'gram', tipe_satuan: 'berat', isi: 500, satuan_beli: 'pack 500g', kategori: 'Buah', stok: 5000, ambang: 300, biaya: 35 },
	{ id: 'bhn-smd-anggur-merah', nama: 'Anggur Merah Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'butir', kategori: 'Buah', stok: 1000, ambang: 50, biaya: 400 },
	{ id: 'bhn-smd-anggur-hijau', nama: 'Anggur Hijau Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'butir', kategori: 'Buah', stok: 1000, ambang: 50, biaya: 400 },
	{ id: 'bhn-smd-kurma', nama: 'Kurma Manis', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'butir', kategori: 'Buah', stok: 500, ambang: 30, biaya: 800 },
	{ id: 'bhn-smd-pir', nama: 'Pir Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 4000 },
	{ id: 'bhn-smd-kiwi-hijau', nama: 'Kiwi Hijau', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 6000 },
	{ id: 'bhn-smd-kiwi-gold', nama: 'Kiwi Gold', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 7500 },
	{ id: 'bhn-smd-nangka', nama: 'Nangka Frozen', satuan: 'gram', tipe_satuan: 'berat', isi: 500, satuan_beli: 'pack 500g', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 30 },
	{ id: 'bhn-smd-belimbing', nama: 'Belimbing Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 2500 },
	{ id: 'bhn-smd-pakcoy', nama: 'Pakcoy Segar', satuan: 'lembar', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'lembar', kategori: 'Buah', stok: 200, ambang: 20, biaya: 300 },
	{ id: 'bhn-smd-jeruk-peras', nama: 'Jeruk Peras Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 500, ambang: 30, biaya: 1200 },
	{ id: 'bhn-smd-lemon', nama: 'Lemon Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 100, ambang: 10, biaya: 3500 },
	{ id: 'bhn-smd-jeruk-nipis', nama: 'Jeruk Nipis Segar', satuan: 'pcs', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'buah', kategori: 'Buah', stok: 200, ambang: 20, biaya: 1000 },
	{ id: 'bhn-smd-kelapa-muda', nama: 'Kelapa Muda (Daging & Air)', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'butir', kategori: 'Buah', stok: 10000, ambang: 500, biaya: 15 },

	// 2. Pemanis, Susu & Pelengkap Minuman
	{ id: 'bhn-smd-skm', nama: 'Susu Kental Manis (Putih)', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'pouch 1L', kategori: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 25 },
	{ id: 'bhn-smd-skm-cokelat', nama: 'Susu Kental Manis Cokelat', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'pouch 1L', kategori: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 25 },
	{ id: 'bhn-smd-gula-cair', nama: 'Gula Cair (Simple Syrup)', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'liter', kategori: 'Pemanis & Susu', stok: 30000, ambang: 2000, biaya: 15 },
	{ id: 'bhn-smd-gula-aren', nama: 'Gula Aren Cair', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'liter', kategori: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 35 },
	{ id: 'bhn-smd-madu', nama: 'Madu Murni Cair', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'liter', kategori: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 50 },
	{ id: 'bhn-smd-susu-uht', nama: 'Susu UHT Fresh Milk', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'karton 1L', kategori: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 20 },
	{ id: 'bhn-smd-santan', nama: 'Santan Matang', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'liter', kategori: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 25 },
	{ id: 'bhn-smd-yogurt', nama: 'Yogurt Plain', satuan: 'ml', tipe_satuan: 'volume', isi: 500, satuan_beli: 'cup 500ml', kategori: 'Pemanis & Susu', stok: 5000, ambang: 250, biaya: 40 },
	{ id: 'bhn-smd-keju', nama: 'Keju Cheddar Blok', satuan: 'gram', tipe_satuan: 'berat', isi: 2000, satuan_beli: 'blok 2kg', kategori: 'Pemanis & Susu', stok: 4000, ambang: 200, biaya: 60 },
	{ id: 'bhn-smd-krimer-base', nama: 'Cream Base / Krimer', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'liter', kategori: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 30 },
	{ id: 'bhn-smd-milo-bubuk', nama: 'Milo Bubuk', satuan: 'gram', tipe_satuan: 'berat', isi: 1000, satuan_beli: 'pack 1kg', kategori: 'Bubuk Minuman', stok: 5000, ambang: 300, biaya: 80 },
	{ id: 'bhn-smd-sirup-cocopandan', nama: 'Sirup Merah Cocopandan', satuan: 'ml', tipe_satuan: 'volume', isi: 1000, satuan_beli: 'botol 1L', kategori: 'Pemanis & Susu', stok: 5000, ambang: 300, biaya: 30 },

	// 3. Camilan, Snack & Kemasan Siap Saji
	{ id: 'bhn-smd-amplang', nama: 'Amplang Kuku Macan', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 12000 },
	{ id: 'bhn-smd-keripik-pisang-karamel', nama: 'Keripik Pisang Karamel', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 10000 },
	{ id: 'bhn-smd-pisang-serut-gula-merah', nama: 'Pisang Serut Gula Merah', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 10000 },
	{ id: 'bhn-smd-puding-cup-besar', nama: 'Puding Buah Cup Besar', satuan: 'cup', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'cup', kategori: 'Camilan', stok: 30, ambang: 5, biaya: 8000 },
	{ id: 'bhn-smd-puding-cup-sedang', nama: 'Puding Buah Cup Sedang', satuan: 'cup', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'cup', kategori: 'Camilan', stok: 30, ambang: 5, biaya: 6000 },
	{ id: 'bhn-smd-puding-reguler', nama: 'Puding Cup Reguler', satuan: 'cup', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'cup', kategori: 'Camilan', stok: 30, ambang: 5, biaya: 4000 },
	{ id: 'bhn-smd-keripik-sukun-srikandi', nama: 'Keripik Sukun Srikandi', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 12000 },
	{ id: 'bhn-smd-keripik-sukun-mbak-nur', nama: 'Keripik Sukun Mbak Nur', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 12000 },
	{ id: 'bhn-smd-bakso-goreng', nama: 'Bakso Goreng Kriuk', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 8000 },
	{ id: 'bhn-smd-basreng-stik', nama: 'Basreng Stik', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 8000 },
	{ id: 'bhn-smd-mi-lidi', nama: 'Mi Lidi Moil Snack', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 6000 },
	{ id: 'bhn-smd-keripik-kaca', nama: 'Keripik Kaca Pecah', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 50, ambang: 5, biaya: 7000 },
	{ id: 'bhn-smd-sanggar-rimpi', nama: 'Sanggar Rimpi 220g', satuan: 'pack', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'pack', kategori: 'Camilan', stok: 30, ambang: 5, biaya: 12000 },
	{ id: 'bhn-smd-asinan-kiamboy', nama: 'Asinan Kiamboy Cup', satuan: 'cup', tipe_satuan: 'jumlah', isi: 1, satuan_beli: 'cup', kategori: 'Camilan', stok: 30, ambang: 5, biaya: 10000 }
];

// Pemanis standar SOP Zatiaras
const sweetReg = [
	{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'sdm', jumlah_dasar: 30 },
	{ bahan_id: 'bhn-smd-gula-cair', jumlah: 50, satuan_resep: 'centong', jumlah_dasar: 50 }
];
const sweetJmb = [
	{ bahan_id: 'bhn-smd-skm', jumlah: 45, satuan_resep: 'sdm', jumlah_dasar: 45 },
	{ bahan_id: 'bhn-smd-gula-cair', jumlah: 75, satuan_resep: 'centong', jumlah_dasar: 75 }
];

// Resep 95 Produk Resmi Samarinda
const productRecipes = [
	// ─── 1. Aneka Jus Buah dan Sayur (28 menu) ───
	{
		id: 'smd-alpukat',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-alpukat', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-alpukat', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 }]
	},
	{
		id: 'smd-mangga',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-mangga', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-mangga', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 }]
	},
	{
		id: 'smd-buah-naga',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-buah-naga', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 250 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-buah-naga', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 375 }]
	},
	{
		id: 'smd-jeruk',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-jeruk-peras', jumlah: 5, satuan_resep: 'buah', jumlah_dasar: 5 }]
	},
	{
		id: 'smd-stroberi',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-stroberi', jumlah: 12, satuan_resep: 'buah', jumlah_dasar: 12 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-stroberi', jumlah: 22, satuan_resep: 'buah', jumlah_dasar: 22 }]
	},
	{
		id: 'smd-durian',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-durian', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-durian', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 }]
	},
	{
		id: 'smd-jambu-guava',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-jambu-guava', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 200 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-jambu-guava', jumlah: 6, satuan_resep: 'potong', jumlah_dasar: 300 }]
	},
	{
		id: 'smd-sirsak',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-sirsak', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 140 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-sirsak', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 210 }]
	},
	{
		id: 'smd-apel',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-apel', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-apel', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }]
	},
	{
		id: 'smd-melon',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-melon', jumlah: 6, satuan_resep: 'potong', jumlah_dasar: 150 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-melon', jumlah: 9, satuan_resep: 'potong', jumlah_dasar: 225 }]
	},
	{
		id: 'smd-semangka',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-semangka', jumlah: 5, satuan_resep: 'potong', jumlah_dasar: 175 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-semangka', jumlah: 8, satuan_resep: 'potong', jumlah_dasar: 280 }]
	},
	{
		id: 'smd-nanas',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-nanas', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 140 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-nanas', jumlah: 7, satuan_resep: 'potong', jumlah_dasar: 245 }]
	},
	{
		id: 'smd-pisang-cavendish',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1.25, satuan_resep: 'buah', jumlah_dasar: 1.25 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1.75, satuan_resep: 'buah', jumlah_dasar: 1.75 }]
	},
	{
		id: 'smd-wortel',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-wortel', jumlah: 3.5, satuan_resep: 'buah', jumlah_dasar: 3.5 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-wortel', jumlah: 5.5, satuan_resep: 'buah', jumlah_dasar: 5.5 }]
	},
	{
		id: 'smd-tomat',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-tomat', jumlah: 2.5, satuan_resep: 'buah', jumlah_dasar: 2.5 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-tomat', jumlah: 4.5, satuan_resep: 'buah', jumlah_dasar: 4.5 }]
	},
	{
		id: 'smd-timun',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-timun', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-timun', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }]
	},
	{
		id: 'smd-bit-beetroot',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 50 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 75 }]
	},
	{
		id: 'smd-pepaya',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-pepaya', jumlah: 6, satuan_resep: 'potong', jumlah_dasar: 180 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-pepaya', jumlah: 9, satuan_resep: 'potong', jumlah_dasar: 270 }]
	},
	{
		id: 'smd-mangga-kuini',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-mangga-kuini', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-mangga-kuini', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 }]
	},
	{
		id: 'smd-anggur-merah',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-anggur-merah', jumlah: 15, satuan_resep: 'buah', jumlah_dasar: 15 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-anggur-merah', jumlah: 25, satuan_resep: 'buah', jumlah_dasar: 25 }]
	},
	{
		id: 'smd-anggur-hijau',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-anggur-hijau', jumlah: 15, satuan_resep: 'buah', jumlah_dasar: 15 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-anggur-hijau', jumlah: 25, satuan_resep: 'buah', jumlah_dasar: 25 }]
	},
	{
		id: 'smd-kurma',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-kurma', jumlah: 7, satuan_resep: 'buah', jumlah_dasar: 7 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-kurma', jumlah: 10, satuan_resep: 'buah', jumlah_dasar: 10 }]
	},
	{
		id: 'smd-pir',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-pir', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-pir', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }]
	},
	{
		id: 'smd-kiwi-hijau',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }]
	},
	{
		id: 'smd-kiwi-gold',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-kiwi-gold', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-kiwi-gold', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }]
	},
	{
		id: 'smd-nangka',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-nangka', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-nangka', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 }]
	},
	{
		id: 'smd-belimbing',
		reguler: [...sweetReg, { bahan_id: 'bhn-smd-belimbing', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }],
		jumbo: [...sweetJmb, { bahan_id: 'bhn-smd-belimbing', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }]
	},
	{
		id: 'smd-kelapa',
		reguler: [
			{ bahan_id: 'bhn-smd-kelapa-muda', jumlah: 250, satuan_resep: 'gram', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 35, satuan_resep: 'ml', jumlah_dasar: 35 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-kelapa-muda', jumlah: 350, satuan_resep: 'gram', jumlah_dasar: 350 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 }
		]
	},

	// ─── 2. Aneka Jus Mix (27 menu) ───
	{
		id: 'smd-alpukat-mix-durian',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-durian', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 333.33 },
			{ bahan_id: 'bhn-smd-durian', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 }
		]
	},
	{
		id: 'smd-3-diva',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
			{ bahan_id: 'bhn-smd-wortel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-tomat', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-apel', jumlah: 1.2, satuan_resep: 'buah', jumlah_dasar: 1.2 },
			{ bahan_id: 'bhn-smd-wortel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-tomat', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }
		]
	},
	{
		id: 'smd-stroberi-mix-pisang',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 10, satuan_resep: 'buah', jumlah_dasar: 10 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 15, satuan_resep: 'buah', jumlah_dasar: 15 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }
		]
	},
	{
		id: 'smd-mangga-mix-buah-naga',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 125 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.25, satuan_resep: 'buah', jumlah_dasar: 125 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.25, satuan_resep: 'buah', jumlah_dasar: 125 }
		]
	},
	{
		id: 'smd-stroberi-mix-mangga',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 125 },
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 7, satuan_resep: 'buah', jumlah_dasar: 7 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 11, satuan_resep: 'buah', jumlah_dasar: 11 }
		]
	},
	{
		id: 'smd-alpukat-mix-jeruk',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 125 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 2.5, satuan_resep: 'potong', jumlah_dasar: 208.33 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }
		]
	},
	{
		id: 'smd-buah-naga-mix-sirsak',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-sirsak', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 105 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.25, satuan_resep: 'buah', jumlah_dasar: 125 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-sirsak', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 140 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.35, satuan_resep: 'buah', jumlah_dasar: 175 }
		]
	},
	{
		id: 'smd-buah-naga-mix-jeruk',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.25, satuan_resep: 'buah', jumlah_dasar: 125 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.35, satuan_resep: 'buah', jumlah_dasar: 175 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }
		]
	},
	{
		id: 'smd-apel-mix-jambu-guava',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
			{ bahan_id: 'bhn-smd-jambu-guava', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 100 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-apel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-jambu-guava', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 200 }
		]
	},
	{
		id: 'smd-stroberi-pisang-nanas',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 5, satuan_resep: 'buah', jumlah_dasar: 5 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 70 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 10, satuan_resep: 'buah', jumlah_dasar: 10 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 105 }
		]
	},
	{
		id: 'smd-stroberi-mix-pir',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 7, satuan_resep: 'buah', jumlah_dasar: 7 },
			{ bahan_id: 'bhn-smd-pir', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 11, satuan_resep: 'buah', jumlah_dasar: 11 },
			{ bahan_id: 'bhn-smd-pir', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 }
		]
	},
	{
		id: 'smd-apel-mix-nanas',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 70 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-apel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 140 }
		]
	},
	{
		id: 'smd-apel-mix-nanas-yogurt',
		reguler: [
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 70 },
			{ bahan_id: 'bhn-smd-yogurt', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 105 },
			{ bahan_id: 'bhn-smd-yogurt', jumlah: 75, satuan_resep: 'ml', jumlah_dasar: 75 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		]
	},
	{
		id: 'smd-kurma-mix-mangga',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 125 },
			{ bahan_id: 'bhn-smd-kurma', jumlah: 4, satuan_resep: 'buah', jumlah_dasar: 4 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-mangga', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-kurma', jumlah: 6, satuan_resep: 'buah', jumlah_dasar: 6 }
		]
	},
	{
		id: 'smd-pisang-mix-milo',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-milo-bubuk', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-milo-bubuk', jumlah: 20, satuan_resep: 'gram', jumlah_dasar: 20 }
		]
	},
	{
		id: 'smd-pisang-mix-jeruk',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }
		]
	},
	{
		id: 'smd-kiwi-mix-jeruk',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }
		]
	},
	{
		id: 'smd-jeruk-mix-wortel',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-wortel', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 },
			{ bahan_id: 'bhn-smd-wortel', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 }
		]
	},
	{
		id: 'smd-wortel-mix-tomat',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-wortel', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-tomat', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-wortel', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 },
			{ bahan_id: 'bhn-smd-tomat', jumlah: 2.5, satuan_resep: 'buah', jumlah_dasar: 2.5 }
		]
	},
	{
		id: 'smd-bit-mix-apel',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 40 },
			{ bahan_id: 'bhn-smd-apel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 60 },
			{ bahan_id: 'bhn-smd-apel', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }
		]
	},
	{
		id: 'smd-bit-mix-nanas',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 40 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 105 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-bit-beetroot', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 60 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 5, satuan_resep: 'potong', jumlah_dasar: 175 }
		]
	},
	{
		id: 'smd-pakcoy-mix-nanas',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 2.5, satuan_resep: 'lembar', jumlah_dasar: 2.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 3.5, satuan_resep: 'potong', jumlah_dasar: 122.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 4.5, satuan_resep: 'lembar', jumlah_dasar: 4.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 6.5, satuan_resep: 'potong', jumlah_dasar: 227.5 }
		]
	},
	{
		id: 'smd-pakcoy-nanas-apel',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 2.5, satuan_resep: 'lembar', jumlah_dasar: 2.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 70 },
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 4.5, satuan_resep: 'lembar', jumlah_dasar: 4.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 140 },
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		]
	},
	{
		id: 'smd-apel-mix-selada',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-apel', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 3, satuan_resep: 'lembar', jumlah_dasar: 3 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-apel', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-pakcoy', jumlah: 5, satuan_resep: 'lembar', jumlah_dasar: 5 }
		]
	},
	{
		id: 'smd-pir-mix-timun',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-pir', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
			{ bahan_id: 'bhn-smd-timun', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-pir', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-timun', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 }
		]
	},
	{
		id: 'smd-timun-mix-pisang',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-timun', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-timun', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 }
		]
	},
	{
		id: 'smd-timun-kiwi-nanas',
		reguler: [
			...sweetReg,
			{ bahan_id: 'bhn-smd-timun', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 70 }
		],
		jumbo: [
			...sweetJmb,
			{ bahan_id: 'bhn-smd-timun', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-kiwi-hijau', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 4, satuan_resep: 'potong', jumlah_dasar: 140 }
		]
	},

	// ─── 3. Aneka Nonjus (14 menu) ───
	{
		id: 'smd-avocado-milky',
		reguler: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 180, satuan_resep: 'ml', jumlah_dasar: 180 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-mango-milky',
		reguler: [
			{ bahan_id: 'bhn-smd-mangga', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-mangga', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 180, satuan_resep: 'ml', jumlah_dasar: 180 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-stroberi-milky',
		reguler: [
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 7, satuan_resep: 'buah', jumlah_dasar: 7 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 12, satuan_resep: 'buah', jumlah_dasar: 12 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 180, satuan_resep: 'ml', jumlah_dasar: 180 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-sop-buah',
		reguler: [
			{ bahan_id: 'bhn-smd-melon', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-semangka', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.1, satuan_resep: 'buah', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 0.4, satuan_resep: 'potong', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-sirup-cocopandan', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-es-buah-jadul',
		reguler: [
			{ bahan_id: 'bhn-smd-pepaya', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 40 },
			{ bahan_id: 'bhn-smd-nanas', jumlah: 1.2, satuan_resep: 'potong', jumlah_dasar: 40 },
			{ bahan_id: 'bhn-smd-melon', jumlah: 1.5, satuan_resep: 'potong', jumlah_dasar: 40 },
			{ bahan_id: 'bhn-smd-sirup-cocopandan', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 25, satuan_resep: 'ml', jumlah_dasar: 25 }
		]
	},
	{
		id: 'smd-honey-lemon',
		reguler: [
			{ bahan_id: 'bhn-smd-lemon', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-madu', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-lemon', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-madu', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-es-milo-malaysia',
		reguler: [
			{ bahan_id: 'bhn-smd-milo-bubuk', jumlah: 25, satuan_resep: 'gram', jumlah_dasar: 25 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-milo-bubuk', jumlah: 35, satuan_resep: 'gram', jumlah_dasar: 35 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 150, satuan_resep: 'ml', jumlah_dasar: 150 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		]
	},
	{
		id: 'smd-es-kacang-merah',
		reguler: [
			{ bahan_id: 'bhn-smd-santan', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
			{ bahan_id: 'bhn-smd-gula-aren', jumlah: 35, satuan_resep: 'ml', jumlah_dasar: 35 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		]
	},
	{
		id: 'smd-es-longan-leci',
		reguler: [
			{ bahan_id: 'bhn-smd-sirup-cocopandan', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 },
			{ bahan_id: 'bhn-smd-kelapa-muda', jumlah: 40, satuan_resep: 'gram', jumlah_dasar: 40 }
		]
	},
	{
		id: 'smd-jeruk-peras',
		reguler: [
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 5, satuan_resep: 'buah', jumlah_dasar: 5 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 75, satuan_resep: 'ml', jumlah_dasar: 75 }
		]
	},
	{
		id: 'smd-sunkist-peras',
		reguler: [
			{ bahan_id: 'bhn-smd-jeruk-sunkist', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-jeruk-sunkist', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 }
		]
	},
	{
		id: 'smd-lemon-peras',
		reguler: [
			{ bahan_id: 'bhn-smd-lemon', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-lemon', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 75, satuan_resep: 'ml', jumlah_dasar: 75 }
		]
	},
	{
		id: 'smd-es-timun-serut',
		reguler: [
			{ bahan_id: 'bhn-smd-timun', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-timun', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-jeruk-peras', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 }
		]
	},
	{
		id: 'smd-jeruk-nipis-peras',
		reguler: [
			{ bahan_id: 'bhn-smd-jeruk-nipis', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-jeruk-nipis', jumlah: 3.5, satuan_resep: 'buah', jumlah_dasar: 3.5 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 65, satuan_resep: 'ml', jumlah_dasar: 65 }
		]
	},

	// ─── 4. Baby Cream (5 menu) ───
	{
		id: 'smd-baby-avocado',
		reguler: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
			{ bahan_id: 'bhn-smd-krimer-base', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 15, satuan_resep: 'ml', jumlah_dasar: 15 }
		]
	},
	{
		id: 'smd-baby-mango',
		reguler: [
			{ bahan_id: 'bhn-smd-mangga', jumlah: 0.5, satuan_resep: 'potong', jumlah_dasar: 41.67 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-krimer-base', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 15, satuan_resep: 'ml', jumlah_dasar: 15 }
		]
	},
	{
		id: 'smd-baby-dragon',
		reguler: [
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.15, satuan_resep: 'buah', jumlah_dasar: 75 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-krimer-base', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		]
	},
	{
		id: 'smd-baby-stroberi',
		reguler: [
			{ bahan_id: 'bhn-smd-stroberi', jumlah: 5, satuan_resep: 'buah', jumlah_dasar: 5 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-krimer-base', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
		]
	},
	{
		id: 'smd-baby-milo',
		reguler: [
			{ bahan_id: 'bhn-smd-milo-bubuk', jumlah: 20, satuan_resep: 'gram', jumlah_dasar: 20 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-krimer-base', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 15, satuan_resep: 'ml', jumlah_dasar: 15 }
		]
	},

	// ─── 5. Menu Kocok (6 menu) ───
	{
		id: 'smd-alpukat-mix-durian-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-durian', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-durian', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 83.33 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		]
	},
	{
		id: 'smd-durian-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-durian', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 80, satuan_resep: 'ml', jumlah_dasar: 80 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-durian', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		]
	},
	{
		id: 'smd-alpukat-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 35, satuan_resep: 'ml', jumlah_dasar: 35 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-alpukat', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 }
		]
	},
	{
		id: 'smd-mangga-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-mangga', jumlah: 2, satuan_resep: 'potong', jumlah_dasar: 166.67 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 80, satuan_resep: 'ml', jumlah_dasar: 80 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-mangga', jumlah: 3, satuan_resep: 'potong', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		]
	},
	{
		id: 'smd-naga-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 250 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 80, satuan_resep: 'ml', jumlah_dasar: 80 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 25, satuan_resep: 'ml', jumlah_dasar: 25 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 375 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 },
			{ bahan_id: 'bhn-smd-gula-cair', jumlah: 35, satuan_resep: 'ml', jumlah_dasar: 35 }
		]
	},
	{
		id: 'smd-pisang-kocok',
		reguler: [
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 2, satuan_resep: 'buah', jumlah_dasar: 2 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 80, satuan_resep: 'ml', jumlah_dasar: 80 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
		],
		jumbo: [
			{ bahan_id: 'bhn-smd-pisang-cavendish', jumlah: 3, satuan_resep: 'buah', jumlah_dasar: 3 },
			{ bahan_id: 'bhn-smd-susu-uht', jumlah: 120, satuan_resep: 'ml', jumlah_dasar: 120 },
			{ bahan_id: 'bhn-smd-skm-cokelat', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
		]
	},

	// ─── 6. Camilan dan Pencuci Mulut (15 menu) ───
	{
		id: 'smd-salad-buah',
		reguler: [
			{ bahan_id: 'bhn-smd-melon', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-semangka', jumlah: 1, satuan_resep: 'potong', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-buah-naga', jumlah: 0.1, satuan_resep: 'buah', jumlah_dasar: 30 },
			{ bahan_id: 'bhn-smd-apel', jumlah: 0.25, satuan_resep: 'buah', jumlah_dasar: 0.25 },
			{ bahan_id: 'bhn-smd-yogurt', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
			{ bahan_id: 'bhn-smd-keju', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 }
		]
	},
	{
		id: 'smd-amplang',
		reguler: [{ bahan_id: 'bhn-smd-amplang', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-keripik-pisang-karamel',
		reguler: [{ bahan_id: 'bhn-smd-keripik-pisang-karamel', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-pisang-serut-gula-merah',
		reguler: [{ bahan_id: 'bhn-smd-pisang-serut-gula-merah', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-puding-buah-cup-besar',
		reguler: [{ bahan_id: 'bhn-smd-puding-cup-besar', jumlah: 1, satuan_resep: 'cup', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-puding-buah-cup-sedang',
		reguler: [{ bahan_id: 'bhn-smd-puding-cup-sedang', jumlah: 1, satuan_resep: 'cup', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-keripik-sukun-srikandi',
		reguler: [{ bahan_id: 'bhn-smd-keripik-sukun-srikandi', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-keripik-sukun-mbak-nur',
		reguler: [{ bahan_id: 'bhn-smd-keripik-sukun-mbak-nur', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-bakso-goreng-kriuk',
		reguler: [{ bahan_id: 'bhn-smd-bakso-goreng', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-basreng-stik',
		reguler: [{ bahan_id: 'bhn-smd-basreng-stik', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-mi-lidi-moil-snack',
		reguler: [{ bahan_id: 'bhn-smd-mi-lidi', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-keripik-kaca-pecah',
		reguler: [{ bahan_id: 'bhn-smd-keripik-kaca', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-puding',
		reguler: [{ bahan_id: 'bhn-smd-puding-reguler', jumlah: 1, satuan_resep: 'cup', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-sanggar-rimpi-220g',
		reguler: [{ bahan_id: 'bhn-smd-sanggar-rimpi', jumlah: 1, satuan_resep: 'pack', jumlah_dasar: 1 }]
	},
	{
		id: 'smd-asinan-kiamboy',
		reguler: [{ bahan_id: 'bhn-smd-asinan-kiamboy', jumlah: 1, satuan_resep: 'cup', jumlah_dasar: 1 }]
	}
];

// Definisi Bahan untuk 7 Tambahan / Extras
const extrasMaterials = [
	{ id: 'ext-keju', bahan_id: 'bhn-smd-keju', jumlah: 20, satuan_resep: 'gram', jumlah_dasar: 20 },
	{ id: 'ext-milo', bahan_id: 'bhn-smd-milo-bubuk', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 },
	{ id: 'ext-madu', bahan_id: 'bhn-smd-madu', jumlah: 15, satuan_resep: 'ml', jumlah_dasar: 15 },
	{ id: 'ext-skm', bahan_id: 'bhn-smd-skm', jumlah: 15, satuan_resep: 'ml', jumlah_dasar: 15 },
	{ id: 'ext-yogurt', bahan_id: 'bhn-smd-yogurt', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
	{ id: 'ext-ekstra-buah', bahan_id: 'bhn-smd-melon', jumlah: 50, satuan_resep: 'gram', jumlah_dasar: 50 },
	{ id: 'ext-ekstra-durian', bahan_id: 'bhn-smd-durian', jumlah: 83.33, satuan_resep: 'gram', jumlah_dasar: 83.33 }
];

function escapeSql(val) {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return val;
	if (typeof val === 'boolean') return val ? 1 : 0;
	return `'${String(val).replace(/'/g, "''")}'`;
}

function generateSql() {
	const lines = [];

	// 1. Bersihkan resep lama cabang Samarinda secara total
	lines.push(`DELETE FROM resep_produk WHERE cabang_id = '${CABANG_ID}';`);

	// 2. Insert/Update Bahan Baku
	for (const b of ingredients) {
		lines.push(`INSERT INTO bahan (
	id, cabang_id, nama, satuan, tipe_satuan, isi_per_kemasan, satuan_beli,
	kategori, stok_saat_ini, ambang_stok, yield_persen, biaya_per_satuan,
	jumlah_beli_terakhir, biaya_beli_terakhir, is_active
) VALUES (
	${escapeSql(b.id)}, '${CABANG_ID}', ${escapeSql(b.nama)}, ${escapeSql(b.satuan)},
	${escapeSql(b.tipe_satuan)}, ${b.isi}, ${escapeSql(b.satuan_beli)}, ${escapeSql(b.kategori)},
	${b.stok}, ${b.ambang}, 100, ${b.biaya}, ${b.isi}, ${b.isi * b.biaya}, 1
)
ON CONFLICT (id) DO UPDATE SET
	nama = excluded.nama,
	satuan = excluded.satuan,
	tipe_satuan = excluded.tipe_satuan,
	isi_per_kemasan = excluded.isi_per_kemasan,
	satuan_beli = excluded.satuan_beli,
	kategori = excluded.kategori,
	biaya_per_satuan = excluded.biaya_per_satuan,
	is_active = 1,
	updated_at = CURRENT_TIMESTAMP;`);
	}

	// Hapus bahan lama yang tidak dipakai
	const ingredientIdsList = ingredients.map((b) => escapeSql(b.id)).join(', ');
	lines.push(`DELETE FROM bahan WHERE cabang_id = '${CABANG_ID}' AND id NOT IN (${ingredientIdsList});`);

	const productIdsList = productRecipes.map((p) => escapeSql(p.id)).join(', ');

	// 3. Masukkan resep produk
	for (const pr of productRecipes) {
		if (pr.reguler) {
			for (const r of pr.reguler) {
				const id = `rsp-${CABANG_ID}-${pr.id}-reg-${r.bahan_id.replace('bhn-smd-', '')}`;
				lines.push(`INSERT INTO resep_produk (
	id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item
) VALUES (
	${escapeSql(id)}, '${CABANG_ID}', ${escapeSql(pr.id)}, ${escapeSql(r.bahan_id)},
	'reguler', ${r.jumlah}, ${escapeSql(r.satuan_resep)}, ${r.jumlah_dasar}
);`);
			}
		}

		if (pr.jumbo) {
			for (const r of pr.jumbo) {
				const id = `rsp-${CABANG_ID}-${pr.id}-jmb-${r.bahan_id.replace('bhn-smd-', '')}`;
				lines.push(`INSERT INTO resep_produk (
	id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item
) VALUES (
	${escapeSql(id)}, '${CABANG_ID}', ${escapeSql(pr.id)}, ${escapeSql(r.bahan_id)},
	'jumbo', ${r.jumlah}, ${escapeSql(r.satuan_resep)}, ${r.jumlah_dasar}
);`);
			}
		}
	}

	// 4. Update Tambahan / Extras dengan bahan_id & konsumsi bahan
	for (const ext of extrasMaterials) {
		lines.push(`UPDATE tambahan
SET bahan_id = ${escapeSql(ext.bahan_id)},
    jumlah_bahan = ${ext.jumlah},
    satuan_resep = ${escapeSql(ext.satuan_resep)},
    jumlah_dasar_per_item = ${ext.jumlah_dasar},
    updated_at = CURRENT_TIMESTAMP
WHERE cabang_id = '${CABANG_ID}' AND id = ${escapeSql(ext.id)};`);
	}

	// 5. Aktifkan lacak_bahan = 1 pada 95 produk Samarinda
	lines.push(`UPDATE produk SET lacak_bahan = 1 WHERE cabang_id = '${CABANG_ID}' AND id IN (${productIdsList});`);

	return lines.join('\n');
}

async function main() {
	console.log(`Starting Samarinda recipe seeding (Target: ${isRemote ? 'REMOTE PRODUCTION' : 'LOCAL'})...`);
	console.log(`Ingredients: ${ingredients.length}, Product Recipes: ${productRecipes.length}, Extras Mappings: ${extrasMaterials.length}`);

	const sqlContent = generateSql();
	const tempSqlFile = join(tmpdir(), `zatiaras-seed-recipes-${randomUUID()}.sql`);
	writeFileSync(tempSqlFile, sqlContent, 'utf8');

	const targetArgs = isRemote
		? [DB_NAME, '--remote', `--file=${tempSqlFile}`, '--yes']
		: [
				'DB_SAMARINDA_GROUP',
				'--local',
				'--config=wrangler.pages.jsonc',
				`--file=${tempSqlFile}`,
				'--yes'
			];

	console.log(`Executing wrangler d1 execute...`);
	const proc = spawnSync('npx', ['wrangler', 'd1', 'execute', ...targetArgs], {
		stdio: 'pipe',
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});

	try {
		unlinkSync(tempSqlFile);
	} catch {}

	if (proc.status !== 0) {
		console.error('Error executing seed:');
		console.error(proc.stderr || proc.stdout);
		process.exit(1);
	}

	console.log('Recipe seed executed successfully!');
	console.log(proc.stdout?.slice(0, 500) || 'OK');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
