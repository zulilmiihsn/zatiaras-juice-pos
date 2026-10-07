// Skema runtime rekomendasi AI kanonik tunggal (AUD-033).
// Dipakai parse (aiAnalysisService) dan apply (autoApplyService) agar sama.
// Prinsip: allowlist field per action; ID/branch/immutable tak pernah
// menjadi otoritas dari model; ambigu merambat ke kebijakan kategori,
// bukan default diam. Murni tanpa dependensi (unit-testable).
export const AI_RECOMMENDATION_ACTIONS = [
	'create_transaction',
	'update_transaction',
	'create_category'
] as const;

export type AiRecommendationAction = (typeof AI_RECOMMENDATION_ACTIONS)[number];

export const AI_TRANSACTION_TYPES = ['pemasukan', 'pengeluaran', 'penjualan'] as const;

export type AiTransactionType = (typeof AI_TRANSACTION_TYPES)[number];

const TYPE_ALIASES: Record<string, AiTransactionType> = {
	income: 'pemasukan',
	expense: 'pengeluaran',
	sale: 'penjualan',
	pemasukan: 'pemasukan',
	pengeluaran: 'pengeluaran',
	penjualan: 'penjualan'
};

const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;
const MAX_DESKRIPSI = 500;
const MAX_ID = 200;
const MAX_NAMA = 100;

export interface ValidatedCreateTransaction {
	kind: 'create_transaction';
	type: AiTransactionType;
	amount: number;
	deskripsi: string;
	category: unknown;
	products: unknown[];
	customerName: string | null;
	metode_bayar: string | null;
}

export interface ValidatedUpdateTransaction {
	kind: 'update_transaction';
	id: string;
	type: AiTransactionType;
	amount: number;
	deskripsi: string;
	category: unknown;
}

export interface ValidatedCreateCategory {
	kind: 'create_category';
	nama: string;
	deskripsi: string | null;
}

export type ValidatedRecommendation =
	ValidatedCreateTransaction | ValidatedUpdateTransaction | ValidatedCreateCategory;

export type RecommendationValidation =
	{ ok: true; value: ValidatedRecommendation } | { ok: false; reason: string };

function cleanText(value: unknown, max: number): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim().slice(0, max);
	return text ? text : null;
}

function cleanAmount(value: unknown): number | null {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_SAFE_AMOUNT) return null;
	return amount;
}

function cleanType(value: unknown): AiTransactionType | null {
	if (typeof value !== 'string') return null;
	return TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
}

function cleanId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const id = value.trim().slice(0, MAX_ID);
	return id ? id : null;
}

function cleanProducts(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function validateRecommendation(rec: unknown): RecommendationValidation {
	if (!rec || typeof rec !== 'object') {
		return { ok: false, reason: 'Rekomendasi bukan object.' };
	}
	const source = rec as Record<string, unknown>;
	if (
		typeof source.action !== 'string' ||
		!(AI_RECOMMENDATION_ACTIONS as readonly string[]).includes(source.action)
	) {
		return {
			ok: false,
			reason: `Action tidak didukung: ${String(source.action ?? '').slice(0, 40)}`
		};
	}
	const data = (source.data ?? {}) as Record<string, unknown>;

	if (source.action === 'create_category') {
		const nama = cleanText(data.nama, MAX_NAMA);
		if (!nama) return { ok: false, reason: 'Nama kategori tidak valid.' };
		const deskripsi = cleanText(data.deskripsi, MAX_DESKRIPSI);
		return { ok: true, value: { kind: 'create_category', nama, deskripsi } };
	}

	// create_transaction + update_transaction: allowlist ketat.
	// Field model lain (id/branch/transaction_id/…) sengaja dibuang,
	// kecuali id target update yang divalidasi di bawah.
	const type = cleanType(data.type);
	if (!type) return { ok: false, reason: 'Type transaksi tidak valid.' };
	const amount = cleanAmount(data.amount);
	if (amount === null) return { ok: false, reason: 'Amount transaksi tidak valid.' };
	const deskripsi = cleanText(data.deskripsi, MAX_DESKRIPSI);
	if (!deskripsi) return { ok: false, reason: 'Deskripsi transaksi tidak valid.' };

	if (source.action === 'update_transaction') {
		const id = cleanId(data.id);
		if (!id) return { ok: false, reason: 'ID target update tidak valid.' };
		return {
			ok: true,
			value: { kind: 'update_transaction', id, type, amount, deskripsi, category: data.category }
		};
	}
	const customerName = cleanText(data.customerName, MAX_DESKRIPSI);
	const metodeRaw =
		typeof data.metode_bayar === 'string' ? data.metode_bayar.trim().toLowerCase() : '';
	return {
		ok: true,
		value: {
			kind: 'create_transaction',
			type,
			amount,
			deskripsi,
			category: data.category,
			products: cleanProducts(data.products),
			customerName,
			metode_bayar: metodeRaw === 'non-tunai' ? 'non-tunai' : metodeRaw === 'tunai' ? 'tunai' : null
		}
	};
}

export const AI_ACTION_LABEL: Record<AiRecommendationAction, string> = {
	create_transaction: 'Buat transaksi',
	update_transaction: 'Ubah transaksi',
	create_category: 'Buat kategori'
};
