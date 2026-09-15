/**
 * Mesin pajak murni (F07/F12/F13). Tanpa browser/localStorage/fetch.
 * Satu kalkulator dipakai client simulasi, server laporan, dan AI.
 */
import type { TaxCalculationResult, TaxItemBreakdown, TaxSettings } from '$lib/types/pajak';

export const TAX_CONTRACT_VERSION = 2;
export const TAX_THRESHOLD_DEFAULT = 500_000_000;
const ALLOWED_TYPES = ['pph_final', 'pbjt_restoran', 'ppn', 'custom'] as const;
export type EngineTaxType = (typeof ALLOWED_TYPES)[number];

export interface EngineInput {
	settings: TaxSettings;
	periodTurnover: number;
	periodGrossProfit: number;
	ytdTurnoverBefore: number;
}

export function isValidRate(p: unknown): p is number {
	return typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 100;
}

export function validateTaxSettings(input: unknown): { ok: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!input || typeof input !== 'object')
		return { ok: false, errors: ['Pengaturan pajak tidak valid'] };
	const s = input as { isTaxEnabled?: unknown; taxes?: unknown };
	if (typeof s.isTaxEnabled !== 'boolean') errors.push('isTaxEnabled harus boolean');
	if (!Array.isArray(s.taxes)) errors.push('taxes harus array');
	else {
		if (s.taxes.length > 20) errors.push('Maksimal 20 entri pajak');
		const ids = new Set<string>();
		for (const raw of s.taxes) {
			const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
			const id = String(t.id || '');
			if (!id) errors.push('ID pajak wajib');
			else if (ids.has(id)) errors.push(`ID pajak ganda: ${id}`);
			else ids.add(id);
			if (typeof t.nama !== 'string' || !t.nama.trim()) errors.push('Nama pajak wajib');
			if (!ALLOWED_TYPES.includes(t.tipe as EngineTaxType))
				errors.push(`Tipe pajak tidak valid: ${String(t.tipe)}`);
			if (!isValidRate(t.persentase)) errors.push(`Persentase pajak tidak valid: ${String(t.id)}`);
			if (typeof t.isEnabled !== 'boolean')
				errors.push(`isEnabled pajak tidak valid: ${String(t.id)}`);
			if (t.useThreshold500Juta !== undefined && typeof t.useThreshold500Juta !== 'boolean')
				errors.push(`useThreshold500Juta tidak valid: ${String(t.id)}`);
			if (t.thresholdAmount !== undefined) {
				const th = t.thresholdAmount;
				if (typeof th !== 'number' || !Number.isFinite(th) || th < 0)
					errors.push(`thresholdAmount tidak valid: ${String(t.id)}`);
			}
		}
	}
	return { ok: errors.length === 0, errors };
}

export interface LegacyTaxConfig {
	enabled: boolean;
	nama: string;
	rate: number;
	threshold: number;
	apply_threshold: boolean;
	updated_at?: string;
}

/**
 * Adapter legacy eksplisit: rate=0 tetap 0 (bukan default via ||),
 * threshold non-default tidak hilang.
 */
export function legacyToSettings(legacy: Partial<LegacyTaxConfig> | null | undefined): TaxSettings {
	const rate =
		typeof legacy?.rate === 'number' && Number.isFinite(legacy.rate) ? legacy.rate : 0.005;
	const threshold =
		typeof legacy?.threshold === 'number' && Number.isFinite(legacy.threshold)
			? legacy.threshold
			: TAX_THRESHOLD_DEFAULT;
	return {
		isTaxEnabled: legacy?.enabled !== false,
		taxes: [
			{
				id: 'pph_final_umkm',
				nama:
					typeof legacy?.nama === 'string' && legacy.nama ? legacy.nama : 'PPh Final UMKM (0.5%)',
				tipe: 'pph_final',
				persentase: rate * 100,
				isEnabled: legacy?.enabled !== false,
				useThreshold500Juta: Boolean(legacy?.apply_threshold),
				thresholdAmount: threshold
			} as TaxSettings['taxes'][number]
		]
	};
}

