import { createKategoriCrud, createMenuCrud } from '$lib/services/manajemenmenuCrud';
import { ErrorHandler } from '$lib/utils/errorHandling';
import type { Category, Product } from '$lib/types/product';

interface KategoriDeps {
	showNotif: (msg: string, type: string) => void;
	afterUpdate: () => Promise<void>;
	fetchMenus: () => Promise<void>;
	getMenus: () => Product[];
}

export function createKategoriState(deps: KategoriDeps) {
	const kategoriCrud = createKategoriCrud();
	const menuCrud = createMenuCrud();

	let kategoriList = $state<Category[]>([]);
	let showDeleteKategoriModal = $state(false);
	let kategoriIdToDelete = $state<string | number | null>(null);
	let showKategoriDetailModal = $state(false);
	let kategoriDetail = $state<Category | null>(null);
	let selectedMenuIds = $state<Array<string | number>>([]);
	let unselectedMenuIds = $state<Array<string | number>>([]);
	let kategoriDetailName = $state('');
	let searchKategoriKeyword = $state('');
	let isLoadingKategori = $state(true);

	async function fetchKategori() {
		isLoadingKategori = true;
		try {
			kategoriList = await kategoriCrud.load();
		} catch (error) {
			const e = error as Error;
			deps.showNotif('Gagal mengambil data kategori: ' + (e?.message || 'Unknown error'), 'error');
		}
		isLoadingKategori = false;
	}

	function openKategoriForm(kat: Category | null) {
		const menus = deps.getMenus();
		if (!kat) {
			kategoriDetail = null;
			showKategoriDetailModal = true;
			kategoriDetailName = '';
			selectedMenuIds = [];
			unselectedMenuIds = menus.filter((m) => !m.kategori_id).map((m) => m.id);
			return;
		}
		kategoriDetail = kat;
		showKategoriDetailModal = true;
		kategoriDetailName = kat.nama;
		selectedMenuIds = menus.filter((m) => m.kategori_id === kat.id).map((m) => m.id);
		unselectedMenuIds = menus
			.filter((m) => !m.kategori_id)
			.map((m) => m.id)
			.filter((id) => !selectedMenuIds.includes(id));
	}

	function closeKategoriDetailModal() {
		showKategoriDetailModal = false;
		kategoriDetail = null;
	}

	async function updateMenusKategori(
		kategoriId: string | number | null,
		menuIds: Array<string | number>,
		oldKategoriId: string | number | null
	) {
		try {
			const menus = deps.getMenus();
			if (menuIds.length) await menuCrud.updateCategories(menuIds, kategoriId);
			if (oldKategoriId) {
				const menusInOldKategori = menus.filter((m) => m.kategori_id === oldKategoriId);
				const menusToRemove = menusInOldKategori.filter((m) => !menuIds.includes(m.id));
				if (menusToRemove.length)
					await menuCrud.updateCategories(
						menusToRemove.map((menu) => menu.id),
						null
					);
			}
		} catch (error) {
			ErrorHandler.logError(error, 'updateMenuCategories');
			throw error;
		}
	}

	async function saveKategoriDetail() {
		if (kategoriDetail) {
			await kategoriCrud.save(kategoriDetailName, kategoriDetail.id);
			await updateMenusKategori(kategoriDetail.id, selectedMenuIds, kategoriDetail.id);
		} else {
			const { data } = await kategoriCrud.save(kategoriDetailName);
			const newKategoriId = (data?.[0]?.id as string) ?? null;
			await updateMenusKategori(newKategoriId, selectedMenuIds, null);
		}
		showKategoriDetailModal = false;
		kategoriDetail = null;
		await fetchKategori();
		await deps.fetchMenus();
		await deps.afterUpdate();
	}

	function confirmDeleteKategori(id: string | number) {
		kategoriIdToDelete = id;
		showDeleteKategoriModal = true;
	}

	async function doDeleteKategori() {
		if (kategoriIdToDelete !== null) {
			try {
				await kategoriCrud.clearProducts(kategoriIdToDelete);
				await kategoriCrud.remove(kategoriIdToDelete);
				showDeleteKategoriModal = false;
				kategoriIdToDelete = null;
				await fetchKategori();
				await deps.fetchMenus();
				await deps.afterUpdate();
			} catch (error) {
				deps.showNotif(
					'Gagal menghapus kategori: ' + ErrorHandler.extractErrorMessage(error),
					'error'
				);
			}
		}
	}

	function cancelDeleteKategori() {
		showDeleteKategoriModal = false;
		kategoriIdToDelete = null;
	}

	function toggleMenuInKategoriRealtime(menuId: string | number) {
		if (selectedMenuIds.includes(menuId)) {
			selectedMenuIds = selectedMenuIds.filter((id) => id !== menuId);
			unselectedMenuIds = [...unselectedMenuIds, menuId];
		} else {
			unselectedMenuIds = unselectedMenuIds.filter((id) => id !== menuId);
			selectedMenuIds = [...selectedMenuIds, menuId];
		}
	}

	return {
		get kategoriList() {
			return kategoriList;
		},
		get showDeleteKategoriModal() {
			return showDeleteKategoriModal;
		},
		get showKategoriDetailModal() {
			return showKategoriDetailModal;
		},
		get kategoriDetail() {
			return kategoriDetail;
		},
		get selectedMenuIds() {
			return selectedMenuIds;
		},
		set selectedMenuIds(v) {
			selectedMenuIds = v;
		},
		get unselectedMenuIds() {
			return unselectedMenuIds;
		},
		set unselectedMenuIds(v) {
			unselectedMenuIds = v;
		},
		get kategoriDetailName() {
			return kategoriDetailName;
		},
		set kategoriDetailName(v) {
			kategoriDetailName = v;
		},
		get searchKategoriKeyword() {
			return searchKategoriKeyword;
		},
		set searchKategoriKeyword(v) {
			searchKategoriKeyword = v;
		},
		get isLoadingKategori() {
			return isLoadingKategori;
		},
		fetchKategori,
		openKategoriForm,
		closeKategoriDetailModal,
		saveKategoriDetail,
		confirmDeleteKategori,
		doDeleteKategori,
		cancelDeleteKategori,
		toggleMenuInKategoriRealtime
	};
}
