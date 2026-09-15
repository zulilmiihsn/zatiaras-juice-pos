export type HppBaseUnit = 'gram' | 'ml' | 'pcs' | 'buah';

export interface HppParsedPurchase {
	nama: string;
	satuan: HppBaseUnit;
	purchase_qty: number;
	purchase_cost: number;
	biaya_per_satuan: number;
}

function stripFences(content: string): string {
	return content
		.trim()
		.replace(/^```json\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();
}

function normalizeName(value: unknown): string {
	return String(value ?? '')
		.replace(/\b(beli|belanja|stok|harga|rp)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100);
}

/**
 * Normalisasi satuan + kuantitas bersama. Model wajib kirim jumlah dasar
 * (gram/ml). Bila model masih kirim kg/liter, konversi eksplisit di sini;
 * jangan hanya ganti label.
 */
function normalizeUnitQty(
	rawSatuan: unknown,
	rawQty: unknown
): { satuan: HppBaseUnit; qty: number } | null {
	const s = String(rawSatuan ?? '')
		.trim()
		.toLowerCase();
	const qty = Number(rawQty);
	if (!Number.isFinite(qty) || qty <= 0) return null;

	if (['kg', 'kilo', 'kilogram', 'g', 'gr', 'gram'].includes(s)) {
		const factor = ['kg', 'kilo', 'kilogram'].includes(s) ? 1000 : 1;
		const out = qty * factor;
		if (!Number.isFinite(out) || out <= 0) return null;
		return { satuan: 'gram', qty: Math.round(out * 10000) / 10000 };
	}
	if (['l', 'liter', 'litre', 'ml', 'mili', 'mililiter'].includes(s)) {
		const factor = ['l', 'liter', 'litre'].includes(s) ? 1000 : 1;
		const out = qty * factor;
		if (!Number.isFinite(out) || out <= 0) return null;
		return { satuan: 'ml', qty: Math.round(out * 10000) / 10000 };
	}
	if (['buah'].includes(s)) return { satuan: 'buah', qty: qty };
	if (['pcs', 'pc', 'biji', 'buah-buahan'].includes(s)) return { satuan: 'pcs', qty: qty };
	// Satuan tak dikenal: tolak, jangan tebak pcs diam-diam bila qty besar?
	// Kontrak kanonik hanya 4 satuan dasar; selain itu tolak.
	if (['gram', 'ml', 'pcs', 'buah'].includes(s)) return { satuan: s as HppBaseUnit, qty };
	return null;
}

export function parseHppModelResponse(content: unknown): HppParsedPurchase[] {
	const text = stripFences(String(content ?? ''));
	if (!text) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const out: HppParsedPurchase[] = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		// Kanonik `nama`; terima alias legacy `name` sekali di batas parse.
		const nama = normalizeName(r.nama ?? r.name);
		if (!nama) continue;

		const cost = Number(r.purchase_cost);
		if (!Number.isFinite(cost) || cost <= 0) continue;

		const unitQty = normalizeUnitQty(r.satuan, r.purchase_qty);
		if (!unitQty) continue;

		out.push({
			nama,
			satuan: unitQty.satuan,
			purchase_qty: unitQty.qty,
			purchase_cost: cost,
			biaya_per_satuan: Math.round((cost / unitQty.qty) * 100) / 100
		});
	}
	return out;
}
