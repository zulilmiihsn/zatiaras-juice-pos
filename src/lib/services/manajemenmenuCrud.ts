import { productService } from '$lib/services/productService';
import { transactionService } from '$lib/services/transactionService';
import type {
	AddOn,
	Category,
	HppSettings,
	Ingredient,
	Product,
	ProductRecipe
} from '$lib/types/product';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';

export interface HppParsedItem {
	nama: string;
	satuan: string;
	purchase_qty: number;
	purchase_cost: number;
	biaya_per_satuan: number;
}

export function createMenuCrud() {
	return {
		load: () => productService.getProducts(),
		loadRecipes: async (productId?: string | number): Promise<ProductRecipe[]> =>
			(await productService.getProductRecipes(productId)) as unknown as ProductRecipe[],
		save: (payload: Record<string, unknown>, id?: string | number | null) =>
			id
				? transactionService.updateRows('produk', payload, { id: String(id) })
				: transactionService.insertRows('produk', payload),
		async saveRecipes(
			productId: string | number,
			items: Array<{
				bahan_id: string | number;
				jumlah_per_item: string | number;
				satuan_resep?: string;
				jumlah_dasar_per_item?: number;
			}>,
			enabled: boolean
		) {
			const response = await fetchWithCsrfRetry(
				`/api/resep-produk?produk_id=${encodeURIComponent(String(productId))}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						payload: enabled
							? items.map((item) => ({
									produk_id: String(productId),
									bahan_id: String(item.bahan_id),
									porsi: (item as any).porsi || 'reguler',
									jumlah_per_item: Number(item.jumlah_per_item || 0),
									satuan_resep: item.satuan_resep || null,
									jumlah_dasar_per_item: Number(
										item.jumlah_dasar_per_item ?? item.jumlah_per_item ?? 0
									)
								}))
							: []
					})
				}
			);
			if (!response.ok) throw new Error(`Gagal menyimpan resep: HTTP ${response.status}`);
		},
		remove: (id: string | number) => transactionService.deleteRows('produk', { id: String(id) }),
		updateCategories: (ids: Array<string | number>, kategoriId: string | number | null) =>
			transactionService.updateRows(
				'produk',
				{ kategori_id: kategoriId },
				{ ids: ids.map(String).join(',') }
			),
		updateCategory: (id: string | number, kategoriId: string | number | null) =>
			transactionService.updateRows('produk', { kategori_id: kategoriId }, { id: String(id) })
	};
}

export function createKategoriCrud() {
	return {
		load: () => productService.getCategories(),
		save: (name: string, id?: string | number | null) =>
			id
				? transactionService.updateRows('kategori', { nama: name }, { id: String(id) })
				: transactionService.insertRows('kategori', { nama: name }),
		clearProducts: (id: string | number) =>
			transactionService.updateRows('produk', { kategori_id: null }, { kategori_id: String(id) }),
		remove: (id: string | number) => transactionService.deleteRows('kategori', { id: String(id) })
	};
}

export function createEkstraCrud() {
	return {
		load: async (): Promise<Array<AddOn & { harga: number }>> =>
			(await productService.getAddOns()).map((item) => ({ ...item, harga: item.harga })),
		save: (payload: Record<string, unknown>, id?: string | number | null) =>
			id
				? transactionService.updateRows('tambahan', payload, { id: String(id) })
				: transactionService.insertRows('tambahan', payload),
		remove: (id: string | number) => transactionService.deleteRows('tambahan', { id: String(id) })
	};
}

export function createBahanCrud() {
	return {
		load: async (): Promise<Ingredient[]> =>
			(await productService.getIngredients(true)) as unknown as Ingredient[],
		save: (payload: Record<string, unknown>, id?: string | number | null) =>
			id
				? transactionService.updateRows('bahan', payload, { id: String(id) })
				: transactionService.insertRows('bahan', payload),
		mutate: (id: string | number, delta: number, catatan: string) =>
			transactionService.insertRows('bahan_mutasi', {
				bahan_id: String(id),
				delta_jumlah: delta,
				source: 'manual',
				catatan
			}),
		remove: (id: string | number) => transactionService.deleteRows('bahan', { id: String(id) })
	};
}

export function createHppState() {
	return {
		loadSettings: async (): Promise<HppSettings | null> =>
			(await productService.getHppSettings()) as unknown as HppSettings | null,
		loadRecipes: async (): Promise<ProductRecipe[]> =>
			(await productService.getProductRecipes()) as unknown as ProductRecipe[],
		saveSettings: (payload: Record<string, unknown>, id?: string | number | null) =>
			id
				? transactionService.updateRows('hpp_settings', payload, { id: '1' })
				: transactionService.insertRows('hpp_settings', payload),
		async parsePurchase(text: string): Promise<HppParsedItem[]> {
			const response = await fetchWithCsrfRetry('/api/hpp/parse', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text })
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data?.message || 'Gagal parse belanja');
			return data.items || [];
		},
		async savePurchasedItem(item: HppParsedItem, existing?: Ingredient) {
			if (existing) {
				await transactionService.updateRows(
					'bahan',
					{
						satuan: item.satuan,
						yield_persen: 100, // default
						jumlah_beli_terakhir: item.purchase_qty, // interpreted as portions
						biaya_beli_terakhir: item.purchase_cost,
						biaya_per_satuan: calculateEffectiveUnitCost(item.purchase_cost, item.purchase_qty)
					},
					{ id: String(existing.id) }
				);
				await transactionService.insertRows('bahan_mutasi', {
					bahan_id: String(existing.id),
					delta_jumlah: item.purchase_qty, // portions
					source: 'purchase',
					catatan: `Belanja Rp ${Math.round(Number(item.purchase_cost || 0)).toLocaleString('id-ID')}`
				});
				return;
			}
			const inserted = await transactionService.insertRows('bahan', {
				nama: item.nama,
				satuan: item.satuan,
				stok_saat_ini: 0,
				ambang_stok: 0,
				yield_persen: 100,
				jumlah_beli_terakhir: item.purchase_qty,
				biaya_beli_terakhir: item.purchase_cost,
				biaya_per_satuan: calculateEffectiveUnitCost(item.purchase_cost, item.purchase_qty)
			});
			const bahanId = inserted.data?.[0]?.id;
			if (typeof bahanId !== 'string' && typeof bahanId !== 'number') {
				throw new Error('Bahan baru tersimpan tanpa ID yang valid');
			}
			await transactionService.insertRows('bahan_mutasi', {
				bahan_id: String(bahanId),
				delta_jumlah: item.purchase_qty,
				source: 'purchase',
				catatan: `Belanja Rp ${Math.round(Number(item.purchase_cost || 0)).toLocaleString('id-ID')}`
			});
		}
	};
}

export type MenuEntity = Product;
export type KategoriEntity = Category;
