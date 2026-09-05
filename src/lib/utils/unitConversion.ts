/**
 * ⚖️ UNIT CONVERSION & MEASUREMENT ENGINE (F&B / JUICE POS)
 *
 * Mendukung konversi presisi antara satuan beli/kulakan grosir
 * dan satuan resep/takaran saji (gram, kg, ml, liter, sdm, sdt, pump, pcs, pack, dll).
 */

export type UnitCategory = 'berat' | 'cairan' | 'kemasan' | 'unit';

export interface UnitOption {
	value: string;
	label: string;
	category: UnitCategory;
	factorToBase: number; // Perkalian untuk menghasilkan satuan dasar
	description?: string;
}

export const UNIT_CATEGORIES: { value: UnitCategory; label: string; defaultBase: string }[] = [
	{ value: 'cairan', label: 'Cairan / Volume (ml, Liter, Sirup, Susu)', defaultBase: 'ml' },
	{ value: 'berat', label: 'Berat / Timbangan (Gram, Kg, Gula, Buah)', defaultBase: 'gram' },
	{ value: 'kemasan', label: 'Kemasan / Pack (Cup, Sedotan, Tutup)', defaultBase: 'pcs' },
	{ value: 'unit', label: 'Hitungan Fisik (Buah Utuh, Porsi, Telur)', defaultBase: 'buah' }
];

export const ALL_UNITS: Record<UnitCategory, UnitOption[]> = {
	cairan: [
		{ value: 'ml', label: 'Mililiter (ml)', category: 'cairan', factorToBase: 1 },
		{ value: 'liter', label: 'Liter (L)', category: 'cairan', factorToBase: 1000 },
		{ value: 'centong', label: 'Centong Takar (~25 ml)', category: 'cairan', factorToBase: 25 },
		{ value: 'sdm', label: 'Sendok Makan / sdm (15 ml)', category: 'cairan', factorToBase: 15 },
		{ value: 'sdt', label: 'Sendok Teh / sdt (5 ml)', category: 'cairan', factorToBase: 5 },
		{ value: 'pump', label: 'Pump Sirup (10 ml)', category: 'cairan', factorToBase: 10 },
		{ value: 'oz', label: 'Fluid Ounce / oz (30 ml)', category: 'cairan', factorToBase: 30 },
		{ value: 'gelas', label: 'Gelas / Cup (200 ml)', category: 'cairan', factorToBase: 200 },
		{ value: 'botol', label: 'Botol', category: 'cairan', factorToBase: 1000 },
		{ value: 'kaleng', label: 'Kaleng (370 ml)', category: 'cairan', factorToBase: 370 }
	],
	berat: [
		{ value: 'gram', label: 'Gram (g)', category: 'berat', factorToBase: 1 },
		{ value: 'kg', label: 'Kilogram (kg)', category: 'berat', factorToBase: 1000 },
		{ value: 'potong', label: 'Potong (~83 g / 500g:6)', category: 'berat', factorToBase: 83.33 },
		{ value: 'sdm', label: 'Sendok Makan / sdm (~15 g)', category: 'berat', factorToBase: 15 },
		{ value: 'sdt', label: 'Sendok Teh / sdt (~5 g)', category: 'berat', factorToBase: 5 },
		{ value: 'ons', label: 'Ons (100 g)', category: 'berat', factorToBase: 100 },
		{ value: 'pon', label: 'Pon (500 g)', category: 'berat', factorToBase: 500 }
	],
	kemasan: [
		{ value: 'pcs', label: 'Pcs / Satuan', category: 'kemasan', factorToBase: 1 },
		{ value: 'lembar', label: 'Lembar', category: 'kemasan', factorToBase: 1 },
		{ value: 'pack', label: 'Pack / Bungkus (bks)', category: 'kemasan', factorToBase: 1 },
		{ value: 'slop', label: 'Slop (50 pcs)', category: 'kemasan', factorToBase: 50 },
		{ value: 'dus', label: 'Dus / Karton', category: 'kemasan', factorToBase: 1 },
		{ value: 'roll', label: 'Roll Sealer', category: 'kemasan', factorToBase: 1 }
	],
	unit: [
		{ value: 'buah', label: 'Buah Utuh', category: 'unit', factorToBase: 1 },
		{ value: 'porsi', label: 'Porsi', category: 'unit', factorToBase: 1 },
		{ value: 'potong', label: 'Potong / Slice (0.25)', category: 'unit', factorToBase: 0.25 },
		{ value: 'biji', label: 'Biji', category: 'unit', factorToBase: 1 },
		{ value: 'butir', label: 'Butir', category: 'unit', factorToBase: 1 },
		{ value: 'sachet', label: 'Sachet', category: 'unit', factorToBase: 1 },
		{ value: 'ikat', label: 'Ikat', category: 'unit', factorToBase: 1 }
	]
};

/**
 * Mendeteksi kategori satuan secara cerdas berdasarkan nama satuan
 */
