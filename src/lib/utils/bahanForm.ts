// Kebijakan tunggal form bahan (Stok dan Manajemen Menu).
// Murni: tanpa store/fetch, sehingga kedua halaman memakai aturan yang sama
// untuk mengisi form, mengonversi satuan beli, yield, dan biaya per satuan.

import {
	formatQuantityInput,
	formatRupiah,
	parseQuantityInput,
	parseRupiah
} from '$lib/utils/currency';
import { calculateEffectiveUnitCost, normalizeYieldPercent } from '$lib/utils/ingredientCost';
import {
	convertToBaseUnit,
	detectUnitCategory,
	safeConvertFromBaseUnit,
	type UnitCategory
} from '$lib/utils/unitConversion';
import type { Ingredient } from '$lib/types/product';

export const DEFAULT_BAHAN_CATEGORY = 'Bahan Baku';
export const NEW_CATEGORY_OPTION = '__new__';

export type BahanForm = {
	nama: string;
	tipe_satuan: UnitCategory;
	satuan: string;
	isi_per_kemasan: string;
	satuan_beli: string;
	kategoriSelect: string;
	customKategori: string;
	kategori: string;
	stok_saat_ini: string;
	ambang_stok: string;
	yield_persen: string;
	jumlah_beli_terakhir: string;
	biaya_beli_terakhir: string;
};

export type BahanPayload = {
	nama: string;
	satuan: string;
	tipe_satuan: UnitCategory;
	isi_per_kemasan: number;
	satuan_beli: string;
	kategori: string;
	stok_saat_ini?: number;
	ambang_stok: number;
	yield_persen: number;
	jumlah_beli_terakhir: number;
	biaya_beli_terakhir: number;
	biaya_per_satuan: number;
};

export type BahanPayloadResult = { ok: true; payload: BahanPayload } | { ok: false; error: string };

export function emptyBahanForm(kategori = DEFAULT_BAHAN_CATEGORY): BahanForm {
	return {
		nama: '',
		tipe_satuan: 'berat',
		satuan: 'gram',
		isi_per_kemasan: '1',
		satuan_beli: 'kg',
		kategoriSelect: kategori,
		customKategori: '',
		kategori,
		stok_saat_ini: '',
		ambang_stok: '',
		yield_persen: '100',
		jumlah_beli_terakhir: '',
		biaya_beli_terakhir: ''
	};
}

/** Susut kulit/biji hanya berlaku untuk tipe berat dan unit (sama dengan kontrol dialog). */
export function supportsYield(tipe: UnitCategory): boolean {
	return tipe === 'berat' || tipe === 'unit';
}

/** Isi form edit: jumlah beli ditampilkan dalam satuan beli, bukan satuan dasar. */
export function bahanFormFromIngredient(bahan: Ingredient, knownCategories: string[]): BahanForm {
	const cat = (bahan.kategori || DEFAULT_BAHAN_CATEGORY).trim() || DEFAULT_BAHAN_CATEGORY;
	const isKnown = knownCategories.includes(cat);
	const detectedType = bahan.tipe_satuan || detectUnitCategory(bahan.satuan || 'gram');
	const baseUnit = bahan.satuan || (detectedType === 'cairan' ? 'ml' : 'gram');
	const buyUnit = bahan.satuan_beli || baseUnit;
	const pack = Number(bahan.isi_per_kemasan) || 1;
	const storedBaseQty = Number(bahan.jumlah_beli_terakhir) || 0;
	const displayQty = safeConvertFromBaseUnit(storedBaseQty, buyUnit, baseUnit, pack);
	return {
		nama: bahan.nama,
		tipe_satuan: detectedType,
		satuan: baseUnit,
		isi_per_kemasan: formatQuantityInput(bahan.isi_per_kemasan || 1) || '1',
		satuan_beli: buyUnit,
		kategoriSelect: isKnown ? cat : NEW_CATEGORY_OPTION,
		customKategori: isKnown ? '' : cat,
		kategori: cat,
		stok_saat_ini: formatQuantityInput(bahan.stok_saat_ini ?? 0),
		ambang_stok: formatQuantityInput(bahan.ambang_stok ?? 0),
		// Input number: titik desimal, bukan format id-ID ("92.5", bukan "92,5").
		yield_persen: String(normalizeYieldPercent(bahan.yield_persen ?? 100)),
		jumlah_beli_terakhir: storedBaseQty
			? formatQuantityInput(Number.isFinite(displayQty) ? displayQty : storedBaseQty)
			: '',
		biaya_beli_terakhir: formatRupiah(bahan.biaya_beli_terakhir) || ''
	};
}

