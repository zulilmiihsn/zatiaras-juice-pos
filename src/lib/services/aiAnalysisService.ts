import type { TransactionAnalysis, DetectedTransaction, AiRecommendation } from '$lib/types/ai';
import { validateRecommendation } from '$lib/utils/aiRecommendationSchema';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import {
	getApiErrorMessageFromResponse,
	reportApiFailureFromResponse
} from '$lib/utils/errorHandling';
import { formatRupiah } from '$lib/utils/currency';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';

export class AiAnalysisService {
	private static instance: AiAnalysisService;

	public static getInstance(): AiAnalysisService {
		if (!AiAnalysisService.instance) {
			AiAnalysisService.instance = new AiAnalysisService();
		}
		return AiAnalysisService.instance;
	}

	/**
	 * Menganalisis teks transaksi dari user
	 */
	async analyzeTransaction(text: string): Promise<TransactionAnalysis> {
		try {
			// [CATATAN]: Get current branch from store
			const currentBranch = selectedBranch.value || 'default';

			// [CATATAN]: Kirim ke backend AI untuk analisis
			const response = await fetchWithCsrfRetry('/api/aichat?action=analyze', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-branch': currentBranch
				},
				body: JSON.stringify({ text })
			});

			if (!response.ok) {
				await reportApiFailureFromResponse(response, '/api/aichat?action=analyze');
				throw new Error(
					await getApiErrorMessageFromResponse(response, 'Gagal menganalisis transaksi')
				);
			}

