import {
	getCachedTaxRevision,
	getTaxSettings,
	saveTaxSettings,
	syncTaxSettingsWithServer,
	DEFAULT_TAX_SETTINGS,
	calculateTaxes
} from '$lib/services/taxService';
import type { TaxSettings, TaxItemConfig, TaxCalculationResult } from '$lib/types/pajak';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';

export function createTaxSettingsState() {
	let draft = $state<TaxSettings>(getTaxSettings());
	let persisted = $state<TaxSettings>(getTaxSettings());
	let revision = $state<number>(0);
	let pendingSaves = $state(0);
	let saveError = $state<string | null>(null);
	let saveSuccessMessage = $state<string | null>(null);
	let successTimer: ReturnType<typeof setTimeout> | null = null;
	let dirty = false;
	let syncGen = 0;
	let editGeneration = 0;
	let saveGeneration = 0;
	// JSON terakhir yang diketahui tersimpan di server; pembanding konflik mandiri.
	let persistedSnapshot = JSON.stringify(persisted);

	async function syncWithServer(branch?: string) {
		const gen = ++syncGen;
		const targetBranch = branch || selectedBranch.value;
		const editsAtStart = editGeneration;
		const synced = await syncTaxSettingsWithServer(targetBranch);
		if (gen !== syncGen || selectedBranch.value !== targetBranch) return synced;
		persisted = structuredClone(synced);
		persistedSnapshot = JSON.stringify(synced);
		revision = getCachedTaxRevision(targetBranch);
		// Jangan timpa draft yang sedang diedit; hanya cache persisted.
		if (!dirty && !pendingSaves && editsAtStart === editGeneration) {
			draft = structuredClone(synced);
			saveError = null;
		}
		return synced;
	}

	if (typeof window !== 'undefined') {
		void syncWithServer();
	}

	function refresh() {
		editGeneration++;
		draft = getTaxSettings();
		dirty = false;
		void syncWithServer();
	}

	async function persist(): Promise<boolean> {
		const generation = ++saveGeneration;
		const targetBranch = selectedBranch.value;
		// Invalidate any GET started before this write.
		syncGen++;
		pendingSaves++;
		saveError = null;
		saveSuccessMessage = null;
		try {
			// Kirim snapshot saat attempt; draft hidup tetap bisa diedit selama flight.
			for (let attempt = 0; attempt < 2; attempt++) {
				const snapshot = $state.snapshot(draft);
				const sentAtEdit = editGeneration;
				const res = await saveTaxSettings(snapshot, targetBranch);
				if (selectedBranch.value !== targetBranch) return res.ok;
				if (res.ok) {
					persisted = structuredClone(res.settings);
					persistedSnapshot = JSON.stringify(res.settings);
					revision = res.revision;
					// Respons lama hanya boleh merapikan bila tak ada edit lebih baru.
					// Edit susulan selalu membawa persist sendiri, jadi tanpa susulan di sini.
					if (sentAtEdit === editGeneration && JSON.stringify(draft) === JSON.stringify(snapshot)) {
						dirty = false;
						draft = structuredClone(res.settings);
						if (generation === saveGeneration) {
							if (successTimer) clearTimeout(successTimer);
							saveSuccessMessage = 'Pengaturan pajak berhasil disimpan.';
							successTimer = setTimeout(() => {
								saveSuccessMessage = null;
							}, 3000);
						}
					}
					return true;
				}
				if (!res.conflict || attempt > 0) {
					if (generation === saveGeneration) {
						saveError = res.conflict
							? 'Berubah di perangkat lain. Muat ulang lalu coba lagi.'
							: res.message;
					}
					return false;
				}
				// 409: bedakan konflik mandiri (rantai save sendiri) dari eksternal.
				// Baseline dicatat SEBELUM sync; hanya server yang sama-dengan-baseline
				// boleh ditulis ulang. Jika perangkat lain mengubah, draft dipertahankan.
				const baseline = persistedSnapshot;
				const fresh = await syncTaxSettingsWithServer(targetBranch);
				if (selectedBranch.value !== targetBranch) return false;
				persisted = structuredClone(fresh);
				persistedSnapshot = JSON.stringify(fresh);
				revision = getCachedTaxRevision(targetBranch);
				if (JSON.stringify(fresh) !== baseline) {
					if (generation === saveGeneration) {
						saveError = 'Berubah di perangkat lain. Muat ulang lalu coba lagi.';
					}
					return false;
				}
				// Konflik mandiri: ulangi sekali dengan revision segar.
			}
			return false;
		} finally {
			pendingSaves--;
		}
	}

	function markDirty() {
		dirty = true;
		editGeneration++;
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
			return pendingSaves > 0;
		},
		get hasUnsavedChanges() {
			return dirty || pendingSaves > 0;
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
