import type { AiRecommendation, AutoApplyResult } from '$lib/types/ai';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
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
				await this.createTransaction(recommendation.data as TransactionData);
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

	private async createTransaction(data: TransactionData): Promise<void> {
		if (!data.type) throw new Error('Type transaksi tidak valid');
		if (!data.amount || data.amount <= 0)
			throw new Error('Amount transaksi tidak valid atau kosong');
		if (!data.deskripsi || data.deskripsi.trim() === '')
			throw new Error('Description transaksi tidak valid atau kosong');

		if (data.type === 'penjualan') {
			const products = Array.isArray(data.products) && data.products.length ? data.products : [];
			const res = await apiFetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					idempotency_key: crypto.randomUUID(),
					nama_pelanggan: data.customerName || null,
					metode_bayar: data.metode_bayar || 'tunai',
					cash_received: Number(data.amount),
					items: products.length
						? products.map((product: Record<string, unknown>) => ({
								product_id: product.id || null,
								nama_kustom: product.id ? null : product.nama || data.deskripsi,
								custom_price: product.id ? null : Number(product.harga || data.amount),
								jumlah: product.quantity || product.jumlah || 1,
								add_on_ids: ((product.addOns as Array<{ id?: unknown }>) || [])
									.map((addOn) => addOn.id)
									.filter(Boolean)
							}))
						: [
								{
									product_id: null,
									nama_kustom: String(data.deskripsi).trim(),
									custom_price: Number(data.amount),
									jumlah: 1,
									add_on_ids: []
								}
							]
				})
			});

			await throwIfNotOk(res, 'Gagal menyimpan transaksi POS');
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
