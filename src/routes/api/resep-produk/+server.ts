import { json, error as kitError } from '@sveltejs/kit';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { resepProduk } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import type { RequestHandler } from './$types';

/**
 * /api/resep-produk — Resource route untuk tabel `resep_produk` (resep bahan per menu).
 * Menggantikan dispatch dari /api/data?table=resep_produk.
 * DELETE mendukung dua mode:
 *   - ?id=<id>            → hapus satu baris
 *   - ?produk_id=<id>    → hapus semua resep untuk produk (bulk, dipakai saat ganti resep)
 * RBAC: pemilik (owner) untuk insert/delete.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const productId = url.searchParams.get('produk_id');

	const filters: SQL[] = [eq(resepProduk.cabang_id, branch)];
	if (productId) filters.push(eq(resepProduk.produk_id, productId));

	const rows = await db
		.select()
		.from(resepProduk)
		.where(and(...filters))
		.orderBy(desc(resepProduk.created_at))
		.limit(limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);
	const rows = payloadRows(body.payload, branch).map((row) => ({
		...row,
		produk_id: String(row.produk_id || ''),
		bahan_id: String(row.bahan_id || ''),
		jumlah_per_item: Number(row.jumlah_per_item || 0)
	})) as Array<Record<string, any>>;
	if (rows.some((row) => !row.produk_id || !row.bahan_id || row.jumlah_per_item <= 0)) {
		throw kitError(400, 'Resep bahan tidak valid');
	}
	await db.insert(resepProduk).values(rows as (typeof resepProduk.$inferInsert)[]);
	await publish(platform, branch, 'resep_produk', 'insert', {
		id: rows[0]?.id,
		transaction_id: rows[0]?.produk_id as string | undefined
	});
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'insert', rows[0]?.id, {
		count: rows.length,
		produk_id: rows[0]?.produk_id
	});
	return json({ ok: true, data: rows });
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	const productId = url.searchParams.get('produk_id');
	if (!id && !productId) throw kitError(400, 'id atau produk_id diperlukan');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	if (productId) {
		// Bulk delete: hapus semua resep untuk produk (dipakai sebelum insert resep baru).
		await db
			.delete(resepProduk)
			.where(and(eq(resepProduk.cabang_id, branch), eq(resepProduk.produk_id, productId)));
		await publish(platform, branch, 'resep_produk', 'delete', { transaction_id: productId });
		await auditDataChange(rawDb, branch, session, 'resep_produk', 'delete_by_product', null, {
			produk_id: productId
		});
		return json({ ok: true });
	}

	await db
		.delete(resepProduk)
		.where(and(eq(resepProduk.cabang_id, branch), eq(resepProduk.id, String(id))));
	await publish(platform, branch, 'resep_produk', 'delete', { id });
	await auditDataChange(rawDb, branch, session, 'resep_produk', 'delete', id);
	return json({ ok: true });
};
