const browser = typeof window !== 'undefined';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { calculateEngineTax, validateTaxSettings } from '$lib/tax/engine';
import type { TaxSettings, TaxCalculationResult, TaxItemConfig, TaxType } from '$lib/types/pajak';

export const TAX_STORAGE_KEY = 'zatiara_tax_settings';

export const DEFAULT_TAX_SETTINGS: TaxSettings = {
	isTaxEnabled: true,
	taxes: [
		{
			id: 'pph_final_umkm',
			nama: 'PPh Final UMKM',
			tipe: 'pph_final',
			persentase: 0.5,
			isEnabled: true,
			deskripsi: 'Pajak Penghasilan UMKM 0,5% dari omzet bruto usaha (PP 55/2022).',
			useThreshold500Juta: false
		},
		{
			id: 'pbjt_makanan_minuman',
			nama: 'PBJT / PB1 Restoran & Kafe',
			tipe: 'pbjt_restoran',
			persentase: 10,
			isEnabled: false,
			deskripsi:
				'Pajak daerah makanan/minuman (UU HKPD No. 1/2022). Tarif standar 10% atau sesuai Perda.'
		},
		{
			id: 'ppn_pkp',
			nama: 'PPN (Pajak Pertambahan Nilai)',
			tipe: 'ppn',
			persentase: 11,
			isEnabled: false,
			deskripsi: 'Pajak pertambahan nilai 11% khusus Wajib Pajak yang telah dikukuhkan sebagai PKP.'
		}
	]
};

function parseTaxItem(item: unknown): TaxItemConfig {
	const t = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
	const tipe =
		typeof t.tipe === 'string' && ['pph_final', 'pbjt_restoran', 'ppn', 'custom'].includes(t.tipe)
			? (t.tipe as TaxType)
			: 'custom';
	const persentase =
		typeof t.persentase === 'number' && Number.isFinite(t.persentase) ? t.persentase : 0;
	const thresholdAmount =
		typeof t.thresholdAmount === 'number' && Number.isFinite(t.thresholdAmount)
			? t.thresholdAmount
			: undefined;
	return {
		id: String(t.id || `tax_${Date.now()}`),
		nama: String(t.nama || 'Pajak'),
		tipe,
		persentase,
		isEnabled: Boolean(t.isEnabled),
		deskripsi: typeof t.deskripsi === 'string' ? t.deskripsi : undefined,
		useThreshold500Juta: Boolean(t.useThreshold500Juta),
		...(thresholdAmount !== undefined ? { thresholdAmount } : {})
	};
}

const inFlightSync = new Map<string, Promise<TaxSettings>>();
const saveChains = new Map<string, Promise<SaveTaxResult>>();

function branchKey(targetBranch: string): string {
	return `zatiaras_tax_settings_${targetBranch}`;
}

function currentBranch(): string {
	if (!browser) return 'samarinda';
	try {
		return (localStorage.getItem('selectedBranch') || 'samarinda').toLowerCase();
	} catch {
		return 'samarinda';
	}
}

function readPersistedCache(targetBranch: string): TaxSettings | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(branchKey(targetBranch));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<TaxSettings>;
		if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.taxes)) return null;
		return {
			isTaxEnabled: typeof parsed.isTaxEnabled === 'boolean' ? parsed.isTaxEnabled : true,
			taxes: parsed.taxes.map(parseTaxItem)
		};
	} catch {
		return null;
	}
}

function writePersistedCache(targetBranch: string, settings: TaxSettings): void {
	if (!browser) return;
	try {
		localStorage.setItem(branchKey(targetBranch), JSON.stringify(settings));
	} catch {}
}

function readRevision(targetBranch: string): number {
	if (!browser) return 0;
	try {
		return Number(localStorage.getItem(`${branchKey(targetBranch)}:revision`) || 0);
	} catch {
		return 0;
	}
}

function writeRevision(targetBranch: string, revision: number): void {
	if (!browser) return;
	try {
		localStorage.setItem(`${branchKey(targetBranch)}:revision`, String(revision));
	} catch {}
}

function notifyUpdated(settings: TaxSettings, targetBranch: string, revision: number): void {
	if (!browser) return;
	try {
		window.dispatchEvent(
			new CustomEvent('zatiara:tax_settings_updated', {
				detail: { settings, branch: targetBranch, revision }
			})
		);
	} catch {}
}

/**
 * Cache lokal murni tanpa efek jaringan. Sinkronisasi eksplisit via syncTaxSettingsWithServer.
 * Legacy global key hanya jadi kandidat draft cabang aktif, bukan sumber antar-cabang.
 */
export function getTaxSettings(branch?: string): TaxSettings {
	if (!browser) {
		return DEFAULT_TAX_SETTINGS;
	}
	const targetBranch = (branch || currentBranch()).toLowerCase();
	const cached = readPersistedCache(targetBranch);
	if (cached) return cached;
	try {
		const legacyRaw = localStorage.getItem(TAX_STORAGE_KEY);
		if (legacyRaw) {
			const parsed = JSON.parse(legacyRaw) as Partial<TaxSettings>;
			if (parsed && typeof parsed === 'object' && Array.isArray(parsed.taxes)) {
				return {
					isTaxEnabled: typeof parsed.isTaxEnabled === 'boolean' ? parsed.isTaxEnabled : true,
					taxes: parsed.taxes.map(parseTaxItem)
				};
			}
		}
	} catch {}
	return DEFAULT_TAX_SETTINGS;
}

