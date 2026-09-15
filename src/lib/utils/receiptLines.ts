/**
 * Adapter snapshot transaksi -> baris tampil struk (F17/F18).
 * Satu adapter dipakai HTML dan ESC/POS agar konsisten.
 *
 * Kontrak snapshot server (financials.ts):
 * - harga = unit inklusif (harga_dasar + total_tambahan), per unit
 * - harga_dasar = unit dasar per unit, total_tambahan = unit tambahan per unit
 * - nominal = subtotal baris (harga x jumlah)
 * - snapshot_tambahan = daftar tambahan per unit
 */
export interface ReceiptAddOnLine {
	nama: string;
	unit: number;
	total: number;
}

export interface ReceiptLine {
	nama: string;
	jumlah: number;
	/** Subtotal baris (nominal snapshot bila sah). */
	subtotal: number;
	/** Harga satuan dasar (tanpa topping) bila breakdown terpercaya. */
	baseUnit: number | null;
	/** Total tambahan per unit bila breakdown terpercaya. */
	addOnUnit: number | null;
	addOns: ReceiptAddOnLine[];
	/** True bila hanya total inklusif legacy tanpa breakdown. */
	inklusifSaja: boolean;
	/** Harga satuan inklusif untuk penanda @ bila qty > 1. */
	unitInklusif: number | null;
	gula?: string | null;
	es?: string | null;
	catatan?: string | null;
}

function num(value: unknown): number | null {
	const n = typeof value === 'string' ? Number(value) : (value as number);
	return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function pickName(item: Record<string, unknown>): string {
	const snapshot = num(item.nama_produk) === null ? (item.nama_produk as unknown) : null;
	if (typeof snapshot === 'string' && snapshot.trim()) return snapshot.trim();
	const custom = item.nama_kustom;
	if (typeof custom === 'string' && custom.trim()) return custom.trim();
	const produk = item.produk as Record<string, unknown> | undefined;
	const legacy = produk?.nama;
	if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
	return 'Produk Custom';
}

function pickAddOns(item: Record<string, unknown>, qty: number): ReceiptAddOnLine[] {
	const raw = item.snapshot_tambahan;
	if (typeof raw !== 'string' || !raw.trim()) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: ReceiptAddOnLine[] = [];
		for (const e of parsed) {
			if (!e || typeof e !== 'object') continue;
			const r = e as Record<string, unknown>;
			const nama = typeof r.nama === 'string' && r.nama.trim() ? r.nama.trim() : null;
			const unit = num(r.harga);
			if (!nama || unit === null || unit < 0) continue;
			out.push({ nama, unit, total: Math.round(unit * qty * 100) / 100 });
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Normalisasi satu baris snapshot. Tidak membaca katalog: nama/harga beku.
 * nominal 0 sah (bukan missing). Legacy tanpa nominal -> harga x jumlah.
 */
export function toReceiptLine(item: Record<string, unknown>): ReceiptLine {
	const qtyRaw = num(item.jumlah);
	const qty = qtyRaw !== null && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;
	const nominal = num(item.nominal);
	const harga = num(item.harga);
	const hargaDasar = num(item.harga_dasar);
	const totalTambahan = num(item.total_tambahan);

	const subtotal =
		nominal !== null ? nominal : harga !== null ? Math.round(harga * qty * 100) / 100 : 0;

	let baseUnit: number | null = null;
	let addOnUnit: number | null = null;
	let inklusifSaja = true;
	if (hargaDasar !== null && totalTambahan !== null && hargaDasar >= 0 && totalTambahan >= 0) {
		baseUnit = hargaDasar;
		addOnUnit = totalTambahan;
		inklusifSaja = false;
	}

	const addOns = inklusifSaja ? [] : pickAddOns(item, qty);
	const unitInklusif =
		harga !== null ? harga : qty > 0 ? Math.round((subtotal / qty) * 100) / 100 : null;

	return {
		nama: pickName(item),
		jumlah: qty,
		subtotal: Math.round(subtotal * 100) / 100,
		baseUnit,
		addOnUnit,
		addOns,
		inklusifSaja,
		unitInklusif,
		gula: (item.gula as string | null) ?? null,
		es: (item.es as string | null) ?? null,
		catatan: (item.catatan as string | null) ?? null
	};
}

export function toReceiptLines(items: Array<Record<string, unknown>>): ReceiptLine[] {
	return (items ?? []).map(toReceiptLine);
}
