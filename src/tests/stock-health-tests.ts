import assert from 'node:assert/strict';
import {
	getStockHealth,
	isLowStockItem,
	filterLowStock,
	filterBahan,
	buildCategoryOptions,
	countCategory
} from '../lib/utils/stockHealth.js';

// AUD-053 slice 1: kebijakan tampilan stok terpusat, perilaku identik pindahan.
const bahan = (over: Record<string, unknown> = {}) => ({
	stok_saat_ini: 10,
	ambang_stok: 5,
	jumlah_beli_terakhir: 20,
	kategori: 'Bahan Baku',
	nama: 'Gula',
	...over
});

// Lima status: Habis, Sisa Sedikit, Mendekati Batas, Setengah, Penuh.
assert.equal(getStockHealth(bahan({ stok_saat_ini: 0 })).status, 'out');
assert.equal(getStockHealth(bahan({ stok_saat_ini: 0 })).percent, 0);
assert.equal(getStockHealth(bahan({ stok_saat_ini: 3, ambang_stok: 5 })).status, 'critical');
assert.equal(getStockHealth(bahan({ stok_saat_ini: 7, ambang_stok: 5 })).status, 'warning');
assert.equal(
	getStockHealth(bahan({ stok_saat_ini: 60, ambang_stok: 0, jumlah_beli_terakhir: 100 })).status,
	'half'
);
assert.equal(getStockHealth(bahan({ stok_saat_ini: 100, ambang_stok: 0 })).status, 'full');
// Stok > 0 tak pernah percent 0 (minimal 4).
assert.ok(getStockHealth(bahan({ stok_saat_ini: 1, jumlah_beli_terakhir: 10000 })).percent >= 4);

// Predikat tunggal mengganti dua derived ganda.
assert.equal(isLowStockItem(bahan({ stok_saat_ini: 5, ambang_stok: 5 })), true);
assert.equal(isLowStockItem(bahan({ stok_saat_ini: 6, ambang_stok: 5 })), false);
assert.equal(isLowStockItem(bahan({ stok_saat_ini: 0, ambang_stok: 0 })), false);
const list = [
	bahan({ nama: 'Gula', kategori: 'Bahan Baku', stok_saat_ini: 2, ambang_stok: 5 }),
	bahan({ nama: 'Teh', kategori: 'Buah & Jus', stok_saat_ini: 50, ambang_stok: 5 })
];
assert.deepEqual(
	filterLowStock(list).map((b) => b.nama),
	['Gula']
);

// Filter + hitung + opsi kategori.
assert.equal(filterBahan(list, 'teh', 'all').length, 1);
assert.equal(filterBahan(list, '', 'low_stock').length, 1);
assert.equal(filterBahan(list, '', 'Buah & Jus').length, 1);
assert.equal(filterBahan(list, '', 'Semua-Salah').length, 0);
assert.deepEqual(buildCategoryOptions(list, ['Bahan Baku']), {
	dynamic: ['Bahan Baku', 'Buah & Jus'],
	available: ['Bahan Baku', 'Buah & Jus']
});
assert.equal(countCategory(list, 1, 'all'), 2);
assert.equal(countCategory(list, 1, 'low_stock'), 1);
assert.equal(countCategory(list, 1, 'buah & jus'), 1);

console.log('stock-health-tests: status/predikat/filter/kategori passed');