export type BahanCostPreview = {
	/** Jumlah beli dalam satuan dasar. */
	baseQty: number;
	/** Jumlah bersih setelah susut (satuan dasar). */
	netQty: number;
	yieldPercent: number;
	unitCost: number;
};

const PURCHASE_FIELDS = [
	'jumlah_beli_terakhir',
	'satuan_beli',
	'satuan',
	'isi_per_kemasan'
] as const;

/**
 * Pratinjau dan dasar simpan biaya per satuan (satu aturan untuk keduanya).
 * `original`: bahan yang sedang diedit. Bila field pembelian tidak diubah,
 * jumlah dasar tersimpan dipakai apa adanya agar tidak bergeser karena
 * pembulatan tampilan (mis. 10 pcs = 3,3333 pack).
 * null = satuan beli tidak kompatibel dengan satuan dasar.
 */
export function previewBahanCost(
	form: BahanForm,
	original?: Ingredient | null
): BahanCostPreview | null {
	const purchaseCost = Math.max(0, parseRupiah(form.biaya_beli_terakhir));
	let baseQty: number;
	const baseline = original ? bahanFormFromIngredient(original, []) : null;
	if (baseline && PURCHASE_FIELDS.every((field) => form[field] === baseline[field])) {
		baseQty = Number(original?.jumlah_beli_terakhir) || 0;
	} else {
		const purchaseQty = Math.max(0, parseQuantityInput(form.jumlah_beli_terakhir));
		const packSize = Math.max(1, parseQuantityInput(form.isi_per_kemasan) || 1);
		try {
			baseQty = convertToBaseUnit(
				purchaseQty,
				form.satuan_beli || form.satuan,
				form.satuan,
				packSize
			);
		} catch {
			return null;
		}
	}
	const yieldPercent = supportsYield(form.tipe_satuan)
		? normalizeYieldPercent(parseQuantityInput(form.yield_persen) || 100)
		: 100;
	return {
		baseQty,
		netQty: (baseQty * yieldPercent) / 100,
		yieldPercent,
		unitCost: calculateEffectiveUnitCost(purchaseCost, baseQty, yieldPercent)
	};
}

/**
 * Payload simpan bahan. Jumlah beli disimpan dalam satuan dasar; biaya per
 * satuan = biaya beli / (jumlah dasar x yield). Edit tidak mengirim saldo stok;
 * stok awal hanya saat membuat bahan.
 */
export function buildBahanPayload(
	form: BahanForm,
	isEdit: boolean,
	original?: Ingredient | null
): BahanPayloadResult {
	if (!form.nama.trim()) return { ok: false, error: 'Nama bahan wajib diisi' };
	const preview = previewBahanCost(form, original);
	if (!preview) return { ok: false, error: 'Satuan beli tidak kompatibel dengan satuan dasar' };
	const kategori =
		(form.kategoriSelect === NEW_CATEGORY_OPTION
			? form.customKategori.trim()
			: form.kategoriSelect.trim()) || DEFAULT_BAHAN_CATEGORY;
	return {
		ok: true,
		payload: {
			nama: form.nama.trim(),
			satuan: form.satuan || 'gram',
			tipe_satuan: form.tipe_satuan || 'berat',
			isi_per_kemasan: Math.max(1, parseQuantityInput(form.isi_per_kemasan) || 1),
			satuan_beli: form.satuan_beli || form.satuan,
			kategori,
			...(!isEdit ? { stok_saat_ini: Math.max(0, parseQuantityInput(form.stok_saat_ini)) } : {}),
			ambang_stok: Math.max(0, parseQuantityInput(form.ambang_stok)),
			yield_persen: preview.yieldPercent,
			jumlah_beli_terakhir: preview.baseQty,
			biaya_beli_terakhir: Math.max(0, parseRupiah(form.biaya_beli_terakhir)),
			biaya_per_satuan: preview.unitCost
		}
	};
}
