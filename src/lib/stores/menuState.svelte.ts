import { createMenuCrud } from '$lib/services/manajemenmenuCrud';
import {
	deleteMenuImage,
	readImageFile,
	uploadMenuImageFromDataUrl
} from '$lib/utils/manajemenmenuImage';
import { formatRupiah, parseRupiah } from '$lib/utils/currency';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { convertToBaseUnit } from '$lib/utils/unitConversion';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import type { Ingredient, Product } from '$lib/types/product';

export interface RecipeItemState {
	bahan_id: string | number;
	porsi?: 'reguler' | 'jumbo';
	jumlah_per_item: string;
	satuan_resep?: string;
	jumlah_dasar_per_item?: number;
}

interface MenuDeps {
	showNotif: (msg: string, type: string) => void;
	afterUpdate: () => Promise<void>;
	fetchRecipes: () => Promise<void>;
	getBahanList?: () => Ingredient[];
}

export function createMenuState(deps: MenuDeps) {
	const menuCrud = createMenuCrud();

	let menus = $state<Product[]>([]);
	const imageError = $state<Record<string, boolean>>({});
	let showMenuForm = $state(false);
	let editMenuId = $state<string | number | null>(null);
	let showDeleteModal = $state(false);
	let menuIdToDelete = $state<string | number | null>(null);
	let showCropperDialog = $state(false);
	let cropperDialogImage = $state('');
	let isCropping = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let recipeItems = $state<RecipeItemState[]>([]);
	let activeRecipePorsi = $state<'reguler' | 'jumbo'>('reguler');
	let recipeDraft = $state({ bahan_id: '', jumlah_per_item: '', satuan_resep: '' });
	let selectedKategori = $state<string | number>('Semua');
	let searchKeyword = $state('');
	let isGridView = $state(true);
	let isLoadingMenus = $state(true);

	let menuForm = $state({
		nama: '',
		kategori_id: null as string | number | null,
		tipe: 'minuman' as 'minuman' | 'makanan' | 'snack',
		harga: '',
		harga_jumbo: '',
		stok: '',
		lacak_stok: false,
		lacak_bahan: false,
		ekstra_ids: [] as Array<string | number>,
		gambar: ''
	});

	function resetMenuForm() {
		menuForm = {
			nama: '',
			kategori_id: null,
			tipe: 'minuman',
			harga: '',
			harga_jumbo: '',
			stok: '',
			lacak_stok: false,
			lacak_bahan: false,
			ekstra_ids: [],
			gambar: ''
		};
	}

	async function fetchMenus(): Promise<void> {
		isLoadingMenus = true;
		try {
			menus = await menuCrud.load();
		} catch (error) {
			deps.showNotif('Gagal memuat menu: ' + ErrorHandler.extractErrorMessage(error), 'error');
		}
		isLoadingMenus = false;
	}

	async function openMenuForm(menu: Product | null = null): Promise<void> {
		showMenuForm = true;
		activeRecipePorsi = 'reguler';
		if (menu) {
			editMenuId = menu.id;
			menuForm.nama = menu.nama;
			menuForm.kategori_id = menu.kategori_id as number;
			menuForm.tipe = menu.tipe;
			menuForm.harga = formatRupiah(menu.harga);
			menuForm.harga_jumbo = menu.harga_jumbo ? formatRupiah(menu.harga_jumbo) : '';
			menuForm.stok =
				menu.stok !== null && menu.stok !== undefined ? String(Number(menu.stok || 0)) : '';
			menuForm.lacak_stok = Boolean(menu.lacak_stok);
			menuForm.lacak_bahan = Boolean(menu.lacak_bahan);
			menuForm.ekstra_ids = menu.ekstra_ids ?? [];
			menuForm.gambar = menu.gambar || '';
			if (menuForm.lacak_bahan) {
				const recipes = await menuCrud.loadRecipes(menu.id);
				recipeItems = recipes.map((recipe) => ({
					bahan_id: recipe.bahan_id,
					porsi: (recipe as any).porsi || 'reguler',
					jumlah_per_item: String(recipe.jumlah_per_item || ''),
					satuan_resep: recipe.satuan_resep || undefined,
					jumlah_dasar_per_item: recipe.jumlah_dasar_per_item ?? Number(recipe.jumlah_per_item || 0)
				}));
			}
		} else {
			editMenuId = null;
			resetMenuForm();
		}
	}

	function closeMenuForm() {
		showMenuForm = false;
		editMenuId = null;
		resetMenuForm();
		recipeItems = [];
		activeRecipePorsi = 'reguler';
		recipeDraft = { bahan_id: '', jumlah_per_item: '', satuan_resep: '' };
	}

	async function saveMenu() {
		if (!menuForm.nama || menuForm.nama.trim() === '') {
			deps.showNotif('Nama menu wajib diisi!', 'warning');
			return;
		}
		if (!menuForm.harga || menuForm.harga.toString().trim() === '') {
			deps.showNotif('Harga menu wajib diisi!', 'warning');
			return;
		}
		if (menuForm.lacak_bahan && recipeItems.length === 0) {
			deps.showNotif('Resep bahan wajib diisi untuk menu jus.', 'warning');
			return;
		}

		let imageUrl = menuForm.gambar;
		if (imageUrl && imageUrl.startsWith('data:image/')) {
			try {
				imageUrl = await uploadMenuImageFromDataUrl(imageUrl, String(editMenuId || Date.now()));
			} catch (err) {
				deps.showNotif('Gagal upload gambar: ' + ErrorHandler.extractErrorMessage(err), 'error');
				return;
			}
		}
		const productPayload = {
			id: editMenuId || null,
			nama: menuForm.nama,
			kategori_id: menuForm.kategori_id,
			tipe: menuForm.tipe,
			harga: parseRupiah(menuForm.harga),
			harga_jumbo: menuForm.harga_jumbo ? parseRupiah(menuForm.harga_jumbo) : null,
			stok:
				menuForm.stok !== null && menuForm.stok !== undefined && menuForm.stok !== ''
					? Number(menuForm.stok)
					: null,
			lacak_stok: menuForm.lacak_stok,
			lacak_bahan: menuForm.lacak_bahan,
			ekstra_ids: menuForm.ekstra_ids,
			gambar: imageUrl
		};

		const recipesPayload = recipeItems.map((item) => ({
			bahan_id: String(item.bahan_id),
			porsi: item.porsi || 'reguler',
			jumlah_per_item: Number(item.jumlah_per_item || 0),
			satuan_resep: item.satuan_resep || null,
			jumlah_dasar_per_item: Number(item.jumlah_dasar_per_item || item.jumlah_per_item || 0)
		}));

		try {
			const res = await fetchWithCsrfRetry('/api/produk/save-atomic', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					produk: productPayload,
					resep: recipesPayload
				})
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => ({}));
				throw new Error(errData.message || 'Gagal menyimpan menu');
			}
		} catch (error) {
			deps.showNotif('Gagal menyimpan menu: ' + ErrorHandler.extractErrorMessage(error), 'error');
			return;
		}

		closeMenuForm();
		await fetchMenus();
		await deps.fetchRecipes();
		await deps.afterUpdate();
	}

	function addRecipeItem() {
		const bahanId = recipeDraft.bahan_id;
		const jumlah = Number(recipeDraft.jumlah_per_item || 0);
		if (!bahanId || !Number.isFinite(jumlah) || jumlah <= 0) {
			deps.showNotif('Pilih bahan dan isi takaran resep.', 'warning');
			return;
		}
		const bahanList = deps.getBahanList ? deps.getBahanList() : [];
		const bahan = bahanList.find((b) => String(b.id) === String(bahanId));
		const baseUnit = bahan?.satuan || 'gram';
		const recipeUnit = recipeDraft.satuan_resep || baseUnit;
		const packSize = bahan?.isi_per_kemasan || 1;
		const baseAmount = convertToBaseUnit(jumlah, recipeUnit, baseUnit, packSize);

		const existing = recipeItems.find(
			(item) =>
				String(item.bahan_id) === String(bahanId) && (item.porsi || 'reguler') === activeRecipePorsi
		);
		if (existing) {
			existing.jumlah_per_item = String(jumlah);
			existing.satuan_resep = recipeUnit;
			existing.jumlah_dasar_per_item = baseAmount;
			recipeItems = [...recipeItems];
		} else {
			recipeItems = [
				...recipeItems,
				{
					bahan_id: bahanId,
					porsi: activeRecipePorsi,
					jumlah_per_item: String(jumlah),
					satuan_resep: recipeUnit,
					jumlah_dasar_per_item: baseAmount
				}
			];
		}
		recipeDraft = { bahan_id: '', jumlah_per_item: '', satuan_resep: '' };
	}

	function removeRecipeItem(bahanId: string | number, porsi?: 'reguler' | 'jumbo') {
		const targetPorsi = porsi || activeRecipePorsi;
		recipeItems = recipeItems.filter(
			(item) =>
				!(String(item.bahan_id) === String(bahanId) && (item.porsi || 'reguler') === targetPorsi)
		);
	}

	function confirmDeleteMenu(id: string | number) {
		menuIdToDelete = id;
		showDeleteModal = true;
	}

	async function doDeleteMenu() {
		if (menuIdToDelete !== null) {
			try {
				const menu = menus.find((m) => m.id === menuIdToDelete);
				await deleteMenuImage(menu?.gambar);
				await menuCrud.remove(menuIdToDelete);
				deps.showNotif('Menu berhasil dihapus!', 'success');
			} catch (error) {
				deps.showNotif('Gagal menghapus menu: ' + ErrorHandler.extractErrorMessage(error), 'error');
				return;
			}
			showDeleteModal = false;
			menuIdToDelete = null;
			await fetchMenus();
			await deps.afterUpdate();
		}
	}

	function cancelDeleteMenu() {
		showDeleteModal = false;
		menuIdToDelete = null;
	}

	async function handleFileChange(e: Event) {
		if (isCropping) return;
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		cropperDialogImage = await readImageFile(file);
		showCropperDialog = true;
		isCropping = true;
	}

	function handleCropperDone(data: { cropped: string }) {
		menuForm.gambar = data.cropped;
		showCropperDialog = false;
		cropperDialogImage = '';
		isCropping = false;
		if (fileInputEl) fileInputEl.value = '';
	}

	function handleCropperCancel() {
		showCropperDialog = false;
		cropperDialogImage = '';
		isCropping = false;
	}

	function removeImage() {
		menuForm.gambar = '';
		if (fileInputEl) fileInputEl.value = '';
	}

	function handleImgError(menuId: string | number) {
		imageError[menuId] = true;
	}

	function setMenuType(type: 'minuman' | 'makanan' | 'snack') {
		menuForm.tipe = type;
	}

	function setMenuKategori(kategoriId: string | number | null) {
		menuForm.kategori_id = kategoriId;
	}

	function toggleEkstra(ekstraId: string | number) {
		if (menuForm.ekstra_ids.includes(ekstraId)) {
			menuForm.ekstra_ids = menuForm.ekstra_ids.filter((id) => id !== ekstraId);
		} else {
			menuForm.ekstra_ids = [...menuForm.ekstra_ids, ekstraId];
		}
	}

	function setTrackStock(value: boolean) {
		menuForm.lacak_stok = value;
		if (value) menuForm.lacak_bahan = false;
	}

	function setTrackIngredients(value: boolean) {
		menuForm.lacak_bahan = value;
		if (value) menuForm.lacak_stok = false;
	}

	return {
		get menus() {
			return menus;
		},
		get imageError() {
			return imageError;
		},
		get menuForm() {
			return menuForm;
		},
		set menuForm(v) {
			menuForm = v;
		},
		get showMenuForm() {
			return showMenuForm;
		},
		get editMenuId() {
			return editMenuId;
		},
		get showDeleteModal() {
			return showDeleteModal;
		},
		get showCropperDialog() {
			return showCropperDialog;
		},
		get cropperDialogImage() {
			return cropperDialogImage;
		},
		get isCropping() {
			return isCropping;
		},
		get fileInputEl() {
			return fileInputEl;
		},
		set fileInputEl(v) {
			fileInputEl = v;
		},
		get recipeItems() {
			return recipeItems;
		},
		set recipeItems(v) {
			recipeItems = v;
		},
		get activeRecipePorsi() {
			return activeRecipePorsi;
		},
		set activeRecipePorsi(v: 'reguler' | 'jumbo') {
			activeRecipePorsi = v;
		},
		get recipeDraft() {
			return recipeDraft;
		},
		set recipeDraft(v) {
			recipeDraft = v;
		},
		get selectedKategori() {
			return selectedKategori;
		},
		set selectedKategori(v) {
			selectedKategori = v;
		},
		get searchKeyword() {
			return searchKeyword;
		},
		set searchKeyword(v) {
			searchKeyword = v;
		},
		get isGridView() {
			return isGridView;
		},
		set isGridView(v) {
			isGridView = v;
		},
		get isLoadingMenus() {
			return isLoadingMenus;
		},
		fetchMenus,
		openMenuForm,
		closeMenuForm,
		saveMenu,
		confirmDeleteMenu,
		doDeleteMenu,
		cancelDeleteMenu,
		addRecipeItem,
		removeRecipeItem,
		handleFileChange,
		handleCropperDone,
		handleCropperCancel,
		removeImage,
		handleImgError,
		setMenuType,
		setMenuKategori,
		toggleEkstra,
		setTrackStock,
		setTrackIngredients
	};
}