/**
 * Sinkronisasi eksplisit dengan guard in-flight per cabang.
 * Tidak menimpa draft: hanya cache persisted yang ditulis.
 */
export async function syncTaxSettingsWithServer(branch?: string): Promise<TaxSettings> {
	if (!browser) return DEFAULT_TAX_SETTINGS;
	const targetBranch = (branch || currentBranch()).toLowerCase();
	const flying = inFlightSync.get(targetBranch);
	if (flying) return flying;
	const run = (async (): Promise<TaxSettings> => {
		try {
			const res = await fetch(`/api/pengaturan/pajak?branch=${encodeURIComponent(targetBranch)}`);
			if (!res.ok) return getTaxSettings(targetBranch);
			const json = (await res.json()) as {
				ok?: boolean;
				schema_version?: number;
				revision?: number;
				settings?: unknown;
			};
			if (json?.ok && json.schema_version === 2 && json.settings) {
				const v = validateTaxSettings(json.settings);
				if (v.ok) {
					const settings = json.settings as TaxSettings;
					const revision = Number(json.revision || 0);
					writePersistedCache(targetBranch, settings);
					writeRevision(targetBranch, revision);
					notifyUpdated(settings, targetBranch, revision);
					return settings;
				}
			}
		} catch {}
		return getTaxSettings(targetBranch);
	})();
	inFlightSync.set(targetBranch, run);
	try {
		return await run;
	} finally {
		if (inFlightSync.get(targetBranch) === run) inFlightSync.delete(targetBranch);
	}
}

export type SaveTaxResult =
	| { ok: true; revision: number; settings: TaxSettings }
	| { ok: false; conflict: boolean; message: string };

/**
 * Simpan SELURUH daftar pajak ke server. Promise: hanya tampil sukses
 * sesudah server commit; yang disimpan ke cache adalah HASIL server.
 * Cabang ditangkap sebelum await agar switch cabang tidak mencemari state lain.
 * Perubahan cepat diserialkan per cabang supaya respons lama tak menimpa baru.
 */
export function saveTaxSettings(settings: TaxSettings, branch?: string): Promise<SaveTaxResult> {
	const targetBranch = (branch || currentBranch()).toLowerCase();
	const v = validateTaxSettings(settings);
	if (!v.ok) return Promise.resolve({ ok: false, conflict: false, message: v.errors.join('; ') });
	const prev =
		saveChains.get(targetBranch) ??
		Promise.resolve({ ok: true, revision: readRevision(targetBranch), settings });
	const next = prev.then(() =>
		persistTaxSettings(settings, targetBranch).catch((e): SaveTaxResult => ({
			ok: false,
			conflict: false,
			message: e instanceof Error ? e.message : 'Gagal menyimpan pengaturan pajak.'
		}))
	);
	saveChains.set(targetBranch, next);
	void next.finally(() => {
		if (saveChains.get(targetBranch) === next) saveChains.delete(targetBranch);
	});
	return next;
}

async function persistTaxSettings(
	settings: TaxSettings,
	targetBranch: string
): Promise<SaveTaxResult> {
	if (!browser) return { ok: false, conflict: false, message: 'Bukan di browser.' };
	const expected = readRevision(targetBranch);
	let res: Response;
	try {
		res = await fetchWithCsrfRetry('/api/pengaturan/pajak', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				schema_version: 2,
				expected_revision: expected,
				settings,
				branch: targetBranch
			})
		});
	} catch (e) {
		return {
			ok: false,
			conflict: false,
			message: e instanceof Error ? e.message : 'Jaringan gagal.'
		};
	}
	type SaveTaxResponse = {
		ok?: boolean;
		schema_version?: number;
		revision?: number;
		settings?: unknown;
		message?: string;
	};
	let json: SaveTaxResponse | null = null;
	try {
		json = (await res.json()) as SaveTaxResponse;
	} catch {
		json = null;
	}
	if (!res.ok || !json?.ok || json.schema_version !== 2 || !json.settings) {
		if (res.status === 409)
			return { ok: false, conflict: true, message: 'Berubah di perangkat lain. Muat ulang.' };
		if (res.status === 403)
			return { ok: false, conflict: false, message: 'Akses ditolak. Masuk lagi sebagai pemilik.' };
		return {
			ok: false,
			conflict: false,
			message: json?.message || `Gagal menyimpan (HTTP ${res.status}).`
		};
	}
	const v = validateTaxSettings(json.settings);
	if (!v.ok) return { ok: false, conflict: false, message: 'Respons server tidak valid.' };
	const saved = json.settings as TaxSettings;
	const revision = Number(json.revision || 0);
	writePersistedCache(targetBranch, saved);
	writeRevision(targetBranch, revision);
	notifyUpdated(saved, targetBranch, revision);
	return { ok: true, revision, settings: saved };
}

/**
 * Hitung kalkulasi pajak. Delegasi ke mesin kanonik agar server/UI/AI satu hasil.
 */
export function calculateTaxes(
	pendapatanBruto: number,
	labaKotor: number,
	customSettings?: TaxSettings,
	cumulativeTurnoverYtd?: number
): TaxCalculationResult {
	const settings = customSettings || getTaxSettings();
	return calculateEngineTax({
		settings,
		periodTurnover: pendapatanBruto,
		periodGrossProfit: labaKotor,
		ytdTurnoverBefore:
			cumulativeTurnoverYtd != null
				? Math.max(0, cumulativeTurnoverYtd - Math.max(0, Number(pendapatanBruto) || 0))
				: 0
	});
}
