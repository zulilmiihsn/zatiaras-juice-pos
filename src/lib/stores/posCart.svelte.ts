import { browser } from '$app/environment';
import { calculateCartTotal } from '$lib/utils/performance';
import type { CartItem } from '$lib/types/cart';
import type { PosProduct, PosAddOn } from '$lib/stores/posState.svelte';

interface StoredCartEnvelope {
	schema_version: number;
	branch: string;
	items: CartItem[];
	updated_at: string;
}

function loadCartFromStorage(): CartItem[] {
	if (!browser) return [];
	try {
		const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
		const key = `pos_cart_${branch}`;
		const saved = localStorage.getItem(key);
		if (saved) {
			const parsed = JSON.parse(saved);
			if (Array.isArray(parsed)) return parsed;
			if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
				return parsed.items;
			}
		}

		// Migrasi otomatis dari key warisan global pos_cart
		const legacy = localStorage.getItem('pos_cart');
		if (legacy) {
			const parsedLegacy = JSON.parse(legacy);
			if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
				localStorage.setItem(
					key,
					JSON.stringify({
						schema_version: 2,
						branch,
						items: parsedLegacy,
						updated_at: new Date().toISOString()
					})
				);
				localStorage.removeItem('pos_cart');
				return parsedLegacy;
			}
		}
	} catch {}
	return [];
}

export function createPosCart() {
	let cart = $state<CartItem[]>(loadCartFromStorage());

	function saveToStorage(items: CartItem[]) {
		if (!browser) return;
		try {
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const key = `pos_cart_${branch}`;
			const envelope: StoredCartEnvelope = {
				schema_version: 2,
				branch,
				items,
				updated_at: new Date().toISOString()
			};
			localStorage.setItem(key, JSON.stringify(envelope));
		} catch {
			// [CATATAN]: Abaikan jika kuota penyimpanan penuh
		}
	}

	// [CATATAN]: Derived calculations otomatis (Svelte 5 Runes)
	const cartTotal = $derived(calculateCartTotal(cart));
	const totalItems = $derived(cartTotal.items);
	const totalHarga = $derived(cartTotal.total);

	function calculateItemKey(
		productId: string | number,
		addOnIds: Array<string | number>,
		porsi: string,
		sugar: string,
		ice: string,
		note: string
	): string {
		const sortedAddOns = [...addOnIds].sort().join(',');
		return `${productId}-${porsi || 'reguler'}-${sortedAddOns}-${sugar}-${ice}-${note.trim()}`;
	}

	function cartItemKey(item: CartItem): string {
		return [
			item.product.id,
			item.porsi || 'reguler',
			(item.addOns || [])
				.map((a) => a.id)
				.sort()
				.join(','),
			item.gula,
			item.es,
			item.catatan
		].join('|');
	}

	function addItem(
		product: PosProduct,
		addOnsSelected: PosAddOn[],
		porsi: 'reguler' | 'jumbo',
		sugar: string,
		ice: string,
		quantity: number,
		note: string
	): void {
		const addOnIds = addOnsSelected.map((a) => a.id);
		const targetKey = calculateItemKey(product.id, addOnIds, porsi, sugar, ice, note);

		const existingIdx = cart.findIndex((item) => {
			const itemAddOnIds = (item.addOns || []).map((a) => a.id);
			const currentKey = calculateItemKey(
				item.product.id,
				itemAddOnIds,
				item.porsi || 'reguler',
				item.gula,
				item.es,
				item.catatan || ''
			);
			return currentKey === targetKey;
		});

		if (existingIdx !== -1) {
			cart = cart.map((item, idx) =>
				idx === existingIdx ? { ...item, jumlah: item.jumlah + quantity } : item
			);
		} else {
			cart = [
				...cart,
				{
					product,
					addOns: addOnsSelected,
					porsi,
					gula: sugar,
					es: ice,
					jumlah: quantity,
					catatan: note.trim()
				}
			];
		}
		saveToStorage(cart);
	}

	function addCustomItem(item: CartItem): void {
		cart = [...cart, item];
		saveToStorage(cart);
	}

	function removeItem(index: number): void {
		cart = cart.filter((_, i) => i !== index);
		saveToStorage(cart);
	}

	function clearCart(): void {
		cart = [];
		saveToStorage(cart);
	}

	function reloadFromStorage(): void {
		if (!browser) return;
		cart = loadCartFromStorage();
	}

	function updateItemQuantity(index: number, quantity: number): void {
		if (quantity <= 0) {
			removeItem(index);
			return;
		}
		cart = cart.map((item, idx) => (idx === index ? { ...item, jumlah: quantity } : item));
		saveToStorage(cart);
	}

	return {
		get items() {
			return cart;
		},
		set items(val: CartItem[]) {
			cart = val;
			saveToStorage(cart);
		},
		get cartTotal() {
			return cartTotal;
		},
		get totalItems() {
			return totalItems;
		},
		get totalHarga() {
			return totalHarga;
		},
		addItem,
		addCustomItem,
		updateItemQuantity,
		removeItem,
		clearCart,
		reloadFromStorage,
		cartItemKey,
		calculateItemKey
	};
}

export const posCart = createPosCart();
