import { json, error as kitError } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { bahan } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, sanitizeUpdatePayload, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
import type { RequestHandler } from './$types';

function nonNegativeNumber(value: unknown, label: string): number {
	const parsed = Number(value ?? 0);
	if (!Number.isFinite(parsed) || parsed < 0) throw kitError(400, `${label} tidak valid`);
	return parsed;
}

// Removed yieldPercent function

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
		const purchaseQuantity = nonNegativeNumber(row.jumlah_beli_terakhir, 'Jumlah porsi');
		const purchaseCost = nonNegativeNumber(row.biaya_beli_terakhir, 'Biaya beli');
		const yieldVal =
			row.yield_persen != null ? Math.min(100, Math.max(1, Number(row.yield_persen))) : 100;
		const netQty = purchaseQuantity * (yieldVal / 100);
		return {
			...row,
			satuan: row.satuan || 'gram',
			tipe_satuan: row.tipe_satuan ? String(row.tipe_satuan).trim() : 'berat',
			isi_per_kemasan: nonNegativeNumber(row.isi_per_kemasan, 'Isi kemasan') || 1,
			satuan_beli: row.satuan_beli ? String(row.satuan_beli).trim() : null,
			kategori: row.kategori ? String(row.kategori).trim() : 'Bahan Baku',
			stok_saat_ini: nonNegativeNumber(row.stok_saat_ini, 'Stok'),
			ambang_stok: nonNegativeNumber(row.ambang_stok, 'Minimum stok'),
			yield_persen: yieldVal,
			biaya_per_satuan: calculateEffectiveUnitCost(
				purchaseCost,
				netQty > 0 ? netQty : purchaseQuantity
			),
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
	// [CATATAN]: Coerce field numerik dan kategori bila ada di payload.
	if ('kategori' in safePayload && safePayload.kategori !== undefined) {
		safePayload.kategori = safePayload.kategori
			? String(safePayload.kategori).trim()
			: 'Bahan Baku';
	}
	if ('stok_saat_ini' in safePayload)
		safePayload.stok_saat_ini = nonNegativeNumber(safePayload.stok_saat_ini, 'Stok');
	if ('ambang_stok' in safePayload) {
		safePayload.ambang_stok = nonNegativeNumber(safePayload.ambang_stok, 'Minimum stok');
	}
	if ('jumlah_beli_terakhir' in safePayload) {
		safePayload.jumlah_beli_terakhir = nonNegativeNumber(
			safePayload.jumlah_beli_terakhir,
			'Jumlah porsi'
		);
	}
	if ('tipe_satuan' in safePayload && safePayload.tipe_satuan !== undefined) {
		safePayload.tipe_satuan = String(safePayload.tipe_satuan).trim();
	}
	if ('isi_per_kemasan' in safePayload) {
		safePayload.isi_per_kemasan =
			nonNegativeNumber(safePayload.isi_per_kemasan, 'Isi kemasan') || 1;
	}
	if ('satuan_beli' in safePayload && safePayload.satuan_beli !== undefined) {
		safePayload.satuan_beli = safePayload.satuan_beli
			? String(safePayload.satuan_beli).trim()
			: null;
	}
	if ('yield_persen' in safePayload && safePayload.yield_persen !== undefined) {
		const parsedYield = Number(safePayload.yield_persen);
		safePayload.yield_persen = Number.isFinite(parsedYield)
			? Math.min(100, Math.max(1, parsedYield))
			: 100;
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
		const yieldPercent = Number(safePayload.yield_persen ?? current.yield_persen ?? 100);
		const netQty = purchaseQuantity * (yieldPercent / 100);
		safePayload.biaya_per_satuan = calculateEffectiveUnitCost(
			purchaseCost,
			netQty > 0 ? netQty : purchaseQuantity
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

	// [CATATAN]: FK pre-check: tolak hapus bila bahan masih dipakai di resep menu.
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
