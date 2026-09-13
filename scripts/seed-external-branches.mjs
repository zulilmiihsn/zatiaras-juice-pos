/**
 * Seed External Branches Catalog: Balikpapan 1, Balikpapan 2, and Berau.
 *
 * Targets:
 * - Balikpapan 1 ('balikpapan') & Balikpapan 2 ('balikpapan2') on DB_BALIKPAPAN_GROUP (zatiaras-balikpapan-group)
 * - Berau ('berau') on DB_BERAU_GROUP (zatiaras-berau-group)
 *
 * Requirements:
 * 1. Single Source of Truth (SSOT) for Jumbo Sizing:
 *    - Standard drinks: harga_jumbo = harga + 8,000
 *    - Premium drinks (Durian, Kurma, Baby Cream, Kiwi): harga_jumbo = harga + 10,000
 *    - Food/retail items: harga_jumbo = NULL
 *    - 'Ukuran Jumbo' stripped from 'ekstra_ids' and NOT inserted into 'tambahan'
 * 2. 7 official categories inserted per branch
 * 3. 18 blank-category items auto-assigned to appropriate categories
 * 4. 12 clean extras inserted into 'tambahan' with valid ingredient linkages
 * 5. 68 master ingredients ('bahan') cloned from Samarinda standard inventory
 * 6. SOP recipes ('resep_produk') generated for all 87 drinks (both reguler & jumbo portions)
 * 7. Default HPP settings ('pengaturan_hpp') initialized
 *
 * Usage:
 *   node scripts/seed-external-branches.mjs          # Local D1
 *   node scripts/seed-external-branches.mjs --remote # Remote Production D1
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const rawProducts = JSON.parse(
	readFileSync(new URL('./data/external-products.json', import.meta.url), 'utf8')
);

const isRemote = process.argv.includes('--remote');

// Helper to escape SQL values safely
function escapeSql(val) {
	if (val === null || val === undefined) return 'NULL';
	if (typeof val === 'number') return val;
	if (typeof val === 'boolean') return val ? 1 : 0;
	return `'${String(val).replace(/'/g, "''")}'`;
}

// 7 Master Categories
const baseCategories = [
	{
		id: '4bdba4e4-fb04-432b-95bc-d0d2c561fcab',
		nama: 'Aneka Jus Buah dan Sayur',
		deskripsi: 'Jus buah dan sayur segar pilihan'
	},
	{
		id: 'aeffa7d0-ab74-4511-a7dd-177e7409b431',
		nama: 'Aneka Jus Mix',
		deskripsi: 'Kombinasi campuran jus buah dan sayur'
	},
	{
		id: 'c50f807d-3d4a-4f9e-a75e-931f24805983',
		nama: 'Aneka Nonjus (Tea Series)',
		deskripsi: 'Minuman segar teh dan olahan buah'
	},
	{
		id: 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
		nama: 'Aneka Nonjus (Milky & Es)',
		deskripsi: 'Minuman segar olahan susu dan es segar'
	},
	{
		id: 'fc4e8dfe-d6bf-4888-b9e4-8e322aff5ad2',
		nama: 'Baby Cream',
		deskripsi: 'Minuman lembut baby cream series'
	},
	{
		id: 'e260ae70-a514-46dc-abe8-7590cd23254e',
		nama: 'Menu Kocok',
		deskripsi: 'Minuman kocok kental khas Zatiaras'
	},
	{
		id: '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
		nama: 'Camilan dan Pencuci Mulut',
		deskripsi: 'Snack, keripik, puding, dan makanan ringan'
	}
];

// 12 Clean Extras
const baseTambahan = [
	{ id: '47abf33e-c67f-43cb-9e31-4f1427c78f8e', nama: 'Susu UHT', harga: 5000, bahan_key: 'susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
	{ id: '70798fa5-7b2a-4a51-9920-61493e67e8e0', nama: 'Oatmilk', harga: 11000, bahan_key: 'oatmilk', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
	{ id: '8307d6d5-83fc-4af7-8e84-cf8016da9818', nama: 'Topping Keju', harga: 4000, bahan_key: 'keju', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 },
	{ id: '8b364415-80bf-4c82-8a17-1cf65e29c6a8', nama: 'Madu', harga: 10000, bahan_key: 'madu', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 },
	{ id: '90350ad8-5fb2-46e6-9216-8e783dd28bcf', nama: 'Topping oat', harga: 3000, bahan_key: 'oat', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 },
	{ id: 'c4560016-8b9c-4f05-8cea-58defbeeaae8', nama: 'Topping Cococrunch', harga: 4000, bahan_key: 'cococrunch', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 },
	{ id: 'c6c71c02-e4ee-41ef-9b7c-77cc5e6d8baf', nama: 'Yakult', harga: 6000, bahan_key: 'yakult', jumlah: 1, satuan_resep: 'botol', jumlah_dasar: 1 },
	{ id: 'cc9a3925-a8a1-46e4-aeef-5d72fd5280fc', nama: 'Topping Milo', harga: 4000, bahan_key: 'milo-bubuk', jumlah: 15, satuan_resep: 'gram', jumlah_dasar: 15 },
	{ id: 'ee0d3f49-3702-44c4-b0be-9ec7a2740316', nama: 'Yogurt', harga: 13000, bahan_key: 'yogurt', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
	{ id: 'f153654f-5d73-479d-8b88-0f2c657b7808', nama: 'Tropicana', harga: 4000, bahan_key: 'tropicana-slim', jumlah: 1, satuan_resep: 'sachet', jumlah_dasar: 1 },
	{ id: 'fd31f91e-be14-4d43-9f2d-be3e62313d9c', nama: 'Granola', harga: 8000, bahan_key: 'granola', jumlah: 20, satuan_resep: 'gram', jumlah_dasar: 20 },
	{ id: 'fdb09684-3e7b-466c-9249-ae66cd281f09', nama: 'Ciacide', harga: 10000, bahan_key: 'chia-seed', jumlah: 10, satuan_resep: 'gram', jumlah_dasar: 10 }
];

const JUMBO_EXTRA_ID = '2573669a-b068-4fe1-baeb-24f8f39c9caa';

// 18 Blank Category Product Mappings
const blankCategoryMapping = {
	'Jeruk peras': '4bdba4e4-fb04-432b-95bc-d0d2c561fcab',
	'Baby dragon': 'fc4e8dfe-d6bf-4888-b9e4-8e322aff5ad2',
	'Es buah jadul': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Es milo malaysia': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Es Longan leci': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Es timun serut': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Kacang merah': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Choco banana': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Orange milky': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Honey lemon': 'd236a91d-f420-4c50-beda-86a5d8bb1fc1',
	'Keripik usus': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Rujak bangkok': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Buah potong': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Manisan kiamboy': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Smoothies bowl mango': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Banofie fie': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Buah strawberry': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Salad buah': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd',
	'Blender': '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd'
};

const foodKeywords = [
	'keripik', 'salad', 'puding', 'lumpia', 'yogurt', 'buko', 'pisang coklat',
	'bumbu rujak', 'madu', 'blender', 'banofie', 'buah potong', 'buah strawberry',
	'manisan', 'smoothies bowl', 'bolu gulung', 'panada', 'bakwan', 'basreng',
	'jelangkote', 'asinan'
];

function isFoodItem(name, tipe) {
	if (tipe === 'makanan') return true;
	const lower = (name || '').toLowerCase();
	return foodKeywords.some((k) => lower.includes(k));
}

function isPremiumDrink(name) {
	const lower = (name || '').toLowerCase();
	return lower.includes('durian') || lower.includes('kurma') || lower.includes('kiwi') || lower.startsWith('baby');
}

function computeHargaJumbo(product) {
	if (isFoodItem(product.nama, product.tipe)) {
		return null;
	}
	if (isPremiumDrink(product.nama)) {
		return product.harga + 10000;
	}
	return product.harga + 8000;
}

// Master Ingredients (64 Samarinda Standard + 4 Topping Additions)
const masterIngredients = [
	{ key: 'alpukat', nama: 'Alpukat Frozen', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Buah', stok: 10000, ambang: 500, biaya: 35 },
	{ key: 'mangga', nama: 'Mangga Frozen', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Buah', stok: 10000, ambang: 500, biaya: 30 },
	{ key: 'buah-naga', nama: 'Buah Naga Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 25 },
	{ key: 'jeruk-peras', nama: 'Jeruk Peras Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 300, ambang: 30, biaya: 1500 },
	{ key: 'jeruk-sunkist', nama: 'Jeruk Sunkist', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 5000 },
	{ key: 'stroberi', nama: 'Stroberi Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'butir', kat: 'Buah', stok: 1000, ambang: 50, biaya: 500 },
	{ key: 'durian', nama: 'Durian Frozen', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'pack 1kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 70 },
	{ key: 'jambu-guava', nama: 'Jambu Guava Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 18 },
	{ key: 'sirsak', nama: 'Sirsak Frozen', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Buah', stok: 10000, ambang: 500, biaya: 30 },
	{ key: 'apel', nama: 'Apel Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 4000 },
	{ key: 'melon', nama: 'Melon Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 15 },
	{ key: 'semangka', nama: 'Semangka Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 10 },
	{ key: 'nanas', nama: 'Nanas Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 12 },
	{ key: 'pisang-cavendish', nama: 'Pisang Cavendish Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 2000 },
	{ key: 'tomat', nama: 'Tomat Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 200, ambang: 20, biaya: 1000 },
	{ key: 'wortel', nama: 'Wortel Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 15 },
	{ key: 'timun', nama: 'Timun Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 1500 },
	{ key: 'pakcoy', nama: 'Pakcoy Sayur Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'batang', kat: 'Buah', stok: 100, ambang: 10, biaya: 1000 },
	{ key: 'terong-belanda', nama: 'Terong Belanda Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 1500 },
	{ key: 'daging-kelapa', nama: 'Daging Kelapa Muda', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 5000, ambang: 300, biaya: 25 },
	{ key: 'kiwi-green', nama: 'Kiwi Green Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 7000 },
	{ key: 'pepaya', nama: 'Pepaya Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 10000, ambang: 500, biaya: 10 },
	{ key: 'mangga-kuini', nama: 'Mangga Kuini', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Buah', stok: 5000, ambang: 300, biaya: 35 },
	{ key: 'anggur-merah', nama: 'Anggur Merah Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'butir', kat: 'Buah', stok: 1000, ambang: 50, biaya: 400 },
	{ key: 'kurma', nama: 'Kurma Manis', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'butir', kat: 'Buah', stok: 500, ambang: 30, biaya: 800 },
	{ key: 'pir', nama: 'Pir Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 4000 },
	{ key: 'bit-beetroot', nama: 'Bit / Beetroot Segar', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Buah', stok: 5000, ambang: 300, biaya: 30 },
	{ key: 'nangka', nama: 'Nangka Manis Segar', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Buah', stok: 5000, ambang: 300, biaya: 25 },
	{ key: 'lemon-segar', nama: 'Lemon Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 3500 },
	{ key: 'belimbing', nama: 'Belimbing Segar', satuan: 'pcs', tipe: 'jumlah', isi: 1, beli: 'buah', kat: 'Buah', stok: 100, ambang: 10, biaya: 2500 },
	{ key: 'kacang-merah', nama: 'Kacang Merah Matang', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'kg', kat: 'Bahan Pokok', stok: 5000, ambang: 300, biaya: 25 },

	// Pemanis & Olahan Susu
	{ key: 'skm', nama: 'Susu Kental Manis (Putih)', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'pouch 1L', kat: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 25 },
	{ key: 'skm-cokelat', nama: 'Susu Kental Manis Cokelat', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'pouch 1L', kat: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 25 },
	{ key: 'gula-cair', nama: 'Gula Cair (Simple Syrup)', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 30000, ambang: 2000, biaya: 15 },
	{ key: 'gula-aren', nama: 'Gula Aren Cair', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 35 },
	{ key: 'madu', nama: 'Madu Murni Cair', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 50 },
	{ key: 'susu-uht', nama: 'Susu UHT Fresh Milk', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'karton 1L', kat: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 20 },
	{ key: 'santan', nama: 'Santan Matang', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 25 },
	{ key: 'yogurt', nama: 'Yogurt Plain', satuan: 'ml', tipe: 'volume', isi: 500, beli: 'cup 500ml', kat: 'Pemanis & Susu', stok: 5000, ambang: 250, biaya: 40 },
	{ key: 'keju', nama: 'Keju Cheddar Blok', satuan: 'gram', tipe: 'berat', isi: 2000, beli: 'blok 2kg', kat: 'Pemanis & Susu', stok: 4000, ambang: 200, biaya: 60 },
	{ key: 'krimer-base', nama: 'Cream Base / Krimer', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 30 },
	{ key: 'sirup-cocopandan', nama: 'Sirup Merah Cocopandan', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'botol 1L', kat: 'Pemanis & Susu', stok: 5000, ambang: 300, biaya: 30 },
	{ key: 'yakult', nama: 'Yakult Botol (65ml)', satuan: 'botol', tipe: 'jumlah', isi: 5, beli: 'pack 5 btl', kat: 'Pemanis & Susu', stok: 50, ambang: 10, biaya: 2500 },
	{ key: 'tropicana-slim', nama: 'Gula Tropicana Slim Sachet', satuan: 'sachet', tipe: 'jumlah', isi: 50, beli: 'box 50 sachet', kat: 'Pemanis & Susu', stok: 100, ambang: 20, biaya: 900 },
	{ key: 'teh-base', nama: 'Teh Seduh Base', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 20000, ambang: 1000, biaya: 10 },
	{ key: 'milo-bubuk', nama: 'Milo Bubuk', satuan: 'gram', tipe: 'berat', isi: 1000, beli: 'pack 1kg', kat: 'Bubuk Minuman', stok: 5000, ambang: 300, biaya: 80 },

	// Toppings & Extras
	{ key: 'cococrunch', nama: 'Koko Krunch Cereal', satuan: 'gram', tipe: 'berat', isi: 330, beli: 'pack 330g', kat: 'Topping', stok: 2000, ambang: 200, biaya: 100 },
	{ key: 'oreo', nama: 'Oreo Biskuit / Crumb', satuan: 'gram', tipe: 'berat', isi: 133, beli: 'pack 133g', kat: 'Topping', stok: 2000, ambang: 200, biaya: 68 },
	{ key: 'oatmilk', nama: 'Susu Oatmilk', satuan: 'ml', tipe: 'volume', isi: 1000, beli: 'liter', kat: 'Pemanis & Susu', stok: 10000, ambang: 500, biaya: 40 },
	{ key: 'oat', nama: 'Topping Rolled Oat', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Topping', stok: 2000, ambang: 200, biaya: 50 },
	{ key: 'granola', nama: 'Granola Topping', satuan: 'gram', tipe: 'berat', isi: 500, beli: 'pack 500g', kat: 'Topping', stok: 2000, ambang: 200, biaya: 90 },
	{ key: 'chia-seed', nama: 'Chia Seed Topping', satuan: 'gram', tipe: 'berat', isi: 250, beli: 'pack 250g', kat: 'Topping', stok: 1000, ambang: 100, biaya: 120 }
];

// Recipe generator for all 87 drinks
const fruitIngredients = {
	'alpukat': { key: 'alpukat', reg: 166.67, jmb: 250, unit: 'potong', base: 166.67, baseJmb: 250 },
	'mangga': { key: 'mangga', reg: 166.67, jmb: 250, unit: 'potong', base: 166.67, baseJmb: 250 },
	'naga': { key: 'buah-naga', reg: 0.5, jmb: 0.75, unit: 'buah', base: 250, baseJmb: 375 },
	'buahnaga': { key: 'buah-naga', reg: 0.5, jmb: 0.75, unit: 'buah', base: 250, baseJmb: 375 },
	'jeruk': { key: 'jeruk-peras', reg: 3, jmb: 5, unit: 'buah', base: 3, baseJmb: 5 },
	'jerukperas': { key: 'jeruk-peras', reg: 3, jmb: 5, unit: 'buah', base: 3, baseJmb: 5 },
	'stroberi': { key: 'stroberi', reg: 8, jmb: 12, unit: 'pcs', base: 8, baseJmb: 12 },
	'strawberry': { key: 'stroberi', reg: 8, jmb: 12, unit: 'pcs', base: 8, baseJmb: 12 },
	'durian': { key: 'durian', reg: 75, jmb: 120, unit: 'gram', base: 75, baseJmb: 120 },
	'jambu': { key: 'jambu-guava', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'jambubiji': { key: 'jambu-guava', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'sirsak': { key: 'sirsak', reg: 166.67, jmb: 250, unit: 'potong', base: 166.67, baseJmb: 250 },
	'apel': { key: 'apel', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'melon': { key: 'melon', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'semangka': { key: 'semangka', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'nanas': { key: 'nanas', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'pisang': { key: 'pisang-cavendish', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'tomat': { key: 'tomat', reg: 2, jmb: 3, unit: 'buah', base: 2, baseJmb: 3 },
	'wortel': { key: 'wortel', reg: 100, jmb: 150, unit: 'gram', base: 100, baseJmb: 150 },
	'timun': { key: 'timun', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'pakcoy': { key: 'pakcoy', reg: 2, jmb: 3, unit: 'buah', base: 2, baseJmb: 3 },
	'kiwi': { key: 'kiwi-green', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'pepaya': { key: 'pepaya', reg: 200, jmb: 300, unit: 'gram', base: 200, baseJmb: 300 },
	'kuini': { key: 'mangga-kuini', reg: 166.67, jmb: 250, unit: 'potong', base: 166.67, baseJmb: 250 },
	'manggakuini': { key: 'mangga-kuini', reg: 166.67, jmb: 250, unit: 'potong', base: 166.67, baseJmb: 250 },
	'anggur': { key: 'anggur-merah', reg: 10, jmb: 15, unit: 'butir', base: 10, baseJmb: 15 },
	'kurma': { key: 'kurma', reg: 5, jmb: 8, unit: 'butir', base: 5, baseJmb: 8 },
	'pir': { key: 'pir', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'pear': { key: 'pir', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'bit': { key: 'bit-beetroot', reg: 120, jmb: 180, unit: 'gram', base: 120, baseJmb: 180 },
	'nangka': { key: 'nangka', reg: 100, jmb: 150, unit: 'gram', base: 100, baseJmb: 150 },
	'lemon': { key: 'lemon-segar', reg: 1, jmb: 1.5, unit: 'buah', base: 1, baseJmb: 1.5 },
	'milo': { key: 'milo-bubuk', reg: 30, jmb: 45, unit: 'gram', base: 30, baseJmb: 45 }
};

function buildRecipeForDrink(productName) {
	const n = productName.toLowerCase().replace(/[^a-z0-9]/g, '');
	const sweetReg = [
		{ bahan_key: 'skm', jumlah: 30, satuan_resep: 'sdm', jumlah_dasar: 30 },
		{ bahan_key: 'gula-cair', jumlah: 50, satuan_resep: 'centong', jumlah_dasar: 50 }
	];
	const sweetJmb = [
		{ bahan_key: 'skm', jumlah: 45, satuan_resep: 'sdm', jumlah_dasar: 45 },
		{ bahan_key: 'gula-cair', jumlah: 75, satuan_resep: 'centong', jumlah_dasar: 75 }
	];

	if (n.endsWith('kocok')) {
		const fruitName = n.replace('kocok', '');
		const f = fruitIngredients[fruitName] || fruitIngredients['alpukat'];
		return {
			reguler: [
				{ bahan_key: f.key, jumlah: f.reg, satuan_resep: f.unit, jumlah_dasar: f.base },
				{ bahan_key: 'santan', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
				{ bahan_key: 'gula-aren', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'skm', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
			],
			jumbo: [
				{ bahan_key: f.key, jumlah: f.jmb, satuan_resep: f.unit, jumlah_dasar: f.baseJmb },
				{ bahan_key: 'santan', jumlah: 75, satuan_resep: 'ml', jumlah_dasar: 75 },
				{ bahan_key: 'gula-aren', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			]
		};
	}

	if (n.startsWith('baby')) {
		let fruitName = n.replace('baby', '');
		if (fruitName === 'dragon') fruitName = 'naga';
		const f = fruitIngredients[fruitName] || fruitIngredients['alpukat'];
		return {
			reguler: [
				{ bahan_key: f.key, jumlah: f.reg, satuan_resep: f.unit, jumlah_dasar: f.base },
				{ bahan_key: 'krimer-base', jumlah: 50, satuan_resep: 'ml', jumlah_dasar: 50 },
				{ bahan_key: 'susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 },
				{ bahan_key: 'skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: f.key, jumlah: f.jmb, satuan_resep: f.unit, jumlah_dasar: f.baseJmb },
				{ bahan_key: 'krimer-base', jumlah: 75, satuan_resep: 'ml', jumlah_dasar: 75 },
				{ bahan_key: 'susu-uht', jumlah: 150, satuan_resep: 'ml', jumlah_dasar: 150 },
				{ bahan_key: 'skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.endsWith('milky')) {
		const fruitName = n.replace('milky', '');
		const f = fruitIngredients[fruitName] || fruitIngredients['stroberi'];
		return {
			reguler: [
				{ bahan_key: f.key, jumlah: f.reg, satuan_resep: f.unit, jumlah_dasar: f.base },
				{ bahan_key: 'susu-uht', jumlah: 150, satuan_resep: 'ml', jumlah_dasar: 150 },
				{ bahan_key: 'skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: f.key, jumlah: f.jmb, satuan_resep: f.unit, jumlah_dasar: f.baseJmb },
				{ bahan_key: 'susu-uht', jumlah: 200, satuan_resep: 'ml', jumlah_dasar: 200 },
				{ bahan_key: 'skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.endsWith('tea')) {
		return {
			reguler: [
				{ bahan_key: 'teh-base', jumlah: 200, satuan_resep: 'ml', jumlah_dasar: 200 },
				{ bahan_key: 'gula-cair', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 }
			],
			jumbo: [
				{ bahan_key: 'teh-base', jumlah: 300, satuan_resep: 'ml', jumlah_dasar: 300 },
				{ bahan_key: 'gula-cair', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 }
			]
		};
	}

	if (n.includes('sopbuah') || n.includes('esbuah')) {
		return {
			reguler: [
				{ bahan_key: 'melon', jumlah: 40, satuan_resep: 'gram', jumlah_dasar: 40 },
				{ bahan_key: 'semangka', jumlah: 40, satuan_resep: 'gram', jumlah_dasar: 40 },
				{ bahan_key: 'buah-naga', jumlah: 40, satuan_resep: 'gram', jumlah_dasar: 40 },
				{ bahan_key: 'sirup-cocopandan', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'skm', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: 'melon', jumlah: 60, satuan_resep: 'gram', jumlah_dasar: 60 },
				{ bahan_key: 'semangka', jumlah: 60, satuan_resep: 'gram', jumlah_dasar: 60 },
				{ bahan_key: 'buah-naga', jumlah: 60, satuan_resep: 'gram', jumlah_dasar: 60 },
				{ bahan_key: 'sirup-cocopandan', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'skm', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.includes('kacangmerah')) {
		return {
			reguler: [
				{ bahan_key: 'kacang-merah', jumlah: 80, satuan_resep: 'gram', jumlah_dasar: 80 },
				{ bahan_key: 'skm-cokelat', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: 'kacang-merah', jumlah: 120, satuan_resep: 'gram', jumlah_dasar: 120 },
				{ bahan_key: 'skm-cokelat', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'gula-cair', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.includes('chocobanana')) {
		return {
			reguler: [
				{ bahan_key: 'pisang-cavendish', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
				{ bahan_key: 'skm-cokelat', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 }
			],
			jumbo: [
				{ bahan_key: 'pisang-cavendish', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
				{ bahan_key: 'skm-cokelat', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'susu-uht', jumlah: 150, satuan_resep: 'ml', jumlah_dasar: 150 }
			]
		};
	}

	if (n.includes('honeylemon')) {
		return {
			reguler: [
				{ bahan_key: 'lemon-segar', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
				{ bahan_key: 'madu', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
				{ bahan_key: 'gula-cair', jumlah: 20, satuan_resep: 'ml', jumlah_dasar: 20 }
			],
			jumbo: [
				{ bahan_key: 'lemon-segar', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
				{ bahan_key: 'madu', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 },
				{ bahan_key: 'gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			]
		};
	}

	if (n.includes('3diva')) {
		return {
			reguler: [
				{ bahan_key: 'apel', jumlah: 0.5, satuan_resep: 'buah', jumlah_dasar: 0.5 },
				{ bahan_key: 'wortel', jumlah: 50, satuan_resep: 'gram', jumlah_dasar: 50 },
				{ bahan_key: 'tomat', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
				...sweetReg
			],
			jumbo: [
				{ bahan_key: 'apel', jumlah: 0.75, satuan_resep: 'buah', jumlah_dasar: 0.75 },
				{ bahan_key: 'wortel', jumlah: 75, satuan_resep: 'gram', jumlah_dasar: 75 },
				{ bahan_key: 'tomat', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
				...sweetJmb
			]
		};
	}

	if (n.includes('timunserut')) {
		return {
			reguler: [
				{ bahan_key: 'timun', jumlah: 1, satuan_resep: 'buah', jumlah_dasar: 1 },
				{ bahan_key: 'sirup-cocopandan', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: 'timun', jumlah: 1.5, satuan_resep: 'buah', jumlah_dasar: 1.5 },
				{ bahan_key: 'sirup-cocopandan', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'gula-cair', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.includes('longanleci')) {
		return {
			reguler: [
				{ bahan_key: 'sirup-cocopandan', jumlah: 40, satuan_resep: 'ml', jumlah_dasar: 40 },
				{ bahan_key: 'gula-cair', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 }
			],
			jumbo: [
				{ bahan_key: 'sirup-cocopandan', jumlah: 60, satuan_resep: 'ml', jumlah_dasar: 60 },
				{ bahan_key: 'gula-cair', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 }
			]
		};
	}

	if (n.includes('esmilo')) {
		return {
			reguler: [
				{ bahan_key: 'milo-bubuk', jumlah: 30, satuan_resep: 'gram', jumlah_dasar: 30 },
				{ bahan_key: 'skm-cokelat', jumlah: 30, satuan_resep: 'ml', jumlah_dasar: 30 },
				{ bahan_key: 'susu-uht', jumlah: 100, satuan_resep: 'ml', jumlah_dasar: 100 }
			],
			jumbo: [
				{ bahan_key: 'milo-bubuk', jumlah: 45, satuan_resep: 'gram', jumlah_dasar: 45 },
				{ bahan_key: 'skm-cokelat', jumlah: 45, satuan_resep: 'ml', jumlah_dasar: 45 },
				{ bahan_key: 'susu-uht', jumlah: 150, satuan_resep: 'ml', jumlah_dasar: 150 }
			]
		};
	}

	if (n.endsWith('yakult')) {
		const fruitName = n.replace('yakult', '');
		const f = fruitIngredients[fruitName] || fruitIngredients['jeruk'];
		return {
			reguler: [
				{ bahan_key: f.key, jumlah: f.reg, satuan_resep: f.unit, jumlah_dasar: f.base },
				{ bahan_key: 'yakult', jumlah: 1, satuan_resep: 'botol', jumlah_dasar: 1 },
				...sweetReg
			],
			jumbo: [
				{ bahan_key: f.key, jumlah: f.jmb, satuan_resep: f.unit, jumlah_dasar: f.baseJmb },
				{ bahan_key: 'yakult', jumlah: 2, satuan_resep: 'botol', jumlah_dasar: 2 },
				...sweetJmb
			]
		};
	}

	if (n.includes('mix')) {
		const clean = n.replace(/^jus/, '');
		const parts = clean.split('mix');
		if (parts.length >= 2) {
			const f1 = fruitIngredients[parts[0]] || fruitIngredients['alpukat'];
			const f2 = fruitIngredients[parts[1]] || fruitIngredients['mangga'];
			return {
				reguler: [
					{ bahan_key: f1.key, jumlah: Math.round((f1.reg / 2) * 100) / 100, satuan_resep: f1.unit, jumlah_dasar: Math.round((f1.base / 2) * 100) / 100 },
					{ bahan_key: f2.key, jumlah: Math.round((f2.reg / 2) * 100) / 100, satuan_resep: f2.unit, jumlah_dasar: Math.round((f2.base / 2) * 100) / 100 },
					...sweetReg
				],
				jumbo: [
					{ bahan_key: f1.key, jumlah: Math.round((f1.jmb / 2) * 100) / 100, satuan_resep: f1.unit, jumlah_dasar: Math.round((f1.baseJmb / 2) * 100) / 100 },
					{ bahan_key: f2.key, jumlah: Math.round((f2.jmb / 2) * 100) / 100, satuan_resep: f2.unit, jumlah_dasar: Math.round((f2.baseJmb / 2) * 100) / 100 },
					...sweetJmb
				]
			};
		}
	}

	const cleanSingle = n.replace(/^jus/, '');
	const f = fruitIngredients[cleanSingle] || fruitIngredients['alpukat'];
	return {
		reguler: [
			{ bahan_key: f.key, jumlah: f.reg, satuan_resep: f.unit, jumlah_dasar: f.base },
			...sweetReg
		],
		jumbo: [
			{ bahan_key: f.key, jumlah: f.jmb, satuan_resep: f.unit, jumlah_dasar: f.baseJmb },
			...sweetJmb
		]
	};
}

// Generate deterministically mapped UUID for branch 2
function deterministicUuid(seed) {
	const hash = createHash('sha256').update(seed).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function generateBranchSql(branchId, bahanPrefix, idTransformer = (id) => id) {
	const lines = [
		`-- Seed Catalog for branch: ${branchId}`,
		'PRAGMA foreign_keys = OFF;',
		`DELETE FROM resep_produk WHERE cabang_id = '${branchId}';`,
		`DELETE FROM produk WHERE cabang_id = '${branchId}';`,
		`DELETE FROM tambahan WHERE cabang_id = '${branchId}';`,
		`DELETE FROM bahan WHERE cabang_id = '${branchId}';`,
		`DELETE FROM kategori WHERE cabang_id = '${branchId}';`,
		`DELETE FROM pengaturan_hpp WHERE cabang_id = '${branchId}';`
	];

	// 1. Kategori
	const categoryIdMap = new Map();
	for (const cat of baseCategories) {
		const newCatId = idTransformer(cat.id);
		categoryIdMap.set(cat.id, newCatId);
		lines.push(`INSERT INTO kategori (id, cabang_id, nama, deskripsi, is_active)
VALUES (${escapeSql(newCatId)}, '${branchId}', ${escapeSql(cat.nama)}, ${escapeSql(cat.deskripsi)}, 1);`);
	}

	// 2. Bahan
	const bahanKeyToId = new Map();
	for (const b of masterIngredients) {
		const fullBahanId = `bhn-${bahanPrefix}-${b.key}`;
		bahanKeyToId.set(b.key, fullBahanId);
		lines.push(`INSERT INTO bahan (
	id, cabang_id, nama, satuan, stok_saat_ini, ambang_stok, is_active,
	biaya_per_satuan, jumlah_beli_terakhir, biaya_beli_terakhir,
	yield_persen, tipe_satuan, isi_per_kemasan, satuan_beli, kategori
) VALUES (
	${escapeSql(fullBahanId)}, '${branchId}', ${escapeSql(b.nama)}, ${escapeSql(b.satuan)},
	${b.stok}, ${b.ambang}, 1,
	${b.biaya}, 1, ${b.biaya * b.isi},
	100, ${escapeSql(b.tipe)}, ${b.isi},
	${escapeSql(b.beli)}, ${escapeSql(b.kat)}
);`);
	}

	// 3. Tambahan
	const tambahanIdMap = new Map();
	for (const t of baseTambahan) {
		const newTambahanId = idTransformer(t.id);
		tambahanIdMap.set(t.id, newTambahanId);
		const linkedBahanId = bahanKeyToId.get(t.bahan_key) || null;
		lines.push(`INSERT INTO tambahan (
	id, cabang_id, nama, harga, is_active,
	bahan_id, jumlah_bahan, satuan_resep, jumlah_dasar_per_item
) VALUES (
	${escapeSql(newTambahanId)}, '${branchId}', ${escapeSql(t.nama)}, ${t.harga}, 1,
	${escapeSql(linkedBahanId)}, ${t.jumlah}, ${escapeSql(t.satuan_resep)}, ${t.jumlah_dasar}
);`);
	}

	// 4. Produk & Resep
	for (const p of rawProducts) {
		const newProdId = idTransformer(p.id);
		let targetCatId = p.kategori_id;
		if (!targetCatId) {
			targetCatId = blankCategoryMapping[p.nama] || '0caf87d5-995b-4c0d-8ca9-f9b28b136fcd';
		}
		const finalCatId = categoryIdMap.get(targetCatId) || targetCatId;
		const isFood = isFoodItem(p.nama, p.tipe);
		const finalTipe = isFood ? 'makanan' : 'minuman';
		const hargaJumbo = computeHargaJumbo(p);

		// Clean and map ekstra_ids
		let mappedEkstraIds = [];
		if (!isFood && p.ekstra_ids) {
			try {
				const arr = typeof p.ekstra_ids === 'string' ? JSON.parse(p.ekstra_ids) : p.ekstra_ids;
				if (Array.isArray(arr)) {
					mappedEkstraIds = arr
						.filter((eid) => eid !== JUMBO_EXTRA_ID)
						.map((eid) => tambahanIdMap.get(eid) || eid);
				}
			} catch {}
		}

		lines.push(`INSERT INTO produk (
	id, cabang_id, nama, harga, harga_jumbo, kategori_id, tipe,
	gambar, ekstra_ids, is_active, lacak_stok, lacak_bahan
) VALUES (
	${escapeSql(newProdId)}, '${branchId}', ${escapeSql(p.nama)}, ${p.harga},
	${escapeSql(hargaJumbo)}, ${escapeSql(finalCatId)}, ${escapeSql(finalTipe)},
	NULL, ${escapeSql(JSON.stringify(mappedEkstraIds))}, 1, ${isFood ? 1 : 0}, ${isFood ? 0 : 1}
);`);

		// Resep produk (drinks only)
		if (!isFood) {
			const recipe = buildRecipeForDrink(p.nama);
			if (recipe?.reguler) {
				for (const r of recipe.reguler) {
					const bId = bahanKeyToId.get(r.bahan_key);
					if (!bId) continue;
					const recipeId = `rsp-${branchId}-${newProdId.slice(0, 8)}-reg-${r.bahan_key}`;
					lines.push(`INSERT INTO resep_produk (
	id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item
) VALUES (
	${escapeSql(recipeId)}, '${branchId}', ${escapeSql(newProdId)}, ${escapeSql(bId)},
	'reguler', ${r.jumlah}, ${escapeSql(r.satuan_resep)}, ${r.jumlah_dasar}
);`);
				}
			}

			if (recipe?.jumbo && hargaJumbo !== null) {
				for (const r of recipe.jumbo) {
					const bId = bahanKeyToId.get(r.bahan_key);
					if (!bId) continue;
					const recipeId = `rsp-${branchId}-${newProdId.slice(0, 8)}-jmb-${r.bahan_key}`;
					lines.push(`INSERT INTO resep_produk (
	id, cabang_id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item
) VALUES (
	${escapeSql(recipeId)}, '${branchId}', ${escapeSql(newProdId)}, ${escapeSql(bId)},
	'jumbo', ${r.jumlah}, ${escapeSql(r.satuan_resep)}, ${r.jumlah_dasar}
);`);
				}
			}
		}
	}

	// 5. Pengaturan HPP
	const rincianBiaya = JSON.stringify([
		{ id: 'sewa', nama: 'Sewa Lapak / Kios', nominal: 1000000 },
		{ id: 'gaji', nama: 'Gaji Karyawan', nominal: 1000000 },
		{ id: 'listrik', nama: 'Listrik', nominal: 100000 },
		{ id: 'air', nama: 'Air Bersih (Cuci / PDAM)', nominal: 100000 },
		{ id: 'kemasan', nama: 'Kemasan (Cup, Tutup, Sedotan, Kresek)', nominal: 600000 },
		{ id: 'es_batu', nama: 'Es Batu Kristal', nominal: 200000 },
		{ id: 'air_galon', nama: 'Air Galon (Blender)', nominal: 150000 }
	]);

	lines.push(`INSERT INTO pengaturan_hpp (
	id, cabang_id, sewa_bulanan, listrik_bulanan, air_bulanan, gaji_bulanan,
	lainnya_bulanan, target_item_bulanan, rincian_biaya
) VALUES (
	'${branchId}:default', '${branchId}', 1000000, 100000, 100000, 1000000,
	3150000, 750, ${escapeSql(rincianBiaya)}
);`);

	return lines.join('\n');
}

function executeD1(dbTarget, sqlContent, isRemoteTarget) {
	const tempFile = join(tmpdir(), `seed-${randomUUID()}.sql`);
	writeFileSync(tempFile, sqlContent, 'utf8');

	const targetArgs = isRemoteTarget
		? [dbTarget, '--remote', `--file=${tempFile}`, '--yes']
		: [dbTarget, '--local', '--config=wrangler.pages.jsonc', `--file=${tempFile}`, '--yes'];

	console.log(`Executing SQL on ${dbTarget} (${isRemoteTarget ? 'REMOTE' : 'LOCAL'})...`);
	const proc = spawnSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', ...targetArgs], {
		stdio: 'pipe',
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});

	try {
		unlinkSync(tempFile);
	} catch {}

	if (proc.status !== 0) {
		console.error(`Failed executing SQL on ${dbTarget}:`);
		console.error(proc.stderr || proc.stdout);
		throw new Error(`Wrangler execution failed with status ${proc.status}`);
	}

	console.log(`Successfully executed batch on ${dbTarget}!`);
}

async function main() {
	console.log(`=== STARTING SEED FOR BALIKPAPAN, BALIKPAPAN 2, AND BERAU (${isRemote ? 'REMOTE' : 'LOCAL'}) ===`);

	// 1. Generate SQL for Balikpapan 1
	console.log('\n[1/3] Generating catalog for Balikpapan 1 (balikpapan)...');
	const sqlBpp1 = generateBranchSql('balikpapan', 'bpp', (id) => id);

	// 2. Generate SQL for Balikpapan 2
	console.log('\n[2/3] Generating catalog for Balikpapan 2 (balikpapan2)...');
	const sqlBpp2 = generateBranchSql('balikpapan2', 'bpp2', (id) => deterministicUuid(`bpp2:${id}`));

	// Combine Balikpapan 1 and 2 for DB_BALIKPAPAN_GROUP
	const combinedBppSql = `${sqlBpp1}\n\n${sqlBpp2}`;
	const bppDbTarget = isRemote ? 'zatiaras-balikpapan-group' : 'DB_BALIKPAPAN_GROUP';
	executeD1(bppDbTarget, combinedBppSql, isRemote);

	// 3. Generate SQL for Berau
	console.log('\n[3/3] Generating catalog for Berau (berau)...');
	const sqlBerau = generateBranchSql('berau', 'bru', (id) => id);
	const berauDbTarget = isRemote ? 'zatiaras-berau-group' : 'DB_BERAU_GROUP';
	executeD1(berauDbTarget, sqlBerau, isRemote);

	console.log('\n=== SEEDING COMPLETED SUCCESSFULLY FOR ALL BRANCHES! ===');
}

main().catch((err) => {
	console.error('Seeding process failed:', err);
	process.exit(1);
});