export function settingsToLegacy(settings: TaxSettings): LegacyTaxConfig {
	const first = settings.taxes.find((t) => t.isEnabled) ?? settings.taxes[0];
	return {
		enabled: settings.isTaxEnabled && Boolean(first?.isEnabled),
		nama: first?.nama ?? 'Pajak',
		rate: Number(first?.persentase ?? 0) / 100,
		threshold: Number(
			(first as { thresholdAmount?: unknown })?.thresholdAmount ?? TAX_THRESHOLD_DEFAULT
		),
		apply_threshold: Boolean(first?.useThreshold500Juta)
	};
}

export function calculateEngineTax(input: EngineInput): TaxCalculationResult {
	const { settings, periodTurnover, periodGrossProfit, ytdTurnoverBefore } = input;
	const turnover = Math.max(0, Number(periodTurnover) || 0);
	const gross = Number(periodGrossProfit) || 0;
	const ytdBefore = Math.max(0, Number(ytdTurnoverBefore) || 0);

	if (!settings.isTaxEnabled) {
		return {
			isTaxEnabled: false,
			totalPajak: 0,
			labaKotor: gross,
			labaBersih: gross,
			breakdowns: [],
			activeTaxesLabel: 'Pajak Dinonaktifkan (0%)'
		};
	}
	const active = settings.taxes.filter((t) => t.isEnabled && t.persentase > 0);
	if (active.length === 0) {
		return {
			isTaxEnabled: true,
			totalPajak: 0,
			labaKotor: gross,
			labaBersih: gross,
			breakdowns: [],
			activeTaxesLabel: 'Tidak Ada Pajak Aktif (0%)'
		};
	}

	const ytdEnd = Math.max(turnover, ytdBefore + turnover);
	const breakdowns: TaxItemBreakdown[] = [];
	let total = 0;
	for (const tax of active) {
		let dpp = turnover;
		let keterangan = `${tax.persentase}% dari Omzet (Rp ${dpp.toLocaleString('id-ID')})`;
		if (tax.tipe === 'pph_final' && tax.useThreshold500Juta) {
			const threshold = Number(
				(tax as { thresholdAmount?: unknown }).thresholdAmount ?? TAX_THRESHOLD_DEFAULT
			);
			const taxableEnd = Math.max(0, ytdEnd - threshold);
			const taxableBefore = Math.max(0, ytdBefore - threshold);
			dpp = Math.min(turnover, Math.max(0, taxableEnd - taxableBefore));
			keterangan =
				dpp === 0
					? `Bebas PPh Final (Omzet YTD Rp ${ytdEnd.toLocaleString('id-ID')} ≤ Rp ${threshold.toLocaleString('id-ID')}/th)`
					: `${tax.persentase}% dari Omzet kena pajak periode ini (Rp ${dpp.toLocaleString('id-ID')} setelah fasilitas YTD Rp ${threshold.toLocaleString('id-ID')})`;
		}
		const nominal = Math.round(dpp * (tax.persentase / 100));
		breakdowns.push({
			id: tax.id,
			nama: tax.nama,
			tipe: tax.tipe,
			persentase: tax.persentase,
			nominalPajak: nominal,
			dasarPengenaan: dpp,
			keterangan
		});
		total += nominal;
	}

	let label: string;
	if (active.length === 1) label = `${active[0].nama} (${active[0].persentase}%)`;
	else {
		const sum = active.reduce((s, t) => s + t.persentase, 0);
		label = `Total Pajak ${sum}% (${active.map((t) => `${t.nama.split('(')[0].trim()} ${t.persentase}%`).join(', ')})`;
	}
	return {
		isTaxEnabled: true,
		totalPajak: total,
		labaKotor: gross,
		labaBersih: gross - total,
		breakdowns,
		activeTaxesLabel: label
	};
}
