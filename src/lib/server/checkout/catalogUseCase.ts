/**
 * Katalog POS use case — rakitan katalog bertanda tangan untuk kasir.
 *
 * Route (`src/routes/api/pos/catalog/+server.ts`) hanya: auth, panggil
 * fungsi di sini, petakan hasil/error ke HTTP. Seluruh SQL, signing harga,
 * epoch policy, dan shaping tinggal di sini.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { getD1Database, type BranchContext } from '../branchResolver';
import { getPosPricingKeyId, signPosPricingToken } from '../posPricingToken';
import { loadStockPolicy } from '../stockPolicy';
import { signStockPolicyEpoch } from '../stockPolicyEpoch';
import { MS_PER_DAY } from '$lib/constants/time';

export const CATALOG_TOKEN_TTL_MS = MS_PER_DAY;

interface CatalogProductRow {
	id: string;
	nama: string;
	harga: number;
	harga_jumbo: number | null;
	stok: number | null;
	lacak_stok: number | boolean | null;
	lacak_bahan: number | boolean | null;
	kategori_id: string | null;
	tipe: 'minuman' | 'makanan' | 'snack';
	gambar: string | null;
	deskripsi: string | null;
	ekstra_ids: string | Array<string | number> | null;
	is_active: number | boolean;
	created_at: string | null;
	updated_at: string | null;
}

interface CatalogCategoryRow {
	id: string;
	nama: string;
	deskripsi: string | null;
	is_active: number | boolean;
	created_at: string | null;
	updated_at: string | null;
}

interface CatalogAddOnRow {
	id: string;
	nama: string;
	harga: number;
	is_active: number | boolean;
	created_at: string | null;
	updated_at: string | null;
}

interface CatalogIngredientRow {
	id: string;
	nama: string;
	satuan: string;
	stok_saat_ini: number | null;
	ambang_stok: number | null;
	is_active: number | boolean;
}

interface CatalogRecipeRow {
	id: string;
	produk_id: string;
	bahan_id: string;
	porsi: string | null;
	jumlah_per_item: number;
	satuan_resep: string | null;
	jumlah_dasar_per_item: number | null;
}

function parseIds(value: CatalogProductRow['ekstra_ids']): Array<string | number> {
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function buildPosCatalog(
	db: D1Database,
	branch: BranchContext,
	platform: App.Platform | undefined
) {
	const now = Date.now();
	const fetchedAt = new Date(now).toISOString();
	const expiresAt = new Date(now + CATALOG_TOKEN_TTL_MS).toISOString();

	const [productResult, categoryResult, addOnResult, ingredientResult, recipeResult] =
		await Promise.all([
			db
				.prepare(
					`SELECT id, nama, harga, harga_jumbo, stok, lacak_stok, lacak_bahan, kategori_id, tipe,
					        gambar, deskripsi, ekstra_ids, is_active, created_at, updated_at
					   FROM produk
					  WHERE cabang_id = ? AND is_active = 1
					  ORDER BY created_at DESC`
				)
				.bind(branch)
				.all<CatalogProductRow>(),
			db
				.prepare(
					`SELECT id, nama, deskripsi, is_active, created_at, updated_at
					   FROM kategori
					  WHERE cabang_id = ? AND is_active = 1
					  ORDER BY created_at DESC`
				)
				.bind(branch)
				.all<CatalogCategoryRow>(),
			db
				.prepare(
					`SELECT id, nama, harga, is_active, created_at, updated_at
					   FROM tambahan
					  WHERE cabang_id = ? AND is_active = 1
					  ORDER BY created_at DESC`
				)
				.bind(branch)
				.all<CatalogAddOnRow>(),
			db
				.prepare(
					`SELECT id, nama, satuan, stok_saat_ini, ambang_stok, is_active
					   FROM bahan
					  WHERE cabang_id = ? AND is_active = 1`
				)
				.bind(branch)
				.all<CatalogIngredientRow>(),
			db
				.prepare(
					`SELECT id, produk_id, bahan_id, porsi, jumlah_per_item, satuan_resep, jumlah_dasar_per_item
					   FROM resep_produk
					  WHERE cabang_id = ?`
				)
				.bind(branch)
				.all<CatalogRecipeRow>()
		]);

	const products = await Promise.all(
		(productResult.results || []).map(async (product) => ({
			...product,
			ekstra_ids: parseIds(product.ekstra_ids),
			is_active: Boolean(product.is_active),
			price_token: await signPosPricingToken(platform?.env, {
				kind: 'catalog_product',
				branch,
				ttlMs: CATALOG_TOKEN_TTL_MS,
				now,
				data: {
					id: product.id,
					nama: product.nama,
					harga: Number(product.harga),
					harga_jumbo: product.harga_jumbo != null ? Number(product.harga_jumbo) : null,
					updated_at: product.updated_at
				}
			})
		}))
	);
	const policy = await loadStockPolicy(db, branch);
	let epochToken = '';
	try {
		epochToken = await signStockPolicyEpoch(platform?.env, {
			branch,
			mode: policy.mode,
			revision: policy.revision,
			now
		});
	} catch {
		epochToken = '';
	}
	const addOns = await Promise.all(
		(addOnResult.results || []).map(async (addOn) => ({
			...addOn,
			is_active: Boolean(addOn.is_active),
			price_token: await signPosPricingToken(platform?.env, {
				kind: 'catalog_add_on',
				branch,
				ttlMs: CATALOG_TOKEN_TTL_MS,
				now,
				data: {
					id: addOn.id,
					nama: addOn.nama,
					harga: Number(addOn.harga),
					updated_at: addOn.updated_at
				}
			})
		}))
	);

	return {
		version: 2,
		branch,
		products,
		categories: (categoryResult.results || []).map((category) => ({
			...category,
			is_active: Boolean(category.is_active)
		})),
		addOns,
		ingredients: (ingredientResult.results || []).map((ing) => ({
			...ing,
			is_active: Boolean(ing.is_active),
			stok_saat_ini: Number(ing.stok_saat_ini || 0),
			ambang_stok: Number(ing.ambang_stok || 0)
		})),
		recipes: (recipeResult.results || []).map((r) => ({
			id: String(r.id),
			produk_id: String(r.produk_id),
			bahan_id: String(r.bahan_id),
			porsi: r.porsi || 'reguler',
			jumlah_per_item: Number(r.jumlah_per_item || 0),
			satuan_resep: r.satuan_resep || null,
			jumlah_dasar_per_item:
				r.jumlah_dasar_per_item != null ? Number(r.jumlah_dasar_per_item) : null
		})),
		fetched_at: fetchedAt,
		expires_at: expiresAt,
		signing_key_id: getPosPricingKeyId(platform?.env),
		stock_policy: {
			mode: policy.mode,
			revision: policy.revision,
			updated_at: policy.updated_at,
			epoch_token: epochToken
		}
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function buildPosCatalogForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext
) {
	return buildPosCatalog(
		getD1Database(platform?.env as Record<string, unknown> | undefined, branch),
		branch,
		platform
	);
}
