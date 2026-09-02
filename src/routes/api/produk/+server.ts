import { error as kitError } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { produk } from '$lib/database/schema';
import { makeResourceRoute } from '$lib/server/resourceRouteHelpers';

/**
 * /api/produk — CRUD menu tenant-scoped.
 * PATCH menerima update satu id atau bulk berdasarkan kategori_id.
 */
export const { GET, POST, PATCH, DELETE } = makeResourceRoute({
	resource: 'produk',
	read: async ({ db, branch }, limit) =>
		db
			.select()
			.from(produk)
			.where(eq(produk.cabang_id, branch))
			.orderBy(desc(produk.created_at))
			.limit(limit),
	insert: async ({ db }, rows) => {
		await db.insert(produk).values(rows as (typeof produk.$inferInsert)[]);
	},
	update: async ({ db, branch }, body) => {
		const { id, ids, kategori_id: kategoriId } = body.where || {};
		const productIds = ids
			?.split(',')
			.map((value) => value.trim())
			.filter(Boolean);
		if (id == null && !productIds?.length && kategoriId === undefined) {
			throw kitError(400, 'id, ids, atau kategori_id diperlukan');
		}
		const payload = body.payload as Partial<typeof produk.$inferInsert>;

		if (productIds?.length && id == null) {
			await db
				.update(produk)
				.set(payload)
				.where(and(eq(produk.cabang_id, branch), inArray(produk.id, productIds)));
			return {
				action: 'bulk_update',
				entityId: null,
				metadata: { ids: productIds, fields: Object.keys(payload) }
			};
		}

		if (kategoriId !== undefined && id == null) {
			await db
				.update(produk)
				.set(payload)
				.where(and(eq(produk.cabang_id, branch), eq(produk.kategori_id, String(kategoriId))));
			return {
				action: 'bulk_update',
				entityId: null,
				metadata: { kategori_id: kategoriId, fields: Object.keys(payload) }
			};
		}

		await db
			.update(produk)
			.set(payload)
			.where(and(eq(produk.cabang_id, branch), eq(produk.id, String(id))));
		return { entityId: id, publishExtra: { id } };
	},
	remove: async ({ db, branch }, id) => {
		await db.delete(produk).where(and(eq(produk.cabang_id, branch), eq(produk.id, id)));
	}
});
