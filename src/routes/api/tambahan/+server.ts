import { and, desc, eq } from 'drizzle-orm';
import { error as kitError } from '@sveltejs/kit';
import { tambahan } from '$lib/database/schema';
import { makeResourceRoute } from '$lib/server/resourceRouteHelpers';

/**
 * /api/tambahan — CRUD ekstra tenant-scoped.
 * Auth, audit, dan realtime ditangani makeResourceRoute.
 */
export const { GET, POST, PATCH, DELETE } = makeResourceRoute({
	resource: 'tambahan',
	read: async ({ db, branch }, limit) =>
		db
			.select()
			.from(tambahan)
			.where(eq(tambahan.cabang_id, branch))
			.orderBy(desc(tambahan.created_at))
			.limit(limit),
	insert: async ({ db }, rows) => {
		await db.insert(tambahan).values(rows as (typeof tambahan.$inferInsert)[]);
	},
	update: async ({ db, branch }, body) => {
		if (!body.where?.id) throw kitError(400, 'Payload / id tidak valid');
		await db
			.update(tambahan)
			.set(body.payload as Partial<typeof tambahan.$inferInsert>)
			.where(and(eq(tambahan.cabang_id, branch), eq(tambahan.id, String(body.where.id))));
		return { entityId: body.where.id, publishExtra: { id: body.where.id } };
	},
	remove: async ({ db, branch }, id) => {
		await db.delete(tambahan).where(and(eq(tambahan.cabang_id, branch), eq(tambahan.id, id)));
	}
});
