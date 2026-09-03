const browser = typeof window !== 'undefined';
import type { Ingredient } from '$lib/types/product';

let audioCtx: AudioContext | null = null;
let lastNotifiedIds = new Set<string | number>();
let lastNotificationTime = 0;
const NOTIFICATION_THROTTLE_MS = 60 * 1000; // 1 menit jeda antar notifikasi suara/sistem yang sama

// [AUDIO UNLOCK]: Auto-warmup AudioContext pada gestur pertama kasir (klik/sentuh)
// agar browser tidak memblokir autoplay policy saat alarm otomatis berbunyi
if (browser) {
	const unlockAudio = () => {
		try {
			if (!audioCtx) {
				const AudioContextClass =
					window.AudioContext ||
					(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
				if (AudioContextClass) {
					audioCtx = new AudioContextClass();
				}
			}
			if (audioCtx && audioCtx.state === 'suspended') {
				void audioCtx.resume();
			}
		} catch {
			// no-op
		}
	};
	window.addEventListener('click', unlockAudio, { passive: true });
	window.addEventListener('touchstart', unlockAudio, { passive: true });
	window.addEventListener('keydown', unlockAudio, { passive: true });
}

const SOUND_ENABLED_KEY = 'zatiaras_stock_sound_enabled';
const STRICT_STOCK_KEY = 'zatiaras_strict_stock_checkout';

/**
 * Memeriksa apakah suara alarm diaktifkan oleh pengguna.
 */
export function isSoundEnabled(): boolean {
	if (!browser) return true;
	const saved = localStorage.getItem(SOUND_ENABLED_KEY);
	return saved === null ? true : saved === 'true';
}

/**
 * Menyimpan preferensi suara alarm pengguna ke localStorage.
 */
export function setSoundEnabled(enabled: boolean): void {
	if (!browser) return;
	localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
}

/**
 * Memeriksa apakah mode pembatasan checkout stok aktif (Strict Stock Mode).
 * Jika true: Produk yang stoknya habis (<= 0) dilarang untuk di-checkout.
 * Jika false (default): Kasir tetap bisa checkout meskipun stok sistem 0.
 */
export function isStrictStockEnforcement(): boolean {
	if (!browser) return false;
	const saved = localStorage.getItem(STRICT_STOCK_KEY);
	return saved === 'true';
}

/**
 * Menyimpan preferensi pembatasan checkout stok ke localStorage.
 */
export function setStrictStockEnforcement(enabled: boolean): void {
	if (!browser) return;
	localStorage.setItem(STRICT_STOCK_KEY, String(enabled));
}

export interface PosStockAvailability {
	isOutOfStock: boolean;
	availableStock: number | null;
	limitingReason?: string;
	limitingIngredientName?: string;
}

/**
 * Menghitung ketersediaan stok produk POS secara menyeluruh:
 * - Jika produk lacak_stok: dihitung dari sisa stok unit produk.
 * - Jika produk lacak_bahan: dihitung dari sisa porsi maksimal berdasarkan stok semua bahan baku resepnya.
 * - Jika tidak dilacak: return availableStock null (unlimited).
 */
export function getProductStockAvailability(
	product:
		| {
				id?: string | number;
				stok?: number | null;
				lacak_stok?: boolean | number | string | null;
				lacak_bahan?: boolean | number | string | null;
				nama?: string;
		  }
		| null
		| undefined,
	porsi: 'reguler' | 'jumbo' | string = 'reguler',
	allIngredients: Array<{ id: string | number; nama: string; stok_saat_ini?: number | null }> = [],
	allRecipes: Array<{
		produk_id: string | number;
		bahan_id: string | number;
		porsi?: string | null;
		jumlah_per_item: number;
		jumlah_dasar_per_item?: number | null;
	}> = []
): PosStockAvailability {
	if (!product) return { isOutOfStock: false, availableStock: null };

	const isTrackingUnitStock =
		product.lacak_stok === true ||
		product.lacak_stok === 1 ||
		product.lacak_stok === '1' ||
		product.lacak_stok === 'true';

	const isTrackingIngredients =
		product.lacak_bahan === true ||
		product.lacak_bahan === 1 ||
		product.lacak_bahan === '1' ||
		product.lacak_bahan === 'true';

	// 1. Direct Unit Stock Tracking (lacak_stok)
	if (isTrackingUnitStock) {
		const currentStock = Math.max(0, Number(product.stok || 0));
		if (currentStock <= 0) {
			return {
				isOutOfStock: true,
				availableStock: 0,
				limitingReason: 'Stok unit habis'
			};
		}
		return {
			isOutOfStock: false,
			availableStock: currentStock
		};
	}

	// 2. Recipe Ingredient Stock Tracking (lacak_bahan)
	if (isTrackingIngredients && allRecipes.length > 0 && allIngredients.length > 0) {
		const prodId = String(product.id);
		const recipesForProduct = allRecipes.filter((r) => String(r.produk_id) === prodId);
		if (recipesForProduct.length > 0) {
			const requestedPorsi = String(porsi || 'reguler').toLowerCase();
			let matchingRecipes = recipesForProduct.filter(
				(r) => (r.porsi || 'reguler').toLowerCase() === requestedPorsi
			);
			if (!matchingRecipes.length && requestedPorsi === 'jumbo') {
				matchingRecipes = recipesForProduct.filter(
					(r) => (r.porsi || 'reguler').toLowerCase() === 'reguler'
				);
			}
			if (!matchingRecipes.length) {
				matchingRecipes = recipesForProduct;
			}

			const ingredientMap = new Map(allIngredients.map((ing) => [String(ing.id), ing]));

			let minPortions = Infinity;
			let limitingIngName = '';

			for (const recipe of matchingRecipes) {
				const ing = ingredientMap.get(String(recipe.bahan_id));
				const requiredQty = Number(recipe.jumlah_dasar_per_item ?? recipe.jumlah_per_item ?? 0);
				if (requiredQty > 0) {
					const currentIngStock = ing ? Math.max(0, Number(ing.stok_saat_ini || 0)) : 0;
					const portionsForThisIng = Math.floor(currentIngStock / requiredQty);
					if (portionsForThisIng < minPortions) {
						minPortions = portionsForThisIng;
						limitingIngName = ing?.nama || 'Bahan baku';
					}
				}
			}

			if (minPortions !== Infinity) {
				if (minPortions <= 0) {
					return {
						isOutOfStock: true,
						availableStock: 0,
						limitingReason: `Bahan ${limitingIngName} habis`,
						limitingIngredientName: limitingIngName
					};
				}
				return {
					isOutOfStock: false,
					availableStock: minPortions,
					limitingIngredientName: limitingIngName
				};
			}
		}
	}

	return { isOutOfStock: false, availableStock: null };
}

/**
 * Memeriksa apakah produk tertentu sedang habis stok (baik stok unit maupun bahan baku resepnya).
 */
export function isProductOutOfStock(
	product:
		| {
				id?: string | number;
				stok?: number | null;
				lacak_stok?: boolean | number | string | null;
				lacak_bahan?: boolean | number | string | null;
		  }
		| null
		| undefined,
	allIngredients: Array<{ id: string | number; nama: string; stok_saat_ini?: number | null }> = [],
	allRecipes: Array<{
		produk_id: string | number;
		bahan_id: string | number;
		porsi?: string | null;
		jumlah_per_item: number;
		jumlah_dasar_per_item?: number | null;
	}> = []
): boolean {
	const avail = getProductStockAvailability(product, 'reguler', allIngredients, allRecipes);
	return avail.isOutOfStock;
}

/**
 * Mendapatkan sisa stok/porsi tersedia untuk produk (unit stock atau porsi bahan baku).
 * Mengembalikan null jika produk tidak melacak stok (unlimited).
 */
export function getProductAvailableStock(
	product:
		| {
				id?: string | number;
				stok?: number | null;
				lacak_stok?: boolean | number | string | null;
				lacak_bahan?: boolean | number | string | null;
		  }
		| null
		| undefined,
	porsi: string = 'reguler',
	allIngredients: Array<{ id: string | number; nama: string; stok_saat_ini?: number | null }> = [],
	allRecipes: Array<{
		produk_id: string | number;
		bahan_id: string | number;
		porsi?: string | null;
		jumlah_per_item: number;
		jumlah_dasar_per_item?: number | null;
	}> = []
): number | null {
	const avail = getProductStockAvailability(product, porsi, allIngredients, allRecipes);
	return avail.availableStock;
}

/**
 * Memutar suara nada peringatan stok menipis via Web Audio API.
 * Menghasilkan dual-tone chime yang jelas tanpa perlu aset file mp3 eksternal.
 */
export function playLowStockSound(force = false): void {
	if (!browser) return;
	if (!force && !isSoundEnabled()) return;

	try {
		const AudioContextClass =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		if (!AudioContextClass) return;

		if (!audioCtx) {
			audioCtx = new AudioContextClass();
		}

		if (audioCtx.state === 'suspended') {
			void audioCtx.resume();
		}

		const now = audioCtx.currentTime;

		// Tone 1 (E5 - 659.25 Hz)
		const osc1 = audioCtx.createOscillator();
		const gain1 = audioCtx.createGain();
		osc1.type = 'sine';
		osc1.frequency.setValueAtTime(659.25, now);
		gain1.gain.setValueAtTime(0.2, now);
		gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
		osc1.connect(gain1);
		gain1.connect(audioCtx.destination);
		osc1.start(now);
		osc1.stop(now + 0.25);

		// Tone 2 (A5 - 880 Hz, nada lebih tinggi untuk kesan waspada/notifikasi)
		const osc2 = audioCtx.createOscillator();
		const gain2 = audioCtx.createGain();
		osc2.type = 'sine';
		osc2.frequency.setValueAtTime(880, now + 0.15);
		gain2.gain.setValueAtTime(0.25, now + 0.15);
		gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
		osc2.connect(gain2);
		gain2.connect(audioCtx.destination);
		osc2.start(now + 0.15);
		osc2.stop(now + 0.45);
	} catch (e) {
		console.warn('Gagal memutar audio alert stok:', e);
	}
}

/**
 * Meminta izin (permission) notifikasi sistem HP/browser kepada pengguna.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (!browser || !('Notification' in window)) {
		return 'denied';
	}
	if (Notification.permission === 'granted') {
		return 'granted';
	}
	try {
		const permission = await Notification.requestPermission();
		return permission;
	} catch {
		return Notification.permission;
	}
}

interface ExtendedNotificationOptions extends NotificationOptions {
	badge?: string;
	vibrate?: number[];
	renotify?: boolean;
	tag?: string;
}

/**
 * Mengirim notifikasi ke status bar OS (Android, iOS PWA, Windows, macOS).
 */
export async function sendSystemNotification(
	title: string,
	options?: ExtendedNotificationOptions
): Promise<void> {
	if (!browser || !('Notification' in window) || Notification.permission !== 'granted') {
		return;
	}

	try {
		// Coba lewat ServiceWorkerRegistration untuk kompatibilitas PWA mobile
		if ('serviceWorker' in navigator) {
			const registration = await navigator.serviceWorker.getRegistration();
			if (registration && 'showNotification' in registration) {
				const swOptions = {
					icon: '/favicon.png',
					badge: '/favicon.png',
					vibrate: [200, 100, 200],
					...options
				} as NotificationOptions;
				await registration.showNotification(title, swOptions);
				return;
			}
		}

		// Fallback ke browser Notification constructor biasa
		new Notification(title, {
			icon: '/favicon.png',
			...options
		} as NotificationOptions);
	} catch (err) {
		console.warn('Gagal menampilkan notifikasi sistem:', err);
	}
}

/**
 * Memeriksa daftar bahan dan memicu alert suara + notifikasi HP jika ada yang menipis.
 */
export function evaluateAndAlertLowStock(
	ingredients: Ingredient[],
	options: { forceSound?: boolean } = {}
): Ingredient[] {
	if (!browser || !Array.isArray(ingredients)) return [];

	const lowStockItems = ingredients.filter((b) => {
		const ambang = Number(b.ambang_stok || 0);
		const stok = Number(b.stok_saat_ini || 0);
		return ambang > 0 && stok <= ambang;
	});

	if (lowStockItems.length === 0) {
		lastNotifiedIds.clear();
		return [];
	}

	const currentIds = new Set(lowStockItems.map((b) => b.id));
	const now = Date.now();
	const hasNewItems = [...currentIds].some((id) => !lastNotifiedIds.has(id));
	const isThrottled = now - lastNotificationTime < NOTIFICATION_THROTTLE_MS;

	if (options.forceSound || hasNewItems || !isThrottled) {
		playLowStockSound();

		const itemNames = lowStockItems
			.slice(0, 3)
			.map((b) => `${b.nama} (${b.stok_saat_ini || 0} ${b.satuan || ''})`)
			.join(', ');
		const extraCount =
			lowStockItems.length > 3 ? ` dan ${lowStockItems.length - 3} bahan lainnya` : '';

		sendSystemNotification('⚠️ Peringatan: Stok Bahan Menipis!', {
			body: `Segera restock: ${itemNames}${extraCount}.`,
			tag: 'low-stock-alert',
			renotify: true
		});

		lastNotifiedIds = currentIds;
		lastNotificationTime = now;
	}

	return lowStockItems;
}
