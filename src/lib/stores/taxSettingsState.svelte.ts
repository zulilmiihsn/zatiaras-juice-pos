import {
	getTaxSettings,
	saveTaxSettings,
	syncTaxSettingsWithServer,
	DEFAULT_TAX_SETTINGS,
	calculateTaxes
} from '$lib/services/taxService';
import type { TaxSettings, TaxItemConfig, TaxCalculationResult } from '$lib/types/pajak';

export function createTaxSettingsState() {
	let draft = $state<TaxSettings>(getTaxSettings());
	let persisted = $state<TaxSettings>(getTaxSettings());
	let revision = $state<number>(0);
	let isSaving = $state<boolean>(false);
	let saveError = $state<string | null>(null);
	let saveSuccessMessage = $state<string | null>(null);
	let successTimer: ReturnType<typeof setTimeout> | null = null;
	let dirty = false;
	let syncGen = 0;

	async function syncWithServer(branch?: string) {
		const gen = ++syncGen;
		const synced = await syncTaxSettingsWithServer(branch);
		if (gen !== syncGen) return synced;
		persisted = structuredClone(synced);
		// Jangan timpa draft yang sedang diedit; hanya cache persisted.
		if (!dirty) draft = structuredClone(synced);
		saveError = null;
		return synced;
	}

	if (typeof window !== 'undefined') {
		void syncWithServer();
	}

	function refresh() {
		draft = getTaxSettings();
		dirty = false;
		void syncWithServer();
	}

	async function persist(): Promise<boolean> {
		isSaving = true;
		saveError = null;
		try {
			const res = await saveTaxSettings(draft);
			if (!res.ok) {
				saveError = res.conflict
					? 'Berubah di perangkat lain. Muat ulang lalu coba lagi.'
					: res.message;
				return false;
			}
			dirty = false;
			persisted = structuredClone(res.settings);
			draft = structuredClone(res.settings);
			revision = res.revision;
			if (successTimer) clearTimeout(successTimer);
			saveSuccessMessage = 'Pengaturan pajak berhasil disimpan.';
			successTimer = setTimeout(() => {
				saveSuccessMessage = null;
			}, 3000);
			return true;
		} finally {
			isSaving = false;
		}
	}

	function markDirty() {
		dirty = true;
	}

	function setMasterTaxEnabled(enabled: boolean) {
		draft.isTaxEnabled = enabled;
		markDirty();
		void persist();
	}

	function toggleTax(id: string, enabled: boolean) {
		const target = draft.taxes.find((t) => t.id === id);
		if (target) {
			target.isEnabled = enabled;
			markDirty();
			void persist();
		}
	}

	function updateTaxPercentage(id: string, percentage: number) {
		const target = draft.taxes.find((t) => t.id === id);
		if (target) {
			target.persentase = Math.max(0, Math.min(100, Number(percentage) || 0));
			markDirty();
			void persist();
		}
	}

	function toggleTaxThreshold(id: string, useThreshold: boolean) {
		const target = draft.taxes.find((t) => t.id === id);
		if (target) {
			target.useThreshold500Juta = useThreshold;
			markDirty();
			void persist();
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

		draft.taxes.push(newItem);
		markDirty();
		void persist();
	}

	function removeCustomTax(id: string) {
		draft.taxes = draft.taxes.filter((t) => t.id !== id);
		markDirty();
		void persist();
	}

	function resetToDefaults() {
		draft = JSON.parse(JSON.stringify(DEFAULT_TAX_SETTINGS));
		markDirty();
		void persist();
	}

	// Simulasi draft eksplisit (halaman pajak). Laporan memakai summary server.
	function compute(
		pendapatanBruto: number,
		labaKotor: number,
		ytdEnd?: number
	): TaxCalculationResult {
		return calculateTaxes(pendapatanBruto, labaKotor, draft, ytdEnd);
	}

	return {
		get settings() {
			return draft;
		},
		set settings(v: TaxSettings) {
			draft = v;
			markDirty();
		},
		get persisted() {
			return persisted;
		},
		get revision() {
			return revision;
		},
		get isSaving() {
			return isSaving;
		},
		get saveError() {
			return saveError;
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
