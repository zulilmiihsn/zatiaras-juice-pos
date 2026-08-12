import {
	createBahanCrud,
	createHppState,
	type HppParsedItem
} from '$lib/services/manajemenmenuCrud';
import { formatRupiah, parseRupiah } from '$lib/utils/currency';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { createHppCalculator } from '$lib/utils/manajemenmenuHpp';
import {
	calculateEffectiveUnitCost,
	isValidYieldPercent,
	normalizeYieldPercent
} from '$lib/utils/ingredientCost';
import type { Ingredient, ProductRecipe, HppSettings } from '$lib/types/product';

interface BahanHppConfig {
	showNotif: (msg: string, type: string) => void;
}

export function createBahanHppState(config: BahanHppConfig) {
	const bahanCrud = createBahanCrud();
	const hppState = createHppState();

	let bahanList = $state<Ingredient[]>([]);
	let allRecipes = $state<ProductRecipe[]>([]);
	let hppSettings = $state<HppSettings | null>(null);
	let showBahanForm = $state(false);
	let editBahanId = $state<string | number | null>(null);
	let mutasiBahanId = $state<string | number | null>(null);
	let showMutasiBahanForm = $state(false);
	let showDeleteBahanModal = $state(false);
	let bahanIdToDelete = $state<string | number | null>(null);
	let searchBahan = $state('');
	let isLoadingBahan = $state(true);
	let isParsingHpp = $state(false);
	let hppPurchaseText = $state('');
	let hppParsedItems = $state<HppParsedItem[]>([]);

	let bahanForm = $state({
		nama: '',
		satuan: 'gram',
		stok_saat_ini: '',
		ambang_stok: '',
		yield_persen: '100',
		jumlah_beli_terakhir: '',
		biaya_beli_terakhir: ''
	});

	let hppForm = $state({
		sewa_bulanan: '',
		listrik_bulanan: '',
		air_bulanan: '',
		gaji_bulanan: '',
		lainnya_bulanan: '',
		target_item_bulanan: '1000'
	});

	let mutasiBahanForm = $state({ delta_jumlah: '', catatan: '' });

	const {
		getBahanName,
		getBahanUnit,
		getOverheadMonthly,
		getOverheadPerItem,
		getProductRecipeCost,
		getProductHpp,
		getProductMargin
	} = createHppCalculator({
		getSettings: () => hppSettings,
		getIngredients: () => bahanList,
		getRecipes: () => allRecipes
	});

	async function fetchBahan() {
		isLoadingBahan = true;
		try {
			bahanList = await bahanCrud.load();
		} catch (error) {
			const e = error as Error;
			config.showNotif('Gagal mengambil data bahan: ' + (e?.message || 'Unknown error'), 'error');
		}
		isLoadingBahan = false;
	}

	async function fetchRecipes() {
		try {
			allRecipes = await hppState.loadRecipes();
		} catch {
			allRecipes = [];
		}
	}

	async function fetchHppSettings() {
		try {
			hppSettings = await hppState.loadSettings();
			const settings = hppSettings || ({} as Partial<HppSettings>);
			hppForm = {
				sewa_bulanan: formatRupiah(settings.sewa_bulanan),
				listrik_bulanan: formatRupiah(settings.listrik_bulanan),
				air_bulanan: formatRupiah(settings.air_bulanan),
				gaji_bulanan: formatRupiah(settings.gaji_bulanan),
				lainnya_bulanan: formatRupiah(settings.lainnya_bulanan),
				target_item_bulanan: formatRupiah(settings.target_item_bulanan) || '1.000'
			};
		} catch {
			hppSettings = null;
		}
	}

	function openBahanForm(bahan: Ingredient | null = null) {
		showBahanForm = true;
		if (bahan) {
			editBahanId = bahan.id;
			bahanForm = {
				nama: bahan.nama,
				satuan: bahan.satuan || 'gram',
				stok_saat_ini: formatRupiah(bahan.stok_saat_ini) || '0',
				ambang_stok: formatRupiah(bahan.ambang_stok) || '0',
				yield_persen: String(normalizeYieldPercent(bahan.yield_persen)),
				jumlah_beli_terakhir: formatRupiah(bahan.jumlah_beli_terakhir),
				biaya_beli_terakhir: formatRupiah(bahan.biaya_beli_terakhir)
			};
		} else {
			editBahanId = null;
			bahanForm = {
				nama: '',
				satuan: 'gram',
				stok_saat_ini: '',
				ambang_stok: '',
				yield_persen: '100',
				jumlah_beli_terakhir: '',
				biaya_beli_terakhir: ''
			};
		}
	}

	function closeBahanForm() {
		showBahanForm = false;
		editBahanId = null;
		bahanForm = {
			nama: '',
			satuan: 'gram',
			stok_saat_ini: '',
			ambang_stok: '',
			yield_persen: '100',
			jumlah_beli_terakhir: '',
			biaya_beli_terakhir: ''
		};
	}

	async function saveBahan() {
		if (!bahanForm.nama.trim()) {
			config.showNotif('Nama bahan wajib diisi', 'warning');
			return;
		}
		if (!isValidYieldPercent(bahanForm.yield_persen)) {
			config.showNotif('Yield bahan harus lebih dari 0% dan maksimal 100%', 'warning');
			return;
		}
		const purchaseQuantity = Math.max(0, parseRupiah(bahanForm.jumlah_beli_terakhir));
		const purchaseCost = Math.max(0, parseRupiah(bahanForm.biaya_beli_terakhir));
		const yieldPercent = normalizeYieldPercent(bahanForm.yield_persen);
		const payload = {
			nama: bahanForm.nama.trim(),
			satuan: bahanForm.satuan || 'gram',
			stok_saat_ini: Math.max(0, parseRupiah(bahanForm.stok_saat_ini)),
			ambang_stok: Math.max(0, parseRupiah(bahanForm.ambang_stok)),
			yield_persen: yieldPercent,
			jumlah_beli_terakhir: purchaseQuantity,
			biaya_beli_terakhir: purchaseCost,
			biaya_per_satuan: calculateEffectiveUnitCost(purchaseCost, purchaseQuantity, yieldPercent)
		};
		try {
			await bahanCrud.save(payload, editBahanId);
			closeBahanForm();
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await fetchBahan();
		} catch (error) {
			config.showNotif(
				'Gagal menyimpan bahan: ' + ErrorHandler.extractErrorMessage(error),
				'error'
			);
		}
	}

	function openMutasiBahanForm(bahan: Ingredient) {
		mutasiBahanId = bahan.id;
		mutasiBahanForm = { delta_jumlah: '', catatan: '' };
		showMutasiBahanForm = true;
	}

	function closeMutasiBahanForm() {
		showMutasiBahanForm = false;
		mutasiBahanId = null;
		mutasiBahanForm = { delta_jumlah: '', catatan: '' };
	}

	async function saveMutasiBahan() {
		if (!mutasiBahanId) return;
		const delta = Number(mutasiBahanForm.delta_jumlah || 0);
		if (!Number.isFinite(delta) || delta === 0) {
			config.showNotif('Jumlah stok masuk atau keluar wajib diisi', 'warning');
			return;
		}
		try {
			await bahanCrud.mutate(mutasiBahanId, delta, mutasiBahanForm.catatan);
			closeMutasiBahanForm();
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await fetchBahan();
		} catch (error) {
			config.showNotif(
				'Gagal menyimpan stok bahan: ' + ErrorHandler.extractErrorMessage(error),
				'error'
			);
		}
	}

	function confirmDeleteBahan(id: string | number) {
		bahanIdToDelete = id;
		showDeleteBahanModal = true;
	}

	async function doDeleteBahan() {
		if (bahanIdToDelete === null) return;
		try {
			await bahanCrud.remove(bahanIdToDelete);
			showDeleteBahanModal = false;
			bahanIdToDelete = null;
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await fetchBahan();
		} catch (error) {
			config.showNotif(
				'Gagal menghapus bahan: ' + ErrorHandler.extractErrorMessage(error),
				'error'
			);
		}
	}

	function cancelDeleteBahan() {
		showDeleteBahanModal = false;
		bahanIdToDelete = null;
	}

	async function saveHppSettings() {
		const payload = {
			sewa_bulanan: parseRupiah(hppForm.sewa_bulanan),
			listrik_bulanan: parseRupiah(hppForm.listrik_bulanan),
			air_bulanan: parseRupiah(hppForm.air_bulanan),
			gaji_bulanan: parseRupiah(hppForm.gaji_bulanan),
			lainnya_bulanan: parseRupiah(hppForm.lainnya_bulanan),
			target_item_bulanan: Math.max(1, parseRupiah(hppForm.target_item_bulanan))
		};
		try {
			const result = await hppState.saveSettings(payload);
			hppSettings = (result.data?.[0] as unknown as HppSettings) || ({ ...payload } as HppSettings);
			await cacheOrchestrator.invalidateCacheOnChange('hpp_settings');
			await fetchHppSettings();
			config.showNotif('Pengaturan HPP tersimpan', 'success');
		} catch (error) {
			config.showNotif('Gagal menyimpan HPP: ' + ErrorHandler.extractErrorMessage(error), 'error');
		}
	}

	async function parseHppPurchaseText() {
		if (!hppPurchaseText.trim()) {
			config.showNotif('Isi catatan belanja dulu', 'warning');
			return;
		}
		isParsingHpp = true;
		try {
			hppParsedItems = await hppState.parsePurchase(hppPurchaseText);
		} catch (error) {
			config.showNotif(
				'Gagal membaca catatan belanja: ' + ErrorHandler.extractErrorMessage(error),
				'error'
			);
		}
		isParsingHpp = false;
	}

	async function saveParsedHppItem(item: HppParsedItem) {
		const existing = bahanList.find(
			(bahan) => bahan.nama.trim().toLowerCase() === item.nama.trim().toLowerCase()
		);
		try {
			await hppState.savePurchasedItem(item, existing);
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await fetchBahan();
			config.showNotif('Bahan HPP tersimpan', 'success');
		} catch (error) {
			config.showNotif(
				'Gagal menyimpan bahan HPP: ' + ErrorHandler.extractErrorMessage(error),
				'error'
			);
		}
	}

	return {
		get bahanList() {
			return bahanList;
		},
		get allRecipes() {
			return allRecipes;
		},
		get hppSettings() {
			return hppSettings;
		},
		get showBahanForm() {
			return showBahanForm;
		},
		get editBahanId() {
			return editBahanId;
		},
		get mutasiBahanId() {
			return mutasiBahanId;
		},
		get showMutasiBahanForm() {
			return showMutasiBahanForm;
		},
		get showDeleteBahanModal() {
			return showDeleteBahanModal;
		},
		get searchBahan() {
			return searchBahan;
		},
		set searchBahan(v) {
			searchBahan = v;
		},
		get isLoadingBahan() {
			return isLoadingBahan;
		},
		get isParsingHpp() {
			return isParsingHpp;
		},
		get hppPurchaseText() {
			return hppPurchaseText;
		},
		set hppPurchaseText(v) {
			hppPurchaseText = v;
		},
		get hppParsedItems() {
			return hppParsedItems;
		},
		get bahanForm() {
			return bahanForm;
		},
		set bahanForm(v) {
			bahanForm = v;
		},
		get hppForm() {
			return hppForm;
		},
		set hppForm(v) {
			hppForm = v;
		},
		get mutasiBahanForm() {
			return mutasiBahanForm;
		},
		set mutasiBahanForm(v) {
			mutasiBahanForm = v;
		},
		fetchBahan,
		fetchRecipes,
		fetchHppSettings,
		openBahanForm,
		closeBahanForm,
		saveBahan,
		openMutasiBahanForm,
		closeMutasiBahanForm,
		saveMutasiBahan,
		confirmDeleteBahan,
		doDeleteBahan,
		cancelDeleteBahan,
		saveHppSettings,
		parseHppPurchaseText,
		saveParsedHppItem,
		getBahanName,
		getBahanUnit,
		getOverheadMonthly,
		getOverheadPerItem,
		getProductRecipeCost,
		getProductHpp,
		getProductMargin
	};
}
