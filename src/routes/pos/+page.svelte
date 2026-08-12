<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import ProductGrid from '$lib/components/pos/ProductGrid.svelte';
	import CustomItemModal from '$lib/components/pos/CustomItemModal.svelte';
	import CartPreview from '$lib/components/pos/CartPreview.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import type { TokoSession } from '$lib/types/store';
	import { validateNumber, sanitizeInput } from '$lib/utils/validation';
	import { securityUtils } from '$lib/utils/security';
	import { fly, fade } from 'svelte/transition';

	import { cubicOut } from 'svelte/easing';
	import { posGridView } from '$lib/stores/posGridView.svelte';
	import { debounce, calculateCartTotal, fuzzySearch } from '$lib/utils/performance';
	import { userRole } from '$lib/stores/userRole.svelte';
	import { getSesiAktif } from '$lib/services/sesiTokoService';
	import { formatRupiah } from '$lib/utils/currency';
	import { NOTIF, POS_SKELETON } from '$lib/constants/ui';
	import type { CartItem } from '$lib/types/cart';
	import { ICE_OPTIONS, SUGAR_OPTIONS } from '$lib/utils/orderDetails';
	import CloudAlert from 'lucide-svelte/icons/cloud-alert';
	import Database from 'lucide-svelte/icons/database';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	let currentUserRole = $state('');
	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	import { browser } from '$app/environment';
	let sesiAktif: TokoSession | null = null;
	async function cekSesiTokoAktif(): Promise<void> {
		sesiAktif = await getSesiAktif();
	}

	onMount(() => {
		cekSesiTokoAktif();
		if (browser) {
			window.addEventListener('openTokoModal', cekSesiTokoAktif);
		}
	});

	import {
		createPosState,
		type PosProduct,
		type PosCategory,
		type PosAddOn
	} from '$lib/stores/posState.svelte';

	const pos = createPosState();

	import { createSwipeNavigation } from '$lib/utils/touchNavigation';

	const swipeNav = createSwipeNavigation(1); // 1 = Kasir

	// Kategori produk
	let selectedCategory = $state('all');

	let categories = $derived(pos.kategoriData);
	let products = $derived(pos.produkData);

	let addOns = $derived(pos.tambahanData);

	// Jenis gula dan es
	const sugarOptions = SUGAR_OPTIONS;
	const iceOptions = ICE_OPTIONS;

	let showModal = $state(false);
	let selectedProduct = $state<PosProduct | null>(null);
	let selectedAddOns = $state<Array<string | number>>([]);
	let selectedSugar = $state('normal');
	let selectedIce = $state('normal');
	let jumlah = $state(1);
	let selectedNote = $state('');

	// Keranjang sementara
	let cart = $state<CartItem[]>([]);

	// Untuk track error gambar per produk (pakai string key)
	let imageError = $state<Record<string, boolean>>({});

	// Search produk dengan debounce
	let search = $state('');

	// Debounced search dengan optimasi
	const debouncedSearch = debounce((value: string) => {
		search = value;
	}, 300);

	function handleSearchInput(value: string) {
		debouncedSearch(value);
	}

	// Memoized computed values untuk performance
	let cartTotal = $derived(calculateCartTotal(cart));
	let totalItems = $derived(cartTotal.items);
	let totalHarga = $derived(cartTotal.total);

	// Memoized filtered products dengan optimasi
	let filteredProducts = $derived(
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
		cart = cart.filter((_, i) => i !== idx);
	}

	function openAddOnModal(product: PosProduct): void {
		showCartModal = false;
		selectedProduct = product;
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

	// Optimized cart operations
	function addToCart() {
		if (pos.isCatalogExpired) {
			showErrorNotif('Katalog POS kedaluwarsa. Hubungkan perangkat lalu muat ulang menu.');
			return;
		}
		// Blokir kasir jika sesi toko belum dibuka
		if (currentUserRole === 'kasir' && !sesiAktif) {
			showErrorNotif('Toko belum dibuka. Silakan buka toko terlebih dahulu!');
			return;
		}
		// Validate quantity
		const qtyValidation = validateNumber(jumlah, { required: true, min: 1, max: 99 });
		if (!qtyValidation.isValid) {
			showErrorNotif(`Error: ${qtyValidation.errors.join(', ')}`);
			return;
		}

		// Check rate limiting
		if (!securityUtils.checkFormRateLimit('pos_add_to_cart')) {
			showErrorNotif('Terlalu banyak item ditambahkan. Silakan tunggu sebentar.');
			return;
		}

		// Sanitize inputs
		const sanitizedSugar = sanitizeInput(selectedSugar);
		const sanitizedIce = sanitizeInput(selectedIce);

		// Check for suspicious activity
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

		// Optimized cart item check dengan memoization
		const addOnsSelected = addOns.filter((a: PosAddOn) => selectedAddOns.includes(a.id));
		const addOnsKey = addOnsSelected
			.map((a: PosAddOn) => a.id)
			.sort()
			.join(',');
		const itemKey = `${selectedProduct?.id}-${addOnsKey}-${sanitizedSugar}-${sanitizedIce}-${selectedNote.trim()}`;

		const existingIdx = cart.findIndex((item: CartItem) => {
			const itemAddOnsKey = (item.addOns || [])
				.map((a) => a.id)
				.sort()
				.join(',');
			const currentItemKey = `${item.product.id}-${itemAddOnsKey}-${item.gula}-${item.es}-${item.catatan}`;
			return currentItemKey === itemKey;
		});

		if (existingIdx !== -1) {
			// Jika sudah ada, tambahkan jumlah
			cart = cart.map((item, idx) =>
				idx === existingIdx ? { ...item, jumlah: item.jumlah + jumlah } : item
			);
		} else if (selectedProduct) {
			// Jika belum ada, tambahkan item baru
			cart = [
				...cart,
				{
					product: selectedProduct,
					addOns: addOnsSelected,
					gula: sanitizedSugar,
					es: sanitizedIce,
					jumlah,
					catatan: selectedNote.trim()
				}
			];
		}

		// Log successful add to cart
		securityUtils.logSecurityEvent('product_added_to_cart', {
			product: selectedProduct?.nama,
			jumlah,
			totalItems: cart.length
		});

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
		if (jumlah < 99) jumlah++;
	}
	function decQty() {
		if (jumlah > 1) jumlah--;
	}

	let showSnackbar = $state(false);
	let snackbarMsg = $state('');

	function clearCart() {
		cart = [];
		showSnackbar = true;
		snackbarMsg = 'Keranjang dikosongkan';
		setTimeout(() => {
			showSnackbar = false;
		}, 1800);
	}

	function capitalizeFirst(str: string): string {
		if (!str) return '';
		return str.charAt(0).toUpperCase() + str.slice(1);
	}

	let skeletonCount = $state<number>(POS_SKELETON.TABLET);
	if (typeof window !== 'undefined') {
		if (window.innerWidth < 768) {
			skeletonCount = POS_SKELETON.MOBILE;
		} else if (window.innerWidth >= 1024) {
			skeletonCount = POS_SKELETON.DESKTOP;
		} else {
			skeletonCount = POS_SKELETON.TABLET;
		}
	}

	let showErrorNotification = $state(false);
	let errorNotificationMessage = $state('');
	let errorNotificationTimeout: ReturnType<typeof setTimeout> | null = null;

	function showErrorNotif(message: string) {
		errorNotificationMessage = message;
		showErrorNotification = true;
		if (errorNotificationTimeout) clearTimeout(errorNotificationTimeout);
		errorNotificationTimeout = setTimeout(() => {
			showErrorNotification = false;
		}, NOTIF.TOAST_MS);
	}

	let showCustomItemModal = $state(false);

	function addCustomItemToCart(item: CartItem) {
		cart = [...cart, item];
	}

	function cartItemKey(item: CartItem): string {
		return [
			item.product.id,
			item.addOns
				.map((addOn) => addOn.id)
				.sort()
				.join(','),
			item.gula,
			item.es,
			item.catatan
		].join('|');
	}

	// Helper untuk ambil nama kategori dari kategori_id
	function getKategoriNameById(id: string | number): string {
		if (!id) return '';
		const kat = categories?.find((k) => String(k.id) === String(id));
		return kat?.nama || '';
	}

	// Sinkronisasi cart ke localStorage setiap kali cart berubah
	$effect(() => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('pos_cart', JSON.stringify(cart));
		}
	});

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