export function detectUnitCategory(satuanName: string): UnitCategory {
	if (!satuanName) return 'berat';
	const s = satuanName.trim().toLowerCase();

	if (
		[
			'ml',
			'mililiter',
			'liter',
			'l',
			'centong',
			'pump',
			'oz',
			'cairan',
			'botol',
			'kaleng',
			'gelas',
			'cup'
		].includes(s)
	)
		return 'cairan';
	if (['gram', 'g', 'kg', 'kilogram', 'ons', 'pon', 'berat'].includes(s)) return 'berat';
	if (
		[
			'pack',
			'bks',
			'bungkus',
			'slop',
			'dus',
			'karton',
			'kemasan',
			'lembar',
			'roll',
			'pcs',
			'piece',
			'pieces'
		].includes(s)
	)
		return 'kemasan';
	if (['buah', 'porsi', 'potong', 'biji', 'butir', 'unit', 'sachet', 'ikat'].includes(s))
		return 'unit';

	return 'berat';
}

/**
 * Mengambil daftar satuan yang kompatibel dengan satuan dasar bahan
 */
export function getCompatibleUnits(baseUnitOrCategory: string): UnitOption[] {
	const category = detectUnitCategory(baseUnitOrCategory);
	if (category === 'kemasan' || category === 'unit') {
		const combined = [...ALL_UNITS.kemasan, ...ALL_UNITS.unit];
		const seen = new Set<string>();
		return combined.filter((u) => {
			if (seen.has(u.value)) return false;
			seen.add(u.value);
			return true;
		});
	}
	return ALL_UNITS[category] || ALL_UNITS.berat;
}

/**
 * Mengkonversi nilai dari satuan tertentu ke satuan dasar (base unit)
 */
export function convertToBaseUnit(
	amount: number,
	fromUnit: string,
	baseUnit: string,
	packSize: number = 1
): number {
	if (!amount || isNaN(amount)) return 0;

	const cleanFrom = (fromUnit || '').trim().toLowerCase();
	const cleanBase = (baseUnit || '').trim().toLowerCase();

	if (cleanFrom === cleanBase) return amount;

	const fromCategory = detectUnitCategory(cleanFrom);
	const baseCategory = detectUnitCategory(cleanBase);

	const isCountCategory = (cat: UnitCategory) => cat === 'kemasan' || cat === 'unit';

	if (fromCategory !== baseCategory && !(isCountCategory(fromCategory) && isCountCategory(baseCategory))) {
		throw new Error(
			`Konversi satuan tidak kompatibel: ${fromUnit} (${fromCategory}) tidak dapat dikonversi ke ${baseUnit} (${baseCategory})`
		);
	}

	const unitList = [...(ALL_UNITS[baseCategory] || []), ...(ALL_UNITS[fromCategory] || [])];
	const fromUnitDef = unitList.find((u) => u.value.toLowerCase() === cleanFrom);
	const baseUnitDef = unitList.find((u) => u.value.toLowerCase() === cleanBase);

	let fromFactor = fromUnitDef ? fromUnitDef.factorToBase : 1;
	let baseFactor = baseUnitDef ? baseUnitDef.factorToBase : 1;

	// Handle dynamic pack size
	const isPackUnit = (unit: string) =>
		['pack', 'bks', 'bungkus', 'dus', 'roll', 'karton'].includes(unit);

	if (isPackUnit(cleanFrom)) {
		fromFactor = Math.max(1, packSize);
	}
	if (isPackUnit(cleanBase)) {
		baseFactor = Math.max(1, packSize);
	}

	// Calculate base unit amount
	const inBaseAmount = (amount * fromFactor) / baseFactor;
	return Math.round(inBaseAmount * 10000) / 10000;
}

export function safeConvertToBaseUnit(
	amount: number,
	fromUnit: string,
	baseUnit: string,
	packSize: number = 1
): number {
	try {
		return convertToBaseUnit(amount, fromUnit, baseUnit, packSize);
	} catch {
		return amount;
	}
}

/**
 * Format stok cerdas dengan unit turunan jika besar (misal: 2500 gram -> 2.500 g (2,5 kg))
 */
export function formatSmartStock(amount: number, baseUnit: string): string {
	const num = Number(amount || 0);
	const cleanBase = (baseUnit || 'gram').trim().toLowerCase();

	if (cleanBase === 'gram' && num >= 1000) {
		const kg = (num / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
		return `${num.toLocaleString('id-ID')} g (${kg} kg)`;
	}

	if (cleanBase === 'ml' && num >= 1000) {
		const l = (num / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 });
		return `${num.toLocaleString('id-ID')} ml (${l} L)`;
	}

	return `${num.toLocaleString('id-ID')} ${baseUnit}`;
}

/**
 * Format kuantitas / takaran dengan angka desimal yang rapi (misal: 0,05 atau 1,5 atau 250)
 */
export function formatQuantity(value: number | string | null | undefined): string {
	if (value === null || value === undefined || value === '') return '0';
	const num = typeof value === 'string' ? parseFloat(value.replace(/,/g, '.')) : value;
	if (isNaN(num)) return '0';
	return num.toLocaleString('id-ID', { maximumFractionDigits: 3 });
}
