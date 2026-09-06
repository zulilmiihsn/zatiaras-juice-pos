/**
 * Seeding data menu resmi Zatiaras Juice cabang Samarinda
 * Sumber: [ZATIARAS] Daftar Menu, 18_06_2026.pdf & [ZATIARAS] SOP Porsi, 18_06_2026.pdf
 *
 * Penggunaan:
 *   node scripts/seed-samarinda-menu.mjs          # Seed ke local D1
 *   node scripts/seed-samarinda-menu.mjs --remote # Seed ke remote production D1
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const isRemote = process.argv.includes('--remote');
const DB_NAME = 'zatiaras-samarinda-group';
const CABANG_ID = 'samarinda';

const categories = [
	{
		id: 'kat-smd-jus-buah',
		nama: 'Aneka Jus Buah dan Sayur',
		deskripsi: 'Jus buah dan sayur segar pilihan'
	},
	{
		id: 'kat-smd-jus-mix',
		nama: 'Aneka Jus Mix',
		deskripsi: 'Kombinasi campuran jus buah dan sayur'
	},
	{
		id: 'kat-smd-nonjus',
		nama: 'Aneka Nonjus',
		deskripsi: 'Minuman segar non-jus dan olahan susu'
	},
	{
		id: 'kat-smd-baby-cream',
		nama: 'Baby Cream',
		deskripsi: 'Minuman lembut baby cream series'
	},
	{
		id: 'kat-smd-menu-kocok',
		nama: 'Menu Kocok',
		deskripsi: 'Minuman kocok kental khas Zatiaras'
	},
	{
		id: 'kat-smd-camilan',
		nama: 'Camilan dan Pencuci Mulut',
		deskripsi: 'Snack, keripik, puding, dan pencuci mulut'
	}
];

const extras = [
	{ id: 'ext-keju', nama: 'Keju Parut', harga: 4000 },
	{ id: 'ext-milo', nama: 'Milo Bubuk', harga: 4000 },
	{ id: 'ext-madu', nama: 'Madu Murni', harga: 3000 },
	{ id: 'ext-skm', nama: 'Susu Kental Manis', harga: 2000 },
	{ id: 'ext-yogurt', nama: 'Yogurt', harga: 5000 },
	{ id: 'ext-ekstra-buah', nama: 'Ekstra Buah Potong', harga: 5000 },
	{ id: 'ext-ekstra-durian', nama: 'Ekstra Durian', harga: 10000 }
];

const standardJusExtras = JSON.stringify(['ext-madu', 'ext-skm', 'ext-yogurt', 'ext-ekstra-buah']);
const kocokExtras = JSON.stringify(['ext-keju', 'ext-milo', 'ext-skm', 'ext-ekstra-durian']);
const nonjusExtras = JSON.stringify(['ext-madu', 'ext-skm', 'ext-keju', 'ext-milo']);
const noExtras = JSON.stringify([]);

// 95 Produk Resmi Samarinda
const products = [
	// 1. Aneka Jus Buah dan Sayur (28 menu)
	{
		id: 'smd-alpukat',
		nama: 'Alpukat',
		harga: 22000,
		jumbo: 27000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-mangga',
		nama: 'Mangga',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-buah-naga',
		nama: 'Buah Naga',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-jeruk',
		nama: 'Jeruk',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-stroberi',
		nama: 'Stroberi',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-durian',
		nama: 'Durian',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-jambu-guava',
		nama: 'Jambu Guava',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-sirsak',
		nama: 'Sirsak',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-apel',
		nama: 'Apel',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-melon',
		nama: 'Melon',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-semangka',
		nama: 'Semangka',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-nanas',
		nama: 'Nanas',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pisang-cavendish',
		nama: 'Pisang Cavendish',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-wortel',
		nama: 'Wortel',
		harga: 12000,
		jumbo: 17000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-tomat',
		nama: 'Tomat',
		harga: 12000,
		jumbo: 17000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-timun',
		nama: 'Timun',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-bit-beetroot',
		nama: 'Bit / Beetroot',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pepaya',
		nama: 'Pepaya',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-mangga-kuini',
		nama: 'Mangga Kuini',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-anggur-merah',
		nama: 'Anggur Merah',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-anggur-hijau',
		nama: 'Anggur Hijau',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kurma',
		nama: 'Kurma',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pir',
		nama: 'Pir',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kiwi-hijau',
		nama: 'Kiwi Hijau',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kiwi-gold',
		nama: 'Kiwi Gold',
		harga: 30000,
		jumbo: 35000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-nangka',
		nama: 'Nangka',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-belimbing',
		nama: 'Belimbing',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kelapa',
		nama: 'Kelapa',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-buah',
		tipe: 'minuman',
		extras: standardJusExtras
	},

	// 2. Aneka Jus Mix (27 menu)
	{
		id: 'smd-alpukat-mix-durian',
		nama: 'Alpukat Mix Durian',
		harga: 30000,
		jumbo: 35000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-3-diva',
		nama: '3 Diva',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		deskripsi: 'Apel, tomat, wortel',
		extras: standardJusExtras
	},
	{
		id: 'smd-stroberi-mix-pisang',
		nama: 'Stroberi Mix Pisang',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-mangga-mix-buah-naga',
		nama: 'Mangga Mix Buah Naga',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-stroberi-mix-mangga',
		nama: 'Stroberi Mix Mangga',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-alpukat-mix-jeruk',
		nama: 'Alpukat Mix Jeruk',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-buah-naga-mix-sirsak',
		nama: 'Buah Naga Mix Sirsak',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-buah-naga-mix-jeruk',
		nama: 'Buah Naga Mix Jeruk',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-apel-mix-jambu-guava',
		nama: 'Apel Mix Jambu Guava',
		harga: 22000,
		jumbo: 27000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-stroberi-pisang-nanas',
		nama: 'Stroberi Pisang Nanas',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-stroberi-mix-pir',
		nama: 'Stroberi Mix Pir',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-apel-mix-nanas',
		nama: 'Apel Mix Nanas',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-apel-mix-nanas-yogurt',
		nama: 'Apel Mix Nanas Yogurt',
		harga: 27000,
		jumbo: 32000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kurma-mix-mangga',
		nama: 'Kurma Mix Mangga',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pisang-mix-milo',
		nama: 'Pisang Mix Milo',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pisang-mix-jeruk',
		nama: 'Pisang Mix Jeruk',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-kiwi-mix-jeruk',
		nama: 'Kiwi Mix Jeruk',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-jeruk-mix-wortel',
		nama: 'Jeruk Mix Wortel',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-wortel-mix-tomat',
		nama: 'Wortel Mix Tomat',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-bit-mix-apel',
		nama: 'Bit Mix Apel',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-bit-mix-nanas',
		nama: 'Bit Mix Nanas',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pakcoy-mix-nanas',
		nama: 'Pakcoy Mix Nanas',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pakcoy-nanas-apel',
		nama: 'Pakcoy Nanas Apel',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-apel-mix-selada',
		nama: 'Apel Mix Selada',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-pir-mix-timun',
		nama: 'Pir Mix Timun',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-timun-mix-pisang',
		nama: 'Timun Mix Pisang',
		harga: 15000,
		jumbo: 20000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},
	{
		id: 'smd-timun-kiwi-nanas',
		nama: 'Timun Kiwi Nanas',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-jus-mix',
		tipe: 'minuman',
		extras: standardJusExtras
	},

	// 3. Aneka Nonjus (14 menu)
	{
		id: 'smd-avocado-milky',
		nama: 'Avocado Milky',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-mango-milky',
		nama: 'Mango Milky',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-stroberi-milky',
		nama: 'Stroberi Milky',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-sop-buah',
		nama: 'Sop Buah',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-es-buah-jadul',
		nama: 'Es Buah Jadul',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-honey-lemon',
		nama: 'Honey Lemon',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-es-milo-malaysia',
		nama: 'Es Milo Malaysia',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-es-kacang-merah',
		nama: 'Es Kacang Merah',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-es-longan-leci',
		nama: 'Es Longan Leci',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-jeruk-peras',
		nama: 'Jeruk Peras',
		harga: 10000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-sunkist-peras',
		nama: 'Sunkist Peras',
		harga: 18000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-lemon-peras',
		nama: 'Lemon Peras',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-es-timun-serut',
		nama: 'Es Timun Serut',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},
	{
		id: 'smd-jeruk-nipis-peras',
		nama: 'Jeruk Nipis Peras',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-nonjus',
		tipe: 'minuman',
		extras: nonjusExtras
	},

	// 4. Baby Cream (5 menu)
	{
		id: 'smd-baby-avocado',
		nama: 'Baby Avocado',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-baby-cream',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-baby-mango',
		nama: 'Baby Mango',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-baby-cream',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-baby-dragon',
		nama: 'Baby Dragon',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-baby-cream',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-baby-stroberi',
		nama: 'Baby Stroberi',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-baby-cream',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-baby-milo',
		nama: 'Baby Milo',
		harga: 22000,
		jumbo: null,
		kat: 'kat-smd-baby-cream',
		tipe: 'minuman',
		extras: kocokExtras
	},

	// 5. Menu Kocok (6 menu)
	{
		id: 'smd-alpukat-mix-durian-kocok',
		nama: 'Alpukat Mix Durian Kocok',
		harga: 30000,
		jumbo: 35000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-durian-kocok',
		nama: 'Durian Kocok',
		harga: 30000,
		jumbo: 35000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-alpukat-kocok',
		nama: 'Alpukat Kocok',
		harga: 22000,
		jumbo: 27000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-mangga-kocok',
		nama: 'Mangga Kocok',
		harga: 25000,
		jumbo: 30000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-naga-kocok',
		nama: 'Naga Kocok',
		harga: 20000,
		jumbo: 25000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},
	{
		id: 'smd-pisang-kocok',
		nama: 'Pisang Kocok',
		harga: 18000,
		jumbo: 23000,
		kat: 'kat-smd-menu-kocok',
		tipe: 'minuman',
		extras: kocokExtras
	},

	// 6. Camilan dan Pencuci Mulut (15 menu)
	{
		id: 'smd-salad-buah',
		nama: 'Salad Buah',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-amplang',
		nama: 'Amplang',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-keripik-pisang-karamel',
		nama: 'Keripik Pisang Karamel',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-pisang-serut-gula-merah',
		nama: 'Pisang Serut Gula Merah',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-puding-buah-cup-besar',
		nama: 'Puding Buah Cup Besar',
		harga: 25000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-puding-buah-cup-sedang',
		nama: 'Puding Buah Cup Sedang',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-keripik-sukun-srikandi',
		nama: 'Keripik Sukun Srikandi',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-keripik-sukun-mbak-nur',
		nama: 'Keripik Sukun Mbak Nur',
		harga: 18000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-bakso-goreng-kriuk',
		nama: 'Bakso Goreng Kriuk',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-basreng-stik',
		nama: 'Basreng Stik',
		harga: 5000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-mi-lidi-moil-snack',
		nama: 'Mi Lidi Moil Snack',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-keripik-kaca-pecah',
		nama: 'Keripik Kaca Pecah',
		harga: 15000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-puding',
		nama: 'Puding',
		harga: 10000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-sanggar-rimpi-220g',
		nama: 'Sanggar Rimpi 220 gram',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	},
	{
		id: 'smd-asinan-kiamboy',
		nama: 'Asinan Kiamboy',
		harga: 20000,
		jumbo: null,
		kat: 'kat-smd-camilan',
		tipe: 'makanan',
		extras: noExtras
	}
];

function escapeSql(val) {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return val;
	if (typeof val === 'boolean') return val ? 1 : 0;
	return `'${String(val).replace(/'/g, "''")}'`;
}

function generateSql() {
	const lines = [];

	// Hapus produk dan kategori UAT dummy jika ada
	lines.push(`DELETE FROM produk WHERE id = 'uat-produk-es-teh' AND cabang_id = '${CABANG_ID}';`);
	lines.push(`DELETE FROM kategori WHERE id = 'uat-cat-minuman' AND cabang_id = '${CABANG_ID}';`);
	lines.push(
		`DELETE FROM resep_produk WHERE produk_id = 'uat-produk-es-teh' AND cabang_id = '${CABANG_ID}';`
	);

	// Insert Kategori
	for (const kat of categories) {
		lines.push(`INSERT INTO kategori (id, cabang_id, nama, deskripsi, is_active)
VALUES (${escapeSql(kat.id)}, '${CABANG_ID}', ${escapeSql(kat.nama)}, ${escapeSql(kat.deskripsi)}, 1)
ON CONFLICT (id) DO UPDATE SET
	nama = excluded.nama,
	deskripsi = excluded.deskripsi,
	is_active = 1,
	updated_at = CURRENT_TIMESTAMP;`);
	}

	// Insert Extras / Tambahan
	for (const ext of extras) {
		lines.push(`INSERT INTO tambahan (id, cabang_id, nama, harga, is_active)
VALUES (${escapeSql(ext.id)}, '${CABANG_ID}', ${escapeSql(ext.nama)}, ${ext.harga}, 1)
ON CONFLICT (id) DO UPDATE SET
	nama = excluded.nama,
	harga = excluded.harga,
	is_active = 1,
	updated_at = CURRENT_TIMESTAMP;`);
	}

	// Insert 95 Produk
	for (const prod of products) {
		lines.push(`INSERT INTO produk (id, cabang_id, nama, harga, harga_jumbo, kategori_id, tipe, deskripsi, ekstra_ids, is_active, lacak_stok, lacak_bahan)
VALUES (
	${escapeSql(prod.id)},
	'${CABANG_ID}',
	${escapeSql(prod.nama)},
	${prod.harga},
	${escapeSql(prod.jumbo)},
	${escapeSql(prod.kat)},
	${escapeSql(prod.tipe)},
	${escapeSql(prod.deskripsi || null)},
	${escapeSql(prod.extras)},
	1,
	0,
	0
)
ON CONFLICT (id) DO UPDATE SET
	nama = excluded.nama,
	harga = excluded.harga,
	harga_jumbo = excluded.harga_jumbo,
	kategori_id = excluded.kategori_id,
	tipe = excluded.tipe,
	deskripsi = excluded.deskripsi,
	ekstra_ids = excluded.ekstra_ids,
	is_active = 1,
	updated_at = CURRENT_TIMESTAMP;`);
	}

	return lines.join('\n');
}

async function main() {
	console.log(`Starting Samarinda menu seeding (Target: ${isRemote ? 'REMOTE' : 'LOCAL'})...`);
	console.log(
		`Categories: ${categories.length}, Extras: ${extras.length}, Products: ${products.length}`
	);

	const sqlContent = generateSql();
	const tempSqlFile = join(tmpdir(), `zatiaras-seed-smd-${randomUUID()}.sql`);
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

	console.log('Seed executed successfully!');
	console.log(proc.stdout?.slice(0, 500) || 'OK');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
