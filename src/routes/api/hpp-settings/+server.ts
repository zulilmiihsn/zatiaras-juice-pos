import { json, error as kitError } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { hppSettings } from '$lib/database/schema';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody, type WriteBody } from '$lib/server/resourceRouteHelpers';
import type { RequestHandler } from './$types';

/**
 * /api/hpp-settings — Resource route untuk tabel `hpp_settings` (1 row per cabang).
 * Menggantikan dispatch dari /api/data?table=hpp_settings.
 * Invariant: upsert via `ON CONFLICT(id) DO UPDATE` dengan id tetap `${branch}:default`.
 * RBAC: pemilik (owner) untuk upsert. GET boleh untuk semua yang login.
 */
export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const db = getDb(platform, branch);

	const rows = await db
		.select()
		.from(hppSettings)
		.where(eq(hppSettings.cabang_id, branch))
		.limit(1);
	return json(rows);
};

type HppPayload = {
	sewa_bulanan?: number;
	listrik_bulanan?: number;
	air_bulanan?: number;
	gaji_bulanan?: number;
	lainnya_bulanan?: number;
	rincian_biaya?: string | unknown[];
	target_item_bulanan?: number;
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<WriteBody>(request);
	if (!body?.payload) throw kitError(400, 'Payload tidak valid');

	const input = (Array.isArray(body.payload) ? body.payload[0] : body.payload) as HppPayload;
	const id = `${branch}:default`;
	const now = new Date().toISOString();
	const rincianBiayaStr =
		typeof input.rincian_biaya === 'string'
			? input.rincian_biaya
			: input.rincian_biaya
				? JSON.stringify(input.rincian_biaya)
				: null;

	const row = {
		id,
		cabang_id: branch,
		sewa_bulanan: Number(input.sewa_bulanan || 0),
		listrik_bulanan: Number(input.listrik_bulanan || 0),
		air_bulanan: Number(input.air_bulanan || 0),
		gaji_bulanan: Number(input.gaji_bulanan || 0),
		lainnya_bulanan: Number(input.lainnya_bulanan || 0),
		rincian_biaya: rincianBiayaStr,
		target_item_bulanan: Math.max(1, Number(input.target_item_bulanan || 1000))
	};

	const rawDb = getRawDb(platform, branch);
	await rawDb
		.prepare(
			`INSERT INTO pengaturan_hpp (
				id, cabang_id, sewa_bulanan, listrik_bulanan, air_bulanan,
				gaji_bulanan, lainnya_bulanan, rincian_biaya, target_item_bulanan, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				sewa_bulanan = excluded.sewa_bulanan,
				listrik_bulanan = excluded.listrik_bulanan,
				air_bulanan = excluded.air_bulanan,
				gaji_bulanan = excluded.gaji_bulanan,
				lainnya_bulanan = excluded.lainnya_bulanan,
				rincian_biaya = excluded.rincian_biaya,
				target_item_bulanan = excluded.target_item_bulanan,
				updated_at = excluded.updated_at`
		)
		.bind(
			row.id,
			row.cabang_id,
			row.sewa_bulanan,
			row.listrik_bulanan,
			row.air_bulanan,
			row.gaji_bulanan,
			row.lainnya_bulanan,
			row.rincian_biaya,
			row.target_item_bulanan,
			now,
			now
		)
		.run();

	await publish(platform, branch, 'hpp_settings', 'upsert', { id });
	await auditDataChange(rawDb, branch, session, 'hpp_settings', 'upsert', id, row);
	return json({ ok: true, data: [row] });
};

export const POST: RequestHandler = PUT;
