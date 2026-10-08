import { eq } from 'drizzle-orm';
import { hppSettings } from '$lib/database/schema';
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getDb, getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';

export type Database = ReturnType<typeof getDb>;
export type SessionUser = App.Locals['authSession'];

export type HppSettingsInput = {
	sewa_bulanan?: number;
	listrik_bulanan?: number;
	air_bulanan?: number;
	gaji_bulanan?: number;
	lainnya_bulanan?: number;
	rincian_biaya?: string | unknown[];
	target_item_bulanan?: number;
};

/**
 * Baris HPP cabang (1 row). Invariant: upsert via `ON CONFLICT(id) DO UPDATE`
 * dengan id tetap `${branch}:default`.
 */
export async function getHppSettings(db: Database, branch: string) {
	return db.select().from(hppSettings).where(eq(hppSettings.cabang_id, branch)).limit(1);
}

export async function upsertHppSettings(
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	input: HppSettingsInput
) {
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
	return { ok: true, data: [row] };
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function getHppSettingsForBranch(platform: App.Platform | undefined, branch: BranchContext) {
	return getHppSettings(getDb(platform, branch), branch);
}

export function upsertHppSettingsForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	input: HppSettingsInput
) {
	return upsertHppSettings(getRawDb(platform, branch), branch, session, platform, input);
}