<!-- Page swipe is optional; visible navigation remains the primary control. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="flex min-h-[100dvh] w-full max-w-full flex-col overflow-x-hidden overflow-y-auto bg-white"
	ontouchstart={swipeNav.handleTouchStart}
	ontouchmove={swipeNav.handleTouchMove}
	ontouchend={swipeNav.handleTouchEnd}
	onclick={swipeNav.handleGlobalClick}
>
	<main
		aria-label="Kasir POS"
		class="page-content w-full max-w-full flex-1 overflow-x-hidden"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div class="bg-white px-4 pt-4 pb-3 md:px-8 md:pt-8 lg:px-10">
			<div class="relative w-full">
				<span class="absolute inset-y-0 left-0 flex items-center pl-3 text-stone-400">
					<Search class="h-5 w-5" />
				</span>
				<input
					class="w-full flex-1 rounded-xl border-[1.5px] border-pink-200 bg-white py-3 pr-3 pl-10 text-base text-gray-800 shadow-sm transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10"
					type="text"
					placeholder="Cari produk..."
					bind:value={search}
					autocomplete="off"
					oninput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
				/>
			</div>
		</div>
		{#if pos.catalogSource === 'cache'}
			<div
				class="mx-4 mb-2 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 md:mx-8 lg:mx-10"
			>
				<Database class="mt-0.5 h-5 w-5 shrink-0" />
				<div>
					<div class="text-sm font-bold">
						{pos.isCatalogExpired ? 'Katalog kedaluwarsa' : 'Memakai katalog tersimpan'}
					</div>
					<div class="mt-0.5 text-xs leading-5 text-amber-800">
						Sinkron terakhir:
						{pos.catalogFetchedAt
							? new Date(pos.catalogFetchedAt).toLocaleString('id-ID')
							: 'belum diketahui'}.
						{pos.isCatalogExpired
							? ' Pembayaran baru diblokir sampai katalog diperbarui.'
							: ' Harga akan diverifikasi sebelum pembayaran.'}
					</div>
				</div>
			</div>
		{:else if pos.catalogSource === 'unavailable' && !pos.isLoadingProducts}
			<div
				class="mx-4 mb-2 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-950 md:mx-8 lg:mx-10"
			>
				<CloudAlert class="mt-0.5 h-5 w-5 shrink-0" />
				<div>
					<div class="text-sm font-bold">Katalog tidak tersedia</div>
					<div class="mt-0.5 text-xs leading-5 text-red-800">{pos.catalogStatusMessage}</div>
				</div>
			</div>
		{/if}
		<div
			class="flex gap-2 overflow-x-auto bg-white px-4 py-2 md:px-8 lg:px-10"
			style="scrollbar-width:none;-ms-overflow-style:none;"
		>
			<button
				class="mb-1 min-w-[96px] flex-shrink-0 cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] {selectedCategory ===
				'all'
					? 'border-pink-500 bg-pink-500 text-white shadow-sm'
					: 'border-pink-200 bg-white text-gray-700'}"
				type="button"
				onclick={handleSelectCategoryAll}>Semua</button
			>
			{#if (categories ?? []).length === 0 && pos.isLoadingProducts}
				{#each Array(4) as _, i}
					<div
						class="mb-1 h-[40px] min-w-[96px] flex-shrink-0 animate-pulse rounded-lg bg-gray-100"
					></div>
				{/each}
			{:else if (categories ?? []).length === 0}
				<!-- Button Custom Item di samping 'Semua' jika tidak ada kategori -->
				<button
					class="mb-1 flex w-12 min-w-[48px] flex-shrink-0 cursor-pointer items-center justify-center rounded-xl border border-pink-500 bg-pink-500 px-3 py-2 text-base font-medium text-white transition-transform duration-200 active:scale-[0.98]"
					type="button"
					aria-label="Tambah item custom"
					onclick={handleShowCustomItemModal}
				>
					<Plus class="h-5 w-5" />
				</button>
				<div class="flex h-[40px] items-center gap-2 px-4 text-sm text-stone-500">
					<svg
						class="h-4 w-4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.5"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
						/>
					</svg>
					<span>Belum ada kategori</span>
				</div>
			{:else}
				{#each categories ?? [] as c (c.id)}
					<button
						class="mb-1 min-w-[96px] flex-shrink-0 cursor-pointer rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-[0.98] {selectedCategory ===
						String(c.id)
							? 'border-pink-500 bg-pink-500 text-white shadow-sm'
							: 'border-pink-200 bg-white text-gray-700'}"
						type="button"
						onclick={() => handleSelectCategory(c.id)}>{c.nama}</button
					>
				{/each}
				<!-- Button Custom Item di paling kanan -->
				<button
					class="mb-1 flex min-w-[96px] flex-shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-pink-500 bg-pink-500 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98]"
					type="button"
					onclick={handleShowCustomItemModal}
				>
					<Plus class="h-5 w-5" />
					Menu Kustom
				</button>
			{/if}
		</div>
		<ProductGrid
			posGridView={posGridView.value}
			isLoadingProducts={pos.isLoadingProducts}
			{skeletonCount}
			{filteredProducts}
			{categories}
			{imageError}
			loadError={pos.posLoadError}
			onSelectProduct={handleOpenAddOnModal}
			onImgError={handleImgErrorId}
			onRetry={pos.retryLoadPOSData}
		/>

		<CustomItemModal bind:show={showCustomItemModal} onAdd={addCustomItemToCart} />

		<CartPreview
			{cart}
			{totalItems}
			{totalHarga}
			onOpenCart={openCartModal}
			onGoToBayar={handleGoToBayar}
			onClearCart={clearCart}
		/>

		{#if showCartModal}
			<ModalSheet bind:open={showCartModal} title="Keranjang" onClose={closeCartModal}>
				<div
					class="min-h-0 flex-1 overflow-y-auto px-0 py-2"
					style="scrollbar-width:none;-ms-overflow-style:none;"
				>
					{#each cart as item, idx (cartItemKey(item))}
						<div
							class="mb-3 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 shadow-sm"
						>
							<div class="flex min-w-0 flex-col">
								<div class="mb-0.5 truncate text-base font-semibold text-gray-900">
									{item.jumlah}x {item.product.nama}
								</div>
								<div class="text-xs font-medium text-gray-500">
									{[
										item.addOns && item.addOns.length > 0
											? item.addOns.map((a) => a.nama).join(', ')
											: '',
										item.catatan ? `${item.catatan}` : '',
										item.product.tipe === 'minuman' && item.gula !== 'normal'
											? (sugarOptions.find((s) => s.id === item.gula)?.label ?? item.gula)
											: '',
										item.product.tipe === 'minuman' && item.es !== 'normal'
											? (iceOptions.find((i) => i.id === item.es)?.label ?? item.es)
											: ''
									]
										.filter(Boolean)
										.join(', ')}
								</div>
								<div class="mt-1 text-base font-bold text-pink-500">
									Rp {formatRupiah(item.product.harga ?? 0)}
								</div>
							</div>
							<button
								class="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-transform duration-150 active:scale-[0.98]"
								onclick={() => handleRemoveCartItem(idx)}>Hapus</button
							>
						</div>
					{/each}
				</div>
				{#snippet footer()}
					<div>
						<button
							class="mb-1 w-full rounded-lg bg-pink-500 px-6 py-3 text-lg font-bold text-white shadow transition-all duration-150 hover:bg-pink-600 active:scale-[0.98]"
							onclick={handleGoToBayar}>Bayar</button
						>
					</div>
				{/snippet}
			</ModalSheet>
		{/if}

		{#if showSnackbar}
			<div
				class="animate-fadeInOut fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
			>
				{snackbarMsg}
			</div>
		{/if}

		{#if showErrorNotification}
			<div
				class="fixed top-20 left-1/2 z-[9999] w-full max-w-xs rounded-xl bg-red-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out md:max-w-md"
				style="transform: translateX(-50%);"
				in:fly={{ y: -32, duration: 300, easing: cubicOut }}
				out:fade={{ duration: 200 }}
			>
				{errorNotificationMessage}
			</div>
		{/if}

		{#if showModal}
			<ModalSheet
				bind:open={showModal}
				title={selectedProduct ? selectedProduct.nama : ''}
				onClose={closeModal}
			>
				<div
					class="addon-list addon-modal-content min-h-0 flex-1 overflow-y-auto pb-48"
					style="scrollbar-width:none;-ms-overflow-style:none;"
				>
					{#if selectedProduct && selectedProduct.tipe === 'minuman'}
						<div class="mt-4 mb-2 text-base font-semibold text-gray-800">Jenis Gula</div>
						<div class="mb-3 flex gap-2">
							{#each sugarOptions as s}
								<button
									class="flex-1 cursor-pointer rounded-lg border px-0 py-2 text-base font-medium transition-all duration-150 active:scale-[0.98] {selectedSugar ===
									s.id
										? 'border-pink-500 bg-pink-500 text-white'
										: 'border-pink-500 bg-white text-pink-500'}"
									type="button"
									onclick={() => (selectedSugar = s.id)}>{s.label}</button
								>
							{/each}
						</div>
					{/if}
					{#if selectedProduct && selectedProduct.tipe === 'minuman'}
						<div class="mt-4 mb-2 text-base font-semibold text-gray-800">Jenis Es</div>
						<div class="mb-3 flex gap-2">
							{#each iceOptions as i}
								<button
									class="flex-1 cursor-pointer rounded-lg border px-0 py-2 text-base font-medium transition-all duration-150 active:scale-[0.98] {selectedIce ===
									i.id
										? 'border-pink-500 bg-pink-500 text-white'
										: 'border-pink-500 bg-white text-pink-500'}"
									type="button"
									onclick={() => (selectedIce = i.id)}>{i.label}</button
								>
							{/each}
						</div>
					{/if}
					<div class="mt-4 mb-2 text-base font-semibold text-gray-800">Ekstra</div>
					{#if selectedProduct && selectedProduct.ekstra_ids && selectedProduct.ekstra_ids.length > 0 && addOns.filter( (a) => selectedProduct?.ekstra_ids?.includes(a.id) ).length > 0}
						<div class="mb-6 grid grid-cols-2 gap-3">
							{#each addOns.filter((a) => selectedProduct?.ekstra_ids?.includes(a.id)) as a (a.id)}
								<button
									class="flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border py-1.5 text-center text-base font-medium whitespace-normal transition-all duration-150 active:scale-[0.98] {selectedAddOns.includes(
										a.id
									)
										? 'border-pink-500 bg-pink-500 text-white'
										: 'border-pink-500 bg-white text-pink-500'}"
									type="button"
									onclick={() => toggleAddOn(a.id)}
								>
									<span class="w-full truncate">{a.nama}</span>
									<span
										class="mt-0 text-sm font-semibold {selectedAddOns.includes(a.id)
											? 'text-white'
											: 'text-pink-500'}">+Rp {formatRupiah(a.harga ?? 0)}</span
									>
								</button>
							{/each}
						</div>
					{:else}
						<div class="mb-6 text-center text-sm font-medium text-gray-400">
							Tidak ada ekstra untuk menu ini.
						</div>
					{/if}
					<div class="mt-4 mb-2 text-base font-semibold text-gray-800">Catatan</div>
					<textarea
						class="mb-1 w-full resize-none rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100"
						placeholder="Contoh: Tidak terlalu manis, tambah es batu, dll..."
						bind:value={selectedNote}
						rows="3"
						maxlength="200"
						oninput={(e) => {
							selectedNote = capitalizeFirst((e.target as HTMLTextAreaElement).value);
						}}
					></textarea>
					<div class="mt-1 text-right text-xs text-gray-500">{selectedNote.length}/200</div>
				</div>
				{#snippet footer()}
					<div>
						<div class="mt-0 mb-2 text-base font-semibold text-gray-800">Jumlah</div>
						<div class="mb-4 flex items-center justify-center gap-3">
							<button
								class="flex h-10 w-10 items-center justify-center rounded-lg border border-pink-400 text-xl font-bold text-pink-400 transition-all duration-150 active:scale-[0.98]"
								type="button"
								onclick={decQty}>-</button
							>
							<input
								class="w-12 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-center text-lg font-semibold text-gray-800 outline-none"
								type="number"
								min="1"
								max="99"
								bind:value={jumlah}
							/>
							<button
								class="flex h-10 w-10 items-center justify-center rounded-lg border border-pink-400 text-xl font-bold text-pink-400 transition-all duration-150 active:scale-[0.98]"
								type="button"
								onclick={incQty}>+</button
							>
						</div>
						<button
							class="mb-1 w-full rounded-lg bg-pink-500 px-6 py-3 text-lg font-bold text-white shadow transition-all duration-150 hover:bg-pink-600 active:scale-[0.98]"
							onclick={addToCart}>Tambah ke Keranjang</button
						>
					</div>
				{/snippet}
			</ModalSheet>
		{/if}
	</main>
</div>

<style>
	@keyframes fadeInOut {
		0% {
			opacity: 0;
			transform: translateY(16px);
		}
		10% {
			opacity: 1;
			transform: translateY(0);
		}
		90% {
			opacity: 1;
			transform: translateY(0);
		}
		100% {
			opacity: 0;
			transform: translateY(-8px);
		}
	}
	.animate-fadeInOut {
		animation: fadeInOut 1.8s cubic-bezier(0.4, 0, 0.2, 1);
	}
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

	/* Hilangkan tombol spinner up/down di input number (Chrome, Edge, Safari) */
	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		-webkit-appearance: none;
		appearance: none;
		margin: 0;
	}

	/* Hilangkan spinner di Firefox */
	input[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}
</style>
