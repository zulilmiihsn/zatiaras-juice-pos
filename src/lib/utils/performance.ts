// [CATATAN]: Performance utilities
export function debounce<T extends (...args: any[]) => any>(
	func: T,
	wait: number
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => func(...args), wait);
	};
}

export function throttle<T extends (...args: any[]) => any>(
	func: T,
	limit: number
): (...args: Parameters<T>) => void {
	let inThrottle: boolean;
	return (...args: Parameters<T>) => {
		if (!inThrottle) {
			func(...args);
			inThrottle = true;
			setTimeout(() => (inThrottle = false), limit);
		}
	};
}

// [CATATAN]: Cart calculations (without memoization)
export const calculateCartTotal = <T>(cart: T[]) => {
	let items = 0;
	let total = 0;
	for (const item of cart) {
		const record = item as Record<string, unknown>;
		const product = record.product as Record<string, unknown> | undefined;
		const isJumbo = record.porsi === 'jumbo';
		const basePrice = isJumbo
			? ((product?.harga_jumbo as number) ?? (product?.harga as number) ?? 0)
			: ((product?.harga as number) ?? 0);
		const itemTotal = basePrice * ((record.jumlah as number) ?? 1);
		const addOnsTotal =
			((record.addOns as Array<Record<string, unknown>>) || []).reduce(
				(sum: number, addon: Record<string, unknown>) => sum + ((addon.harga as number) ?? 0),
				0
			) * ((record.jumlah as number) ?? 1);
		total += itemTotal + addOnsTotal;
		items += (record.jumlah as number | null | undefined) ?? 1;
	}
	return { items, total };
};

// [CATATAN]: Fuzzy search dengan hasil lebih relevan
export function fuzzySearch<T>(query: string, items: T[], key: string = 'nama'): T[] {
	if (!query.trim()) return items;
	const searchTerm = query.toLowerCase();
	// [CATATAN]: Cari di name dan kategori (jika ada)
	return items
		.map((item) => {
			const record = item as Record<string, unknown>;
			const name = String(record[key] ?? '').toLowerCase();
			const kategori = String(record.kategori ?? '').toLowerCase();
			let score = 0;
			if (name.startsWith(searchTerm)) score = 3;
			else if (name.includes(searchTerm)) score = 2;
			else if (kategori && kategori.includes(searchTerm)) score = 1;
			return { item, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((x) => x.item);
}
