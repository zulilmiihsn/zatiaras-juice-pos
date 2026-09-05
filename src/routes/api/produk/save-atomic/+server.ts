import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { RequestHandler } from './$types';

interface AtomicProductInput {
	id?: string | null;
	nama: string;
	harga: number;
	harga_jumbo?: number | null;
	kategori_id?: string | null;
	tipe?: string | null;
	stok?: number | null;
	lacak_stok?: boolean | number;
	lacak_bahan?: boolean | number;
	ekstra_ids?: string | Array<string | number> | null;
	gambar?: string | null;
	is_active?: boolean | number;
}

interface AtomicRecipeInput {
	bahan_id: string;
	porsi?: string | null;
	jumlah_per_item: number;
	satuan_resep?: string | null;
	jumlah_dasar_per_item?: number;
}

interface SaveAtomicBody {
	branch?: string;
	produk: AtomicProductInput;
	resep?: AtomicRecipeInput[];
}

export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	const body = await parseBody<SaveAtomicBody>(request);
	const requestedBranch = url.searchParams.get('branch') || body?.branch;
	const branch = requireSessionBranch(locals, requestedBranch);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	if (!body?.produk || !body.produk.nama) {
		throw kitError(400, 'Data produk tidak lengkap');
	}

	const prod = body.produk;
	const productId = prod.id || crypto.randomUUID();
	const isEdit = Boolean(prod.id);
	const now = new Date().toISOString();

	const harga = Math.max(0, Number(prod.harga || 0));
	const hargaJumbo =
		prod.harga_jumbo !== null &&
		prod.harga_jumbo !== undefined &&
		Number.isFinite(Number(prod.harga_jumbo))
			? Math.max(0, Number(prod.harga_jumbo))
			: null;
	const stok =
		prod.stok !== null && prod.stok !== undefined && Number.isFinite(Number(prod.stok))
			? Number(prod.stok)
			: null;
	const lacakStok = Boolean(prod.lacak_stok);
	const lacakBahan = Boolean(prod.lacak_bahan);
	const isActive = prod.is_active !== undefined ? Boolean(prod.is_active) : true;
	const tipe = prod.tipe ? String(prod.tipe).trim().toLowerCase() : 'minuman';

	const ekstraIdsJson = Array.isArray(prod.ekstra_ids)
		? JSON.stringify(prod.ekstra_ids)
		: typeof prod.ekstra_ids === 'string' && prod.ekstra_ids.trim()
			? prod.ekstra_ids
			: '[]';

	const rawDb = getRawDb(platform, branch);

	// Validate recipes when lacak_bahan is enabled
	const rawRecipes = Array.isArray(body.resep) ? body.resep : [];
	if (lacakBahan && rawRecipes.length === 0) {
		throw kitError(400, 'Produk dengan lacak bahan wajib memiliki minimal 1 resep bahan baku');
	}

	const normalizedRecipes: Array<{
		id: string;
		bahan_id: string;
		porsi: string;
		qty: number;
		satuanResep: string | null;
		baseQty: number;
	}> = [];

	if (lacakBahan && rawRecipes.length > 0) {
		const bahanIds = rawRecipes.map((r) => String(r.bahan_id || '').trim()).filter(Boolean);
		if (bahanIds.length !== rawRecipes.length) {
			throw kitError(400, 'Semua item resep wajib memiliki bahan_id');
		}

		// Verify that all ingredients exist in the active branch
		const placeholders = bahanIds.map(() => '?').join(',');
		const validBahanRows = (await rawDb
			.prepare(`SELECT id FROM bahan WHERE cabang_id = ? AND id IN (${placeholders})`)
			.bind(branch, ...bahanIds)
			.all()) as { results?: Array<{ id: string }> };

		const validBahanSet = new Set((validBahanRows.results || []).map((r) => String(r.id)));
		for (const bid of bahanIds) {
			if (!validBahanSet.has(bid)) {
				throw kitError(400, `Bahan baku dengan ID ${bid} tidak ditemukan di cabang ${branch}`);
			}
		}

		const seenRecipeKeys = new Set<string>();
		for (const r of rawRecipes) {
			const bahanId = String(r.bahan_id || '').trim();
			const qty = Number(r.jumlah_per_item);
			const baseQty = Number(r.jumlah_dasar_per_item ?? qty);

			if (!Number.isFinite(qty) || qty <= 0) {
				throw kitError(400, `Takaran resep untuk bahan ${bahanId} harus lebih besar dari 0`);
			}
			if (!Number.isFinite(baseQty) || baseQty <= 0) {
				throw kitError(400, `Takaran dasar resep untuk bahan ${bahanId} harus lebih besar dari 0`);
			}

			const porsi = r.porsi ? String(r.porsi).trim().toLowerCase() : 'reguler';
			if (porsi !== 'reguler' && porsi !== 'jumbo') {
				throw kitError(400, `Porsi resep tidak valid (harus reguler atau jumbo): ${porsi}`);
			}

			const recipeKey = `${bahanId}:${porsi}`;
			if (seenRecipeKeys.has(recipeKey)) {
				throw kitError(400, `Resep duplikat untuk bahan ${bahanId} pada porsi ${porsi}`);
			}
			seenRecipeKeys.add(recipeKey);

			const recipeId = crypto.randomUUID();
			const satuanResep = r.satuan_resep ? String(r.satuan_resep).trim() : null;

			normalizedRecipes.push({
				id: recipeId,
				bahan_id: bahanId,
				porsi,
				qty,
				satuanResep,
				baseQty
			});
		}
	}

	const statements: D1PreparedStatement[] = [];

	if (isEdit) {
		statements.push(
			rawDb
				.prepare(
					`UPDATE produk SET
						nama = ?,
						harga = ?,
						harga_jumbo = ?,
						kategori_id = ?,
						tipe = ?,
						stok = ?,
						lacak_stok = ?,
						lacak_bahan = ?,
						ekstra_ids = ?,
						gambar = ?,
						is_active = ?,
						updated_at = ?
					WHERE cabang_id = ? AND id = ?`
				)
				.bind(
					prod.nama.trim(),
					harga,
					hargaJumbo,
					prod.kategori_id || null,
					tipe,
					stok,
					lacakStok ? 1 : 0,
					lacakBahan ? 1 : 0,
					ekstraIdsJson,
					prod.gambar || null,
					isActive ? 1 : 0,
					now,
					branch,
					productId
				)
		);
	} else {
		statements.push(
			rawDb
				.prepare(
					`INSERT INTO produk (
						id, cabang_id, nama, harga, harga_jumbo, kategori_id, tipe, stok,
						lacak_stok, lacak_bahan, ekstra_ids, gambar, is_active, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					productId,
					branch,
					prod.nama.trim(),
					harga,
					hargaJumbo,
					prod.kategori_id || null,
					tipe,
					stok,
					lacakStok ? 1 : 0,
					lacakBahan ? 1 : 0,
					ekstraIdsJson,
					prod.gambar || null,
					isActive ? 1 : 0,
					now,
					now
				)
		);
	}

	// Always clear existing recipes in the atomic batch
	statements.push(
		rawDb
			.prepare('DELETE FROM resep_produk WHERE cabang_id = ? AND produk_id = ?')
			.bind(branch, productId)
	);

	for (const r of normalizedRecipes) {
		statements.push(
			rawDb
				.prepare(
					`INSERT INTO resep_produk (
						id, cabang_id, produk_id, bahan_id, porsi,
						jumlah_per_item, satuan_resep, jumlah_dasar_per_item, created_at, updated_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
				)
				.bind(
					r.id,
					branch,
					productId,
					r.bahan_id,
					r.porsi,
					r.qty,
					r.satuanResep,
					r.baseQty,
					now,
					now
				)
		);
	}

	// Execute atomic batch
	await rawDb.batch(statements);

	// Publish realtime events
	await Promise.all([
		publish(platform, branch, 'produk', isEdit ? 'update' : 'insert', { id: productId }),
		publish(platform, branch, 'resep_produk', 'update', { transaction_id: productId })
	]);

	// Audit log
	await auditDataChange(rawDb, branch, session, 'produk', isEdit ? 'update' : 'insert', productId, {
		nama: prod.nama,
		harga,
		harga_jumbo: hargaJumbo,
		recipesCount: normalizedRecipes.length
	});

	return json({
		ok: true,
		data: {
			product: {
				id: productId,
				cabang_id: branch,
				nama: prod.nama.trim(),
				harga,
				harga_jumbo: hargaJumbo,
				kategori_id: prod.kategori_id || null,
				tipe,
				stok,
				lacak_stok: lacakStok,
				lacak_bahan: lacakBahan,
				ekstra_ids: ekstraIdsJson,
				gambar: prod.gambar || null,
				is_active: isActive
			},
			recipes: normalizedRecipes
		}
	});
};
