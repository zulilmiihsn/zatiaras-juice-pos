import { json, error as kitError } from '@sveltejs/kit';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { sesiToko } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, sanitizeUpdatePayload, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { requirePageAccess } from '$lib/server/pageAccess';
import { parseDataLimit } from '$lib/server/dataPagination';
import type { RequestHandler } from './$types';

/**
 * /api/sesi-toko — Resource route untuk tabel `sesi_toko` (buka/tutup toko).
 * Menggantikan dispatch dari /api/data?table=sesi_toko.
 * GET mendukung filter ?id= dan ?is_active=true|false.
 * RBAC: kasir atau pemilik (lebih longgar daripada resource menu).
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'));
	const id = url.searchParams.get('id');
	const active = url.searchParams.get('is_active');

	const filters: SQL[] = [eq(sesiToko.cabang_id, branch)];
	if (id) filters.push(eq(sesiToko.id, id));
	if (active === 'true') filters.push(eq(sesiToko.is_active, true));
	if (active === 'false') filters.push(eq(sesiToko.is_active, false));

	const rows = await db
		.select()
		.from(sesiToko)
		.where(and(...filters))
		.orderBy(desc(sesiToko.created_at))
		.limit(limit);
	return json(rows);
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);
	await requirePageAccess(rawDb, session, 'beranda');
	const rows = payloadRows(body.payload, branch);
	await db.insert(sesiToko).values(rows as (typeof sesiToko.$inferInsert)[]);
	await publish(platform, branch, 'sesi_toko', 'insert', { id: rows[0]?.id });
	await auditDataChange(rawDb, branch, session, 'sesi_toko', 'insert', rows[0]?.id, {
		count: rows.length
	});
	return json({ ok: true, data: rows });
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['kasir', 'pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);
	await requirePageAccess(rawDb, session, 'beranda');
	await db
		.update(sesiToko)
		.set(sanitizeUpdatePayload(body.payload as Partial<typeof sesiToko.$inferInsert>))
		.where(and(eq(sesiToko.cabang_id, branch), eq(sesiToko.id, String(body.where.id))));
	await publish(platform, branch, 'sesi_toko', 'update', { id: body.where.id });
	await auditDataChange(rawDb, branch, session, 'sesi_toko', 'update', body.where.id, {
		fields: Object.keys(body.payload as Record<string, unknown>)
	});
	return json({ ok: true });
};
