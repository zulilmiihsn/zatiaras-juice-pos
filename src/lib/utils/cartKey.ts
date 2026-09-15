/**
 * Identitas kanonik item keranjang (F08). Mencakup product ID, porsi
 * (default reguler), sorted add-on IDs, gula, es, catatan ternormalisasi.
 * Encoding tuple JSON agar tidak ambigu. Kuantitas BUKAN identitas.
 */
export function normalizeCartNote(note: unknown): string {
	return String(note ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

export function buildCartItemKey(input: {
	productId: string | number;
	porsi?: string | null;
	addOnIds?: Array<string | number>;
	gula?: string | null;
	es?: string | null;
	catatan?: string | null;
}): string {
	const addOns = [...(input.addOnIds ?? [])].map(String).sort();
	return JSON.stringify([
		String(input.productId),
		String(input.porsi || 'reguler').toLowerCase(),
		addOns,
		String(input.gula ?? ''),
		String(input.es ?? ''),
		normalizeCartNote(input.catatan)
	]);
}
