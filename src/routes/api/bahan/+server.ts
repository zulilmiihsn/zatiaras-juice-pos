import { json, error as kitError } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { bahan } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, sanitizeUpdatePayload, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	calculateEffectiveUnitCost,
	isValidYieldPercent,
	normalizeYieldPercent
} from '$lib/utils/ingredientCost';
import type { RequestHandler } from './$types';

function nonNegativeNumber(value: unknown, label: string): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed < 0) throw kitError(400, `${label} tidak valid`);
	return parsed;
}

function yieldPercent(value: unknown): number {
	if (!isValidYieldPercent(value)) {
		throw kitError(400, 'Yield bahan harus lebih dari 0% dan maksimal 100%');
	}
	return normalizeYieldPercent(value);
}

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
	const rows = payloadRows(body.payload, branch).map((row) => {
		const purchaseQuantity = nonNegativeNumber(row.jumlah_beli_terakhir, 'Jumlah beli');
		const purchaseCost = nonNegativeNumber(row.biaya_beli_terakhir, 'Biaya beli');
		const usableYield = yieldPercent(row.yield_persen ?? 100);
		return {
			...row,
			satuan: row.satuan || 'gram',
			stok_saat_ini: nonNegativeNumber(row.stok_saat_ini, 'Stok'),
			ambang_stok: nonNegativeNumber(row.ambang_stok, 'Minimum stok'),
			yield_persen: usableYield,
			biaya_per_satuan: calculateEffectiveUnitCost(purchaseCost, purchaseQuantity, usableYield),
			jumlah_beli_terakhir: purchaseQuantity,
			biaya_beli_terakhir: purchaseCost
		};
	}) as Array<typeof bahan.$inferInsert>;
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
	const current = await db
		.select({
			jumlah_beli_terakhir: bahan.jumlah_beli_terakhir,
			biaya_beli_terakhir: bahan.biaya_beli_terakhir,
			yield_persen: bahan.yield_persen
		})
		.from(bahan)
		.where(and(eq(bahan.cabang_id, branch), eq(bahan.id, String(body.where.id))))
		.get();
	if (!current) throw kitError(404, 'Bahan tidak ditemukan');
	// Coerce field numerik bila ada di payload.
	if ('stok_saat_ini' in safePayload)
		safePayload.stok_saat_ini = nonNegativeNumber(safePayload.stok_saat_ini, 'Stok');
	if ('ambang_stok' in safePayload) {
		safePayload.ambang_stok = nonNegativeNumber(safePayload.ambang_stok, 'Minimum stok');
	}
	if ('jumlah_beli_terakhir' in safePayload) {
		safePayload.jumlah_beli_terakhir = nonNegativeNumber(
			safePayload.jumlah_beli_terakhir,
			'Jumlah beli'
		);
	}
	if ('biaya_beli_terakhir' in safePayload) {
		safePayload.biaya_beli_terakhir = nonNegativeNumber(
			safePayload.biaya_beli_terakhir,
			'Biaya beli'
		);
	}
	if ('yield_persen' in safePayload) {
		safePayload.yield_persen = yieldPercent(safePayload.yield_persen);
	}
	const costInputsChanged = ['jumlah_beli_terakhir', 'biaya_beli_terakhir', 'yield_persen'].some(
		(key) => key in safePayload
	);
	delete safePayload.biaya_per_satuan;
	if (costInputsChanged) {
		const purchaseQuantity = Number(
			safePayload.jumlah_beli_terakhir ?? current.jumlah_beli_terakhir
		);
		const purchaseCost = Number(safePayload.biaya_beli_terakhir ?? current.biaya_beli_terakhir);
		const usableYield = Number(safePayload.yield_persen ?? current.yield_persen ?? 100);
		safePayload.biaya_per_satuan = calculateEffectiveUnitCost(
			purchaseCost,
			purchaseQuantity,
			usableYield
		);
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
