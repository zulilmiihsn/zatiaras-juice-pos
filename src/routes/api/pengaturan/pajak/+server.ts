import { json, error as kitError } from '@sveltejs/kit';
import { requireSessionBranch, requireAnyRole } from '$lib/server/apiAuth';
import { getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { parseBody } from '$lib/server/resourceRouteHelpers';
import { validateTaxConfigPayload } from '$lib/utils/validation';
import type { RequestHandler } from './$types';

export interface BranchTaxConfig {
	enabled: boolean;
	nama: string;
	rate: number;
	threshold: number;
	apply_threshold: boolean;
	updated_at?: string;
}

const DEFAULT_TAX_CONFIG: BranchTaxConfig = {
	enabled: true,
	nama: 'PPh Final UMKM (PP 55/2022)',
	rate: 0.005,
	threshold: 500_000_000,
	apply_threshold: true
};

export const GET: RequestHandler = async ({ url, platform, locals }) => {
	const branch = requireSessionBranch(locals, url.searchParams.get('branch'));
	const rawDb = getRawDb(platform, branch);

	try {
		const row = (await rawDb
			.prepare(
				`SELECT nilai, updated_at FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`
			)
			.bind(branch)
			.first()) as { nilai?: string; updated_at?: string } | null;

		if (row?.nilai) {
			const parsed = JSON.parse(row.nilai) as Partial<BranchTaxConfig>;
			return json({
				ok: true,
				data: {
					...DEFAULT_TAX_CONFIG,
					...parsed,
					updated_at: row.updated_at
				}
			});
		}
	} catch {
		// Fallback to default config on unmigrated/fresh branch
	}

	return json({
		ok: true,
		data: DEFAULT_TAX_CONFIG
	});
};

export const PUT: RequestHandler = async ({ request, platform, locals }) => {
	const branch = requireSessionBranch(locals);
	const session = locals.authSession!;
	requireAnyRole(session.role, ['pemilik']);

	const body = await parseBody<{ config?: unknown }>(request);
	if (!body?.config) {
		throw kitError(400, 'Payload konfigurasi pajak tidak valid');
	}

	const validated = validateTaxConfigPayload(body.config);
	if (!validated.success || !validated.data) {
		throw kitError(400, validated.error || 'Payload konfigurasi pajak tidak valid');
	}

	const input = validated.data;
	const rate = input.rate;

	const threshold = Number(input.threshold ?? 500_000_000);
	if (!Number.isFinite(threshold) || threshold < 0) {
		throw kitError(400, 'Threshold omzet pajak tidak boleh negatif');
	}

	const sanitizedConfig: BranchTaxConfig = {
		enabled: Boolean(input.enabled),
		nama: String(input.nama || 'Pajak')
			.trim()
			.slice(0, 100),
		rate,
		threshold,
		apply_threshold: Boolean(input.apply_threshold),
		updated_at: new Date().toISOString()
	};

	const rawDb = getRawDb(platform, branch);
	const configJson = JSON.stringify(sanitizedConfig);
	const now = sanitizedConfig.updated_at!;

	await rawDb
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
			 VALUES (?, ?, 'pajak_config', ?, ?)
			 ON CONFLICT(cabang_id, kunci) DO UPDATE SET
			 nilai = excluded.nilai,
			 updated_at = excluded.updated_at`
		)
		.bind(crypto.randomUUID(), branch, configJson, now)
		.run();

	await publish(platform, branch, 'pengaturan', 'update', { key: 'pajak_config' });
	await auditDataChange(rawDb, branch, session, 'pengaturan', 'update', 'pajak_config', {
		rate: sanitizedConfig.rate,
		enabled: sanitizedConfig.enabled
	});

	return json({
		ok: true,
		data: sanitizedConfig
	});
};
