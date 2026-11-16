/** Bentuk pesanan web (zatiarasjuice) yang menunggu cek pembayaran QRIS oleh kasir. */
export interface WebOrderItem {
	menuItemId: string;
	name?: string;
	qty: number;
	unitPrice: number;
	size?: 'REG' | 'JUMBO';
	sweet?: 'NORMAL' | 'LESS' | 'NONE';
	ice?: 'NORMAL' | 'LESS' | 'NONE';
}

export interface WebOrder {
	/** Kode pesanan web, mis. ZT-ABC234. Dipakai juga sebagai bagian idempotency key POS. */
	id: string;
	outletId: string;
	state: string;
	name: string;
	pickupNote: string | null;
	note: string | null;
	/** Harga menu. Omzet POS memakai angka ini, bukan nominal QRIS. */
	total: number;
	/** Kode unik 1-99 yang ditambahkan ke nominal QRIS agar bisa dicocokkan dengan uang masuk. */
	uniqueCode: number;
	/** Nominal persis yang harus masuk lewat QRIS: total + kode unik. */
	payTotal: number;
	items: WebOrderItem[];
	createdAt: number;
}

export interface WebOrdersConfig {
	baseUrl: string;
	token: string;
}

export type WebOrderState = 'CONFIRMED' | 'PREPARING' | 'READY' | 'CANCELLED';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class WebOrderError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'WebOrderError';
		this.status = status;
	}
}
