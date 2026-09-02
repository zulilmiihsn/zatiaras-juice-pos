import {
	createBahanCrud,
	createHppState,
	type HppParsedItem
} from '$lib/services/manajemenmenuCrud';
import { formatRupiah, parseRupiah } from '$lib/utils/currency';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { createHppCalculator } from '$lib/utils/manajemenmenuHpp';
import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
import {
	convertToBaseUnit,
	detectUnitCategory,
	type UnitCategory
} from '$lib/utils/unitConversion';
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

	const defaultCategories = [
		'Bahan Baku',
		'Buah & Jus',
		'Sirup & Gula',
		'Topping',
		'Kemasan',
		'Barang Jadi'
	];
	const availableCategoryOptions = $derived.by(() => {
		const set = new Set<string>(defaultCategories);
		for (const b of bahanList) {
			const cat = (b.kategori || '').trim();
			if (cat) set.add(cat);
		}
		return Array.from(set);
	});

	let bahanForm = $state({
		nama: '',
		tipe_satuan: 'berat' as UnitCategory,
		satuan: 'gram',
		isi_per_kemasan: '1',
		satuan_beli: 'kg',
		kategoriSelect: 'Bahan Baku',
		customKategori: '',
		kategori: 'Bahan Baku',
		stok_saat_ini: '',
		ambang_stok: '',
		yield_persen: '100', // kept for DB compatibility
		jumlah_beli_terakhir: '',
		biaya_beli_terakhir: ''
	});

	let hppForm = $state<{
		rincian_biaya: Array<{ id: string; nama: string; nominal: string }>;
		sewa_bulanan: string;
		listrik_bulanan: string;
		air_bulanan: string;
		gaji_bulanan: string;
		lainnya_bulanan: string;
		target_item_bulanan: string;
	}>({
		rincian_biaya: [
			{ id: 'sewa', nama: 'Sewa Lapak / Kios', nominal: '' },
			{ id: 'listrik', nama: 'Listrik', nominal: '' },
			{ id: 'air', nama: 'Air Bersih', nominal: '' },
			{ id: 'gaji', nama: 'Gaji Karyawan', nominal: '' }
		],
		sewa_bulanan: '',
		listrik_bulanan: '',
		air_bulanan: '',
		gaji_bulanan: '',
		lainnya_bulanan: '',
		target_item_bulanan: '1.000'
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
			let rincian: Array<{ id: string; nama: string; nominal: string }> = [];

			if (settings.rincian_biaya) {
				try {
					const parsed =
						typeof settings.rincian_biaya === 'string'
							? JSON.parse(settings.rincian_biaya)
							: settings.rincian_biaya;
					if (Array.isArray(parsed) && parsed.length > 0) {
						rincian = parsed.map((item: any) => ({
							id: String(item.id || crypto.randomUUID()),
							nama: String(item.nama || 'Biaya'),
							nominal: formatRupiah(item.nominal) || ''
						}));
					}
				} catch {}
			}

			if (rincian.length === 0) {
				rincian = [
					{
						id: 'sewa',
						nama: 'Sewa Lapak / Kios',
						nominal: formatRupiah(settings.sewa_bulanan) || ''
					},
					{ id: 'listrik', nama: 'Listrik', nominal: formatRupiah(settings.listrik_bulanan) || '' },
					{ id: 'air', nama: 'Air Bersih', nominal: formatRupiah(settings.air_bulanan) || '' },
					{ id: 'gaji', nama: 'Gaji Karyawan', nominal: formatRupiah(settings.gaji_bulanan) || '' }
				];
				if (Number(settings.lainnya_bulanan || 0) > 0) {
					rincian.push({
						id: 'lainnya',
						nama: 'Biaya Rutin Lainnya',
						nominal: formatRupiah(settings.lainnya_bulanan) || ''
					});
				}
			}

			hppForm = {
				rincian_biaya: rincian,
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
			const cat = (bahan.kategori || 'Bahan Baku').trim() || 'Bahan Baku';
			const isKnown = availableCategoryOptions.includes(cat);
			const detectedType = bahan.tipe_satuan || detectUnitCategory(bahan.satuan || 'gram');
			bahanForm = {
				nama: bahan.nama,
				tipe_satuan: detectedType,
				satuan: bahan.satuan || (detectedType === 'cairan' ? 'ml' : 'gram'),
				isi_per_kemasan: formatRupiah(bahan.isi_per_kemasan || 1) || '1',
				satuan_beli: bahan.satuan_beli || bahan.satuan || 'kg',
				kategoriSelect: isKnown ? cat : '__new__',
				customKategori: isKnown ? '' : cat,
				kategori: cat,
				stok_saat_ini: formatRupiah(bahan.stok_saat_ini) || '0',
				ambang_stok: formatRupiah(bahan.ambang_stok) || '0',
				yield_persen: formatRupiah(bahan.yield_persen ?? 100) || '100',
				jumlah_beli_terakhir: formatRupiah(bahan.jumlah_beli_terakhir),
				biaya_beli_terakhir: formatRupiah(bahan.biaya_beli_terakhir)
			};
		} else {
			editBahanId = null;
			bahanForm = {
				nama: '',
				tipe_satuan: 'berat',
				satuan: 'gram',
				isi_per_kemasan: '1',
				satuan_beli: 'kg',
				kategoriSelect: 'Bahan Baku',
				customKategori: '',
				kategori: 'Bahan Baku',
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
			tipe_satuan: 'berat',
			satuan: 'gram',
			isi_per_kemasan: '1',
			satuan_beli: 'kg',
			kategoriSelect: 'Bahan Baku',
			customKategori: '',
			kategori: 'Bahan Baku',
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
		const purchaseQuantityInput = Math.max(0, parseRupiah(bahanForm.jumlah_beli_terakhir));
		const purchaseCost = Math.max(0, parseRupiah(bahanForm.biaya_beli_terakhir));
		const resolvedCategory =
			(bahanForm.kategoriSelect === '__new__'
				? bahanForm.customKategori.trim()
				: bahanForm.kategoriSelect.trim()) || 'Bahan Baku';
		const packSize = Math.max(1, parseRupiah(bahanForm.isi_per_kemasan) || 1);

		// Convert purchase quantity to base unit (e.g. 1 kg -> 1000 gram)
		const purchaseQuantityInBase = convertToBaseUnit(
			purchaseQuantityInput,
			bahanForm.satuan_beli || bahanForm.satuan,
			bahanForm.satuan,
			packSize
		);

		const rawYield = parseRupiah(bahanForm.yield_persen) || 100;
		const yieldPercent = Math.min(100, Math.max(1, rawYield));
		const yieldFactor = yieldPercent / 100;
		const netUsableQuantityInBase = purchaseQuantityInBase * yieldFactor;

		const payload = {
			nama: bahanForm.nama.trim(),
			satuan: bahanForm.satuan || 'gram',
			tipe_satuan: bahanForm.tipe_satuan || 'berat',
			isi_per_kemasan: packSize,
			satuan_beli: bahanForm.satuan_beli || bahanForm.satuan,
			kategori: resolvedCategory,
			stok_saat_ini: Math.max(0, parseRupiah(bahanForm.stok_saat_ini)),
			ambang_stok: Math.max(0, parseRupiah(bahanForm.ambang_stok)),
			yield_persen: yieldPercent,
			jumlah_beli_terakhir: purchaseQuantityInBase,
			biaya_beli_terakhir: purchaseCost,
			biaya_per_satuan: calculateEffectiveUnitCost(purchaseCost, netUsableQuantityInBase)
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

	function addHppExpenseItem() {
		hppForm.rincian_biaya = [
			...hppForm.rincian_biaya,
			{ id: crypto.randomUUID(), nama: '', nominal: '' }
		];
	}

	function removeHppExpenseItem(id: string) {
		hppForm.rincian_biaya = hppForm.rincian_biaya.filter((item) => item.id !== id);
	}

	async function saveHppSettings() {
		const rawItems = hppForm.rincian_biaya
			.filter((item) => item.nama.trim() || parseRupiah(item.nominal) > 0)
			.map((item) => ({
				id: item.id,
				nama: item.nama.trim() || 'Pos Biaya',
				nominal: parseRupiah(item.nominal)
			}));

		const totalMonthly = rawItems.reduce((sum, item) => sum + item.nominal, 0);

		const payload = {
			rincian_biaya: JSON.stringify(rawItems),
			sewa_bulanan: parseRupiah(hppForm.rincian_biaya.find((i) => i.id === 'sewa')?.nominal || 0),
			listrik_bulanan: parseRupiah(
				hppForm.rincian_biaya.find((i) => i.id === 'listrik')?.nominal || 0
			),
			air_bulanan: parseRupiah(hppForm.rincian_biaya.find((i) => i.id === 'air')?.nominal || 0),
			gaji_bulanan: parseRupiah(hppForm.rincian_biaya.find((i) => i.id === 'gaji')?.nominal || 0),
			lainnya_bulanan: totalMonthly,
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
		get availableCategoryOptions() {
			return availableCategoryOptions;
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
		addHppExpenseItem,
		removeHppExpenseItem,
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
