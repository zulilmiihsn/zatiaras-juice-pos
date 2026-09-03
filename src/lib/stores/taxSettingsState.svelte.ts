import {
	getTaxSettings,
	saveTaxSettings,
	syncTaxSettingsWithServer,
	DEFAULT_TAX_SETTINGS,
	calculateTaxes
} from '$lib/services/taxService';
import type { TaxSettings, TaxItemConfig, TaxCalculationResult } from '$lib/types/pajak';

export function createTaxSettingsState() {
	let settings = $state<TaxSettings>(getTaxSettings());
	let isSaving = $state<boolean>(false);
	let saveSuccessMessage = $state<string | null>(null);

	async function syncWithServer(branch?: string) {
		const synced = await syncTaxSettingsWithServer(branch);
		settings = synced;
		return synced;
	}

	if (typeof window !== 'undefined') {
		void syncWithServer();
	}

	function refresh() {
		settings = getTaxSettings();
		void syncWithServer();
	}

	function persist() {
		isSaving = true;
		const ok = saveTaxSettings(settings);
		isSaving = false;
		if (ok) {
			saveSuccessMessage = 'Pengaturan pajak berhasil disimpan.';
			setTimeout(() => {
				saveSuccessMessage = null;
			}, 3000);
		}
		return ok;
	}

	function setMasterTaxEnabled(enabled: boolean) {
		settings.isTaxEnabled = enabled;
		persist();
	}

	function toggleTax(id: string, enabled: boolean) {
		const target = settings.taxes.find((t) => t.id === id);
		if (target) {
			target.isEnabled = enabled;
			persist();
		}
	}

	function updateTaxPercentage(id: string, percentage: number) {
		const target = settings.taxes.find((t) => t.id === id);
		if (target) {
			target.persentase = Math.max(0, Math.min(100, Number(percentage) || 0));
			persist();
		}
	}

	function toggleTaxThreshold(id: string, useThreshold: boolean) {
		const target = settings.taxes.find((t) => t.id === id);
		if (target) {
			target.useThreshold500Juta = useThreshold;
			persist();
		}
	}

	function addCustomTax(nama: string, persentase: number, deskripsi?: string) {
		const cleanName = nama.trim() || 'Pajak Kustom';
		const cleanPercent = Math.max(0.01, Math.min(100, Number(persentase) || 1));
		const newId = `custom_tax_${Date.now()}`;

		const newItem: TaxItemConfig = {
			id: newId,
			nama: cleanName,
			tipe: 'custom',
			persentase: cleanPercent,
			isEnabled: true,
			deskripsi: deskripsi?.trim() || 'Pajak kustom toko'
		};

		settings.taxes.push(newItem);
		persist();
	}

	function removeCustomTax(id: string) {
		settings.taxes = settings.taxes.filter((t) => t.id !== id);
		persist();
	}

	function resetToDefaults() {
		settings = JSON.parse(JSON.stringify(DEFAULT_TAX_SETTINGS));
		persist();
	}

	// Calculate helper
	function compute(pendapatanBruto: number, labaKotor: number): TaxCalculationResult {
		return calculateTaxes(pendapatanBruto, labaKotor, settings);
	}

	return {
		get settings() {
			return settings;
		},
		get isSaving() {
			return isSaving;
		},
		get saveSuccessMessage() {
			return saveSuccessMessage;
		},
		refresh,
		syncWithServer,
		setMasterTaxEnabled,
		toggleTax,
		updateTaxPercentage,
		toggleTaxThreshold,
		addCustomTax,
		removeCustomTax,
		resetToDefaults,
		persist,
		save: persist,
		compute
	};
}

export const globalTaxSettings = createTaxSettingsState();
