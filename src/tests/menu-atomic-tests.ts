import assert from 'node:assert/strict';
import { convertToBaseUnit } from '../lib/utils/unitConversion';

// 1. Recipe unit conversion logic
assert.equal(convertToBaseUnit(500, 'gram', 'kg'), 0.5);
assert.equal(convertToBaseUnit(2, 'kg', 'gram'), 2000);
assert.equal(convertToBaseUnit(100, 'ml', 'liter'), 0.1);

// 2. Atomic Menu Payload Construction & Validation
interface ProductDraft {
	nama: string;
	harga: number;
	harga_jumbo?: number | null;
	kategori_id?: string | null;
	lacak_bahan: boolean;
}

interface RecipeDraft {
	bahan_id: string;
	porsi: string;
	jumlah_per_item: number;
	satuan_resep: string;
	jumlah_dasar_per_item: number;
}

function validateAtomicMenuPayload(product: ProductDraft, recipes: RecipeDraft[]) {
	if (!product.nama || product.nama.trim().length === 0) {
		throw new Error('Nama produk wajib diisi');
	}
	if (!Number.isFinite(product.harga) || product.harga < 0) {
		throw new Error('Harga produk tidak valid');
	}
	if (
		product.harga_jumbo !== null &&
		product.harga_jumbo !== undefined &&
		product.harga_jumbo < 0
	) {
		throw new Error('Harga jumbo tidak valid');
	}

	if (product.lacak_bahan) {
		if (!recipes.length) {
			throw new Error('Produk dengan lacak bahan wajib memiliki resep');
		}
		const seen = new Set<string>();
		for (const r of recipes) {
			if (!r.bahan_id) throw new Error('Bahan resep wajib dipilih');
			if (r.jumlah_per_item <= 0) throw new Error('Takaran resep harus > 0');
			if (r.jumlah_dasar_per_item <= 0) throw new Error('Takaran dasar resep harus > 0');
			const porsi = r.porsi ? String(r.porsi).trim().toLowerCase() : 'reguler';
			if (porsi !== 'reguler' && porsi !== 'jumbo') {
				throw new Error(`Porsi resep tidak valid: ${porsi}`);
			}
			const key = `${r.bahan_id}:${porsi}`;
			if (seen.has(key)) {
				throw new Error(`Resep duplikat untuk bahan ${r.bahan_id} pada porsi ${porsi}`);
			}
			seen.add(key);
		}
	}
	return true;
}

// Valid payload
const validProd: ProductDraft = {
	nama: 'Jus Alpukat',
	harga: 15_000,
	harga_jumbo: 18_000,
	lacak_bahan: true
};
const validRecipes: RecipeDraft[] = [
	{
		bahan_id: 'b-alpukat',
		porsi: 'reguler',
		jumlah_per_item: 150,
		satuan_resep: 'gram',
		jumlah_dasar_per_item: 150
	},
	{
		bahan_id: 'b-susu',
		porsi: 'reguler',
		jumlah_per_item: 30,
		satuan_resep: 'ml',
		jumlah_dasar_per_item: 30
	}
];
assert.equal(validateAtomicMenuPayload(validProd, validRecipes), true);

// Invalid cases
assert.throws(
	() => validateAtomicMenuPayload({ ...validProd, nama: '' }, validRecipes),
	/Nama produk wajib diisi/
);
assert.throws(
	() => validateAtomicMenuPayload({ ...validProd, harga: -5000 }, validRecipes),
	/Harga produk tidak valid/
);
assert.throws(
	() => validateAtomicMenuPayload(validProd, []),
	/Produk dengan lacak bahan wajib memiliki resep/
);
assert.throws(
	() =>
		validateAtomicMenuPayload(validProd, [
			{ ...validRecipes[0], jumlah_per_item: 0, jumlah_dasar_per_item: 0 }
		]),
	/Takaran resep harus > 0/
);
assert.throws(
	() => validateAtomicMenuPayload(validProd, [{ ...validRecipes[0], porsi: 'medium' }]),
	/Porsi resep tidak valid/
);
assert.throws(
	() =>
		validateAtomicMenuPayload(validProd, [
			validRecipes[0],
			{ ...validRecipes[0], jumlah_per_item: 50 }
		]),
	/Resep duplikat/
);

// 3. Ekstra IDs Serialization Tests
function serializeEkstraIds(ekstraIds: unknown): string {
	return Array.isArray(ekstraIds)
		? JSON.stringify(ekstraIds)
		: typeof ekstraIds === 'string' && ekstraIds.trim()
			? ekstraIds
			: '[]';
}

assert.equal(serializeEkstraIds([]), '[]');
assert.equal(serializeEkstraIds(['topping-1', 'topping-2']), '["topping-1","topping-2"]');
assert.equal(serializeEkstraIds(null), '[]');
assert.equal(serializeEkstraIds(undefined), '[]');
assert.equal(serializeEkstraIds('["custom"]'), '["custom"]');

console.log('menu-atomic-tests: 15 assertions passed');
