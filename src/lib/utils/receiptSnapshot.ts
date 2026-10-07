import type { ReceiptSettings } from '$lib/types/laporan.js';

export interface ReceiptSnapshotItem {
	product_id: string | null;
	nama: string;
	jumlah: number;
	harga: number;
	nominal: number;
	harga_dasar: number;
	total_tambahan: number;
	tambahan: Array<{ id?: string; nama: string; harga: number }>;
	gula: string | null;
	es: string | null;
	catatan: string | null;
}

export type ReceiptSnapshotSettings = Pick<
	ReceiptSettings,
	'nama_toko' | 'alamat' | 'telepon' | 'instagram' | 'ucapan'
>;

/** Receipt values persisted at checkout; missing legacy values stay explicitly unavailable. */
export interface ReceiptSnapshot {
	schema_version?: 1;
	items: ReceiptSnapshotItem[];
	total_amount: number;
	total_qty: number;
	cash_received: number | null;
	change: number | null;
	metode_bayar: string | null;
	committed_at: string | null;
	customer_name: string | null;
	settings: ReceiptSnapshotSettings | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | null {
	if (value === null || value === undefined || (typeof value === 'string' && !value.trim()))
		return null;
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function requiredMoney(value: unknown, field: string): number {
	const number = finiteNonNegative(value);
	if (number === null) throw new Error(`Snapshot struk tidak valid: ${field}`);
	return number;
}

function parseSettings(value: unknown): ReceiptSnapshotSettings | null {
	if (!isRecord(value)) return null;
	const name = optionalText(value.nama_toko);
	if (!name) return null;
	return {
		nama_toko: name,
		alamat: optionalText(value.alamat) ?? undefined,
		telepon: optionalText(value.telepon) ?? undefined,
		instagram: optionalText(value.instagram) ?? undefined,
		ucapan: optionalText(value.ucapan) ?? undefined
	};
}

function parseItem(value: unknown): ReceiptSnapshotItem {
	if (!isRecord(value) || typeof value.nama !== 'string' || !value.nama.trim()) {
		throw new Error('Snapshot struk tidak valid: item');
	}
	const jumlah = Number(value.jumlah);
	if (!Number.isInteger(jumlah) || jumlah <= 0)
		throw new Error('Snapshot struk tidak valid: jumlah');
	const addOns = Array.isArray(value.tambahan)
		? value.tambahan.map((addOn) => {
				if (!isRecord(addOn) || typeof addOn.nama !== 'string' || !addOn.nama.trim()) {
					throw new Error('Snapshot struk tidak valid: tambahan');
				}
				return {
					...(typeof addOn.id === 'string' ? { id: addOn.id } : {}),
					nama: addOn.nama,
					harga: requiredMoney(addOn.harga, 'harga tambahan')
				};
			})
		: [];
	return {
		product_id: typeof value.product_id === 'string' ? value.product_id : null,
		nama: value.nama,
		jumlah,
		harga: requiredMoney(value.harga, 'harga item'),
		nominal: requiredMoney(value.nominal, 'subtotal item'),
		harga_dasar: requiredMoney(value.harga_dasar, 'harga dasar'),
		total_tambahan: requiredMoney(value.total_tambahan, 'total tambahan'),
		tambahan: addOns,
		gula: optionalText(value.gula),
		es: optionalText(value.es),
		catatan: optionalText(value.catatan)
	};
}

/** Decode the stored JSON without consulting catalog/settings or inventing missing fields. */
export function decodeReceiptSnapshot(value: unknown): ReceiptSnapshot | null {
	if (value === null || value === undefined || value === '') return null;
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			throw new Error('Snapshot struk tidak dapat dibaca');
		}
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.items) || parsed.items.length === 0) {
		throw new Error('Snapshot struk tidak memiliki detail transaksi yang valid');
	}
	if (parsed.schema_version !== undefined && parsed.schema_version !== 1) {
		throw new Error('Versi snapshot struk tidak didukung');
	}
	const totalQty = Number(parsed.total_qty);
	if (!Number.isInteger(totalQty) || totalQty <= 0)
		throw new Error('Snapshot struk tidak valid: total qty');
	return {
		schema_version: 1,
		items: parsed.items.map(parseItem),
		total_amount: requiredMoney(parsed.total_amount, 'total'),
		total_qty: totalQty,
		cash_received: finiteNonNegative(parsed.cash_received),
		change: finiteNonNegative(parsed.change),
		metode_bayar: optionalText(parsed.metode_bayar),
		committed_at: optionalText(parsed.committed_at),
		customer_name: optionalText(parsed.customer_name),
		settings: parseSettings(parsed.settings)
	};
}
