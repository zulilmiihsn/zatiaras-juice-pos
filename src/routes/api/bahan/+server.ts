import { json, error as kitError } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { bahan } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, sanitizeUpdatePayload, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import type { RequestHandler } from './$types';

/**
 * /api/bahan — Resource route untuk tabel `bahan` (bahan baku & stok).
 * Menggantikan dispatch dari /api/data?table=bahan.
 * Invariant:
 *   - Field numerik di-coerce (stok_saat_ini, biaya_per_satuan, dll) di insert & update.
 *   - DELETE menolak (409) bila bahan masih dipakai di resep_produk.
 * RBAC: pemilik (owner) untuk semua operasi tulis.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'));

	const rows = await db
		.select()
		.from(bahan)
		.where(eq(bahan.cabang_id, branch))
		.orderBy(asc(bahan.nama))
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
		satuan: row.satuan || 'gram',
		stok_saat_ini: Number(row.stok_saat_ini || 0),
		ambang_stok: Number(row.ambang_stok || 0),
		biaya_per_satuan: Number(row.biaya_per_satuan || 0),
		jumlah_beli_terakhir: Number(row.jumlah_beli_terakhir || 0),
		biaya_beli_terakhir: Number(row.biaya_beli_terakhir || 0)
	})) as Array<Record<string, any>>;
	await db.insert(bahan).values(rows as (typeof bahan.$inferInsert)[]);
	await publish(platform, branch, 'bahan', 'insert', { id: rows[0]?.id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'insert', rows[0]?.id, {
		count: rows.length
	});
	return json({ ok: true, data: rows });
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);
	const safePayload = sanitizeUpdatePayload(body.payload as Record<string, unknown>);
	// Coerce field numerik bila ada di payload.
	if ('stok_saat_ini' in safePayload)
		safePayload.stok_saat_ini = Number(safePayload.stok_saat_ini || 0);
	if ('ambang_stok' in safePayload) {
		safePayload.ambang_stok = Number(safePayload.ambang_stok || 0);
	}
	if ('biaya_per_satuan' in safePayload)
		safePayload.biaya_per_satuan = Number(safePayload.biaya_per_satuan || 0);
	if ('jumlah_beli_terakhir' in safePayload) {
		safePayload.jumlah_beli_terakhir = Number(safePayload.jumlah_beli_terakhir || 0);
	}
	if ('biaya_beli_terakhir' in safePayload) {
		safePayload.biaya_beli_terakhir = Number(safePayload.biaya_beli_terakhir || 0);
	}
	await db
		.update(bahan)
		.set(safePayload)
		.where(and(eq(bahan.cabang_id, branch), eq(bahan.id, String(body.where.id))));
	await publish(platform, branch, 'bahan', 'update', { id: body.where.id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'update', body.where.id, {
		fields: Object.keys(body.payload as Record<string, unknown>)
	});
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	if (!id) throw kitError(400, 'id diperlukan');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	// FK pre-check: tolak hapus bila bahan masih dipakai di resep menu.
	const used = await rawDb
		.prepare(`SELECT id FROM resep_produk WHERE cabang_id = ? AND bahan_id = ? LIMIT 1`)
		.bind(branch, id)
		.first();
	if (used) throw kitError(409, 'Bahan masih dipakai di resep menu');

	await db.delete(bahan).where(and(eq(bahan.cabang_id, branch), eq(bahan.id, id)));
	await publish(platform, branch, 'bahan', 'delete', { id });
	await auditDataChange(rawDb, branch, session, 'bahan', 'delete', id);
	return json({ ok: true });
};
