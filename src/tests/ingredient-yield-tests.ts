import assert from 'node:assert/strict';
import {
	calculateEffectiveUnitCost,
	calculateUsableQuantity,
	isValidYieldPercent,
	normalizeYieldPercent
} from '../lib/utils/ingredientCost';
import {
	bahanFormFromIngredient,
	buildBahanPayload,
	emptyBahanForm,
	previewBahanCost
} from '../lib/utils/bahanForm';
import type { Ingredient } from '../lib/types/product';

assert.equal(normalizeYieldPercent(undefined), 100);
assert.equal(normalizeYieldPercent(65), 65);
assert.equal(normalizeYieldPercent('65,5'), 65.5);
assert.equal(isValidYieldPercent(0), false);
assert.equal(isValidYieldPercent(101), false);
assert.equal(isValidYieldPercent(65.5), true);
assert.equal(calculateUsableQuantity(10_000, 65), 6_500);
assert.equal(calculateUsableQuantity(1_000, 100), 1_000);
assert.equal(calculateUsableQuantity(-1, 65), 0);
assert.equal(calculateEffectiveUnitCost(300_000, 10_000, 65), 46.1538);
assert.equal(calculateEffectiveUnitCost(300_000, 10_000, 100), 30);
assert.equal(calculateEffectiveUnitCost(300_000, 0, 65), 0);
assert.equal(calculateEffectiveUnitCost(300_000, 10), 30_000);
assert.equal(calculateEffectiveUnitCost(15_000, 3), 5_000);
assert.equal(calculateEffectiveUnitCost(10_000, '5'), 2_000);
assert.equal(calculateEffectiveUnitCost(300_000, 0), 0);
assert.equal(calculateEffectiveUnitCost(300_000, -1), 0);
assert.equal(calculateEffectiveUnitCost(-100, 10), 0);
assert.equal(calculateEffectiveUnitCost(undefined, 10), 0);
assert.equal(calculateEffectiveUnitCost(10_000, null), 0);
assert.equal(calculateEffectiveUnitCost(NaN, 5), 0);
import { convertToBaseUnit } from '../lib/utils/unitConversion';

assert.throws(() => convertToBaseUnit(100, 'ml', 'gram'), /Konversi satuan tidak kompatibel/);
assert.throws(() => convertToBaseUnit(1, 'kg', 'liter'), /Konversi satuan tidak kompatibel/);
assert.equal(convertToBaseUnit(500, 'gram', 'kg'), 0.5);
assert.equal(convertToBaseUnit(2, 'liter', 'ml'), 2000);
assert.equal(convertToBaseUnit(1, 'pcs', 'pack', 50), 0.02);
assert.equal(convertToBaseUnit(1, 'pack', 'pcs', 50), 50);
assert.equal(convertToBaseUnit(2, 'sachet', 'pack', 20), 0.1);

// Kebijakan form bahan tunggal (Stok + Manajemen Menu).
{
	const created = buildBahanPayload(
		{
			...emptyBahanForm(),
			nama: ' Gula ',
			satuan_beli: 'kg',
			jumlah_beli_terakhir: '1,5',
			biaya_beli_terakhir: '30.000',
			yield_persen: '75',
			stok_saat_ini: '500'
		},
		false
	);
	assert.ok(created.ok);
	if (created.ok) {
		assert.equal(created.payload.nama, 'Gula');
		assert.equal(created.payload.jumlah_beli_terakhir, 1500, 'kg disimpan dalam gram');
		assert.equal(created.payload.biaya_per_satuan, calculateEffectiveUnitCost(30000, 1125));
		assert.equal(created.payload.stok_saat_ini, 500);
	}
	const edited = buildBahanPayload({ ...emptyBahanForm(), nama: 'Gula', stok_saat_ini: '9' }, true);
	assert.ok(
		edited.ok && !('stok_saat_ini' in edited.payload),
		'Edit tidak mengirim saldo (AUD-009)'
	);
	assert.deepEqual(buildBahanPayload(emptyBahanForm(), false), {
		ok: false,
		error: 'Nama bahan wajib diisi'
	});
	const incompatible = buildBahanPayload(
		{
			...emptyBahanForm(),
			nama: 'Susu',
			satuan: 'gram',
			satuan_beli: 'liter',
			jumlah_beli_terakhir: '1'
		},
		false
	);
	assert.equal(incompatible.ok, false);
	const clamped = buildBahanPayload(
		{
			...emptyBahanForm(),
			nama: 'Jeruk',
			yield_persen: '150',
			kategoriSelect: '__new__',
			customKategori: ' Buah '
		},
		false
	);
	assert.ok(
		clamped.ok && clamped.payload.yield_persen === 100 && clamped.payload.kategori === 'Buah'
	);

	// Edit lalu simpan tanpa perubahan mempertahankan nilai desimal dan satuan beli.
	const stored = {
		id: 'b1',
		nama: 'Sirup',
		satuan: 'ml',
		tipe_satuan: 'cairan',
		satuan_beli: 'liter',
		isi_per_kemasan: 1,
		kategori: 'Minuman',
		stok_saat_ini: 2500.5,
		ambang_stok: 0.25,
		yield_persen: 92.5,
		jumlah_beli_terakhir: 1500,
		biaya_beli_terakhir: 45000
	} as unknown as Ingredient;
	const form = bahanFormFromIngredient(stored, ['Minuman']);
	assert.equal(form.jumlah_beli_terakhir, '1,5', 'Jumlah beli tampil dalam satuan beli');
	assert.equal(form.kategoriSelect, 'Minuman');
	assert.equal(bahanFormFromIngredient(stored, []).kategoriSelect, '__new__');
	const resaved = buildBahanPayload(form, true);
	assert.ok(resaved.ok);
	if (resaved.ok) {
		assert.equal(resaved.payload.jumlah_beli_terakhir, 1500);
		assert.equal(
			resaved.payload.yield_persen,
			100,
			'Cairan tidak memakai susut (kontrol tersembunyi)'
		);
		assert.equal(resaved.payload.ambang_stok, 0.25);
		assert.equal(resaved.payload.biaya_beli_terakhir, 45000);
	}
}

