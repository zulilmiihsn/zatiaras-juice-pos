export type PreparationState = 'pending' | 'done';

export interface OrderQueueItemDetail {
	id: string;
	produk_id: string | null;
	nama: string;
	jumlah: number;
	harga: number;
	nominal: number;
	gula: string | null;
	es: string | null;
	catatan: string | null;
	tambahan: Array<{ id: string; nama: string; harga: number }>;
}

export interface OrderQueueItem {
	buku_kas_id: string;
	transaction_id: string;
	idempotency_key: string;
	nama_pelanggan: string | null;
	waktu: string;
	metode_bayar: string | null;
	nominal: number;
	jumlah: number;
	/** Nomor antrean harian. Null untuk baris legacy atau antrean lokal belum sinkron. */
	nomor_harian: number | null;
	tanggal_nomor: string | null;
	preparation_state: PreparationState;
	preparation_revision: number;
	preparation_completed_at: string | null;
	preparation_completed_by: string | null;
	items: OrderQueueItemDetail[];
}

export interface OrderQueueCursor {
	sortValue: string;
	id: string;
}

export interface ListOrderQueueOptions {
	state?: string | null;
	limit?: number | string | null;
	cursor?: string | null;
}

export interface OrderQueuePage {
	items: OrderQueueItem[];
	nextCursor: string | null;
	hasMore: boolean;
	pending_count: number;
}

export interface TransitionOrderInput {
	idempotency_key?: unknown;
	target?: unknown;
	expected_revision?: unknown;
}

export interface TransitionOrderResult {
	idempotency_key: string;
	transaction_id: string;
	preparation_state: PreparationState;
	preparation_revision: number;
	preparation_completed_at: string | null;
	preparation_completed_by: string | null;
	idempotent: boolean;
}
