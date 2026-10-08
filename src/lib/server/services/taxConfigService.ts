import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '$lib/server/branchResolver';
import { getRawDb, publish, auditDataChange } from '$lib/server/dataApiHelpers';
import { validateTaxConfigPayload } from '$lib/utils/validation';
import {
	TAX_CONTRACT_VERSION,
	legacyToSettings,
	settingsToLegacy,
	validateTaxSettings
} from '$lib/tax/engine';
import type { TaxSettings } from '$lib/types/pajak';
import { error as kitError } from '@sveltejs/kit';

export type SessionUser = App.Locals['authSession'];

export interface BranchTaxConfig {
	enabled: boolean;
	nama: string;
	rate: number;
	threshold: number;
	apply_threshold: boolean;
	updated_at?: string;
}

export const DEFAULT_TAX_CONFIG: BranchTaxConfig = {
	enabled: true,
	nama: 'PPh Final UMKM (0.5%)',
	rate: 0.005,
	threshold: 500_000_000,
	apply_threshold: false
};

type StoredEnvelope =
	| { schema_version: 2; revision: number; settings: TaxSettings; updated_at?: string }
	| (Partial<BranchTaxConfig> & { revision?: number });

function invalidStoredTaxConfig(cause?: unknown): Error {
	return new Error(
		'Konfigurasi pajak tersimpan tidak valid. Laporan ditahan agar tarif pajak tidak keliru.',
		{ cause }
	);
}

export async function loadTaxEnvelope(
	rawDb: D1Database,
	branch: string
): Promise<{
	revision: number;
	settings: TaxSettings;
	legacy: BranchTaxConfig;
	updated_at?: string;
	rawNilai: string | null;
}> {
	const row = (await rawDb
		.prepare(
			`SELECT nilai, updated_at FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`
		)
		.bind(branch)
		.first()) as { nilai?: string; updated_at?: string } | null;
	if (!row?.nilai) {
		return {
			revision: 0,
			settings: legacyToSettings(DEFAULT_TAX_CONFIG),
			legacy: DEFAULT_TAX_CONFIG,
			rawNilai: null
		};
	}

	let parsed: StoredEnvelope;
	try {
		parsed = JSON.parse(row.nilai) as StoredEnvelope;
	} catch (cause) {
		throw invalidStoredTaxConfig(cause);
	}
	if (!parsed || typeof parsed !== 'object') throw invalidStoredTaxConfig();
	if ((parsed as { schema_version?: number }).schema_version === 2) {
		const v2 = parsed as { revision?: number; settings?: unknown };
		const v = validateTaxSettings(v2.settings);
		if (!v.ok) throw invalidStoredTaxConfig();
		const settings = v2.settings as TaxSettings;
		return {
			revision: Number(v2.revision || 0),
			settings,
			legacy: { ...settingsToLegacy(settings), updated_at: row.updated_at },
			updated_at: row.updated_at,
			rawNilai: row.nilai
		};
	}

	// Legacy format: rate=0 tetap 0, threshold non-default terjaga via adapter.
	const legacy = { ...DEFAULT_TAX_CONFIG, ...(parsed as Partial<BranchTaxConfig>) };
	return {
		revision: 0,
		settings: legacyToSettings(legacy),
		legacy,
		updated_at: row.updated_at,
		rawNilai: row.nilai
	};
}

