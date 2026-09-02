<script lang="ts">
	// [CATATAN]: Svelte & Lifecycle
	import { onMount, onDestroy } from 'svelte';

	// [CATATAN]: SvelteKit
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';

	// [CATATAN]: Shared Components
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import LowStockAlertBanner from '$lib/components/shared/LowStockAlertBanner.svelte';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';

	// [CATATAN]: POS Components
	import ProductGrid from '$lib/components/pos/ProductGrid.svelte';
	import CustomItemModal from '$lib/components/pos/CustomItemModal.svelte';
	import CartPreview from '$lib/components/pos/CartPreview.svelte';

	// [CATATAN]: Stores & State
	import {
		createPosState,
		type PosProduct,
		type PosCategory,
		type PosAddOn
	} from '$lib/stores/posState.svelte';
	import { posCart } from '$lib/stores/posCart.svelte';
	import { posGridView } from '$lib/stores/posGridView.svelte';
	import { userRole } from '$lib/stores/userRole.svelte';

	// [CATATAN]: Services & Realtime
	import { productService } from '$lib/services/productService';
	import { getSesiAktif } from '$lib/services/sesiTokoService';
	import {
		evaluateAndAlertLowStock,
		isStrictStockEnforcement,
		isProductOutOfStock,
		getProductAvailableStock,
		getProductStockAvailability
	} from '$lib/services/stockAlertService';
	import { realtimeManager } from '$lib/realtime/realtimeManager';

	// [CATATAN]: Utils & Constants
	import { debounce, fuzzySearch } from '$lib/utils/performance';
	import { formatRupiah } from '$lib/utils/currency';
	import { securityUtils } from '$lib/utils/security';
	import { validateNumber, sanitizeInput } from '$lib/utils/validation';
	import { ICE_OPTIONS, SUGAR_OPTIONS } from '$lib/utils/orderDetails';
	import { NOTIF, POS_SKELETON } from '$lib/constants/ui';

	// [CATATAN]: Types
	import type { Ingredient } from '$lib/types/product';
	import type { TokoSession } from '$lib/types/store';
	import type { CartItem } from '$lib/types/cart';

	// [CATATAN]: Icons
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import LayoutList from '@lucide/svelte/icons/layout-list';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	const pos = createPosState();
	const cart = posCart;

	let currentUserRole = $state('');
	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	let sesiAktif: TokoSession | null = null;
	let lowStockIngredients = $state<Ingredient[]>([]);
	let strictStockMode = $state(false);

	function syncStrictStockPreference(): void {
		strictStockMode = isStrictStockEnforcement();
	}

	async function cekSesiTokoAktif(): Promise<void> {
		sesiAktif = await getSesiAktif();
	}

	async function checkLowStock(): Promise<void> {
		try {
			const ingredients = (await productService.getIngredients()) as unknown as Ingredient[];
			if (Array.isArray(ingredients)) {
				lowStockIngredients = evaluateAndAlertLowStock(ingredients);
			}
		} catch {
			// no-op
		}
	}

	let realtimeDisposers: Array<() => void> = [];

	onMount(() => {
		cart.reloadFromStorage();
		syncStrictStockPreference();
		cekSesiTokoAktif();
		checkLowStock();
		if (browser) {
			window.addEventListener('openTokoModal', cekSesiTokoAktif);
			window.addEventListener('storage', syncStrictStockPreference);
			realtimeDisposers.push(realtimeManager.subscribe('bahan', checkLowStock));
			realtimeDisposers.push(realtimeManager.subscribe('produk', syncStrictStockPreference));
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('openTokoModal', cekSesiTokoAktif);
			window.removeEventListener('storage', syncStrictStockPreference);
			for (const unsub of realtimeDisposers) unsub();
			realtimeDisposers = [];
		}
	});

	// [CATATAN]: Kategori & Produk
	let selectedCategory = $state('all');
	const categories = $derived(pos.kategoriData);
	const products = $derived(pos.produkData);
	const addOns = $derived(pos.tambahanData);

	// [CATATAN]: Jenis gula dan es
	const sugarOptions = SUGAR_OPTIONS;
	const iceOptions = ICE_OPTIONS;

	let showModal = $state(false);
	let selectedProduct = $state<PosProduct | null>(null);
	let selectedPorsi = $state<'reguler' | 'jumbo'>('reguler');
	let selectedAddOns = $state<Array<string | number>>([]);
	let selectedSugar = $state('normal');
	let selectedIce = $state('normal');
	let jumlah = $state(1);
	let selectedNote = $state('');

	let imageError = $state<Record<string, boolean>>({});

	// [CATATAN]: Search produk dengan debounce
	let search = $state('');
	const debouncedSearch = debounce((value: string) => {
		search = value;
	}, 300);

	function handleSearchInput(value: string) {
		debouncedSearch(value);
	}

	// [CATATAN]: Memoized computed values
	const totalItems = $derived(cart.totalItems);
	const totalHarga = $derived(cart.totalHarga);

	const currentAddOnsTotal = $derived(
		(addOns || [])
			.filter((a: PosAddOn) => selectedAddOns.includes(a.id))
			.reduce((acc: number, a: PosAddOn) => acc + (Number(a.harga) || 0), 0)
	);
	const currentBasePrice = $derived(
		selectedPorsi === 'jumbo'
			? (selectedProduct?.harga_jumbo ?? selectedProduct?.harga ?? 0)
			: (selectedProduct?.harga ?? 0)
	);
	const currentItemUnitPrice = $derived(currentBasePrice + currentAddOnsTotal);
	const currentItemTotalPrice = $derived(currentItemUnitPrice * jumlah);

	// [CATATAN]: Memoized filtered products
	const filteredProducts = $derived(
		(() => {
			let filtered = products;
			if (search) {
				filtered = fuzzySearch(search, products);
			}
			if (selectedCategory !== 'all') {
				filtered = filtered.filter((p) => p.kategori_id === selectedCategory);
			}
			return filtered;
		})()
	);

	let showCartModal = $state(false);
	function openCartModal() {
		showModal = false;
		showCartModal = true;
	}
	function closeCartModal() {
		showCartModal = false;
	}
	function removeCartItem(idx: number): void {
		cart.removeItem(idx);
	}
	function handleDecCartItem(idx: number): void {
		const currentItem = cart.items[idx];
		if (!currentItem) return;
		if (currentItem.jumlah <= 1) {
			cart.removeItem(idx);
		} else {
			cart.updateItemQuantity(idx, currentItem.jumlah - 1);
		}
	}
	function handleIncCartItem(idx: number): void {
		const currentItem = cart.items[idx];
		if (!currentItem) return;

		if (strictStockMode) {
			const avail = getProductStockAvailability(
				currentItem.product,
				currentItem.porsi || 'reguler',
				pos.bahanData,
				pos.resepData
			);
			if (avail.isOutOfStock) {
				showToastNotif(
					`Stok "${currentItem.product.nama}" habis (${avail.limitingReason || 'bahan tidak cukup'}).`,
					'warning'
				);
				return;
			}
			if (avail.availableStock !== null) {
				const currentTotalInCart = cart.items
					.filter((it) => String(it.product.id) === String(currentItem.product.id))
					.reduce((sum, it) => sum + it.jumlah, 0);
				if (currentTotalInCart + 1 > avail.availableStock) {
					showToastNotif(
						`Stok "${currentItem.product.nama}" hanya tersisa ${avail.availableStock} porsi. Tidak dapat menambah lagi.`,
						'warning'
					);
					return;
				}
			}
		}

		if (currentItem.jumlah < 99) {
			cart.updateItemQuantity(idx, currentItem.jumlah + 1);
		}
	}

	function openAddOnModal(product: PosProduct): void {
		if (strictStockMode) {
			const avail = getProductStockAvailability(product, 'reguler', pos.bahanData, pos.resepData);
			if (avail.isOutOfStock) {
				showToastNotif(
					`Stok "${product.nama}" habis (${avail.limitingReason || 'bahan tidak cukup'}). Tidak dapat dimasukkan ke keranjang.`,
					'warning'
				);
				return;
			}
			if (avail.availableStock !== null) {
				const currentTotalInCart = cart.items
					.filter((it) => String(it.product.id) === String(product.id))
					.reduce((sum, it) => sum + it.jumlah, 0);
				if (currentTotalInCart >= avail.availableStock) {
					showToastNotif(
						`Stok "${product.nama}" tersisa ${avail.availableStock} porsi dan sudah ada ${currentTotalInCart} di keranjang. Tidak dapat menambah lagi.`,
						'warning'
					);
					return;
				}
			}
		}

		showCartModal = false;
		selectedProduct = product;
		selectedPorsi = 'reguler';
		selectedAddOns = [];
		selectedSugar = 'normal';
		selectedIce = 'normal';
		jumlah = 1;
		selectedNote = '';
		showModal = true;
	}

	function closeModal() {
		showModal = false;
	}

	function toggleAddOn(id: string | number): void {
		if (selectedAddOns.includes(id)) {
			selectedAddOns = selectedAddOns.filter((a) => a !== id);
		} else {
			selectedAddOns = [...selectedAddOns, id];
		}
	}

	// [CATATAN]: Optimized cart operations
	function addToCart() {
		if (pos.isCatalogExpired) {
			showErrorNotif('Katalog POS kedaluwarsa. Hubungkan perangkat lalu muat ulang menu.');
			return;
		}
		// [CATATAN]: Blokir kasir jika sesi toko belum dibuka
		if (currentUserRole === 'kasir' && !sesiAktif) {
			showErrorNotif('Toko belum dibuka. Silakan buka toko terlebih dahulu!');
			return;
		}
		// [CATATAN]: Validate quantity
		const qtyValidation = validateNumber(jumlah, { required: true, min: 1, max: 99 });
		if (!qtyValidation.isValid) {
			showErrorNotif(`Error: ${qtyValidation.errors.join(', ')}`);
			return;
		}

		// [CATATAN]: Strict Stock Validation saat memasukkan ke keranjang (Unit & Bahan Resep)
		if (strictStockMode && selectedProduct) {
			const avail = getProductStockAvailability(
				selectedProduct,
				selectedPorsi,
				pos.bahanData,
				pos.resepData
			);
			if (avail.isOutOfStock) {
				showToastNotif(
					`Stok "${selectedProduct.nama}" habis (${avail.limitingReason || 'bahan tidak cukup'}). Tidak dapat dimasukkan ke keranjang.`,
					'warning'
				);
				showModal = false;
				return;
			}

			if (avail.availableStock !== null) {
				const currentTotalInCart = cart.items
					.filter((it) => String(it.product.id) === String(selectedProduct!.id))
					.reduce((sum, it) => sum + it.jumlah, 0);
				if (currentTotalInCart + jumlah > avail.availableStock) {
					showToastNotif(
						`Stok "${selectedProduct.nama}" tidak cukup (tersisa ${avail.availableStock} porsi, sudah ada ${currentTotalInCart} di keranjang).`,
						'warning'
					);
					return;
				}
			}
		}

		// [CATATAN]: Check rate limiting
		if (!securityUtils.checkFormRateLimit('pos_add_to_cart')) {
			showErrorNotif('Terlalu banyak item ditambahkan. Silakan tunggu sebentar.');
			return;
		}

		// [CATATAN]: Sanitize inputs
		const sanitizedSugar = sanitizeInput(selectedSugar);
		const sanitizedIce = sanitizeInput(selectedIce);

		// [CATATAN]: Check for suspicious activity
		const allInputs = `${selectedProduct?.nama}${sanitizedSugar}${sanitizedIce}${jumlah}`;
		if (securityUtils.detectSuspiciousActivity('pos_add_to_cart', allInputs)) {
			showErrorNotif('Aktivitas mencurigakan terdeteksi. Silakan coba lagi.');
			securityUtils.logSecurityEvent('suspicious_cart_activity', {
				product: selectedProduct?.nama,
				jumlah,
				gula: sanitizedSugar,
				es: sanitizedIce
			});
			return;
		}

		if (selectedProduct) {
			const addOnsSelected = addOns.filter((a: PosAddOn) => selectedAddOns.includes(a.id));
			cart.addItem(
				selectedProduct,
				addOnsSelected,
				selectedPorsi,
				sanitizedSugar,
				sanitizedIce,
				jumlah,
				selectedNote
			);

			// [CATATAN]: Log successful add to cart
			securityUtils.logSecurityEvent('product_added_to_cart', {
				product: selectedProduct.nama,
				porsi: selectedPorsi,
				jumlah,
				totalItems: cart.items.length
			});
		}

		showModal = false;
	}

	function handleImgError(id: string) {
		imageError = { ...imageError, [id]: true };
	}

	function goToBayar() {
		showCartModal = false;
		goto('/pos/bayar');
	}

	function incQty() {
		if (strictStockMode && selectedProduct) {
			const avail = getProductStockAvailability(
				selectedProduct,
				selectedPorsi,
				pos.bahanData,
				pos.resepData
			);
			if (avail.availableStock !== null) {
				const currentTotalInCart = cart.items
					.filter((it) => String(it.product.id) === String(selectedProduct!.id))
					.reduce((sum, it) => sum + it.jumlah, 0);
				if (currentTotalInCart + jumlah + 1 > avail.availableStock) {
					showToastNotif(
						`Maksimal ${Math.max(0, avail.availableStock - currentTotalInCart)} porsi lagi untuk stok yang tersedia.`,
						'warning'
					);
					return;
				}
			}
		}
		if (jumlah < 99) jumlah++;
	}
	function decQty() {
		if (jumlah > 1) jumlah--;
	}

	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType = $state<'success' | 'error' | 'warning' | 'info'>('success');

	function showToastNotif(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success'
	) {
		toastMessage = message;
		toastType = type;
		showToast = true;
	}

	function clearCart() {
		cart.clearCart();
		showCartModal = false;
		showToastNotif('Keranjang dikosongkan', 'success');
	}

	function capitalizeFirst(str: string): string {
		if (!str) return '';
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	let skeletonCount = $state<number>(POS_SKELETON.TABLET);
	if (browser) {
		if (window.innerWidth < 768) {
			skeletonCount = POS_SKELETON.MOBILE;
		} else if (window.innerWidth >= 1024) {
			skeletonCount = POS_SKELETON.DESKTOP;
		}
	}

	function showErrorNotif(message: string) {
		showToastNotif(message, 'error');
	}

	let showCustomItemModal = $state(false);

	function addCustomItemToCart(item: CartItem) {
		cart.addCustomItem(item);
	}

	function cartItemKey(item: CartItem): string {
		return cart.cartItemKey(item);
	}

	function handleSelectCategoryAll(): void {
		selectedCategory = 'all';
	}
	function handleSelectCategory(id: string | number): void {
		selectedCategory = String(id);
	}
	function handleOpenAddOnModal(product: PosProduct): void {
		openAddOnModal(product);
	}
	function handleShowCustomItemModal(): void {
		jumlah = 1;
		showCustomItemModal = true;
	}
	function handleImgErrorId(id: string | number): void {
		handleImgError(String(id));
	}
	function handleGoToBayar(e: Event): void {
		e.stopPropagation();
		if (pos.isCatalogExpired) {
			showErrorNotif('Katalog POS kedaluwarsa. Muat ulang sebelum melanjutkan pembayaran.');
			return;
		}
		goToBayar();
	}
	function handleRemoveCartItem(idx: number): void {
		removeCartItem(idx);
	}
</script>

<div class="flex w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<main
		aria-label="Kasir POS"
		class="page-content flex min-h-[calc(100dvh-64px)] w-full max-w-full flex-col overflow-x-hidden pb-32 md:pb-36"
	>
		<!-- Responsive Layout on Tablet (Full 3x3 Grid on md:, Split View on lg:) -->
		<div
			class="mx-auto flex w-full max-w-7xl flex-1 flex-col lg:flex-row lg:items-start lg:gap-6 lg:px-5 lg:pt-4"
		>
			<!-- Left Column: Catalog Area -->
			<div class="flex min-w-0 flex-1 flex-col">
				<!-- [CATATAN]: Fluid Wave Header for POS -->
				<div
					class="relative overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 pt-4 pb-8 shadow-xl shadow-pink-500/15 md:pt-6 md:pb-10 lg:rounded-[32px] lg:pt-5 lg:pb-7"
				>
					<!-- [CATATAN]: Ambient background blur shapes -->
					<div
						class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
					></div>
					<div
						class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
					></div>

					<!-- [CATATAN]: Search Bar & View Mode Toggle (Glass Pills on the Wave) -->
					<div class="relative z-10 flex w-full items-center gap-2.5">
						<div class="relative flex-1">
							<span class="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
								<Search class="h-4.5 w-4.5" />
							</span>
							<input
								class="w-full rounded-full border border-white/80 bg-white/95 py-2.5 pr-4 pl-11 text-sm text-slate-900 shadow-md backdrop-blur-md transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 md:text-base"
								type="text"
								placeholder="Cari menu jus buah, topping..."
								bind:value={search}
								autocomplete="off"
								oninput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
							/>
						</div>

						<!-- [CATATAN]: Button Toggle Tampilan Grid / List -->
						<button
							type="button"
							aria-label={posGridView.value ? 'Ganti ke Tampilan Grid' : 'Ganti ke Tampilan List'}
							title={posGridView.value ? 'Ganti ke Tampilan Grid' : 'Ganti ke Tampilan List'}
							class="flex h-11 w-11 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-md backdrop-blur-md transition-all duration-200 hover:bg-white hover:text-pink-600 active:scale-95"
							onclick={() => posGridView.toggle()}
						>
							{#if posGridView.value}
								<LayoutGrid class="h-5 w-5 stroke-[2.2] text-pink-600" />
							{:else}
								<LayoutList class="h-5 w-5 stroke-[2.2] text-slate-700" />
							{/if}
						</button>
					</div>
				</div>

				<!-- [CATATAN]: Low Stock Alert Banner -->
				<LowStockAlertBanner lowStockItems={lowStockIngredients} />

				<!-- [CATATAN]: Category Filter Pills -->
				<div
					class="flex gap-2.5 overflow-x-auto px-4 pt-4 pb-3 md:px-2 md:pt-4"
					style="scrollbar-width:none;-ms-overflow-style:none;"
				>
					<button
						class="min-h-[44px] min-w-[88px] flex-shrink-0 cursor-pointer rounded-full border px-5 py-2.5 text-sm font-bold transition-all duration-200 active:scale-[0.98] {selectedCategory ===
						'all'
							? 'border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
							: 'border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
						type="button"
						onclick={handleSelectCategoryAll}>Semua</button
					>
					{#if (categories ?? []).length === 0 && pos.isLoadingProducts}
						{#each Array(4) as _, i}
							<div
								class="h-[44px] min-w-[96px] flex-shrink-0 animate-pulse rounded-full bg-white/80"
							></div>
						{/each}
					{:else if (categories ?? []).length === 0}
						<!-- [CATATAN]: Button Custom Item di samping 'Semua' jika tidak ada kategori -->
						<button
							class="flex min-h-[44px] min-w-[48px] flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-4 py-2.5 text-white shadow-sm shadow-pink-500/15 transition-transform duration-200 active:scale-[0.98]"
							type="button"
							aria-label="Tambah item custom"
							onclick={handleShowCustomItemModal}
						>
							<Plus class="h-5 w-5 stroke-[2.5]" />
						</button>
					{:else}
						{#each categories ?? [] as c (c.id)}
							<button
								class="min-h-[44px] min-w-[96px] flex-shrink-0 cursor-pointer rounded-full border px-5 py-2.5 text-sm font-bold transition-all duration-200 active:scale-[0.98] {selectedCategory ===
								String(c.id)
									? 'border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
									: 'border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
								type="button"
								onclick={() => handleSelectCategory(c.id)}>{c.nama}</button
							>
						{/each}
						<!-- [CATATAN]: Button Custom Item di paling kanan -->
						<button
							class="flex min-h-[44px] min-w-[105px] flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-pink-500/15 transition-all duration-200 active:scale-[0.98]"
							type="button"
							onclick={handleShowCustomItemModal}
						>
							<Plus class="h-4.5 w-4.5 stroke-[2.5]" />
							<span>Kustom</span>
						</button>
					{/if}
				</div>

				<ProductGrid
					posGridView={posGridView.value}
					isLoadingProducts={pos.isLoadingProducts}
					{skeletonCount}
					{filteredProducts}
					{categories}
					ingredients={pos.bahanData}
					recipes={pos.resepData}
					{imageError}
					loadError={pos.posLoadError}
					{strictStockMode}
					onSelectProduct={handleOpenAddOnModal}
					onImgError={handleImgErrorId}
					onRetry={pos.retryLoadPOSData}
				/>
			</div>

			<!-- Right Column: Dedicated Permanent Cart Panel on Tablet Landscape / Desktop -->
			<aside
				aria-label="Panel Pesanan Kasir Tablet"
				class="sticky top-4 hidden h-[calc(100dvh-130px)] w-[300px] flex-col rounded-[28px] border border-white/70 bg-white/90 shadow-xl backdrop-blur-xl lg:flex xl:w-[340px]"
			>
				<!-- Cart Header -->
				<div class="flex items-center justify-between border-b border-pink-100/60 px-4 py-3">
					<div class="flex items-center gap-2">
						<h2 class="text-sm font-black text-slate-900 xl:text-base">Pesanan Kasir</h2>
						{#if totalItems > 0}
							<span
								class="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gradient-to-tr from-pink-600 to-rose-600 px-1.5 text-[11px] font-black text-white shadow-xs shadow-pink-500/30"
							>
								{totalItems}
							</span>
						{/if}
					</div>
					{#if cart.items.length > 0}
						<button
							type="button"
							class="flex h-6.5 cursor-pointer items-center gap-1 rounded-full border border-rose-100/90 bg-rose-50/80 px-2 text-[11px] font-bold text-rose-600 shadow-2xs transition-all select-none hover:border-rose-200 hover:bg-rose-100 hover:text-rose-700 active:scale-95"
							onclick={clearCart}
							aria-label="Kosongkan seluruh keranjang"
						>
							<Trash2 class="h-2.5 w-2.5 stroke-[2.4]" />
							<span>Kosongkan</span>
						</button>
					{/if}
				</div>

				<!-- Cart Scrollable Body -->
				<div
					class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3.5 py-3 xl:px-4"
					style="scrollbar-width:thin;"
				>
					{#if cart.items.length === 0}
						<div
							class="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-pink-200/80 bg-pink-50/30 p-5 text-center"
						>
							<div
								class="mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-pink-100"
							>
								<ShoppingBag class="h-6 w-6 stroke-[1.8] text-pink-500" />
							</div>
							<div class="text-xs font-extrabold text-slate-800">Keranjang Masih Kosong</div>
							<div class="mt-1 text-[11px] leading-relaxed text-slate-400">
								Sentuh menu di sebelah kiri untuk menambahkan pesanan.
							</div>
						</div>
					{:else}
						{#each cart.items as item, idx (cartItemKey(item))}
							{@const isJumbo = item.porsi === 'jumbo'}
							{@const basePrice = isJumbo
								? (item.product.harga_jumbo ?? item.product.harga ?? 0)
								: (item.product.harga ?? 0)}
							{@const itemUnitPrice =
								basePrice + (item.addOns || []).reduce((acc, a) => acc + (Number(a.harga) || 0), 0)}
							{@const itemTotalPrice = itemUnitPrice * item.jumlah}
							<div
								class="group rounded-2xl border border-pink-100/70 bg-white p-3 shadow-xs transition-all hover:border-pink-200"
							>
								<!-- Row 1: Item Name -->
								<div class="flex items-start gap-1.5 text-xs font-extrabold text-slate-900">
									<span class="min-w-0 flex-1 truncate">{item.product.nama}</span>
									{#if isJumbo}
										<span
											class="flex-shrink-0 rounded bg-gradient-to-r from-pink-500 to-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white uppercase shadow-2xs"
											>Jumbo</span
										>
									{/if}
								</div>

								<!-- Row 2: Varian & Add-ons -->
								{#if (item.addOns && item.addOns.length > 0) || item.catatan || (item.product.tipe === 'minuman' && (item.gula !== 'normal' || item.es !== 'normal'))}
									<div class="mt-1.5 flex flex-wrap gap-1 text-[10px]">
										{#if item.product.tipe === 'minuman' && item.gula !== 'normal'}
											<span
												class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600"
											>
												{sugarOptions.find((s) => s.id === item.gula)?.label ?? item.gula}
											</span>
										{/if}
										{#if item.product.tipe === 'minuman' && item.es !== 'normal'}
											<span
												class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600"
											>
												{iceOptions.find((i) => i.id === item.es)?.label ?? item.es}
											</span>
										{/if}
										{#if item.addOns && item.addOns.length > 0}
											{#each item.addOns as a}
												<span class="rounded-md bg-pink-50 px-1.5 py-0.5 font-medium text-pink-700">
													+{a.nama}
												</span>
											{/each}
										{/if}
										{#if item.catatan}
											<span class="w-full truncate text-[10px] text-slate-400 italic">
												"{item.catatan}"
											</span>
										{/if}
									</div>
								{/if}

								<!-- Row 3: Price + Quantity Stepper -->
								<div class="mt-2 flex items-center justify-between">
									<div class="flex items-baseline gap-1">
										<span class="text-xs font-black text-pink-600">
											Rp {formatRupiah(itemTotalPrice)}
										</span>
										{#if item.jumlah > 1}
											<span class="text-[10px] font-medium text-slate-400">
												@ {formatRupiah(itemUnitPrice)}
											</span>
										{/if}
									</div>

									<!-- Stepper -->
									<div
										class="flex items-center rounded-full border border-slate-200/80 bg-slate-50 p-0.5 shadow-2xs"
									>
										<button
											type="button"
											class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-90"
											onclick={() => handleDecCartItem(idx)}
											aria-label="Kurangi jumlah item"
										>
											{#if item.jumlah === 1}
												<Trash2 class="h-2.5 w-2.5 stroke-[2.2] text-rose-500" />
											{:else}
												<Minus class="h-2.5 w-2.5 stroke-[2.5]" />
											{/if}
										</button>
										<span class="w-5 text-center text-[11px] font-black text-slate-800 select-none">
											{item.jumlah}
										</span>
										<button
											type="button"
											class="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-pink-50 hover:text-pink-600 active:scale-90"
											onclick={() => handleIncCartItem(idx)}
											aria-label="Tambah jumlah item"
										>
											<Plus class="h-2.5 w-2.5 stroke-[2.5]" />
										</button>
									</div>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<!-- Cart Footer / Checkout Button -->
				<div class="mt-auto border-t border-pink-100/70 px-4 pt-3 pb-4">
					<div class="mb-2.5 flex items-center justify-between">
						<span class="text-[11px] font-bold text-slate-500">Total Tagihan</span>
						<span class="text-base font-black text-pink-700 xl:text-lg">
							Rp {formatRupiah(totalHarga)}
						</span>
					</div>

					<button
						type="button"
						disabled={cart.items.length === 0}
						class="group flex min-h-[44px] w-full cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-4 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
						onclick={goToBayar}
					>
						<div class="flex items-center gap-1.5">
							<span>Bayar</span>
							<ArrowRight
								class="h-3.5 w-3.5 stroke-[2.5] transition-transform duration-200 group-hover:translate-x-0.5"
							/>
						</div>
						<span class="text-xs font-black">Rp {formatRupiah(totalHarga)}</span>
					</button>
				</div>
			</aside>
		</div>
		<CustomItemModal bind:show={showCustomItemModal} onAdd={addCustomItemToCart} />

		<ModalSheet bind:open={showCartModal} onClose={closeCartModal}>
			{#snippet header()}
				<div class="flex items-center justify-between border-b border-pink-100/60 px-5 pt-1 pb-3.5">
					<div class="flex items-center gap-2">
						<h2 class="text-base font-black text-slate-900 sm:text-lg">Keranjang Pesanan</h2>
						{#if totalItems > 0}
							<span
								class="rounded-full bg-pink-50 px-2.5 py-0.5 text-[11px] font-black text-pink-600 ring-1 ring-pink-100/80"
							>
								{totalItems}
								{totalItems > 1 ? 'Items' : 'Item'}
							</span>
						{/if}
					</div>
					{#if cart.items.length > 0}
						<button
							type="button"
							class="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-rose-100/90 bg-rose-50/80 px-2.5 text-xs font-bold text-rose-600 shadow-2xs transition-all select-none hover:border-rose-200 hover:bg-rose-100 hover:text-rose-700 active:scale-95"
							onclick={clearCart}
							aria-label="Kosongkan seluruh keranjang"
						>
							<Trash2 class="h-3 w-3 stroke-[2.4]" />
							<span>Kosongkan</span>
						</button>
					{/if}
				</div>
			{/snippet}

			<div
				class="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3.5"
				style="scrollbar-width:none;-ms-overflow-style:none;"
			>
				{#if cart.items.length === 0}
					<div
						class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-pink-200/80 bg-pink-50/30 px-6 py-10 text-center"
					>
						<div
							class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-pink-100"
						>
							<ShoppingBag class="h-6 w-6 stroke-[2] text-pink-500" />
						</div>
						<div class="text-sm font-extrabold text-slate-800">Keranjang Masih Kosong</div>
						<div class="mt-1 text-xs text-slate-500">
							Pilih menu dari katalog untuk menambahkan pesanan.
						</div>
					</div>
				{:else}
					{#each cart.items as item, idx (cartItemKey(item))}
						{@const isJumbo = item.porsi === 'jumbo'}
						{@const basePrice = isJumbo
							? (item.product.harga_jumbo ?? item.product.harga ?? 0)
							: (item.product.harga ?? 0)}
						{@const itemUnitPrice =
							basePrice + (item.addOns || []).reduce((acc, a) => acc + (Number(a.harga) || 0), 0)}
						{@const itemTotalPrice = itemUnitPrice * item.jumlah}
						<div
							class="group flex items-center justify-between rounded-2xl border border-pink-100/70 bg-white p-3.5 shadow-xs transition-all hover:border-pink-200 sm:p-4"
						>
							<!-- Detail Item -->
							<div class="flex min-w-0 flex-1 flex-col pr-3">
								<div
									class="flex items-center gap-1.5 truncate text-sm font-extrabold text-slate-900"
								>
									<span class="truncate">{item.product.nama}</span>
									{#if isJumbo}
										<span
											class="py-0.2 rounded bg-gradient-to-r from-pink-500 to-rose-500 px-1.5 text-[9px] font-black text-white uppercase shadow-2xs"
											>Jumbo</span
										>
									{/if}
								</div>

								<!-- Varian & Add-ons -->
								{#if (item.addOns && item.addOns.length > 0) || item.catatan || (item.product.tipe === 'minuman' && (item.gula !== 'normal' || item.es !== 'normal'))}
									<div class="mt-1 flex flex-wrap gap-1 text-[11px]">
										{#if item.product.tipe === 'minuman' && item.gula !== 'normal'}
											<span
												class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600"
											>
												{sugarOptions.find((s) => s.id === item.gula)?.label ?? item.gula}
											</span>
										{/if}
										{#if item.product.tipe === 'minuman' && item.es !== 'normal'}
											<span
												class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600"
											>
												{iceOptions.find((i) => i.id === item.es)?.label ?? item.es}
											</span>
										{/if}
										{#if item.addOns && item.addOns.length > 0}
											{#each item.addOns as a}
												<span class="rounded-md bg-pink-50 px-1.5 py-0.5 font-medium text-pink-700">
													+{a.nama}
												</span>
											{/each}
										{/if}
										{#if item.catatan}
											<span class="w-full truncate text-[11px] text-slate-400 italic">
												"{item.catatan}"
											</span>
										{/if}
									</div>
								{/if}

								<!-- Harga Subtotal Item -->
								<div class="mt-1.5 flex items-baseline gap-1.5">
									<span class="text-xs font-black text-pink-600 sm:text-sm">
										Rp {formatRupiah(itemTotalPrice)}
									</span>
									{#if item.jumlah > 1}
										<span class="text-[10px] font-medium text-slate-400">
											(@ Rp {formatRupiah(itemUnitPrice)})
										</span>
									{/if}
								</div>
							</div>

							<!-- Stepper Jumlah Quantity -->
							<div
								class="flex items-center rounded-full border border-slate-200/80 bg-slate-50 p-0.5 shadow-2xs"
							>
								<button
									type="button"
									class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-90"
									onclick={() => handleDecCartItem(idx)}
									aria-label="Kurangi jumlah item"
								>
									{#if item.jumlah === 1}
										<Trash2 class="h-3.5 w-3.5 stroke-[2.2] text-rose-500" />
									{:else}
										<Minus class="h-3.5 w-3.5 stroke-[2.5]" />
									{/if}
								</button>
								<span class="w-6 text-center text-xs font-black text-slate-800 select-none">
									{item.jumlah}
								</span>
								<button
									type="button"
									class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-pink-50 hover:text-pink-600 active:scale-90"
									onclick={() => handleIncCartItem(idx)}
									aria-label="Tambah jumlah item"
								>
									<Plus class="h-3.5 w-3.5 stroke-[2.5]" />
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			{#snippet footer()}
				{#if cart.items.length > 0}
					<button
						type="button"
						class="group flex min-h-[50px] w-full cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-6 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98] sm:text-base"
						onclick={goToBayar}
					>
						<div class="flex items-center gap-2">
							<span>Lanjut ke Pembayaran</span>
							<ArrowRight
								class="h-4 w-4 stroke-[2.5] transition-transform duration-200 group-hover:translate-x-0.5"
							/>
						</div>
						<span class="font-black">Rp {formatRupiah(totalHarga)}</span>
					</button>
				{/if}
			{/snippet}
		</ModalSheet>

		<ToastNotification
			bind:show={showToast}
			message={toastMessage}
			type={toastType}
			position="top"
		/>

		<ModalSheet bind:open={showModal} onClose={closeModal}>
			{#snippet header()}
				<div class="border-b border-slate-100/90 px-5 pt-1 pb-3.5">
					<div class="min-w-0 flex-1">
						<h2 class="text-base leading-snug font-extrabold text-slate-900 sm:text-lg">
							{selectedProduct ? selectedProduct.nama : 'Pilihan Menu'}
						</h2>
						{#if selectedProduct}
							<div class="mt-1 flex items-center gap-2">
								<span
									class="bg-gradient-to-r from-pink-600 to-rose-500 bg-clip-text text-sm font-extrabold text-transparent sm:text-base"
								>
									Rp {formatRupiah(selectedProduct.harga)}
								</span>
								{#if selectedProduct.tipe}
									<span
										class="rounded-full border border-pink-100/80 bg-pink-50 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-pink-600 uppercase"
									>
										{selectedProduct.tipe}
									</span>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			{/snippet}

			<div
				class="addon-list addon-modal-content min-h-0 flex-1 space-y-4 overflow-y-auto py-3.5 pb-4"
				style="scrollbar-width:none;-ms-overflow-style:none;"
			>
				{#if selectedProduct && selectedProduct.tipe === 'minuman'}
					<!-- [CATATAN]: Ukuran Porsi -->
					<div>
						<div
							class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
							Pilihan Porsi
						</div>
						<div class="grid grid-cols-2 gap-2.5">
							<button
								class="flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-all duration-150 active:scale-[0.97] sm:text-sm {selectedPorsi ===
								'reguler'
									? 'border-2 border-pink-500 bg-pink-500 text-white shadow-sm shadow-pink-500/25'
									: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
								type="button"
								onclick={() => (selectedPorsi = 'reguler')}
							>
								<span>Reguler</span>
								<span
									class="mt-0.5 text-[11px] font-semibold {selectedPorsi === 'reguler'
										? 'text-white/90'
										: 'text-slate-500'}"
								>
									Rp {formatRupiah(selectedProduct.harga || 0)}
								</span>
							</button>
							<button
								class="flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-all duration-150 active:scale-[0.97] sm:text-sm {selectedPorsi ===
								'jumbo'
									? 'border-2 border-pink-500 bg-pink-500 text-white shadow-sm shadow-pink-500/25'
									: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
								type="button"
								onclick={() => (selectedPorsi = 'jumbo')}
							>
								<span>Jumbo</span>
								<span
									class="mt-0.5 text-[11px] font-semibold {selectedPorsi === 'jumbo'
										? 'text-white/90'
										: 'text-slate-500'}"
								>
									Rp {formatRupiah(selectedProduct.harga_jumbo || selectedProduct.harga || 0)}
								</span>
							</button>
						</div>
					</div>

					<!-- [CATATAN]: Jenis Gula -->
					<div>
						<div
							class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
							Jenis Gula
						</div>
						<div class="grid grid-cols-3 gap-2.5">
							{#each sugarOptions as s}
								<button
									class="flex min-h-[46px] cursor-pointer items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-all duration-150 active:scale-[0.97] sm:text-sm {selectedSugar ===
									s.id
										? 'border-2 border-pink-500 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/25'
										: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
									type="button"
									onclick={() => (selectedSugar = s.id)}>{s.label}</button
								>
							{/each}
						</div>
					</div>

					<!-- [CATATAN]: Jenis Es -->
					<div>
						<div
							class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
							Jenis Es
						</div>
						<div class="grid grid-cols-3 gap-2.5">
							{#each iceOptions as i}
								<button
									class="flex min-h-[46px] cursor-pointer items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-all duration-150 active:scale-[0.97] sm:text-sm {selectedIce ===
									i.id
										? 'border-2 border-pink-500 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/25'
										: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
									type="button"
									onclick={() => (selectedIce = i.id)}>{i.label}</button
								>
							{/each}
						</div>
					</div>
				{/if}

				<!-- [CATATAN]: Tambahan (Ekstra) -->
				<div>
					<div
						class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
						Tambahan (Ekstra)
					</div>
					{#if selectedProduct && selectedProduct.ekstra_ids && selectedProduct.ekstra_ids.length > 0 && addOns.filter( (a) => selectedProduct?.ekstra_ids?.includes(a.id) ).length > 0}
						<div class="grid grid-cols-2 gap-2.5">
							{#each addOns.filter((a) => selectedProduct?.ekstra_ids?.includes(a.id)) as a (a.id)}
								<button
									class="flex min-h-[52px] w-full cursor-pointer items-center justify-between rounded-2xl p-2.5 text-left transition-all duration-150 active:scale-[0.97] sm:p-3 {selectedAddOns.includes(
										a.id
									)
										? 'border-2 border-pink-500 bg-pink-50/70 shadow-xs'
										: 'border border-slate-200/90 bg-white shadow-2xs hover:border-pink-200 hover:bg-slate-50/50'}"
									type="button"
									onclick={() => toggleAddOn(a.id)}
								>
									<div class="min-w-0 flex-1 pr-1.5">
										<div
											class="truncate text-xs font-bold sm:text-sm {selectedAddOns.includes(a.id)
												? 'text-pink-900'
												: 'text-slate-800'}"
										>
											{a.nama}
										</div>
										<div
											class="mt-0.5 text-[11px] font-bold sm:text-xs {selectedAddOns.includes(a.id)
												? 'text-pink-600'
												: 'text-slate-500'}"
										>
											+Rp {formatRupiah(a.harga ?? 0)}
										</div>
									</div>
									<div
										class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors {selectedAddOns.includes(
											a.id
										)
											? 'bg-pink-500 text-white'
											: 'border border-slate-300 bg-white'}"
									>
										{#if selectedAddOns.includes(a.id)}
											<Check class="h-3 w-3 stroke-[3]" />
										{:else}
											<Plus class="h-3 w-3 text-slate-400" />
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{:else}
						<div
							class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5 text-center text-xs font-medium text-slate-400"
						>
							Tidak ada pilihan ekstra untuk menu ini.
						</div>
					{/if}
				</div>

				<!-- [CATATAN]: Catatan -->
				<div>
					<div
						class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
						Catatan Pesanan
					</div>
					<div class="relative">
						<textarea
							class="w-full resize-none rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
							placeholder="Contoh: Manis sedang, es pisah..."
							bind:value={selectedNote}
							rows="2"
							maxlength="200"
							oninput={(e) => {
								selectedNote = capitalizeFirst((e.target as HTMLTextAreaElement).value);
							}}></textarea>
						<div class="mt-0.5 text-right text-[11px] font-medium text-slate-400">
							{selectedNote.length}/200
						</div>
					</div>
				</div>
			</div>

			{#snippet footer()}
				<div class="flex items-center gap-3">
					<!-- [CATATAN]: Stepper Quantity -->
					<div
						class="flex items-center rounded-full border border-slate-200/80 bg-slate-100/90 p-1 shadow-2xs"
					>
						<button
							type="button"
							class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
							onclick={decQty}
							aria-label="Kurangi jumlah"
						>
							<Minus class="h-4 w-4 stroke-[2.5]" />
						</button>
						<span class="w-8 text-center text-sm font-extrabold text-slate-800 select-none">
							{jumlah}
						</span>
						<button
							type="button"
							class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
							onclick={incQty}
							aria-label="Tambah jumlah"
						>
							<Plus class="h-4 w-4 stroke-[2.5]" />
						</button>
					</div>

					<!-- [CATATAN]: Big CTA Add Button -->
					<button
						type="button"
						class="flex min-h-[48px] flex-1 cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-5 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98]"
						onclick={addToCart}
					>
						<span>Tambah</span>
						<span>Rp {formatRupiah(currentItemTotalPrice)}</span>
					</button>
				</div>
			{/snippet}
		</ModalSheet>
	</main>

	<CartPreview
		cart={cart.items}
		{totalItems}
		{totalHarga}
		onOpenCart={openCartModal}
		onClearCart={clearCart}
	/>
</div>

<style>
	.animate-pulse {
		animation: pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