			const data = await response.json();
			return this.parseAnalysisResponse(data, text);
		} catch (error) {
			throw error;
		}
	}

	/**
	 * Parse response dari AI menjadi struktur yang dapat digunakan
	 */
	private parseAnalysisResponse(
		data: Record<string, unknown>,
		originalText: string
	): TransactionAnalysis {
		const detectedTransactions: DetectedTransaction[] = [];
		const recommendations: AiRecommendation[] = [];

		// [CATATAN]: Parse detected transactions
		if (data.transactions && Array.isArray(data.transactions)) {
			data.transactions.forEach((tx: Record<string, unknown>) => {
				detectedTransactions.push({
					type: this.mapTransactionType(String(tx.type ?? '')),
					amount: Number(tx.amount) || 0,
					deskripsi: String(tx.deskripsi || ''),
					category: tx.category as string | undefined,
					confidence: Number(tx.confidence) || 0.8,
					products: (tx.products as unknown[]) || []
				});
			});
		}

		// [CATATAN]: Generate recommendations - hanya jika AI tidak mengirim rekomendasi langsung
		const aiRecs = data.recommendations as Array<Record<string, unknown>>;
		if (!aiRecs || aiRecs.length === 0) {
			detectedTransactions.forEach((tx, index) => {
				if (tx.type !== 'unknown' && tx.amount > 0) {
					const recommendationData = {
						type: tx.type,
						amount: tx.amount,
						deskripsi: tx.deskripsi,
						category: tx.category,
						products: tx.products || [] // Include products data
					};

					// AUD-033: samakan gerbang validasi dengan rekomendasi model.
					if (
						!validateRecommendation({ action: 'create_transaction', data: recommendationData }).ok
					)
						return;
					recommendations.push({
						id: `rec_${Date.now()}_${index}`,
						action: 'create_transaction',
						title: `Catat ${this.getTransactionTypeLabel(tx.type)}`,
						deskripsi: `${this.getTransactionTypeLabel(tx.type)} sebesar Rp ${formatRupiah(tx.amount)} - ${tx.deskripsi}`,
						data: recommendationData,
						priority: tx.confidence > 0.8 ? 'high' : 'medium'
					});
				}
			});
		} else {
			// [CATATAN]: Gunakan rekomendasi dari AI langsung
			aiRecs.forEach((rec: Record<string, unknown>, index: number) => {
				// [CATATAN]: Jika AI tidak mengirim data, gunakan detected transactions
				let recommendationData = (rec.data as Record<string, unknown>) || {};

				// [CATATAN]: Jika data kosong, coba ambil dari detected transactions
				if (!recommendationData.type && detectedTransactions.length > 0) {
					const tx = detectedTransactions[index] || detectedTransactions[0];
					recommendationData = {
						type: tx.type,
						amount: tx.amount,
						deskripsi: tx.deskripsi,
						category: tx.category,
						products: tx.products || [] // Include products data
					};
				}

				// AUD-033: validasi skema runtime; rekomendasi malformed
				// dibuang sebelum sampai consent/apply.
				const action = (rec.action as unknown as string) || 'create_transaction';
				const title =
					typeof rec.title === 'string' && rec.title.trim() !== ''
						? rec.title.trim().slice(0, 200)
						: `Rekomendasi ${index + 1}`;
				const priority =
					rec.priority === 'high' || rec.priority === 'low' ? rec.priority : 'medium';
				const validation = validateRecommendation({ action, data: recommendationData });
				if (!validation.ok) return;
				const validated = validation.value;
				recommendations.push({
					id: `rec_${Date.now()}_${index}`,
					action:
						validated.kind === 'create_category'
							? 'create_category'
							: validated.kind === 'update_transaction'
								? 'update_transaction'
								: 'create_transaction',
					title,
					deskripsi: (rec.deskripsi as unknown as string) || '',
					data:
						validated.kind === 'create_category'
							? { nama: validated.nama, deskripsi: validated.deskripsi }
							: validated.kind === 'update_transaction'
								? {
										id: validated.id,
										type: validated.type,
										amount: validated.amount,
										deskripsi: validated.deskripsi,
										category: validated.category
									}
								: {
										type: validated.type,
										amount: validated.amount,
										deskripsi: validated.deskripsi,
										category: validated.category,
										products: validated.products,
										customerName: validated.customerName,
										metode_bayar: validated.metode_bayar
									},
					priority
				});
			});
		}

		return {
			id: `analysis_${Date.now()}`,
			originalText,
			detectedTransactions,
			recommendations,
			confidence: (data.confidence as number) || 0.7
		};
	}

	/**
	 * Map transaction type dari AI ke enum yang digunakan
	 */
	private mapTransactionType(
		aiType: string
	): 'pemasukan' | 'pengeluaran' | 'penjualan' | 'unknown' {
		const typeMap: { [key: string]: 'pemasukan' | 'pengeluaran' | 'penjualan' | 'unknown' } = {
			income: 'pemasukan',
			expense: 'pengeluaran',
			sale: 'penjualan',
			pemasukan: 'pemasukan',
			pengeluaran: 'pengeluaran',
			penjualan: 'penjualan',
			unknown: 'unknown'
		};

		return typeMap[aiType.toLowerCase()] || 'unknown';
	}

	/**
	 * Get label untuk transaction type
	 */
	private getTransactionTypeLabel(type: string): string {
		const labels: { [key: string]: string } = {
			pemasukan: 'Pemasukan',
			pengeluaran: 'Pengeluaran',
			penjualan: 'Penjualan POS',
			unknown: 'Transaksi'
		};

		return labels[type] || 'Transaksi';
	}

	/**
	 * Generate response text untuk user
	 */
	generateResponseText(analysis: TransactionAnalysis): string {
		if (analysis.detectedTransactions.length === 0) {
			return 'Saya tidak dapat mengidentifikasi transaksi dari cerita Anda. Bisakah Anda memberikan detail yang lebih spesifik tentang transaksi yang ingin dicatat?';
		}

		let response = 'Saya telah menganalisis cerita Anda dan menemukan:\n\n';

		analysis.detectedTransactions.forEach((tx, index) => {
			response += `${index + 1}. ${this.getTransactionTypeLabel(tx.type)}: Rp ${formatRupiah(tx.amount)}`;
			if (tx.deskripsi) {
				response += ` - ${tx.deskripsi}`;
			}
			response += '\n';
		});

		// [CATATAN]: Hanya tampilkan rekomendasi jika ada transaksi yang teridentifikasi
		if (analysis.recommendations.length > 0) {
			response += '\nRekomendasi saya:\n';
			analysis.recommendations.forEach((rec, index) => {
				response += `${index + 1}. ${rec.title}\n`;
			});

			response += '\nApakah Anda ingin saya menerapkan rekomendasi ini secara otomatis?';
		}

		return response;
	}
}