export async function saveTaxConfig(
	rawDb: D1Database,
	branch: string,
	session: SessionUser,
	platform: App.Platform | undefined,
	body: Record<string, unknown>
) {
	const stored = await loadTaxEnvelope(rawDb, branch);

	let next: TaxSettings;
	if (body.schema_version === 2 || body.settings !== undefined) {
		// Kontrak v2: daftar penuh + CAS revision wajib.
		const v = validateTaxSettings(body.settings);
		if (!v.ok) throw kitError(400, v.errors.join('; '));
		if (JSON.stringify(body.settings).length > 32 * 1024)
			throw kitError(400, 'Payload konfigurasi pajak terlalu besar');
		const expected = (body as { expected_revision?: unknown }).expected_revision;
		if (expected === undefined || !Number.isInteger(Number(expected)))
			throw kitError(400, 'expected_revision wajib pada kontrak v2');
		if (Number(expected) !== stored.revision)
			throw kitError(409, 'Konfigurasi berubah di perangkat lain. Muat ulang lalu coba lagi.');
		next = body.settings as TaxSettings;
	} else if ((body as { config?: unknown }).config !== undefined) {
		// Legacy write: patch hanya entri legacy, jangan hapus daftar multi-pajak.
		const validated = validateTaxConfigPayload((body as { config?: unknown }).config);
		if (!validated.success || !validated.data)
			throw kitError(400, validated.error || 'Payload konfigurasi pajak tidak valid');
		const input = validated.data;
		const legacy: BranchTaxConfig = {
			enabled: Boolean(input.enabled),
			nama: String(input.nama || 'Pajak')
				.trim()
				.slice(0, 100),
			rate: input.rate,
			threshold: Number(input.threshold ?? 500_000_000),
			apply_threshold: Boolean(input.apply_threshold)
		};
		if (!Number.isFinite(legacy.threshold) || legacy.threshold < 0)
			throw kitError(400, 'Threshold omzet pajak tidak boleh negatif');
		const patched: TaxSettings = {
			isTaxEnabled: legacy.enabled,
			taxes: stored.settings.taxes.map((t) =>
				t.id === 'pph_final_umkm'
					? {
							...t,
							nama: legacy.nama,
							persentase: legacy.rate * 100,
							isEnabled: legacy.enabled,
							useThreshold500Juta: legacy.apply_threshold,
							thresholdAmount: legacy.threshold
						}
					: t
			)
		};
		if (!patched.taxes.some((t) => t.id === 'pph_final_umkm')) {
			patched.taxes.unshift({
				id: 'pph_final_umkm',
				nama: legacy.nama,
				tipe: 'pph_final',
				persentase: legacy.rate * 100,
				isEnabled: legacy.enabled,
				useThreshold500Juta: legacy.apply_threshold,
				thresholdAmount: legacy.threshold
			});
		}
		next = patched;
	} else {
		throw kitError(400, 'Payload konfigurasi pajak tidak valid');
	}

	const revision = stored.revision + 1;
	const envelope = JSON.stringify({
		schema_version: TAX_CONTRACT_VERSION,
		revision,
		settings: next,
		updated_at: new Date().toISOString()
	});
	const now = new Date().toISOString();
	// CAS atomik pada nilai mentah pembacaan PERTAMA (bukan baca ulang sesudah
	// hitung payload). Baris baru (old NULL): INSERT biasa. Konflik -> 409.
	const oldNilai = stored.rawNilai;
	// CAS atomik: tulis hanya bila nilai masih sama seperti dibaca.
	// Baris baru (old NULL): INSERT biasa. Konflik nilai -> changes 0 -> 409.
	const applied = (await rawDb
		.prepare(
			oldNilai === null
				? `INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
					 VALUES (?, ?, 'pajak_config', ?, ?)
					 ON CONFLICT(cabang_id, kunci) DO UPDATE SET
					 nilai = excluded.nilai,
					 updated_at = excluded.updated_at
					 WHERE pengaturan.nilai IS NULL`
				: `INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
					 VALUES (?, ?, 'pajak_config', ?, ?)
					 ON CONFLICT(cabang_id, kunci) DO UPDATE SET
					 nilai = excluded.nilai,
					 updated_at = excluded.updated_at
					 WHERE pengaturan.nilai = ?`
		)
		.bind(
			...(oldNilai === null
				? [crypto.randomUUID(), branch, envelope, now]
				: [crypto.randomUUID(), branch, envelope, now, oldNilai])
		)
		.run()) as unknown as { meta?: { changes?: number } };
	if (Number(applied?.meta?.changes ?? 0) === 0) {
		const current = (
			(await rawDb
				.prepare(
					`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'pajak_config' LIMIT 1`
				)
				.bind(branch)
				.first()
				.catch(() => null)) as { nilai?: string } | null
		)?.nilai;
		if (current === envelope) {
			// Retry request sama yang sudah commit sebelum respons.
			return {
				ok: true,
				duplicate: true,
				branch,
				schema_version: TAX_CONTRACT_VERSION,
				revision,
				settings: next,
				data: { ...settingsToLegacy(next), updated_at: now }
			};
		}
		throw kitError(409, 'Konfigurasi berubah di perangkat lain. Muat ulang lalu coba lagi.');
	}

	await publish(platform, branch, 'pengaturan', 'update', { key: 'pajak_config' });
	await auditDataChange(rawDb, branch, session, 'pengaturan', 'update', 'pajak_config', {
		revision,
		taxes: next.taxes.length
	});

	return {
		ok: true,
		branch,
		schema_version: TAX_CONTRACT_VERSION,
		revision,
		settings: next,
		data: { ...settingsToLegacy(next), updated_at: now }
	};
}

// KENAPA: route HTTP hanya boleh auth + parse + respons; resolusi DB milik
// boundary server agar route tidak masuk allowlist import DB langsung.
export function loadTaxEnvelopeForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext
) {
	return loadTaxEnvelope(getRawDb(platform, branch), branch);
}

export function saveTaxConfigForBranch(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: SessionUser,
	body: Record<string, unknown>
) {
	return saveTaxConfig(getRawDb(platform, branch), branch, session, platform, body);
}
