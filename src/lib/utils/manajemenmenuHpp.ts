import type { HppSettings, Ingredient, Product, ProductRecipe } from '$lib/types/product';

type HppSources = {
	getSettings: () => HppSettings | null;
	getIngredients: () => Ingredient[];
	getRecipes: () => ProductRecipe[];
};

export function createHppCalculator(sources: HppSources) {
	const ingredient = (id: string | number) =>
		sources.getIngredients().find((item) => String(item.id) === String(id));

	const getOverheadMonthly = () => {
		const settings = sources.getSettings();
		if (!settings) return 0;
		if (settings.rincian_biaya) {
			try {
				const items =
					typeof settings.rincian_biaya === 'string'
						? JSON.parse(settings.rincian_biaya)
						: settings.rincian_biaya;
				if (Array.isArray(items) && items.length > 0) {
					return items.reduce((sum, item) => {
						const raw =
							typeof item.nominal === 'number'
								? item.nominal
								: Number(String(item.nominal || 0).replace(/\./g, ''));
						return sum + (Number.isNaN(raw) ? 0 : raw);
					}, 0);
				}
			} catch {}
		}
		return (
			Number(settings.sewa_bulanan || 0) +
			Number(settings.listrik_bulanan || 0) +
			Number(settings.air_bulanan || 0) +
			Number(settings.gaji_bulanan || 0) +
			Number(settings.lainnya_bulanan || 0)
		);
	};

	const getOverheadPerItem = () => {
		const target = Math.max(1, Number(sources.getSettings()?.target_item_bulanan || 1000));
		return Math.round(getOverheadMonthly() / target);
	};

	const getProductRecipeCost = (
		productId: string | number,
		porsi: 'reguler' | 'jumbo' = 'reguler'
	) => {
		const allRecipes = sources
			.getRecipes()
			.filter((recipe) => String(recipe.produk_id) === String(productId));
		let recipes = allRecipes.filter((r) => (r.porsi || 'reguler') === porsi);
		if (!recipes.length && porsi === 'jumbo') {
			recipes = allRecipes.filter((r) => (r.porsi || 'reguler') === 'reguler');
		}
		if (!recipes.length) {
			recipes = allRecipes;
		}
		return recipes.reduce((total, recipe) => {
			const qty = Number(recipe.jumlah_dasar_per_item ?? recipe.jumlah_per_item ?? 0);
			return total + qty * Number(ingredient(recipe.bahan_id)?.biaya_per_satuan || 0);
		}, 0);
	};

	const getProductHpp = (menu: Product, porsi: 'reguler' | 'jumbo' = 'reguler') =>
		Math.round(getProductRecipeCost(menu.id, porsi) + getOverheadPerItem());
	const getProductMargin = (menu: Product, porsi: 'reguler' | 'jumbo' = 'reguler') => {
		const price = porsi === 'jumbo' ? (menu.harga_jumbo ?? menu.harga ?? 0) : (menu.harga ?? 0);
		return Number(price || 0) - getProductHpp(menu, porsi);
	};

	return {
		getBahanName: (id: string | number) => ingredient(id)?.nama || 'Bahan',
		getBahanUnit: (id: string | number) => ingredient(id)?.satuan || '',
		getBahanCostPerUnit: (id: string | number) => Number(ingredient(id)?.biaya_per_satuan || 0),
		getOverheadMonthly,
		getOverheadPerItem,
		getProductRecipeCost,
		getProductHpp,
		getProductMargin
	};
}
