import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, payloadRows } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import { parseDataLimit } from '$lib/server/dataPagination';
import {
	getBahanList,
	insertBahanRows,
	updateBahanRow,
	deleteBahanRow
} from '$lib/server/services/bahanService';
import { loadStockPolicy } from '$lib/server/stockPolicy';
import type { RequestHandler } from './$types';

/**
 * /api/bahan — Resource route controller untuk tabel `bahan` (bahan baku & stok).
 * Menangani HTTP auth, validasi request, dan delegasi ke bahanService.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);
	const limit = parseDataLimit(url.searchParams.get('limit'), 2000, 5000);

	const rows = await getBahanList(db, branch, limit);
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
	const rows = payloadRows(body.payload, branch);

	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		for (const row of rows) {
			const stokAwal = Number(row.stok_saat_ini ?? 0);
			if (Number.isFinite(stokAwal) && stokAwal !== 0) {
				throw kitError(409, 'Stok awal bahan harus 0 saat monitoring nonaktif');
			}
			if (row.ambang_stok !== undefined && row.ambang_stok !== null) {
				throw kitError(409, 'Ambang stok tidak dapat diatur saat monitoring nonaktif');
			}
			row.stok_saat_ini = 0;
		}
	}

	const result = await insertBahanRows(db, rawDb, branch, session, platform, rows);
	return json(result);
};

export const PATCH: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload || !body.where?.id) throw kitError(400, 'Payload / id tidak valid');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	const policy = await loadStockPolicy(rawDb, branch);
	if (policy.mode === 'ignored') {
		const payload = body.payload as Record<string, unknown>;
		if ('stok_saat_ini' in payload || 'ambang_stok' in payload) {
			throw kitError(
				409,
				'Saldo stok hanya dapat diubah lewat rekonsiliasi saat monitoring nonaktif'
			);
		}
	}

	const result = await updateBahanRow(
		db,
		rawDb,
		branch,
		session,
		platform,
		String(body.where.id),
		body.payload as Record<string, unknown>
	);
	return json(result);
};

export const DELETE: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const id = url.searchParams.get('id');
	if (!id) throw kitError(400, 'id diperlukan');

	const db = getDb(platform, branch);
	const rawDb = getRawDb(platform, branch);

	const result = await deleteBahanRow(db, rawDb, branch, session, platform, id);
	return json(result);
};
