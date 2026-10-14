// State UI, perintah, dan lifecycle halaman POS (sebelumnya inline di
// routes/pos/+page.svelte). Data katalog/keranjang tetap di store pos/cart.
import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { createPosState, type PosProduct, type PosAddOn } from '$lib/stores/posState.svelte';
import { posCart } from '$lib/stores/posCart.svelte';
import { userRole } from '$lib/stores/userRole.svelte';
import { productService } from '$lib/services/productService';
import { getSesiAktif } from '$lib/services/sesiTokoService';
import {
	evaluateAndAlertLowStock,
	isStrictStockEnforcement,
	getProductStockAvailability
} from '$lib/services/stockAlertService';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';
import { debounce, fuzzySearch } from '$lib/utils/performance';
import { securityUtils } from '$lib/utils/security';
import { validateNumber, trimInput } from '$lib/utils/validation';
import { ICE_OPTIONS, SUGAR_OPTIONS } from '$lib/utils/orderDetails';
import { POS_SKELETON } from '$lib/constants/ui';
import type { Ingredient } from '$lib/types/product';
import type { TokoSession } from '$lib/types/store';
import type { CartItem } from '$lib/types/cart';

export function createPosPageState() {
	const pos = createPosState();
	const cart = posCart;

	let currentUserRole = $state('');
	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	let sesiAktif: TokoSession | null = null;
	let lowStockIngredients = $state<Ingredient[]>([]);
	let strictStockMode = $state(false);

	/** Jumlah porsi produk ini di keranjang (semua varian), satu aturan untuk semua cek stok. */
	function qtyInCart(productId: string | number): number {
		return cart.items
			.filter((it) => String(it.product.id) === String(productId))
			.reduce((sum, it) => sum + it.jumlah, 0);
	}

	function syncStrictStockPreference(): void {
		strictStockMode = isStrictStockEnforcement() && !stockPolicyState.ignored;
	}

	async function cekSesiTokoAktif(): Promise<void> {
		sesiAktif = await getSesiAktif();
	}

	async function checkLowStock(): Promise<void> {
		if (stockPolicyState.ignored) {
			lowStockIngredients = [];
			return;
		}
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

	function mount(): void {
		cart.reloadFromStorage();
		void stockPolicyState.refresh().finally(() => {
			syncStrictStockPreference();
			checkLowStock();
		});
		cekSesiTokoAktif();
		if (browser) {
			window.addEventListener('openTokoModal', cekSesiTokoAktif);
			window.addEventListener('storage', syncStrictStockPreference);
			realtimeDisposers.push(realtimeManager.subscribe('bahan', checkLowStock));
			realtimeDisposers.push(realtimeManager.subscribe('produk', syncStrictStockPreference));
			realtimeDisposers.push(
				realtimeManager.subscribe('stock_policy', () => {
					void stockPolicyState.refresh().finally(() => {
						syncStrictStockPreference();
						checkLowStock();
					});
				})
			);
		}
	}

	function destroy(): void {
		if (browser) {
			window.removeEventListener('openTokoModal', cekSesiTokoAktif);
			window.removeEventListener('storage', syncStrictStockPreference);
			for (const unsub of realtimeDisposers) unsub();
			realtimeDisposers = [];
		}
	}

	// Kategori & Produk
	let selectedCategory = $state('all');
	const categories = $derived(
		[...(pos.kategoriData || [])].sort((a, b) =>
			(a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' })
		)
	);
	const products = $derived(pos.produkData);
	const addOns = $derived(pos.tambahanData);

	const categoryMap = $derived(new Map(categories.map((c) => [String(c.id), c.nama || ''])));

	// Jenis gula dan es
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

	// Search produk dengan debounce
	let search = $state('');
	const debouncedSearch = debounce((value: string) => {
		search = value;
	}, 300);

	function handleSearchInput(value: string) {
		debouncedSearch(value);
	}

	// Memoized computed values
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

	// Memoized filtered products
	const filteredProducts = $derived(
		(() => {
			let filtered = products;
			if (search) {
				filtered = fuzzySearch(search, products);
			}
			if (selectedCategory !== 'all') {
				filtered = filtered.filter((p) => String(p.kategori_id) === String(selectedCategory));
			}

			return [...filtered].sort((a, b) => {
				if (search) return 0; // pertahankan ranking pencarian fuzzy

				if (selectedCategory === 'all') {
					const catA = a.kategori_id
						? categoryMap.get(String(a.kategori_id)) || '\uffff'
						: '\uffff';
					const catB = b.kategori_id
						? categoryMap.get(String(b.kategori_id)) || '\uffff'
						: '\uffff';
					const catCompare = catA.localeCompare(catB, 'id', { sensitivity: 'base' });
					if (catCompare !== 0) return catCompare;
				}

				return (a.nama || '').localeCompare(b.nama || '', 'id', { sensitivity: 'base' });
			});
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
				const currentTotalInCart = qtyInCart(currentItem.product.id);
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
				const currentTotalInCart = qtyInCart(product.id);
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
			showErrorNotif(qtyValidation.errors.join(', '));
			return;
		}

		// Strict Stock Validation saat memasukkan ke keranjang (Unit & Bahan Resep)
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
				const currentTotalInCart = qtyInCart(selectedProduct!.id);
				if (currentTotalInCart + jumlah > avail.availableStock) {
					showToastNotif(
						`Stok "${selectedProduct.nama}" tidak cukup (tersisa ${avail.availableStock} porsi, sudah ada ${currentTotalInCart} di keranjang).`,
						'warning'
					);
					return;
				}
			}
		}

		// Check rate limiting
		if (!securityUtils.checkFormRateLimit('pos_add_to_cart')) {
			showErrorNotif('Terlalu banyak item ditambahkan. Silakan tunggu sebentar.');
			return;
		}

		const trimmedSugar = trimInput(selectedSugar);
		const trimmedIce = trimInput(selectedIce);

		if (selectedProduct) {
			const addOnsSelected = addOns.filter((a: PosAddOn) => selectedAddOns.includes(a.id));
			cart.addItem(
				selectedProduct,
				addOnsSelected,
				selectedPorsi,
				trimmedSugar,
				trimmedIce,
				jumlah,
				selectedNote
			);

			// Log successful add to cart
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
				const currentTotalInCart = qtyInCart(selectedProduct!.id);
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

	return {
		get lowStockIngredients() {
			return lowStockIngredients;
		},
		get strictStockMode() {
			return strictStockMode;
		},
		get selectedCategory() {
			return selectedCategory;
		},
		get showModal() {
			return showModal;
		},
		set showModal(value) {
			showModal = value;
		},
		get selectedProduct() {
			return selectedProduct;
		},
		get selectedPorsi() {
			return selectedPorsi;
		},
		set selectedPorsi(value) {
			selectedPorsi = value;
		},
		get selectedAddOns() {
			return selectedAddOns;
		},
		get selectedSugar() {
			return selectedSugar;
		},
		set selectedSugar(value) {
			selectedSugar = value;
		},
		get selectedIce() {
			return selectedIce;
		},
		set selectedIce(value) {
			selectedIce = value;
		},
		get jumlah() {
			return jumlah;
		},
		get selectedNote() {
			return selectedNote;
		},
		set selectedNote(value) {
			selectedNote = value;
		},
		get imageError() {
			return imageError;
		},
		get search() {
			return search;
		},
		set search(value) {
			search = value;
		},
		get showCartModal() {
			return showCartModal;
		},
		set showCartModal(value) {
			showCartModal = value;
		},
		get showToast() {
			return showToast;
		},
		set showToast(value) {
			showToast = value;
		},
		get toastMessage() {
			return toastMessage;
		},
		get toastType() {
			return toastType;
		},
		get skeletonCount() {
			return skeletonCount;
		},
		get showCustomItemModal() {
			return showCustomItemModal;
		},
		set showCustomItemModal(value) {
			showCustomItemModal = value;
		},
		get categories() {
			return categories;
		},
		get addOns() {
			return addOns;
		},
		get totalItems() {
			return totalItems;
		},
		get totalHarga() {
			return totalHarga;
		},
		get currentItemTotalPrice() {
			return currentItemTotalPrice;
		},
		get filteredProducts() {
			return filteredProducts;
		},
		pos,
		cart,
		sugarOptions,
		iceOptions,
		handleSearchInput,
		openCartModal,
		closeCartModal,
		handleDecCartItem,
		handleIncCartItem,
		closeModal,
		toggleAddOn,
		addToCart,
		goToBayar,
		incQty,
		decQty,
		clearCart,
		addCustomItemToCart,
		cartItemKey,
		handleSelectCategoryAll,
		handleSelectCategory,
		handleOpenAddOnModal,
		handleShowCustomItemModal,
		handleImgErrorId,
		mount,
		destroy
	};
}

export type PosPageState = ReturnType<typeof createPosPageState>;
