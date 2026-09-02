/**
 * Optimized icon loading utility with lazy loading and caching
 * Reduces initial bundle size by loading icons on-demand
 */

interface IconCache {
	[key: string]: Promise<any>;
}

const ICON_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
	wallet: () => import('@lucide/svelte/icons/wallet'),
	'shopping-bag': () => import('@lucide/svelte/icons/shopping-bag'),
	coins: () => import('@lucide/svelte/icons/coins'),
	users: () => import('@lucide/svelte/icons/users'),
	clock: () => import('@lucide/svelte/icons/clock'),
	'trending-up': () => import('@lucide/svelte/icons/trending-up'),
	'shopping-cart': () => import('@lucide/svelte/icons/shopping-cart'),
	'credit-card': () => import('@lucide/svelte/icons/credit-card'),
	receipt: () => import('@lucide/svelte/icons/receipt'),
	calculator: () => import('@lucide/svelte/icons/calculator'),
	filter: () => import('@lucide/svelte/icons/filter'),
	'edit-3': () => import('@lucide/svelte/icons/edit-3'),
	'plus-circle': () => import('@lucide/svelte/icons/plus-circle'),
	'minus-circle': () => import('@lucide/svelte/icons/minus-circle'),
	save: () => import('@lucide/svelte/icons/save'),
	settings: () => import('@lucide/svelte/icons/settings'),
	user: () => import('@lucide/svelte/icons/user'),
	shield: () => import('@lucide/svelte/icons/shield'),
	printer: () => import('@lucide/svelte/icons/printer'),
	'log-out': () => import('@lucide/svelte/icons/log-out'),
	palette: () => import('@lucide/svelte/icons/palette'),
	database: () => import('@lucide/svelte/icons/database'),
	'help-circle': () => import('@lucide/svelte/icons/help-circle'),
	bell: () => import('@lucide/svelte/icons/bell'),
	download: () => import('@lucide/svelte/icons/download'),
	crown: () => import('@lucide/svelte/icons/crown'),
	'arrow-left': () => import('@lucide/svelte/icons/arrow-left'),
	utensils: () => import('@lucide/svelte/icons/utensils'),
	'refresh-cw': () => import('@lucide/svelte/icons/refresh-cw'),
	trash: () => import('@lucide/svelte/icons/trash')
};

class IconLoader {
	private static instance: IconLoader;
	private cache: IconCache = {};
	private loadedIcons: Set<string> = new Set();

	private constructor() {}

	static getInstance(): IconLoader {
		if (!IconLoader.instance) {
			IconLoader.instance = new IconLoader();
		}
		return IconLoader.instance;
	}

	/**
	 * Load icon dynamically with caching
	 */
	async loadIcon(iconName: string): Promise<any> {
		// [CATATAN]: Check if already loaded
		if (this.loadedIcons.has(iconName)) {
			return this.cache[iconName];
		}

		// [CATATAN]: Check cache first
		const cachedIcon = this.cache[iconName];
		if (cachedIcon && this.loadedIcons.has(iconName) && !(cachedIcon instanceof Promise)) {
			return cachedIcon;
		}

		const iconLoader = ICON_MODULES[iconName];
		if (!iconLoader) {
			throw new Error(`Icon tidak ditemukan: ${iconName}`);
		}

		const iconPromise = iconLoader().then((module) => module.default);
		this.cache[iconName] = iconPromise;

		// [CATATAN]: Mark as loaded when resolved
		iconPromise
			.then(() => {
				this.loadedIcons.add(iconName);
			})
			.catch(() => {
				// [CATATAN]: Remove from cache if loading fails
				delete this.cache[iconName];
			});

		return iconPromise;
	}

	/**
	 * Preload multiple icons
	 */
	async preloadIcons(iconNames: string[]): Promise<void> {
		const promises = iconNames.map((name) => this.loadIcon(name).catch(() => null));

		await Promise.allSettled(promises);
	}

	/**
	 * Get loaded icons count
	 */
	getLoadedCount(): number {
		return this.loadedIcons.size;
	}

	/**
	 * Get cached icons count
	 */
	getCachedCount(): number {
		return Object.keys(this.cache).length;
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache = {};
		this.loadedIcons.clear();
	}
}

// [CATATAN]: Export singleton instance
export const iconLoader = IconLoader.getInstance();

// [CATATAN]: Route-specific icon mappings for better code splitting
export const ROUTE_ICONS = {
	// [CATATAN]: Sesuaikan dengan ikon nyata yang dipakai per halaman
	dashboard: ['wallet', 'shopping-bag', 'coins', 'users', 'clock', 'trending-up'],
	pos: [
		// [CATATAN]: Ikon inti POS (antisipasi)
		'shopping-cart',
		'credit-card',
		'receipt',
		'calculator'
	],
	laporan: ['filter'],
	catat: [
		// [CATATAN]: Saat ini banyak pakai SVG inline; siapkan ikon umum jika nanti dipakai
		'edit-3',
		'plus-circle',
		'minus-circle',
		'save'
	],
	// [CATATAN]: Preload ikon umum untuk halaman pengaturan dan subroutes-nya
	pengaturan: [
		'settings',
		'user',
		'shield',
		'printer',
		// [CATATAN]: Ikon yang digunakan di halaman pengaturan utama
		'log-out',
		'palette',
		'database',
		'help-circle',
		'bell',
		'download',
		'crown',
		'credit-card',
		'arrow-left',
		// [CATATAN]: Ikon yang digunakan di halaman pemilik dan subroutes
		'utensils',
		'refresh-cw',
		'trash'
	]
};

/**
 * Load icons for specific route
 */
export async function loadRouteIcons(routeName: keyof typeof ROUTE_ICONS): Promise<void> {
	const icons = ROUTE_ICONS[routeName] || [];
	await iconLoader.preloadIcons(icons);
}
