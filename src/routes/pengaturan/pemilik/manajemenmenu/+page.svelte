<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { get as storeGet } from 'svelte/store';
	import { selectedBranch } from '$lib/stores/selectedBranch';
	import { writable } from 'svelte/store';
	import CropperDialog from '$lib/components/shared/cropperDialog.svelte';
	import { fly, fade, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { getSupabaseClient } from '$lib/database/supabaseClient';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import { get as getCache, set as setCache } from 'idb-keyval';
	import { memoize } from '$lib/utils/performance';
	import { userRole } from '$lib/stores/userRole';
	import Plus from 'lucide-svelte/icons/plus';
	import Edit from 'lucide-svelte/icons/edit';
	import Trash from 'lucide-svelte/icons/trash';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Utensils from 'lucide-svelte/icons/utensils';
	import Tag from 'lucide-svelte/icons/tag';
	import { dataService } from '$lib/services/dataService';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import AddonFormModal from '$lib/components/menu/addonFormModal.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { ErrorHandler } from '$lib/utils/errorHandling';

	// Data Menu
	let menus: any[] = [];
	let imageError: Record<string, boolean> = {};
	let kategoriList: any[] = [];
	let ekstraList: any[] = [];
	let showMenuForm = false;
	let showKategoriForm = false;
	let showEkstraForm = false;
	let editMenuId: any = null;
	let editKategoriId = null;
	let editEkstraId: any = null;
	let menuForm = writable({
		name: '',
		kategori_id: null as string | null,
		tipe: 'minuman',
		price: '',
		ekstra_ids: [] as any[],
		gambar: ''
	});
	let kategoriForm = { name: '' };
	let ekstraForm = { name: '', harga: '' };
	let selectedKategori = 'Semua';
	let searchKeyword = '';
	let showDeleteModal = false;
	let menuIdToDelete: number | null = null;
	let selectedImage: File | null = null;
	let croppedImage: string | null = null;
	let showCropperDialog = false;
	let cropperDialogImage = '';
	let touchStartX = 0;
	let touchEndX = 0;
	let touchStartY = 0;
	let menuTouchStartX = 0;
	let menuTouchStartY = 0;
	let menuTouchStartTime = 0;
	let menuSwipeDetected = false;
	let showDeleteKategoriModal = false;
	let kategoriIdToDelete: number | null = null;
	let showKategoriDetailModal = false;
	let kategoriDetail: any = null;
	let selectedMenuIds: number[] = [];
	let unselectedMenuIds: number[] = [];
	let kategoriDetailName = '';
	let searchKategoriKeyword = '';
	let searchEkstra = '';
	let showDeleteEkstraModal = false;
	let ekstraIdToDelete: any = null;
	let kategoriTouchStartX = 0;
	let kategoriTouchStartY = 0;
	let kategoriTouchStartTime = 0;
	let kategoriSwipeDetected = false;
	let ekstraTouchStartX = 0;
	let ekstraTouchStartY = 0;
	let ekstraTouchStartTime = 0;
	let ekstraSwipeDetected = false;
	let isTouchDevice = false;
	if (typeof window !== 'undefined') {
		isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
	}
	let isGridView = true;
	let showNotifModal = false;
	let notifModalMsg = '';
	let notifModalType = 'warning';
	let isCropping = false;
	let fileInputEl: any;
	let activeTab = 'menu';
	let isLoadingMenus = true;
	let isLoadingKategori = true;
	let isLoadingEkstra = true;
	let unsubscribeBranch: (() => void) | null = null;

	// Toast management
	const toastManager = createToastManager();

	// Toast notification state
	let showToast = false;
	let toastMessage = '';
	let toastType: 'success' | 'error' | 'warning' | 'info' = 'success';

	function showToastNotification(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success'
	) {
		toastManager.showToastNotification(message, type);
	}

	const memoizedKategoriWithCount = memoize(
		(menus: any[], kategoriList: any[]) =>
			kategoriList.map((kat: any) => ({
				...kat,
				count: menus.filter((m: any) => m.kategori_id === kat.id).length
			})),
		(menus: any[], kategoriList: any[]) => {
			// Buat cache key yang lebih granular untuk mendeteksi perubahan kategori individual menu
			const menuKategoriMap = menus.map((m: any) => `${m.id}:${m.kategori_id || 'null'}`).join(',');
			const kategoriIds = kategoriList.map((k: any) => k.id).join(',');
			return `${menuKategoriMap}-${kategoriIds}`;
		}
	);

	$: kategoriWithCount = memoizedKategoriWithCount(menus, kategoriList);

	const memoizedFilteredMenus = memoize(
		(menus: any[], kategoriList: any[], selectedKategori: string, searchKeyword: string) => {
			const keyword = searchKeyword.trim().toLowerCase();
			return menus.filter((menu: any) => {
				if (!keyword)
					return selectedKategori === 'Semua' ? true : menu.kategori_id === selectedKategori;
				const kategoriNama =
					kategoriList.find((k: any) => k.id === menu.kategori_id)?.name?.toLowerCase() || '';
				const match = menu.name.toLowerCase().includes(keyword) || kategoriNama.includes(keyword);
				return (
					(selectedKategori === 'Semua' ? true : menu.kategori_id === selectedKategori) && match
				);
			});
		},
		(menus: any[], kategoriList: any[], selectedKategori: string, searchKeyword: string) => {
			// Buat cache key yang lebih granular untuk mendeteksi perubahan kategori individual menu
			const menuKategoriMap = menus.map((m: any) => `${m.id}:${m.kategori_id || 'null'}`).join(',');
			const kategoriIds = kategoriList.map((k: any) => k.id).join(',');
			return `${menuKategoriMap}-${kategoriIds}-${selectedKategori}-${searchKeyword}`;
		}
	);

	$: filteredMenus = memoizedFilteredMenus(menus, kategoriList, selectedKategori, searchKeyword);

	async function fetchMenus() {
		isLoadingMenus = true;
		try {
			const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('produk')
				.select('*')
				.order('created_at', { ascending: false });
			if (error) throw error;
			menus = data || [];

			// Force reactivity update
			menus = [...menus];
		} catch (error: any) {
			notifModalMsg = 'Gagal mengambil data menu: ' + (error?.message || 'Unknown error');
			notifModalType = 'error';
			showNotifModal = true;
		}
		isLoadingMenus = false;
	}

	async function fetchKategori() {
		isLoadingKategori = true;
		try {
			const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('kategori')
				.select('*')
				.order('created_at', { ascending: false });
			if (error) throw error;
			kategoriList = data || [];
		} catch (error: any) {
			notifModalMsg = 'Gagal mengambil data kategori: ' + (error?.message || 'Unknown error');
			notifModalType = 'error';
			showNotifModal = true;
		}
		isLoadingKategori = false;
	}

	async function fetchEkstra() {
		isLoadingEkstra = true;
		try {
			const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('tambahan')
				.select('*')
				.order('created_at', { ascending: false });
			if (error) throw error;
			ekstraList = (data || []).map((e) => ({ ...e, harga: e.price }));
		} catch (error: any) {
			notifModalMsg = 'Gagal mengambil data ekstra: ' + (error?.message || 'Unknown error');
			notifModalType = 'error';
			showNotifModal = true;
		}
		isLoadingEkstra = false;
	}

	onMount(async () => {
		let first = true;
		await fetchMenus();
		await fetchKategori();
		await fetchEkstra();

		// 2. Update cache POS setelah fetch sukses
		await setCache('pos-data', {
			produkData: menus,
			kategoriData: kategoriList,
			tambahanData: ekstraList
		});

		if (typeof window !== 'undefined') {
			document.body.classList.add('hide-nav');
		}

		if (storeGet(userRole) !== 'pemilik') {
			goto('/unauthorized');
		}

		// Subscribe ke selectedBranch untuk fetch ulang data saat cabang berubah
		unsubscribeBranch = selectedBranch.subscribe(() => {
			if (first) {
				first = false;
				return; // skip trigger pertama
			}
			fetchMenus();
			fetchKategori();
			fetchEkstra();
		});
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.body.classList.remove('hide-nav');
		}
		if (unsubscribeBranch) unsubscribeBranch();
	});

	function openMenuForm(menu: any = null): void {
		if (showMenuForm && menu && editMenuId === menu.id) {
			return;
		}
		showMenuForm = true;
		if (menu) {
			editMenuId = menu.id;
			// Format harga untuk display jika ada
			const formattedPrice = menu.price ? menu.price.toLocaleString('id-ID') : '';
			$menuForm = { ...menu, price: formattedPrice, ekstra_ids: menu.ekstra_ids ?? [] };
		} else {
			editMenuId = null;
			$menuForm = {
				name: '',
				kategori_id: null,
				tipe: 'minuman',
				price: '',
				ekstra_ids: [],
				gambar: ''
			};
		}
	}

	function closeMenuForm() {
		showMenuForm = false;
		editMenuId = null;
		$menuForm = {
			name: '',
			kategori_id: null,
			tipe: 'minuman',
			price: '',
			ekstra_ids: [],
			gambar: ''
		};
	}

	async function saveMenu() {
		if (!$menuForm.name || $menuForm.name.toString().trim() === '') {
			notifModalMsg = 'Nama menu wajib diisi!';
			notifModalType = 'warning';
			showNotifModal = true;
			return;
		}
		if (!$menuForm.price || $menuForm.price.toString().trim() === '') {
			notifModalMsg = 'Harga menu wajib diisi!';
			notifModalType = 'warning';
			showNotifModal = true;
			return;
		}
		if (!$menuForm.kategori_id || $menuForm.kategori_id.toString().trim() === '') {
			$menuForm = { ...$menuForm, kategori_id: null };
		}
		let imageUrl = $menuForm.gambar;
		if (imageUrl && imageUrl.startsWith('data:image/')) {
			try {
				imageUrl = await uploadMenuImageFromDataUrl(imageUrl, editMenuId || Date.now());
			} catch (err) {
				notifModalMsg = 'Gagal upload gambar: ' + ErrorHandler.extractErrorMessage(err);
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
		}
		// Konversi harga dari format Rupiah ke angka
		const priceValue =
			typeof $menuForm.price === 'string'
				? parseInt($menuForm.price.replace(/\./g, ''))
				: parseInt($menuForm.price);

		const payload = {
			...$menuForm,
			gambar: imageUrl,
			price: priceValue,
			ekstra_ids: $menuForm.ekstra_ids
		};
		let result;
		try {
			if (editMenuId) {
				result = await getSupabaseClient(storeGet(selectedBranch))
					.from('produk')
					.update(payload)
					.eq('id', editMenuId);
			} else {
				result = await getSupabaseClient(storeGet(selectedBranch)).from('produk').insert([payload]);
			}
			if (result.error) {
				throw result.error;
			}
		} catch (error) {
			notifModalMsg = 'Gagal menyimpan menu: ' + ErrorHandler.extractErrorMessage(error);
			notifModalType = 'error';
			showNotifModal = true;
			return;
		}
		showMenuForm = false;

		// Clear all caches first
		await dataService.clearAllCaches();
		await dataService.invalidateCacheOnChange('produk');

		// Force refresh data dan clear memoization
		await fetchMenus();

		// Force reactivity update untuk memastikan UI ter-update
		menus = [...menus];

		await afterUpdateCachePOS();
		clearMemoizationCache();
	}

	function confirmDeleteMenu(id: number) {
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		menuIdToDelete = id;
		showDeleteModal = true;
		touchStartX = 0;
		touchEndX = 0;
	}

	async function doDeleteMenu() {
		if (menuIdToDelete !== null) {
			try {
				const menu = menus.find((m) => m.id === menuIdToDelete);
				if (menu?.gambar) {
					const path = menu.gambar.split('/').pop();
					await getSupabaseClient(storeGet(selectedBranch))
						.storage.from('gambar-menu')
						.remove([path]);
				}
				const { error } = await getSupabaseClient(storeGet(selectedBranch))
					.from('produk')
					.delete()
					.eq('id', menuIdToDelete);
				if (error) {
					throw error;
				}
				notifModalMsg = 'Menu berhasil dihapus!';
				notifModalType = 'success';
				showNotifModal = true;
			} catch (error) {
				notifModalMsg = 'Gagal menghapus menu: ' + ErrorHandler.extractErrorMessage(error);
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
			showDeleteModal = false;
			menuIdToDelete = null;

			// Clear all caches first
			await dataService.clearAllCaches();
			await dataService.invalidateCacheOnChange('produk');

			// Force refresh data dan clear memoization
			await fetchMenus();

			// Force reactivity update untuk memastikan UI ter-update
			menus = [...menus];

			await afterUpdateCachePOS();
			clearMemoizationCache();
		}
	}

	function cancelDeleteMenu() {
		showDeleteModal = false;
		menuIdToDelete = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		touchStartX = 0;
		touchEndX = 0;
	}

	function openKategoriForm(kat: any) {
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
		kategoriDetailName = kat.name;
		selectedMenuIds = menus.filter((m) => m.kategori_id === kat.id).map((m) => m.id);
		unselectedMenuIds = menus
			.filter((m) => !m.kategori_id)
			.map((m) => m.id)
			.filter((id) => !selectedMenuIds.includes(id));

		// Force reactivity update untuk memastikan data terbaru
		selectedMenuIds = [...selectedMenuIds];
		unselectedMenuIds = [...unselectedMenuIds];
	}

	function closeKategoriDetailModal() {
		showKategoriDetailModal = false;
		kategoriDetail = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
	}

	async function saveKategoriDetail() {
		if (kategoriDetail) {
			const { error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('kategori')
				.update({ name: kategoriDetailName })
				.eq('id', kategoriDetail.id);
			if (error) {
				notifModalMsg = 'Gagal menyimpan kategori: ' + error.message;
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
			await updateMenusKategori(kategoriDetail.id, selectedMenuIds, kategoriDetail.id);
		} else {
			const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
				.from('kategori')
				.insert([{ name: kategoriDetailName }])
				.select();
			if (error) {
				notifModalMsg = 'Gagal menambah kategori: ' + error.message;
				notifModalType = 'error';
				showNotifModal = true;
				return;
			}
			const newKategoriId = data?.[0]?.id ?? null;
			await updateMenusKategori(newKategoriId, selectedMenuIds, null);
		}
		showKategoriDetailModal = false;
		kategoriDetail = null;

		// Clear all caches first
		await dataService.clearAllCaches();
		await dataService.invalidateCacheOnChange('produk');
		await dataService.invalidateCacheOnChange('kategori');

		// Force refresh data dan clear memoization
		await fetchKategori();
		await fetchMenus();

		// Force reactivity update untuk memastikan UI ter-update
		menus = [...menus];
		kategoriList = [...kategoriList];

		// Force refresh data setelah perubahan kategori
		await forceRefreshAfterCategoryChange();
	}

	function confirmDeleteKategori(id: number) {
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		kategoriIdToDelete = id;
		showDeleteKategoriModal = true;
		touchStartX = 0;
		touchEndX = 0;
	}

	async function doDeleteKategori() {
		if (kategoriIdToDelete !== null) {
			try {
				// Pertama, update semua menu yang menggunakan kategori ini menjadi null
				const { error: updateError } = await getSupabaseClient(storeGet(selectedBranch))
					.from('produk')
					.update({ kategori_id: null })
					.eq('kategori_id', kategoriIdToDelete);

				if (updateError) {
					notifModalMsg = 'Gagal mengupdate menu: ' + updateError.message;
					notifModalType = 'error';
					showNotifModal = true;
					return;
				}

				// Kemudian hapus kategori
				const { error: deleteError } = await getSupabaseClient(storeGet(selectedBranch))
					.from('kategori')
					.delete()
					.eq('id', kategoriIdToDelete);

				if (deleteError) {
					notifModalMsg = 'Gagal menghapus kategori: ' + deleteError.message;
					notifModalType = 'error';
					showNotifModal = true;
					return;
				}

				showDeleteKategoriModal = false;
				kategoriIdToDelete = null;

				// Clear all caches first
				await dataService.clearAllCaches();
				await dataService.invalidateCacheOnChange('produk');
				await dataService.invalidateCacheOnChange('kategori');

				// Force refresh data dan clear memoization
				await fetchKategori();
				await fetchMenus();

				// Force reactivity update untuk memastikan UI ter-update
				menus = [...menus];
				kategoriList = [...kategoriList];

				await afterUpdateCachePOS();
				clearMemoizationCache();

				// Force refresh data setelah perubahan kategori
				await forceRefreshAfterCategoryChange();
			} catch (error) {
				notifModalMsg = 'Gagal menghapus kategori: ' + ErrorHandler.extractErrorMessage(error);
				notifModalType = 'error';
				showNotifModal = true;
			}
		}
	}

	function cancelDeleteKategori() {
		showDeleteKategoriModal = false;
		kategoriIdToDelete = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		touchStartX = 0;
		touchEndX = 0;
	}

	function openEkstraForm(ekstra: any = null) {
		showEkstraForm = true;
		if (ekstra) {
			editEkstraId = ekstra.id;
			ekstraForm = { ...ekstra, harga: ekstra.harga.toLocaleString('id-ID') };
		} else {
			editEkstraId = null;
			ekstraForm = { name: '', harga: '' };
		}
	}

	async function saveEkstra() {
		if (!ekstraForm.name.trim()) {
			notifModalMsg = 'Nama ekstra wajib diisi';
			notifModalType = 'warning';
			showNotifModal = true;
			return;
		}
		const harga = parseInt(ekstraForm.harga.toString().replace(/[^\d]/g, ''));
		if (isNaN(harga) || harga <= 0) {
			notifModalMsg = 'Harga wajib diisi dan harus lebih dari 0';
			notifModalType = 'warning';
			showNotifModal = true;
			return;
		}
		try {
			if (editEkstraId) {
				const { error } = await getSupabaseClient(storeGet(selectedBranch))
					.from('tambahan')
					.update({ name: ekstraForm.name, price: harga })
					.eq('id', editEkstraId);
				if (error) throw error;
			} else {
				const { error } = await getSupabaseClient(storeGet(selectedBranch))
					.from('tambahan')
					.insert([{ name: ekstraForm.name, price: harga }]);
				if (error) throw error;
			}
			await fetchEkstra();
			showEkstraForm = false;
			ekstraForm = { name: '', harga: '' };
			editEkstraId = null;

			// Force reactivity update untuk memastikan UI ter-update
			ekstraList = [...ekstraList];
		} catch (error) {
			notifModalMsg = 'Gagal menyimpan ekstra: ' + ErrorHandler.extractErrorMessage(error);
			notifModalType = 'error';
			showNotifModal = true;
		}
		await afterUpdateCachePOS();
	}

	function confirmDeleteEkstra(id: any) {
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		ekstraIdToDelete = id;
		showDeleteEkstraModal = true;
		touchStartX = 0;
		touchEndX = 0;
	}

	async function doDeleteEkstra() {
		if (ekstraIdToDelete !== null) {
			await getSupabaseClient(storeGet(selectedBranch))
				.from('tambahan')
				.delete()
				.eq('id', ekstraIdToDelete);
			showDeleteEkstraModal = false;
			ekstraIdToDelete = null;

			// Force refresh data dan clear memoization
			await fetchEkstra();

			// Force reactivity update untuk memastikan UI ter-update
			ekstraList = [...ekstraList];

			await afterUpdateCachePOS();
			clearMemoizationCache();
		}
	}

	function cancelDeleteEkstra() {
		showDeleteEkstraModal = false;
		ekstraIdToDelete = null;
		if (typeof window !== 'undefined') {
			window.removeEventListener('click', blockNextClick, true);
		}
		touchStartX = 0;
		touchEndX = 0;
	}

	// Helper functions for menu form
	function handleFileChange(e: Event) {
		if (isCropping) return;
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		selectedImage = file;
		const reader = new FileReader();
		reader.onload = (ev) => {
			cropperDialogImage = '';
			setTimeout(() => {
				cropperDialogImage = (ev.target as FileReader).result as string;
				showCropperDialog = true;
				isCropping = true;
			}, 10);
		};
		reader.readAsDataURL(file);
	}

	function handleCropperDone(e: CustomEvent) {
		$menuForm = { ...$menuForm, gambar: e.detail.cropped };
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
		$menuForm = { ...$menuForm, gambar: '' };
		if (fileInputEl) {
			fileInputEl.value = '';
		}
	}

	function formatRupiahInput(e: Event) {
		const target = e.target as HTMLInputElement;
		let value = target.value.replace(/[^\d]/g, '');
		if (value) {
			// Simpan nilai asli (angka) untuk database
			const numericValue = parseInt(value);
			// Tampilkan format Rupiah untuk user
			const formattedValue = numericValue.toLocaleString('id-ID');
			$menuForm = { ...$menuForm, price: formattedValue };
		} else {
			$menuForm = { ...$menuForm, price: '' };
		}
	}

	function handleImgError(menuId: string | number) {
		imageError[menuId] = true;
		imageError = imageError; // trigger reactivity
	}

	function handleKategoriClick(e: Event, kat: any) {
		// Handle kategori click if needed
	}

	function handleEkstraClick(e: Event, ekstra: any) {
		// Handle ekstra click if needed
	}

	function toggleMenuInKategoriRealtime(menuId: any) {
		if (selectedMenuIds.includes(menuId)) {
			selectedMenuIds = selectedMenuIds.filter((id) => id !== menuId);
			unselectedMenuIds = [...unselectedMenuIds, menuId];
		} else {
			unselectedMenuIds = unselectedMenuIds.filter((id) => id !== menuId);
			selectedMenuIds = [...selectedMenuIds, menuId];
		}

		// Force reactivity update
		selectedMenuIds = [...selectedMenuIds];
		unselectedMenuIds = [...unselectedMenuIds];
	}

	async function updateMenusKategori(kategoriId: any, menuIds: any[], oldKategoriId: any) {
		try {
			// Update menu kategori untuk menu yang dipilih
			for (const menuId of menuIds) {
				await getSupabaseClient(storeGet(selectedBranch))
					.from('produk')
					.update({ kategori_id: kategoriId })
					.eq('id', menuId);
			}

			// Jika ada kategori lama, update menu yang tidak dipilih untuk kembali ke kategori lama
			if (oldKategoriId) {
				const menusInOldKategori = menus.filter((m) => m.kategori_id === oldKategoriId);
				const menusToRemoveFromOldKategori = menusInOldKategori.filter(
					(m) => !menuIds.includes(m.id)
				);

				for (const menu of menusToRemoveFromOldKategori) {
					await getSupabaseClient(storeGet(selectedBranch))
						.from('produk')
						.update({ kategori_id: null })
						.eq('id', menu.id);
				}
			}
		} catch (error) {
			ErrorHandler.logError(error, 'updateMenuCategories');
			throw error;
		}
	}

	async function uploadMenuImageFromDataUrl(dataUrl: string, menuId: any) {
		const res = await fetch(dataUrl);
		const blob = await res.blob();
		const filePath = `menu-${menuId}-${Date.now()}.jpg`;
		const { data, error } = await getSupabaseClient(storeGet(selectedBranch))
			.storage.from('gambar-menu')
			.upload(filePath, blob, { upsert: true });
		if (error) throw error;
		const { data: publicUrlData } = getSupabaseClient(storeGet(selectedBranch))
			.storage.from('gambar-menu')
			.getPublicUrl(filePath);
		return publicUrlData.publicUrl;
	}

	function blockNextClick(e: Event) {
		e.preventDefault();
		e.stopPropagation();
	}

	// Helper functions for modal buttons
	function setMenuType(type: any) {
		$menuForm = { ...$menuForm, tipe: type };
	}

	function setMenuKategori(kategoriId: any) {
		$menuForm = { ...$menuForm, kategori_id: kategoriId };
	}

	function toggleEkstra(ekstraId: any) {
		if ($menuForm.ekstra_ids.includes(ekstraId)) {
			$menuForm = {
				...$menuForm,
				ekstra_ids: $menuForm.ekstra_ids.filter((id) => id !== ekstraId)
			};
		} else {
			$menuForm = { ...$menuForm, ekstra_ids: [...$menuForm.ekstra_ids, ekstraId] };
		}
	}

	async function afterUpdateCachePOS() {
		// Update local cache
		await setCache('pos-data', {
			produkData: menus,
			kategoriData: kategoriList,
			tambahanData: ekstraList
		});

		// Clear dataService cache untuk memastikan data terbaru
		try {
			await dataService.clearAllCaches();
			await dataService.invalidateCacheOnChange('produk');
			await dataService.invalidateCacheOnChange('kategori');
			await dataService.invalidateCacheOnChange('tambahan');
		} catch (error) {
			ErrorHandler.logError(error, 'clearDataServiceCache');
		}
	}

	// Function untuk clear memoization cache
	function clearMemoizationCache() {
		memoizedKategoriWithCount.clearCache();
		memoizedFilteredMenus.clearCache();
	}

	// Function untuk force refresh data setelah perubahan kategori
	async function forceRefreshAfterCategoryChange() {
		// Clear all caches first
		await dataService.clearAllCaches();
		await dataService.invalidateCacheOnChange('produk');
		await dataService.invalidateCacheOnChange('kategori');

		// Force refresh data
		await fetchKategori();
		await fetchMenus();

		// Force reactivity update
		menus = [...menus];
		kategoriList = [...kategoriList];

		// Clear memoization cache
		clearMemoizationCache();

		// Update POS cache
		await afterUpdateCachePOS();
	}

	// Tambahkan auto-dismiss 2 detik untuk notif
	$: if (showNotifModal) {
		const timeout = setTimeout(() => {
			showNotifModal = false;
		}, 2000);
	}
</script>

{#if toastManager.showToast}
	<ToastNotification
		show={toastManager.showToast}
		message={toastManager.toastMessage}
		type={toastManager.toastType}
		duration={3000}
		position="top"
	/>
{/if}

<!-- Seluruh markup manajemen menu, kategori, ekstra, dan modal dari file src/routes/pengaturan/pemilik/+page.svelte -->
<!-- Tambahkan seluruh markup (HTML/Svelte) untuk list/tabel menu, kategori, ekstra, form/modal tambah/edit/hapus, modal/modal sheet, komponen upload/crop gambar, dan semua tampilan serta interaksi CRUD menu, kategori, ekstra dari file /pemilik ke sini. Pastikan semua event handler, binding, dan logic tetap berjalan. Jangan sertakan bagian keamanan, riwayat, atau navigasi utama. -->

<div transition:fly={{ y: 32, duration: 320, easing: cubicOut }}>
	<!-- Custom Top Bar -->
	<div
		class="sticky top-0 z-40 mb-0 flex items-center border-b border-gray-200 bg-white px-4 py-4 shadow-sm"
	>
		<button
			onclick={() => goto('/pengaturan/pemilik')}
			class="mr-2 rounded-xl bg-gray-100 p-2 transition-colors hover:bg-gray-200"
		>
			<svelte:component this={ArrowLeft} class="h-5 w-5 text-gray-600" />
		</button>
		<h1 class="text-xl font-bold text-gray-800">Manajemen Menu</h1>
	</div>

	<!-- Navigasi Tab Menu/Kategori/Ekstra -->
	<div class="mx-auto max-w-4xl px-4 pt-3">
		<div
			class="relative mb-3 flex overflow-hidden rounded-xl border border-gray-100 bg-white p-1 shadow md:h-16 md:gap-6 md:text-lg"
		>
			<!-- Sliding Background -->
			<div
				class="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out {activeTab ===
				'menu'
					? 'left-1 w-[calc(33.333%-0.25rem)] bg-pink-500'
					: activeTab === 'kategori'
						? 'left-[calc(33.333%+0.125rem)] w-[calc(33.333%-0.25rem)] bg-blue-500'
						: 'left-[calc(66.666%+0.125rem)] w-[calc(33.333%-0.25rem)] bg-green-500'}"
			></div>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-base font-semibold transition-all focus:outline-none {activeTab ===
				'menu'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (activeTab = 'menu')}>Menu</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-base font-semibold transition-all focus:outline-none {activeTab ===
				'kategori'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (activeTab = 'kategori')}>Kategori</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-base font-semibold transition-all focus:outline-none {activeTab ===
				'ekstra'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (activeTab = 'ekstra')}>Tambahan</button
			>
		</div>
	</div>

	<!-- Floating Action Button (FAB) bulat untuk tambah data sesuai tab aktif -->
	{#if activeTab === 'menu'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-pink-500 text-white shadow-lg transition-colors hover:bg-pink-600"
			onclick={() => openMenuForm()}
			aria-label="Tambah Menu"
		>
			<svelte:component this={Plus} class="h-8 w-8" />
		</button>
	{:else if activeTab === 'kategori'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-colors hover:bg-blue-600"
			onclick={() => openKategoriForm(null)}
			aria-label="Tambah Kategori"
		>
			<svelte:component this={Plus} class="h-8 w-8" />
		</button>
	{:else if activeTab === 'ekstra'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-colors hover:bg-green-600"
			onclick={() => openEkstraForm()}
			aria-label="Tambah Tambahan"
		>
			<svelte:component this={Plus} class="h-8 w-8" />
		</button>
	{/if}

	<!-- Konten tab dengan transisi geser -->
	<div class="relative min-h-screen">
		{#if activeTab === 'menu'}
			<div transition:slide|local class="flex min-h-0 flex-1 flex-col">
				<!-- Fixed Header Section -->
				<div class="flex-shrink-0 bg-white">
					<!-- Search Bar -->
					<div class="mx-auto max-w-4xl px-4 pb-2">
						<div class="relative flex items-center">
							<svg
								class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								viewBox="0 0 24 24"
								><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
							>
							<input
								type="text"
								class="w-full rounded-lg border border-gray-300 bg-white py-2.5 pr-3 pl-10 text-base text-gray-800 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
								placeholder="Cari menu..."
								bind:value={searchKeyword}
							/>
						</div>
					</div>
					<!-- Header Daftar Menu -->
					<div class="mx-auto max-w-4xl px-4 pb-2">
						<h2 class="text-lg font-bold text-gray-800">Daftar Menu</h2>
					</div>
					<!-- Bar Filter Kategori (button group, horizontal scroll, seperti POS) -->
					<div class="mx-auto flex max-w-4xl items-center gap-2 px-4 pb-4">
						<button
							class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 border-pink-500 bg-pink-50 bg-white p-2 transition-colors hover:bg-gray-100"
							onclick={() => (isGridView = !isGridView)}
							aria-label={isGridView ? 'Tampilkan List' : 'Tampilkan Grid'}
						>
							{#if isGridView}
								<svg
									class="h-5 w-5 text-gray-600"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									viewBox="0 0 24 24"
									transition:fade={{ duration: 120 }}
									><path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M4 6h16M4 12h16M4 18h16"
									/></svg
								>
							{:else}
								<svg
									class="h-5 w-5 text-gray-600"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									viewBox="0 0 24 24"
									transition:fade={{ duration: 120 }}
									><rect x="4" y="4" width="7" height="7" rx="2" /><rect
										x="13"
										y="4"
										width="7"
										height="7"
										rx="2"
									/><rect x="4" y="13" width="7" height="7" rx="2" /><rect
										x="13"
										y="13"
										width="7"
										height="7"
										rx="2"
									/></svg
								>
							{/if}
						</button>
						<div class="scrollbar-hide flex w-max items-center gap-2 overflow-x-auto">
							{#if isLoadingKategori}
								{#each Array(5) as _, i}
									<div
										class="h-10 max-w-none animate-pulse rounded-lg bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 whitespace-nowrap"
										style="min-width:6rem;"
									></div>
								{/each}
							{:else}
								<button
									class="max-w-none rounded-lg border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all focus:outline-none {selectedKategori ===
									'Semua'
										? 'border-pink-500 bg-pink-500 text-white'
										: 'border-pink-200 bg-white text-pink-500'}"
									onclick={() => (selectedKategori = 'Semua')}>Semua</button
								>
								{#each kategoriList as kat}
									<button
										class="max-w-none rounded-lg border px-4 py-2 text-sm font-semibold whitespace-nowrap transition-all focus:outline-none {selectedKategori ==
										kat.id
											? 'border-pink-500 bg-pink-500 text-white'
											: 'border-pink-200 bg-white text-pink-500'}"
										onclick={() => (selectedKategori = kat.id)}>{kat.name}</button
									>
								{/each}
							{/if}
						</div>
					</div>
				</div>

				<!-- Scrollable Menu List -->
				<div class="flex-1 overflow-y-auto">
					<div class="mx-auto max-w-4xl px-4 pb-6">
						{#if isLoadingMenus}
							<div class="grid min-h-screen grid-cols-2 gap-3 pb-4">
								{#each Array(6) as _, i}
									<div
										class="flex aspect-[3/4] max-h-[260px] min-h-[140px] w-full animate-pulse flex-col items-center justify-between rounded-xl border border-gray-100 bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 p-4 shadow-md"
									>
										<div
											class="mb-2 aspect-square w-full rounded-lg border border-gray-100 bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100"
										></div>
										<div class="mb-1 h-4 w-full rounded bg-gray-200"></div>
										<div class="mb-1 h-3 w-2/3 rounded bg-gray-100"></div>
										<div class="h-3 w-1/2 rounded bg-gray-100"></div>
									</div>
								{/each}
							</div>
						{:else if filteredMenus.length === 0}
							<div
								class="pointer-events-none flex min-h-[50vh] flex-col items-center justify-center py-12 text-center"
							>
								<div class="mb-2 text-6xl">🍽️</div>
								<div class="mb-1 text-base font-semibold text-gray-700">Belum ada Menu</div>
								<div class="text-sm text-gray-400">Silakan tambahkan menu terlebih dahulu.</div>
							</div>
						{:else if isGridView}
							<div
								class="grid grid-cols-2 gap-3 pb-4 md:mx-auto md:max-w-4xl md:grid-cols-3 md:gap-8"
								transition:fade={{ duration: 120 }}
							>
								{#each filteredMenus as menu}
									<div
										class="relative flex h-[260px] cursor-pointer flex-col rounded-xl border border-gray-100 bg-white p-4 shadow transition-shadow md:h-[300px] md:items-center md:justify-center md:gap-2 md:rounded-2xl md:p-6 md:text-base md:shadow-lg"
										role="button"
										tabindex="0"
										onclick={() => openMenuForm(menu)}
										onkeydown={(e) => e.key === 'Enter' && openMenuForm(menu)}
										onkeypress={(e) => e.key === 'Enter' && openMenuForm(menu)}
									>
										<!-- Tombol Delete floating di pojok kanan atas -->
										<div class="absolute top-2 right-2 z-10">
											<button
												class="rounded-full border border-red-200 bg-red-50 p-2 hover:bg-red-100"
												onclick={(e) => {
													e.stopPropagation();
													confirmDeleteMenu(menu.id);
												}}
												aria-label="Hapus Menu"
											>
												<svelte:component this={Trash} class="h-4 w-4 text-red-600 md:h-5 md:w-5" />
											</button>
										</div>
										<div class="flex h-full w-full flex-col items-center justify-center">
											<div class="mb-2 flex w-full flex-1 items-center justify-center">
												{#if menu.gambar}
													<img
														src={menu.gambar}
														alt={menu.name}
														class="h-full w-full rounded-lg border border-gray-100 object-cover"
														onerror={() => handleImgError(menu.id)}
													/>
												{:else}
													<div
														class="flex h-full w-full items-center justify-center rounded-lg border border-gray-100 bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 text-4xl"
													>
														🍹
													</div>
												{/if}
											</div>
											<div class="w-full flex-shrink-0 text-center">
												<div
													class="mb-1 truncate text-base font-semibold text-gray-800 md:text-base"
												>
													{menu.name}
												</div>
												<div class="mb-1 truncate text-xs text-gray-500 md:text-base">
													{kategoriList.find((k) => k.id === menu.kategori_id)?.name || '-'}
												</div>
												<div class="text-xs font-bold text-pink-500 md:text-base">
													Rp {menu.price.toLocaleString('id-ID')}
												</div>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="flex flex-col gap-2 px-0 pb-4" transition:fade={{ duration: 120 }}>
								{#each filteredMenus as menu}
									<div
										class="flex cursor-pointer items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm transition-all hover:shadow-md"
										role="button"
										tabindex="0"
										onclick={() => openMenuForm(menu)}
										onkeydown={(e) => e.key === 'Enter' && openMenuForm(menu)}
										onkeypress={(e) => e.key === 'Enter' && openMenuForm(menu)}
									>
										<div class="min-w-0 flex-1">
											<div class="mb-0.5 truncate text-base font-semibold text-gray-800">
												{menu.name}
											</div>
											<div class="mb-0.5 truncate text-xs text-gray-500">
												{kategoriList.find((k) => k.id === menu.kategori_id)?.name || '-'}
											</div>
											<div class="text-base font-bold text-pink-500">
												Rp {menu.price.toLocaleString('id-ID')}
											</div>
										</div>
										<div class="ml-2">
											<button
												class="rounded-full border border-red-200 bg-red-50 p-2 hover:bg-red-100"
												onclick={(e) => {
													e.stopPropagation();
													confirmDeleteMenu(menu.id);
												}}
												aria-label="Hapus Menu"
											>
												<svelte:component this={Trash} class="h-4 w-4 text-red-600" />
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{:else if activeTab === 'kategori'}
			<div transition:slide|local class="flex min-h-0 flex-1 flex-col">
				<!-- Fixed Header Section -->
				<div class="flex-shrink-0 bg-white px-4">
					<!-- Search Bar -->
					<div class="relative mb-3 flex items-center">
						<svg
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
						>
						<input
							type="text"
							class="w-full rounded-lg border border-gray-300 bg-white py-2.5 pr-3 pl-10 text-base text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
							placeholder="Cari kategori..."
							bind:value={searchKategoriKeyword}
						/>
					</div>
					<!-- Header Daftar Kategori -->
					<div class="mb-2 flex items-center justify-between">
						<h2 class="text-lg font-bold text-gray-800">Daftar Kategori</h2>
					</div>
				</div>

				<!-- Scrollable Kategori List -->
				<div class="flex-1 overflow-y-auto">
					<div class="px-4 pb-6">
						{#if isLoadingKategori}
							<div class="flex min-h-screen flex-col gap-2">
								{#each Array(4) as _, i}
									<div
										class="flex animate-pulse items-center justify-between rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 via-purple-50 to-blue-100 px-4 py-3 shadow-md"
									></div>
								{/each}
							</div>
						{:else if kategoriList.length === 0}
							<div
								class="pointer-events-none flex min-h-[30vh] flex-col items-center justify-center py-12 text-center"
							>
								<div class="mb-2 text-5xl">📂</div>
								<div class="mb-1 text-base font-semibold text-gray-700">Belum ada Kategori</div>
								<div class="text-sm text-gray-400">Silakan tambahkan kategori terlebih dahulu.</div>
							</div>
						{:else}
							<div class="flex flex-col gap-2">
								{#each kategoriList.filter((kat) => kat.name
										.toLowerCase()
										.includes(searchKategoriKeyword.trim().toLowerCase())) as kat}
									<div
										class="flex cursor-pointer items-center justify-between rounded-xl border border-blue-200 bg-blue-100 px-4 py-3 shadow-sm transition-all hover:bg-blue-200"
										role="button"
										tabindex="0"
										onclick={() => openKategoriForm(kat)}
										onkeydown={(e) => e.key === 'Enter' && openKategoriForm(kat)}
										onkeypress={(e) => e.key === 'Enter' && openKategoriForm(kat)}
									>
										<div class="flex flex-col">
											<span class="mb-0.5 truncate text-base font-semibold text-blue-900"
												>{kat.name}</span
											>
											<span class="truncate text-xs text-blue-700"
												>{menus.filter((m) => m.kategori_id === kat.id).length} menu</span
											>
										</div>
										<div class="ml-2">
											<button
												class="rounded-full border border-red-200 bg-red-50 p-3 hover:bg-red-100"
												onclick={(e) => {
													e.stopPropagation();
													confirmDeleteKategori(kat.id);
												}}
												aria-label="Hapus Kategori"
											>
												<svelte:component this={Trash} class="h-5 w-5 text-red-600" />
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{:else if activeTab === 'ekstra'}
			<div transition:slide|local class="flex min-h-0 flex-1 flex-col">
				<!-- Fixed Header Section -->
				<div class="flex-shrink-0 bg-white px-4">
					<!-- Search Bar -->
					<div class="relative mb-3 flex items-center">
						<svg
							class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
						>
						<input
							type="text"
							class="w-full rounded-lg border border-gray-300 bg-white py-2.5 pr-3 pl-10 text-base text-gray-800 outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
							placeholder="Cari tambahan..."
							bind:value={searchEkstra}
						/>
					</div>
					<!-- Header Daftar Tambahan -->
					<div class="mb-2 flex items-center justify-between">
						<h2 class="text-lg font-bold text-gray-800">Daftar Tambahan</h2>
					</div>
				</div>

				<!-- Scrollable Tambahan List -->
				<div class="flex-1 overflow-y-auto">
					<div class="px-4 pb-6">
						{#if isLoadingEkstra}
							<div class="flex min-h-screen flex-col gap-2">
								{#each Array(4) as _, i}
									<div
										class="flex animate-pulse items-center justify-between rounded-xl border border-green-200 bg-gradient-to-br from-green-50 via-purple-50 to-green-100 px-4 py-3 shadow-md"
									></div>
								{/each}
							</div>
						{:else if ekstraList.length === 0}
							<div
								class="pointer-events-none flex min-h-[30vh] flex-col items-center justify-center py-12 text-center"
							>
								<div class="mb-2 text-5xl">➕</div>
								<div class="mb-1 text-base font-semibold text-gray-700">Belum ada Tambahan</div>
								<div class="text-sm text-gray-400">Silakan tambahkan tambahan terlebih dahulu.</div>
							</div>
						{:else}
							<div class="flex flex-col gap-2">
								{#each ekstraList.filter((ekstra) => ekstra.name
										.toLowerCase()
										.includes(searchEkstra.trim().toLowerCase())) as ekstra}
									<div
										class="flex cursor-pointer items-center justify-between rounded-xl border border-green-200 bg-green-100 px-4 py-3 shadow-sm transition-all hover:bg-green-200"
										role="button"
										tabindex="0"
										onclick={() => openEkstraForm(ekstra)}
										onkeydown={(e) => e.key === 'Enter' && openEkstraForm(ekstra)}
										onkeypress={(e) => e.key === 'Enter' && openEkstraForm(ekstra)}
									>
										<div class="flex flex-col">
											<span class="mb-0.5 truncate text-base font-semibold text-green-900"
												>{ekstra.name}</span
											>
											<span class="truncate text-xs text-green-700"
												>Rp {ekstra.harga.toLocaleString('id-ID')}</span
											>
										</div>
										<div class="ml-2">
											<button
												class="rounded-full border border-red-200 bg-red-50 p-3 hover:bg-red-100"
												onclick={(e) => {
													e.stopPropagation();
													confirmDeleteEkstra(ekstra.id);
												}}
												aria-label="Hapus Tambahan"
											>
												<svelte:component this={Trash} class="h-5 w-5 text-red-600" />
											</button>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Modal untuk tambah/edit menu -->
	{#if showMenuForm}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && closeMenuForm()}
			onkeydown={(e) => e.key === 'Escape' && closeMenuForm()}
			onkeypress={(e) => e.key === 'Enter' && closeMenuForm()}
			tabindex="-1"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
			<div
				class="animate-slideUpModal mx-4 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
				role="document"
				onclick={(e) => e.stopPropagation()}
			>
				<!-- Header -->
				<div class="flex-shrink-0 border-b border-gray-100 bg-white px-6 py-4">
					<h2 class="text-center text-xl font-bold text-gray-800">
						{editMenuId ? 'Edit Menu' : 'Tambah Menu Baru'}
					</h2>
				</div>

				<!-- Scrollable Form Content -->
				<form
					id="menu-form"
					class="flex flex-1 flex-col gap-6 overflow-y-auto p-6"
					onsubmit={saveMenu}
					autocomplete="off"
				>
					<!-- Preview Gambar Menu -->
					<div class="flex flex-col gap-3">
						<label for="menu-image" class="text-sm font-semibold text-gray-700">Gambar Menu</label>
						<div class="w-full">
							<button
								type="button"
								class="group relative w-full cursor-pointer"
								onclick={() => fileInputEl?.click()}
							>
								{#if $menuForm.gambar}
									<div class="relative w-full">
										<img
											src={$menuForm.gambar}
											alt="Preview Menu"
											class="aspect-square w-full rounded-xl border-2 border-gray-200 object-cover shadow-sm"
										/>
										<!-- Floating Delete Button -->
										<div
											class="absolute top-2 right-2 z-10 cursor-pointer rounded-full bg-red-500 p-2 text-white shadow-lg transition-all duration-200 hover:bg-red-600"
											role="button"
											tabindex="0"
											aria-label="Hapus gambar"
											onclick={(e) => {
												e.stopPropagation();
												removeImage();
											}}
											onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), removeImage())}
											onkeypress={(e) => e.key === 'Enter' && (e.stopPropagation(), removeImage())}
										>
											<svg
												class="h-4 w-4"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/>
											</svg>
										</div>
										<div
											class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-all duration-200 group-hover:opacity-100"
										>
											<div class="text-center">
												<svg
													class="mx-auto mb-2 h-8 w-8 text-white"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
													/>
												</svg>
												<span class="text-sm font-medium text-white">Klik untuk Ubah Gambar</span>
											</div>
										</div>
									</div>
								{:else}
									<div
										class="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-all duration-200 group-hover:border-pink-300 group-hover:bg-gray-100"
									>
										<div class="text-center">
											<svg
												class="mx-auto mb-3 h-12 w-12 text-gray-400"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
												/>
											</svg>
											<span class="text-base font-medium text-gray-500"
												>Klik untuk Upload Gambar</span
											>
											<p class="mt-1 text-xs text-gray-400">PNG, JPG, atau GIF (Max. 5MB)</p>
										</div>
									</div>
								{/if}
							</button>
						</div>
						<input
							type="file"
							accept="image/*"
							class="hidden"
							bind:this={fileInputEl}
							onchange={handleFileChange}
						/>
					</div>

					<!-- Nama Menu -->
					<div class="flex flex-col gap-2">
						<label for="menu-name" class="text-sm font-semibold text-gray-700">Nama Menu</label>
						<input
							type="text"
							id="menu-name"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
							bind:value={$menuForm.name}
							required
							placeholder="Contoh: Es Teh Manis"
						/>
					</div>

					<!-- Harga -->
					<div class="flex flex-col gap-2">
						<label for="menu-price" class="text-sm font-semibold text-gray-700">Harga</label>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								type="text"
								id="menu-price"
								class="w-full rounded-xl border border-gray-300 py-3 pr-4 pl-12 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
								bind:value={$menuForm.price}
								oninput={formatRupiahInput}
								required
								placeholder="0"
							/>
						</div>
					</div>

					<!-- Tipe Menu -->
					<div class="flex flex-col gap-3">
						<label for="menu-type" class="text-sm font-semibold text-gray-700">Tipe Menu</label>
						<div class="flex gap-3">
							<button
								type="button"
								class="flex-1 rounded-xl border-2 px-4 py-3 font-medium transition-all duration-200 {$menuForm.tipe ===
								'minuman'
									? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
									: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
								onclick={() => setMenuType('minuman')}
							>
								<div class="flex items-center justify-center gap-2">
									<span class="text-base">🥤</span>
									<span class="text-sm">Minuman</span>
								</div>
							</button>
							<button
								type="button"
								class="flex-1 rounded-xl border-2 px-4 py-3 font-medium transition-all duration-200 {$menuForm.tipe ===
								'makanan'
									? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
									: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
								onclick={() => setMenuType('makanan')}
							>
								<div class="flex items-center justify-center gap-2">
									<span class="text-base">🍽️</span>
									<span class="text-sm">Makanan</span>
								</div>
							</button>
						</div>
					</div>

					<!-- Kategori -->
					<div class="flex flex-col gap-3">
						<label for="menu-kategori" class="text-sm font-semibold text-gray-700">Kategori</label>
						<div class="scrollbar-hide flex gap-2 overflow-x-auto pb-2">
							{#each kategoriList as kat}
								<button
									type="button"
									class="flex-shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200 {$menuForm.kategori_id ===
									kat.id
										? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
										: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
									onclick={() => setMenuKategori($menuForm.kategori_id === kat.id ? null : kat.id)}
								>
									{kat.name}
								</button>
							{/each}
						</div>
					</div>

					<!-- Tambahan -->
					<div class="flex flex-col gap-3">
						<label for="menu-tambahan" class="text-sm font-semibold text-gray-700">Tambahan</label>
						<div class="grid grid-cols-2 gap-3">
							{#each ekstraList as ekstra}
								<button
									type="button"
									class="rounded-xl border-2 p-3 text-left transition-all duration-200 {$menuForm.ekstra_ids.includes(
										ekstra.id
									)
										? 'border-pink-500 bg-pink-50 shadow-lg shadow-pink-100'
										: 'border-gray-200 bg-white hover:border-pink-300 hover:bg-pink-50'}"
									onclick={() => toggleEkstra(ekstra.id)}
								>
									<div class="mb-0.5 text-sm font-medium text-gray-800">{ekstra.name}</div>
									<div class="text-xs font-semibold text-pink-600">
										+Rp {ekstra.harga?.toLocaleString('id-ID')}
									</div>
								</button>
							{/each}
						</div>
					</div>
				</form>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-gray-100 bg-white p-6">
					<button
						type="submit"
						form="menu-form"
						class="flex-1 rounded-xl bg-pink-500 py-3 font-semibold text-white shadow-lg shadow-pink-200 transition-all duration-200 hover:bg-pink-600 active:bg-pink-700"
					>
						{editMenuId ? 'Update Menu' : 'Simpan Menu'}
					</button>
					<button
						type="button"
						class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
						onclick={closeMenuForm}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal untuk tambah/edit kategori -->
	{#if showKategoriDetailModal}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && closeKategoriDetailModal()}
			onkeydown={(e) => e.key === 'Escape' && closeKategoriDetailModal()}
			onkeypress={(e) => e.key === 'Enter' && closeKategoriDetailModal()}
			tabindex="-1"
		>
			<!-- svelte-ignore a11y-click-events-have-key-events -->
			<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
				role="document"
				onclick={(e) => e.stopPropagation()}
			>
				<!-- Header -->
				<div class="flex-shrink-0 border-b border-gray-100 p-6">
					<h2 class="text-center text-xl font-bold text-gray-800">
						{kategoriDetail ? 'Edit Kategori' : 'Tambah Kategori'}
					</h2>
				</div>

				<!-- Content -->
				<div class="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
					<form
						id="kategori-form"
						class="flex flex-col gap-6"
						onsubmit={saveKategoriDetail}
						autocomplete="off"
					>
						<!-- Nama Kategori -->
						<div class="flex flex-col gap-2">
							<label for="kategori-name" class="mb-1 text-sm font-semibold text-gray-700"
								>Nama Kategori</label
							>
							<input
								type="text"
								id="kategori-name"
								class="w-full rounded-xl border border-blue-200 bg-white px-5 py-3 text-base placeholder-gray-400 shadow-sm transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
								bind:value={kategoriDetailName}
								required
								placeholder="Masukkan nama kategori"
							/>
						</div>

						<!-- Menu dalam Kategori -->
						<div class="flex flex-col gap-2">
							<label for="menu-dalam-kategori" class="mb-1 text-sm font-semibold text-gray-700"
								>Menu dalam Kategori</label
							>
							<div class="flex min-h-[48px] flex-wrap gap-2">
								{#if selectedMenuIds.length > 0}
									{#each menus.filter( (menu) => selectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex items-center rounded-full bg-blue-100 px-4 py-2 font-medium text-blue-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:ring-2 focus:ring-blue-200 focus:outline-none"
											style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
											title={menu.name}
											onclick={() => toggleMenuInKategoriRealtime(menu.id)}
											in:fly={{ y: 16, duration: 180 }}
											out:fly={{ y: 16, duration: 180 }}
										>
											{menu.name}
										</button>
									{/each}
								{:else}
									<span class="text-sm text-gray-400 italic">Belum ada menu dalam kategori ini</span
									>
								{/if}
							</div>
						</div>

						<!-- Menu non Kategori -->
						<div class="flex flex-col gap-2">
							<label for="menu-non-kategori" class="mb-1 text-sm font-semibold text-gray-700"
								>Menu non Kategori</label
							>
							<div class="flex min-h-[48px] flex-wrap gap-2">
								{#if unselectedMenuIds.length > 0}
									{#each menus.filter( (menu) => unselectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex items-center rounded-full border border-blue-200 bg-white px-4 py-2 font-medium text-blue-500 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-md focus:ring-2 focus:ring-blue-100 focus:outline-none"
											style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
											title={menu.name}
											onclick={() => toggleMenuInKategoriRealtime(menu.id)}
											in:fly={{ y: 16, duration: 180 }}
											out:fly={{ y: 16, duration: 180 }}
										>
											{menu.name}
										</button>
									{/each}
								{:else}
									<span class="text-sm text-gray-400 italic">Semua menu sudah masuk kategori</span>
								{/if}
							</div>
						</div>
					</form>
				</div>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-gray-100 bg-white p-6">
					<button
						type="submit"
						form="kategori-form"
						class="flex-1 rounded-xl bg-blue-500 py-3 font-semibold text-white shadow-lg shadow-blue-200 transition-all duration-200 hover:bg-blue-600 active:bg-blue-700"
					>
						{kategoriDetail ? 'Update Kategori' : 'Simpan Kategori'}
					</button>
					<button
						type="button"
						class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
						onclick={closeKategoriDetailModal}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal untuk tambah/edit ekstra -->
	<AddonFormModal
		open={showEkstraForm}
		isEdit={!!editEkstraId}
		name={ekstraForm.name}
		harga={ekstraForm.harga}
		onSubmit={saveEkstra}
		onClose={() => {
			showEkstraForm = false;
			ekstraForm = { name: '', harga: '' };
			editEkstraId = null;
		}}
	/>

	<!-- Modal konfirmasi hapus menu -->
	{#if showDeleteModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Menu?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Menu yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus menu ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={cancelDeleteMenu}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={doDeleteMenu}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus kategori -->
	{#if showDeleteKategoriModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Kategori?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Kategori yang dihapus tidak dapat dikembalikan. Menu dalam kategori ini akan menjadi tanpa
					kategori. Yakin ingin menghapus kategori ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={cancelDeleteKategori}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={doDeleteKategori}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus ekstra -->
	{#if showDeleteEkstraModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Ekstra?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Ekstra yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus ekstra ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={cancelDeleteEkstra}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={doDeleteEkstra}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Notifikasi floating (toast) -->
	{#if showNotifModal}
		<ToastNotification
			show={showNotifModal}
			message={notifModalMsg}
			type={notifModalType === 'error' ? 'error' : 'success'}
			duration={2000}
			position="top"
		/>
	{/if}

	<!-- Toast Notification -->
	<ToastNotification
		show={showToast}
		message={toastMessage}
		type={toastType}
		duration={2000}
		position="top"
	/>

	<!-- Komponen upload/crop gambar menu -->
	{#if showCropperDialog}
		<CropperDialog
			src={cropperDialogImage}
			open={true}
			on:done={handleCropperDone}
			on:cancel={handleCropperCancel}
		/>
	{/if}
</div>

<style>
	@keyframes slideUpModal {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
