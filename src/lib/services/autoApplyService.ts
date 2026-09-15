import type { AiRecommendation, AutoApplyResult } from '$lib/types/ai';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { userRole } from '$lib/stores/userRole.svelte';
import { refreshBus } from '$lib/utils/refreshBus';
import { parseApiError } from '$lib/utils/errorHandling';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';

interface TransactionData {
	type: string;
	amount: number;
	deskripsi: string;
	customerName?: string;
	metode_bayar?: string;
	products?: Array<Record<string, unknown>>;
	category?: string;
}

interface UpdateTransactionData {
	id: string;
	type: string;
	amount: number;
	deskripsi: string;
	category?: string;
}

interface CategoryData {
	nama: string;
	deskripsi?: string;
}

const apiFetch = (path: string, init?: RequestInit) => fetchWithCsrfRetry(path, init);

async function throwIfNotOk(res: Response, label: string): Promise<void> {
	if (!res.ok) {
		const detail = await parseApiError(res, res.statusText || `HTTP ${res.status}`);
		throw new Error(`${label}: ${detail}`);
	}
}

export class AutoApplyService {
	private static instance: AutoApplyService;

	public static getInstance(): AutoApplyService {
		if (!AutoApplyService.instance) {
			AutoApplyService.instance = new AutoApplyService();
		}
		return AutoApplyService.instance;
	}

	async applyRecommendations(recommendations: AiRecommendation[]): Promise<AutoApplyResult> {
		const result: AutoApplyResult = {
			success: true,
			appliedRecommendations: [],
			errors: [],
			message: ''
		};

		try {
			const uniqueRecommendations = this.deduplicateRecommendations(recommendations);

			for (const recommendation of uniqueRecommendations) {
				try {
					await this.applySingleRecommendation(recommendation);
					result.appliedRecommendations.push(recommendation.id);
				} catch (error) {
					result.errors.push(`Gagal menerapkan ${recommendation.title}: ${error}`);
				}
			}

			if (result.appliedRecommendations.length > 0) {
				result.message = `Berhasil menerapkan ${result.appliedRecommendations.length} rekomendasi. Transaksi telah tercatat di laporan dan riwayat.`;
			}

			if (result.errors.length > 0) {
				result.success = false;
				result.message += `. ${result.errors.length} rekomendasi gagal diterapkan.`;
			}
		} catch (error) {
			result.success = false;
			result.message = 'Terjadi kesalahan saat menerapkan rekomendasi';
			result.errors.push(error instanceof Error ? error.message : String(error));
		}

		return result;
	}

	private async applySingleRecommendation(recommendation: AiRecommendation): Promise<void> {
		switch (recommendation.action) {
			case 'create_transaction':
				await this.createTransaction(recommendation.data as TransactionData, recommendation.id);
				break;
			case 'update_transaction':
				await this.updateTransaction(recommendation.data as UpdateTransactionData);
				break;
			case 'create_category':
				await this.createCategory(recommendation.data as CategoryData);
				break;
			default:
				throw new Error(`Action tidak didukung: ${recommendation.action}`);
		}
	}