// Review yield hanya untuk berat/unit; pratinjau = payload; tanpa geser.
{
	const cairan = buildBahanPayload(
		{
			...emptyBahanForm(),
			nama: 'Susu',
			tipe_satuan: 'cairan',
			satuan: 'ml',
			satuan_beli: 'liter',
			jumlah_beli_terakhir: '1',
			biaya_beli_terakhir: '35.000',
			yield_persen: '70'
		},
		false
	);
	assert.ok(cairan.ok);
	if (cairan.ok) {
		assert.equal(cairan.payload.yield_persen, 100, 'Yield tersembunyi tidak diterapkan');
		assert.equal(cairan.payload.biaya_per_satuan, 35, 'Biaya 35/ml, bukan 50/ml');
	}
	const form = {
		...emptyBahanForm(),
		nama: 'Jeruk',
		jumlah_beli_terakhir: '2',
		biaya_beli_terakhir: '20.000',
		yield_persen: '45'
	};
	const preview = previewBahanCost(form);
	const saved = buildBahanPayload(form, false);
	assert.ok(preview && saved.ok && saved.payload.biaya_per_satuan === preview.unitCost);

	const pcs = {
		id: 'p1',
		nama: 'Cup',
		satuan: 'pcs',
		tipe_satuan: 'kemasan',
		satuan_beli: 'pack',
		isi_per_kemasan: 3,
		kategori: 'Kemasan',
		stok_saat_ini: 30,
		ambang_stok: 5,
		yield_persen: 100,
		jumlah_beli_terakhir: 10,
		biaya_beli_terakhir: 9000
	} as unknown as Ingredient;
	const pcsForm = bahanFormFromIngredient(pcs, ['Kemasan']);
	const resavedPcs = buildBahanPayload(pcsForm, true, pcs);
	assert.ok(
		resavedPcs.ok && resavedPcs.payload.jumlah_beli_terakhir === 10,
		'Simpan ulang tanpa perubahan tidak menggeser 10 pcs'
	);
	const changed = buildBahanPayload({ ...pcsForm, jumlah_beli_terakhir: '4' }, true, pcs);
	assert.ok(
		changed.ok && changed.payload.jumlah_beli_terakhir === 12,
		'Perubahan nyata dikonversi'
	);

	const berat = {
		...pcs,
		tipe_satuan: 'berat',
		satuan: 'gram',
		satuan_beli: 'kg',
		yield_persen: 92.5
	} as unknown as Ingredient;
	assert.equal(
		bahanFormFromIngredient(berat, []).yield_persen,
		'92.5',
		'Input number: titik desimal'
	);
	assert.equal(
		bahanFormFromIngredient({ ...pcs, jumlah_beli_terakhir: 0 } as unknown as Ingredient, [])
			.jumlah_beli_terakhir,
		'',
		'Tanpa riwayat beli: field kosong, bukan 0'
	);
}

console.log('ingredient-yield-tests: yield, unit cost, dan kebijakan form bahan passed');
