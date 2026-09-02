import { createHash } from 'node:crypto';

export interface TransactionFingerprintInput {
	branch: string;
	storeSessionId?: string | null;
	cashReceived?: number | string | null;
	items: Array<{
		product_id?: string | null;
		nama_kustom?: string | null;
		custom_name?: string | null;
		custom_price?: string | number | null;
		jumlah: number;
		porsi?: string | null;
		add_on_ids?: Array<string | number>;
		product_price_token?: string | null;
		add_on_price_tokens?: string[];
		gula?: string | null;
		es?: string | null;
		catatan?: string | null;
	}>;
	totalAmount: number;
	totalQty: number;
	paymentMethod: string;
	customerName?: string | null;
}

/**
 * Menghasilkan SHA-256 fingerprint kanonik dari data transaksi POS untuk exact idempotency.
 */
export function computeTransactionFingerprint(params: TransactionFingerprintInput): string {
	const normalizedItems = (params.items || []).map((i) => ({
		p: i.product_id ? String(i.product_id) : null,
		cn: i.nama_kustom || i.custom_name ? String(i.nama_kustom || i.custom_name).trim() : null,
		cp: i.custom_price != null ? Number(i.custom_price) : null,
		q: Number(i.jumlah),
		po: i.porsi || 'reguler',
		addons: Array.isArray(i.add_on_ids) ? [...i.add_on_ids].map(String).sort() : [],
		ptok: i.product_price_token ? String(i.product_price_token) : null,
		atok: Array.isArray(i.add_on_price_tokens) ? [...i.add_on_price_tokens].map(String).sort() : [],
		g: i.gula || null,
		e: i.es || null,
		c: i.catatan || null
	}));

	const canonicalPayload = {
		b: String(params.branch || ''),
		sess: params.storeSessionId ? String(params.storeSessionId) : null,
		cash: params.cashReceived != null ? Math.round(Number(params.cashReceived)) : null,
		items: normalizedItems,
		tot: Math.round(Number(params.totalAmount || 0)),
		qty: Math.round(Number(params.totalQty || 0)),
		pay: String(params.paymentMethod || '').toLowerCase(),
		cust: params.customerName ? String(params.customerName).trim() : null
	};

	return createHash('sha256').update(JSON.stringify(canonicalPayload)).digest('hex');
}
