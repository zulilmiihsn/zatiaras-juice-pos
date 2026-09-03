import { and, desc, eq } from 'drizzle-orm';
import { error as kitError } from '@sveltejs/kit';
import { kategori } from '$lib/database/schema';
import { makeResourceRoute } from '$lib/server/resourceRouteHelpers';

/**
 * /api/kategori — CRUD kategori tenant-scoped.
 * Auth, audit, dan realtime ditangani makeResourceRoute.
 */
export const { GET, POST, PATCH, DELETE } = makeResourceRoute({
	resource: 'kategori',
	read: async ({ db, branch }, limit) =>
		db
			.select()
			.from(kategori)
			.where(eq(kategori.cabang_id, branch))
			.orderBy(desc(kategori.created_at))
			.limit(limit),
	insert: async ({ db }, rows) => {
		await db.insert(kategori).values(rows as (typeof kategori.$inferInsert)[]);
	},
	update: async ({ db, branch }, body) => {
		if (!body.where?.id) throw kitError(400, 'Payload / id tidak valid');
		await db
			.update(kategori)
			.set(body.payload as Partial<typeof kategori.$inferInsert>)
			.where(and(eq(kategori.cabang_id, branch), eq(kategori.id, String(body.where.id))));
		return { entityId: body.where.id, publishExtra: { id: body.where.id } };
	},
	remove: async ({ db, branch }, id) => {
		await db.delete(kategori).where(and(eq(kategori.cabang_id, branch), eq(kategori.id, id)));
	}
});
