import { error as kitError, json } from '@sveltejs/kit';
import { requireAnyRole, requireSessionBranch } from '$lib/server/apiAuth';
import { getD1Database } from '$lib/server/branchResolver';
import {
	getPosPricingKeyId,
	PosPricingTokenError,
	signPosPricingToken
} from '$lib/server/posPricingToken';
import type { RequestHandler } from './$types';

const CATALOG_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

export const GET: RequestHandler = async ({ platform, locals }) => {
	const branch = requireSessionBranch(locals);
	requireAnyRole(locals.authSession!.role, ['kasir', 'pemilik']);
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
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

	try {
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

		return json(
			{
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
				signing_key_id: getPosPricingKeyId(platform?.env)
			},
			{ headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		if (error instanceof PosPricingTokenError && error.code === 'SIGNING_KEY_UNAVAILABLE') {
			throw kitError(503, 'Layanan harga POS belum dikonfigurasi');
		}
		throw error;
	}
};
