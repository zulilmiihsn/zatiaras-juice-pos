/**
 * Presentasi kesehatan stok murni (AUD-053 slice 1).
 *
 * Dipindah verbatim dari `src/routes/stok/+page.svelte` tanpa ubah perilaku:
 * satu kebijakan tampilan untuk badge/bar/kartu, predikat low-stock tunggal
 * (sebelumnya ganda di dua derived), filter + hitung kategori terpusat.
 * Tanpa import Svelte/store/browser — dapat diuji langsung.
 */

export type StockHealthStatus = 'out' | 'critical' | 'warning' | 'half' | 'full';

export interface StockHealth {
	status: StockHealthStatus;
	label: string;
	badgeClass: string;
	barGradient: string;
	trackBg: string;
	textColor: string;
	cardBg: string;
	percent: number;
}

export interface StockHealthInput {
	stok_saat_ini?: unknown;
	ambang_stok?: unknown;
	jumlah_beli_terakhir?: unknown;
	kategori?: unknown;
	nama?: unknown;
}

export function getStockHealth(b: StockHealthInput): StockHealth {
	const current = Math.max(0, Number(b.stok_saat_ini || 0));
	const threshold = Math.max(0, Number(b.ambang_stok || 0));
	const lastPurchase = Math.max(0, Number(b.jumlah_beli_terakhir || 0));

	// Baseline target / maximum benchmark for progress bar:
	const maxCapacity = Math.max(lastPurchase, threshold > 0 ? threshold * 2.5 : 50, current, 1);

	let percent = Math.min(100, Math.max(0, Math.round((current / maxCapacity) * 100)));
	if (current > 0 && percent === 0) percent = 4;

	// 1. HABIS (0 pcs) -> Rose/Merah Pekat
	if (current === 0) {
		return {
			status: 'out',
			label: 'Habis',
			badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
			barGradient: 'bg-rose-600',
			trackBg: 'bg-rose-100',
			textColor: 'text-rose-600',
			cardBg: 'border-rose-200/90 bg-gradient-to-b from-rose-50/30 to-white',
			percent: 0
		};
	}

	// 2. SISA SEDIKIT (stok <= ambang batas ATAU percent <= 25%) -> Gradasi Merah/Rose
	if ((threshold > 0 && current <= threshold) || percent <= 25) {
		return {
			status: 'critical',
			label: 'Sisa Sedikit',
			badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
			barGradient: 'bg-gradient-to-r from-rose-500 to-red-500',
			trackBg: 'bg-rose-100/80',
			textColor: 'text-rose-600',
			cardBg: 'border-rose-200/80 bg-gradient-to-b from-rose-50/20 to-white',
			percent
		};
	}

	// 3. MENDEKATI BATAS (stok <= 1.5x ambang ATAU percent <= 45%) -> Gradasi Amber/Oranye
	if ((threshold > 0 && current <= threshold * 1.5) || percent <= 45) {
		return {
			status: 'warning',
			label: 'Mendekati Batas',
			badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
			barGradient: 'bg-gradient-to-r from-amber-400 to-orange-500',
			trackBg: 'bg-amber-100/80',
			textColor: 'text-amber-600',
			cardBg: 'border-amber-200/70 bg-gradient-to-b from-amber-50/15 to-white',
			percent
		};
	}

	// 4. SETENGAH (percent 46% - 74%) -> Gradasi Sky/Biru Cyan
	if (percent < 75) {
		return {
			status: 'half',
			label: 'Setengah',
			badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
			barGradient: 'bg-gradient-to-r from-sky-400 to-blue-500',
			trackBg: 'bg-sky-100/80',
			textColor: 'text-sky-600',
			cardBg: 'border-slate-100/90 hover:border-slate-200/90',
			percent
		};
	}

	// 5. PENUH (percent >= 75%) -> Gradasi Hijau Emerald
	return {
		status: 'full',
		label: 'Penuh',
		badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		barGradient: 'bg-gradient-to-r from-emerald-400 to-teal-500',
		trackBg: 'bg-emerald-100/60',
		textColor: 'text-emerald-600',
		cardBg: 'border-slate-100/90 hover:border-slate-200/90',
		percent
	};
}

/** Predikat low-stock tunggal (ambang > 0 dan stok <= ambang). */
export function isLowStockItem(b: StockHealthInput): boolean {
	return (
		Number(b.ambang_stok || 0) > 0 && Number(b.stok_saat_ini || 0) <= Number(b.ambang_stok || 0)
	);
}

export function filterLowStock<T extends StockHealthInput>(list: T[]): T[] {
	return list.filter(isLowStockItem);
}

export function filterBahan<T extends StockHealthInput>(
	list: T[],
	query: string,
	category: string
): T[] {
	const q = query.trim().toLowerCase();
	return list.filter((b) => {
		const matchesSearch =
			!q ||
			String(b.nama || '')
				.toLowerCase()
				.includes(q) ||
			String(b.kategori || '')
				.toLowerCase()
				.includes(q);
		if (!matchesSearch) return false;

		if (category === 'all') return true;
		if (category === 'low_stock') return isLowStockItem(b);
		const itemCat = String(b.kategori || 'Bahan Baku')
			.trim()
			.toLowerCase();
		return itemCat === category.toLowerCase();
	});
}

export function buildCategoryOptions<T extends StockHealthInput>(
	list: T[],
	defaults: string[]
): { dynamic: string[]; available: string[] } {
	const dynamicSet = new Set<string>(['Bahan Baku']);
	const availableSet = new Set<string>(defaults);
	for (const b of list) {
		const cat = String(b.kategori || '').trim();
		if (cat) {
			dynamicSet.add(cat);
			availableSet.add(cat);
		}
	}
	return { dynamic: Array.from(dynamicSet), available: Array.from(availableSet) };
}

export function countCategory<T extends StockHealthInput>(
	list: T[],
	lowStockCount: number,
	cat: string
): number {
	if (cat === 'all') return list.length;
	if (cat === 'low_stock') return lowStockCount;
	return list.filter(
		(b) =>
			String(b.kategori || 'Bahan Baku')
				.trim()
				.toLowerCase() === cat.toLowerCase()
	).length;
}
