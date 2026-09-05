import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { createToastManager } from '$lib/utils/ui';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { formatRupiah, parseRupiah, handleRupiahInput } from '$lib/utils/currency';
import { NOTIF } from '$lib/constants/ui';
import { createMenuState } from '$lib/stores/menuState.svelte';
import { createKategoriState } from '$lib/stores/kategoriState.svelte';
import { createEkstraState } from '$lib/stores/ekstraState.svelte';
import { createBahanHppState } from '$lib/stores/bahanHppState.svelte';

export function createManajemenmenuState() {
	// [CATATAN]: ── Shared notif ──────────────────────────────────────────────────────────
	let showNotifModal = $state(false);
	let notifModalMsg = $state('');
	let notifModalType = $state('warning');
	let activeTab = $state('menu');

	function showNotif(msg: string, type: string) {
		notifModalMsg = msg;
		notifModalType = type;
		showNotifModal = true;
	}

	const toastManager = createToastManager();

	// [CATATAN]: ── Late-binding cross-domain deps ────────────────────────────────────────
	const deps = {
		afterUpdate: async () => {},
		fetchRecipes: async () => {},
		fetchMenus: async () => {}
	};

	// [CATATAN]: ── Sub-stores ────────────────────────────────────────────────────────────
	const menuSt = createMenuState({
		showNotif,
		afterUpdate: () => deps.afterUpdate(),
		fetchRecipes: () => deps.fetchRecipes(),
		getBahanList: () => bahanHppSt.bahanList
	});
	const kategoriSt = createKategoriState({
		showNotif,
		afterUpdate: () => deps.afterUpdate(),
		fetchMenus: () => deps.fetchMenus(),
		getMenus: () => menuSt.menus
	});
	const ekstraSt = createEkstraState({
		showNotif,
		afterUpdate: () => deps.afterUpdate(),
		getBahanList: () => bahanHppSt.bahanList
	});
	const bahanHppSt = createBahanHppState({ showNotif });

	// [CATATAN]: ── Wire deps after all sub-stores created ────────────────────────────────
	deps.afterUpdate = async () => {
		try {
			await cacheOrchestrator.clearAllCaches();
			await cacheOrchestrator.invalidateCacheOnChange('produk');
			await cacheOrchestrator.invalidateCacheOnChange('kategori');
			await cacheOrchestrator.invalidateCacheOnChange('tambahan');
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
		} catch (error) {
			ErrorHandler.logError(error, 'clearDataServiceCache');
		}
	};
	deps.fetchRecipes = () => bahanHppSt.fetchRecipes();
	deps.fetchMenus = () => menuSt.fetchMenus();

	// [CATATAN]: ── Cross-domain derived ──────────────────────────────────────────────────
	const filteredMenus = $derived(
		(() => {
			const keyword = menuSt.searchKeyword.trim().toLowerCase();
			return menuSt.menus.filter((menu) => {
				if (!keyword)
					return menuSt.selectedKategori === 'Semua'
						? true
						: menu.kategori_id === menuSt.selectedKategori;
				const kategoriNama =
					kategoriSt.kategoriList.find((k) => k.id === menu.kategori_id)?.nama?.toLowerCase() || '';
				const match = menu.nama.toLowerCase().includes(keyword) || kategoriNama.includes(keyword);
				return (
					(menuSt.selectedKategori === 'Semua'
						? true
						: menu.kategori_id === menuSt.selectedKategori) && match
				);
			});
		})()
	);

	const kategoriWithCount = $derived(
		kategoriSt.kategoriList.map((kat) => ({
			...kat,
			count: menuSt.menus.filter((m) => m.kategori_id === kat.id).length
		}))
	);

	// [CATATAN]: ── Notif auto-dismiss ────────────────────────────────────────────────────
	$effect(() => {
		if (showNotifModal) {
			const timeout = setTimeout(() => {
				showNotifModal = false;
			}, NOTIF.AUTO_DISMISS_MS);
			return () => clearTimeout(timeout);
		}
	});

	// [CATATAN]: ── Branch-reactive loading ───────────────────────────────────────────────
	$effect(() => {
		const _branch = selectedBranch.value;
		if (typeof window !== 'undefined') {
			(async () => {
				await Promise.all([
					menuSt.fetchMenus(),
					kategoriSt.fetchKategori(),
					ekstraSt.fetchEkstra(),
					bahanHppSt.fetchBahan(),
					bahanHppSt.fetchRecipes(),
					bahanHppSt.fetchHppSettings()
				]);
			})();
		}
	});

	// [CATATAN]: ── Public API (identical surface to original) ────────────────────────────
	return {
		// [CATATAN]: ── Menu ──────────────────────────────────────────────────────────────
		get menus() {
			return menuSt.menus;
		},
		get imageError() {
			return menuSt.imageError;
		},
		get menuForm() {
			return menuSt.menuForm;
		},
		set menuForm(v) {
			menuSt.menuForm = v;
		},
		get showMenuForm() {
			return menuSt.showMenuForm;
		},
		get editMenuId() {
			return menuSt.editMenuId;
		},
		get showDeleteModal() {
			return menuSt.showDeleteModal;
		},
		get showCropperDialog() {
			return menuSt.showCropperDialog;
		},
		get cropperDialogImage() {
			return menuSt.cropperDialogImage;
		},
		get isCropping() {
			return menuSt.isCropping;
		},
		get fileInputEl() {
			return menuSt.fileInputEl;
		},
		set fileInputEl(v) {
			menuSt.fileInputEl = v;
		},
		get recipeItems() {
			return menuSt.recipeItems;
		},
		set recipeItems(v) {
			menuSt.recipeItems = v;
		},
		get activeRecipePorsi() {
			return menuSt.activeRecipePorsi;
		},
		set activeRecipePorsi(v: 'reguler' | 'jumbo') {
			menuSt.activeRecipePorsi = v;
		},
		get recipeDraft() {
			return menuSt.recipeDraft;
		},
		set recipeDraft(v) {
			menuSt.recipeDraft = v;
		},
		get selectedKategori() {
			return menuSt.selectedKategori;
		},
		set selectedKategori(v) {
			menuSt.selectedKategori = v;
		},
		get searchKeyword() {
			return menuSt.searchKeyword;
		},
		set searchKeyword(v) {
			menuSt.searchKeyword = v;
		},
		get isGridView() {
			return menuSt.isGridView;
		},
		set isGridView(v) {
			menuSt.isGridView = v;
		},
		get isLoadingMenus() {
			return menuSt.isLoadingMenus;
		},
		get isSavingMenu() {
			return menuSt.isSavingMenu;
		},
		get filteredMenus() {
			return filteredMenus;
		},
		openMenuForm: menuSt.openMenuForm,
		closeMenuForm: menuSt.closeMenuForm,
		saveMenu: menuSt.saveMenu,
		confirmDeleteMenu: menuSt.confirmDeleteMenu,
		doDeleteMenu: menuSt.doDeleteMenu,
		cancelDeleteMenu: menuSt.cancelDeleteMenu,
		addRecipeItem: menuSt.addRecipeItem,
		removeRecipeItem: menuSt.removeRecipeItem,
		handleFileChange: menuSt.handleFileChange,
		handleCropperDone: menuSt.handleCropperDone,
		handleCropperCancel: menuSt.handleCropperCancel,
		removeImage: menuSt.removeImage,
		handleImgError: menuSt.handleImgError,
		setMenuType: menuSt.setMenuType,
		setMenuKategori: menuSt.setMenuKategori,
		toggleEkstra: menuSt.toggleEkstra,
		setTrackStock: menuSt.setTrackStock,
		setTrackIngredients: menuSt.setTrackIngredients,

		// [CATATAN]: ── Kategori ──────────────────────────────────────────────────────────
		get kategoriList() {
			return kategoriSt.kategoriList;
		},
		get kategoriWithCount() {
			return kategoriWithCount;
		},
		get showDeleteKategoriModal() {
			return kategoriSt.showDeleteKategoriModal;
		},
		get showKategoriDetailModal() {
			return kategoriSt.showKategoriDetailModal;
		},
		get kategoriDetail() {
			return kategoriSt.kategoriDetail;
		},
		get selectedMenuIds() {
			return kategoriSt.selectedMenuIds;
		},
		set selectedMenuIds(v) {
			kategoriSt.selectedMenuIds = v;
		},
		get unselectedMenuIds() {
			return kategoriSt.unselectedMenuIds;
		},
		set unselectedMenuIds(v) {
			kategoriSt.unselectedMenuIds = v;
		},
		get kategoriDetailName() {
			return kategoriSt.kategoriDetailName;
		},
		set kategoriDetailName(v) {
			kategoriSt.kategoriDetailName = v;
		},
		get searchKategoriKeyword() {
			return kategoriSt.searchKategoriKeyword;
		},
		set searchKategoriKeyword(v) {
			kategoriSt.searchKategoriKeyword = v;
		},
		get isLoadingKategori() {
			return kategoriSt.isLoadingKategori;
		},
		openKategoriForm: kategoriSt.openKategoriForm,
		closeKategoriDetailModal: kategoriSt.closeKategoriDetailModal,
		saveKategoriDetail: kategoriSt.saveKategoriDetail,
		confirmDeleteKategori: kategoriSt.confirmDeleteKategori,
		doDeleteKategori: kategoriSt.doDeleteKategori,
		cancelDeleteKategori: kategoriSt.cancelDeleteKategori,
		toggleMenuInKategoriRealtime: kategoriSt.toggleMenuInKategoriRealtime,

		// [CATATAN]: ── Ekstra ────────────────────────────────────────────────────────────
		get ekstraList() {
			return ekstraSt.ekstraList;
		},
		get ekstraForm() {
			return ekstraSt.ekstraForm;
		},
		set ekstraForm(v) {
			ekstraSt.ekstraForm = v;
		},
		get showEkstraForm() {
			return ekstraSt.showEkstraForm;
		},
		get editEkstraId() {
			return ekstraSt.editEkstraId;
		},
		get showDeleteEkstraModal() {
			return ekstraSt.showDeleteEkstraModal;
		},
		get searchEkstra() {
			return ekstraSt.searchEkstra;
		},
		set searchEkstra(v) {
			ekstraSt.searchEkstra = v;
		},
		get isLoadingEkstra() {
			return ekstraSt.isLoadingEkstra;
		},
		openEkstraForm: ekstraSt.openEkstraForm,
		closeEkstraForm: ekstraSt.closeEkstraForm,
		saveEkstra: ekstraSt.saveEkstra,
		confirmDeleteEkstra: ekstraSt.confirmDeleteEkstra,
		doDeleteEkstra: ekstraSt.doDeleteEkstra,
		cancelDeleteEkstra: ekstraSt.cancelDeleteEkstra,

		// [CATATAN]: ── Bahan + HPP ───────────────────────────────────────────────────────
		get bahanList() {
			return bahanHppSt.bahanList;
		},
		get allRecipes() {
			return bahanHppSt.allRecipes;
		},
		get hppSettings() {
			return bahanHppSt.hppSettings;
		},
		get showBahanForm() {
			return bahanHppSt.showBahanForm;
		},
		get editBahanId() {
			return bahanHppSt.editBahanId;
		},
		get mutasiBahanId() {
			return bahanHppSt.mutasiBahanId;
		},
		get showMutasiBahanForm() {
			return bahanHppSt.showMutasiBahanForm;
		},
		get showDeleteBahanModal() {
			return bahanHppSt.showDeleteBahanModal;
		},
		get searchBahan() {
			return bahanHppSt.searchBahan;
		},
		set searchBahan(v) {
			bahanHppSt.searchBahan = v;
		},
		get isLoadingBahan() {
			return bahanHppSt.isLoadingBahan;
		},
		get isParsingHpp() {
			return bahanHppSt.isParsingHpp;
		},
		get hppPurchaseText() {
			return bahanHppSt.hppPurchaseText;
		},
		set hppPurchaseText(v) {
			bahanHppSt.hppPurchaseText = v;
		},
		get hppParsedItems() {
			return bahanHppSt.hppParsedItems;
		},
		get bahanForm() {
			return bahanHppSt.bahanForm;
		},
		set bahanForm(v) {
			bahanHppSt.bahanForm = v;
		},
		get hppForm() {
			return bahanHppSt.hppForm;
		},
		set hppForm(v) {
			bahanHppSt.hppForm = v;
		},
		get mutasiBahanForm() {
			return bahanHppSt.mutasiBahanForm;
		},
		set mutasiBahanForm(v) {
			bahanHppSt.mutasiBahanForm = v;
		},
		get availableCategoryOptions() {
			return bahanHppSt.availableCategoryOptions;
		},
		openBahanForm: bahanHppSt.openBahanForm,
		closeBahanForm: bahanHppSt.closeBahanForm,
		saveBahan: bahanHppSt.saveBahan,
		openMutasiBahanForm: bahanHppSt.openMutasiBahanForm,
		closeMutasiBahanForm: bahanHppSt.closeMutasiBahanForm,
		saveMutasiBahan: bahanHppSt.saveMutasiBahan,
		confirmDeleteBahan: bahanHppSt.confirmDeleteBahan,
		doDeleteBahan: bahanHppSt.doDeleteBahan,
		cancelDeleteBahan: bahanHppSt.cancelDeleteBahan,
		addHppExpenseItem: bahanHppSt.addHppExpenseItem,
		removeHppExpenseItem: bahanHppSt.removeHppExpenseItem,
		saveHppSettings: bahanHppSt.saveHppSettings,
		parseHppPurchaseText: bahanHppSt.parseHppPurchaseText,
		saveParsedHppItem: bahanHppSt.saveParsedHppItem,
		getOverheadMonthly: bahanHppSt.getOverheadMonthly,
		getOverheadPerItem: bahanHppSt.getOverheadPerItem,
		getProductRecipeCost: bahanHppSt.getProductRecipeCost,
		getProductHpp: bahanHppSt.getProductHpp,
		getProductMargin: bahanHppSt.getProductMargin,
		getBahanName: bahanHppSt.getBahanName,
		getBahanUnit: bahanHppSt.getBahanUnit,

		// [CATATAN]: ── Shared ────────────────────────────────────────────────────────────
		get showNotifModal() {
			return showNotifModal;
		},
		set showNotifModal(v) {
			showNotifModal = v;
		},
		get notifModalMsg() {
			return notifModalMsg;
		},
		get notifModalType() {
			return notifModalType;
		},
		get activeTab() {
			return activeTab;
		},
		set activeTab(v) {
			activeTab = v;
		},
		toastManager,
		formatRupiah,
		parseRupiah,
		handleRupiahInput
	};
}