	private async createTransaction(data: TransactionData, recommendationId?: string): Promise<void> {
		if (!data.type) throw new Error('Type transaksi tidak valid');
		if (!data.amount || data.amount <= 0)
			throw new Error('Amount transaksi tidak valid atau kosong');
		if (!data.deskripsi || data.deskripsi.trim() === '')
			throw new Error('Description transaksi tidak valid atau kosong');

		if (data.type === 'penjualan') {
			await this.createPenjualanViaQuote(data, recommendationId || 'tanpa-id');
			return;
		}

		const branch = selectedBranch.value;
		// [CATATAN]: 'penjualan' sudah ditangani & return di atas, jadi sisanya cuma pemasukan/pengeluaran
		const tipe = data.type === 'pemasukan' ? 'in' : 'out';
		const transactionId = crypto.randomUUID();

		const payload = {
			id: transactionId,
			tipe,
			nominal: Number(data.amount),
			deskripsi: String(data.deskripsi).trim(),
			jenis: data.category || this.getDefaultCategory(data.type as string),
			sumber: 'catat',
			waktu: new Date().toISOString(),
			metode_bayar: 'tunai',
			transaction_id: transactionId
		};

		const res = await apiFetch('/api/buku-kas', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ branch, payload })
		});

		await throwIfNotOk(res, 'Gagal menyimpan transaksi');

		if (typeof window !== 'undefined') {
			try {
				window.dispatchEvent(
					new CustomEvent('ai-recommendations-applied', { detail: { success: true } })
				);
				refreshBus.emit('laporan');
				refreshBus.emit('riwayat');
			} catch {
				/* sinyal refresh UI best-effort */
			}
		}
	}

	private normalisasiItemPenjualan(data: TransactionData) {
		const cleanStr = (v: unknown, max: number): string | null => {
			if (typeof v !== 'string') return null;
			const s = v.trim().slice(0, max);
			return s ? s : null;
		};
		const toQty = (v: unknown): number => {
			const n = Number(v);
			if (!Number.isInteger(n) || n <= 0 || n > 99)
				throw new Error('Qty item rekomendasi tidak valid (1-99)');
			return n;
		};
		const raw = Array.isArray(data.products) && data.products.length ? data.products : null;
		const items = (raw ?? [null]).map((p) => {
			const product = (p ?? {}) as Record<string, unknown>;
			const productId =
				product.id != null && String(product.id).trim() !== '' ? String(product.id) : null;
			const addOns = product.addOns;
			const add_on_ids = (Array.isArray(addOns) ? addOns : [])
				.map((a) => (a && typeof a === 'object' ? (a as { id?: unknown }).id : a))
				.map((id) => String(id ?? '').trim())
				.filter(Boolean);
			if (!productId) {
				// Item custom: harga dari model TIDAK dipakai; pemilik isi harga valid.
				if (userRole.value !== 'pemilik')
					throw new Error('Item custom rekomendasi hanya boleh dibuat pemilik');
				const customPrice = Number(product.harga);
				if (!Number.isFinite(customPrice) || customPrice <= 0)
					throw new Error('Harga item custom rekomendasi tidak valid');
				return {
					product_id: null,
					nama_kustom: cleanStr(product.nama, 80) || String(data.deskripsi).trim().slice(0, 80),
					custom_price: customPrice,
					jumlah: toQty(product.quantity ?? product.jumlah ?? 1),
					add_on_ids,
					porsi: 'reguler',
					gula: cleanStr(product.gula, 30),
					es: cleanStr(product.es, 30),
					catatan: cleanStr(product.catatan, 240)
				};
			}
			return {
				product_id: productId,
				nama_kustom: null,
				custom_price: null,
				jumlah: toQty(product.quantity ?? product.jumlah ?? 1),
				add_on_ids,
				porsi: (() => {
					const porsi = String(product.porsi || 'reguler').toLowerCase();
					return porsi === 'jumbo' ? 'jumbo' : 'reguler';
				})(),
				gula: cleanStr(product.gula, 30),
				es: cleanStr(product.es, 30),
				catatan: cleanStr(product.catatan, 240)
			};
		});
		if (!items.length) throw new Error('Rekomendasi penjualan tanpa item valid');
		return items;
	}

	/**
	 * Alur quote: normalisasi -> POST quote (CSRF) -> bandingkan total quote
	 * dengan nominal rekomendasi -> commit item YANG SAMA dengan quote.
	 * Beda nominal = butuh review, jangan catat otomatis. Key idempoten stabil
	 * per rekomendasi (bukan dari model); expiry ditangani requote sekali.
	 */
	private async createPenjualanViaQuote(
		data: TransactionData,
		recommendationId: string
	): Promise<void> {
		const items = this.normalisasiItemPenjualan(data);
		const metode =
			String(data.metode_bayar || 'tunai').toLowerCase() === 'non-tunai' ? 'non-tunai' : 'tunai';
		// Key stabil per intent rekomendasi selama retry; bukan keluaran model.
		const intentKey = `ai-rekomendasi-${recommendationId}`;

		const mintaQuote = async () => {
			const res = await apiFetch('/api/pos/quote', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			await throwIfNotOk(res, 'Gagal meminta quote harga');
			return (await res.json()) as { quote_token?: string; total_amount?: number };
		};

		let quote = await mintaQuote();
		if (!quote.quote_token || typeof quote.total_amount !== 'number')
			throw new Error('Quote harga tidak valid');

		const modelAmount = Number(data.amount);
		if (Number.isFinite(modelAmount) && modelAmount > 0 && modelAmount !== quote.total_amount) {
			throw new Error(
				`Total quote Rp ${quote.total_amount.toLocaleString('id-ID')} berbeda dari rekomendasi Rp ${modelAmount.toLocaleString('id-ID')}. Tinjau di POS sebelum mencatat.`
			);
		}

		const commit = async (quoteToken: string) => {
			const res = await apiFetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'online',
					quote_token: quoteToken,
					idempotency_key: intentKey,
					nama_pelanggan: data.customerName || null,
					metode_bayar: metode,
					// Uang diterima = total quote server, bukan nominal model.
					cash_received: quote.total_amount,
					items
				})
			});
			return res;
		};

		let res = await commit(quote.quote_token);
		if (res.status === 409) {
			const detail = await parseApiError(res, '').catch(() => '');
			if (/kedaluwarsa|quote/i.test(String(detail))) {
				quote = await mintaQuote();
				if (!quote.quote_token) throw new Error('Quote harga tidak valid');
				res = await commit(quote.quote_token);
			}
		}
		await throwIfNotOk(res, 'Gagal menyimpan transaksi POS');

		if (typeof window !== 'undefined') {
			try {
				window.dispatchEvent(
					new CustomEvent('ai-recommendations-applied', { detail: { success: true } })
				);
				refreshBus.emit('laporan');
				refreshBus.emit('riwayat');
			} catch {
				/* sinyal refresh UI best-effort */
			}
		}
	}

	private async updateTransaction(data: UpdateTransactionData): Promise<void> {
		if (!data.id) throw new Error('ID transaksi diperlukan untuk update');
		const branch = selectedBranch.value;
		const payload = {
			tipe: data.type === 'pemasukan' ? 'in' : 'out',
			nominal: data.amount,
			deskripsi: data.deskripsi,
			jenis: data.category
		};

		const res = await apiFetch('/api/buku-kas', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				branch,
				where: { id: data.id },
				payload
			})
		});

		await throwIfNotOk(res, 'Gagal mengupdate transaksi');
	}

	private async createCategory(data: CategoryData): Promise<void> {
		const branch = selectedBranch.value;
		const res = await apiFetch('/api/kategori', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				branch,
				payload: { id: crypto.randomUUID(), nama: data.nama, deskripsi: data.deskripsi }
			})
		});

		await throwIfNotOk(res, 'Gagal membuat kategori');
	}

	private getDefaultCategory(type: string): string {
		const map: Record<string, string> = {
			pemasukan: 'pendapatan_usaha',
			pengeluaran: 'beban_usaha',
			penjualan: 'pendapatan_usaha'
		};
		return map[type] || 'lainnya';
	}

	private deduplicateRecommendations(recommendations: AiRecommendation[]): AiRecommendation[] {
		const seen = new Set<string>();
		return recommendations.filter((rec) => {
			const data = rec.data as Record<string, unknown>;
			const key = `${rec.action}_${data?.amount}_${data?.type}_${data?.deskripsi}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}
}
