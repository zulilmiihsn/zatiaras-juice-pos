import type { D1Database, DurableObjectTransaction } from '@cloudflare/workers-types';
import type { BranchContext } from './branchResolver';
import { loadStockPolicy, type StockPolicyMode } from './stockPolicy';
import { CheckoutDomainError } from './checkout/utils';
import { selectRecipe } from './checkout/financials';
import type { PosTransactionItemInput } from './checkout/types';

const MODE = 'inventory:mode';
type IngredientUse = { ingredientId: string; amount: number };
type RecipeUse = IngredientUse & { porsi?: string | null };
type ProductStock = { id: string; remaining: number | null; recipe: RecipeUse[] | null };
export interface KioskInventorySeed {
	mode: StockPolicyMode;
	products: ProductStock[];
	ingredients: Array<{ id: string; remaining: number }>;
	addOns: Array<{ id: string; usage: IngredientUse | null }>;
}

/** Only call after legacy checkout is fenced and stock is reconciled. */
export async function readKioskInventorySeed(
	db: D1Database,
	branch: BranchContext
): Promise<KioskInventorySeed> {
	const policy = await loadStockPolicy(db, branch);
	if (policy.mode === 'ignored')
		return { mode: 'ignored', products: [], ingredients: [], addOns: [] };
	const [products, ingredients, recipes, addOns] = await db.batch<{
		id: string;
		stok?: number | null;
		lacak_stok?: number;
		lacak_bahan?: number;
		bahan_id?: string | null;
		amount?: number | null;
		porsi?: string | null;
	}>([
		db
			.prepare(
				'SELECT id, stok, lacak_stok, lacak_bahan FROM produk WHERE cabang_id=? AND is_active=1'
			)
			.bind(branch),
		db
			.prepare('SELECT id, stok_saat_ini AS amount FROM bahan WHERE cabang_id=? AND is_active=1')
			.bind(branch),
		db
			.prepare(
				`SELECT rp.produk_id AS id, rp.bahan_id, rp.porsi, COALESCE(rp.jumlah_dasar_per_item,rp.jumlah_per_item) AS amount
			FROM resep_produk rp JOIN bahan b ON b.id=rp.bahan_id AND b.cabang_id=rp.cabang_id
			WHERE rp.cabang_id=? AND b.is_active=1`
			)
			.bind(branch),
		db
			.prepare(
				`SELECT id, bahan_id, COALESCE(jumlah_dasar_per_item,jumlah_bahan) AS amount
			FROM tambahan WHERE cabang_id=? AND is_active=1`
			)
			.bind(branch)
	]);
	const grouped = new Map<string, RecipeUse[]>();
	for (const row of recipes.results) {
		if (!row.bahan_id) continue;
		const group = grouped.get(row.id) ?? [];
		group.push({ ingredientId: row.bahan_id, amount: Number(row.amount), porsi: row.porsi });
		grouped.set(row.id, group);
	}
	return {
		mode: 'tracked',
		products: products.results.map((row) => {
			const remaining = row.lacak_stok === 1 ? Number(row.stok ?? 0) : null;
			if (remaining !== null && (!Number.isSafeInteger(remaining) || remaining < 0))
				throw new Error('Stok awal produk kios belum direkonsiliasi');
			return {
				id: row.id,
				remaining,
				recipe: row.lacak_bahan === 1 ? (grouped.get(row.id) ?? []) : null
			};
		}),
		ingredients: ingredients.results.map((row) => {
			const remaining = Number(row.amount ?? 0);
			if (!Number.isFinite(remaining) || remaining < 0)
				throw new Error('Stok awal bahan kios belum direkonsiliasi');
			return { id: row.id, remaining };
		}),
		addOns: addOns.results.map((row) => ({
			id: row.id,
			usage: row.bahan_id ? { ingredientId: row.bahan_id, amount: Number(row.amount) } : null
		}))
	};
}

export async function seedKioskInventory(tx: DurableObjectTransaction, seed: KioskInventorySeed) {
	for (const product of seed.products) await tx.put('inventory:product:' + product.id, product);
	for (const ingredient of seed.ingredients)
		await tx.put('inventory:ingredient:' + ingredient.id, ingredient.remaining);
	for (const addOn of seed.addOns) await tx.put('inventory:extra:' + addOn.id, addOn);
	await tx.put(MODE, seed.mode);
}

/** A single storage transaction owns availability, receipt, and outbox. */
export async function reserveKioskInventory(
	tx: DurableObjectTransaction,
	items: PosTransactionItemInput[]
) {
	const mode = await tx.get<StockPolicyMode>(MODE);
	if (mode === 'ignored') return;
	if (mode !== 'tracked') throw new CheckoutDomainError(409, 'Stok kios belum disiapkan');
	const products = new Map<string, ProductStock>();
	const ingredientDemand = new Map<string, number>();
	const extras = new Map<string, KioskInventorySeed['addOns'][number]>();
	function addUse(usage: IngredientUse, qty: number) {
		const total = (ingredientDemand.get(usage.ingredientId) ?? 0) + usage.amount * qty;
		if (!(usage.amount > 0) || !Number.isFinite(total))
			throw new CheckoutDomainError(409, 'Takaran bahan belum valid');
		ingredientDemand.set(usage.ingredientId, total);
	}
	for (const item of items) {
		const id = item.product_id;
		if (!id) throw new CheckoutDomainError(409, 'Produk belum tersedia di stok kios');
		const product = products.get(id) ?? (await tx.get<ProductStock>('inventory:product:' + id));
		if (!product) throw new CheckoutDomainError(409, 'Produk belum tersedia di stok kios');
		if (product.remaining !== null && product.remaining < item.jumlah)
			throw new CheckoutDomainError(409, 'Stok produk kios tidak mencukupi');
		products.set(id, {
			...product,
			remaining: product.remaining === null ? null : product.remaining - item.jumlah
		});
		if (product.recipe !== null) {
			const recipe = selectRecipe(product.recipe, item.porsi === 'jumbo');
			if (!recipe.length) throw new CheckoutDomainError(409, 'Resep bahan belum tersedia di kios');
			for (const row of recipe) addUse(row, item.jumlah);
		}
		for (const extraId of item.add_on_ids ?? []) {
			const key = String(extraId);
			const extra =
				extras.get(key) ??
				(await tx.get<KioskInventorySeed['addOns'][number]>('inventory:extra:' + key));
			if (!extra) throw new CheckoutDomainError(409, 'Tambahan belum tersedia di stok kios');
			extras.set(key, extra);
			if (extra.usage) addUse(extra.usage, item.jumlah);
		}
	}
	for (const [id, qty] of ingredientDemand) {
		const key = 'inventory:ingredient:' + id;
		const remaining = await tx.get<number>(key);
		if (remaining === undefined || remaining < qty)
			throw new CheckoutDomainError(409, 'Stok bahan kios tidak mencukupi');
		await tx.put(key, remaining - qty);
	}
	for (const [id, product] of products) {
		if (product.remaining !== null) await tx.put('inventory:product:' + id, product);
	}
}
