import type { AiRecommendation, AutoApplyResult } from '$lib/types/ai';
import { AI_ACTION_LABEL, validateRecommendation } from '$lib/utils/aiRecommendationSchema';
import { decodeLedgerRevision } from '$lib/utils/ledgerRevision';
import { decodeDecimalNumber, normalizeMoney } from '$lib/utils/currency';
import { getOfflineSessionRevision, readOfflineSessionSnapshot } from '$lib/auth/offlineSession';
import { resolveLedgerCategory } from '$lib/utils/ledgerCategory';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { userRole } from '$lib/stores/userRole.svelte';
import { refreshBus } from '$lib/utils/refreshBus';
import { parseApiError } from '$lib/utils/errorHandling';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { productService } from '$lib/services/productService';

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
	revision: number;
}

export interface LedgerConsentBefore {
	readonly id: string;
	readonly revision: number;
	readonly nominal: number;
	readonly tipe: string;
	readonly jenis: string;
	readonly deskripsi: string;
	readonly waktu: string;
}

export interface RecommendationConsent {
	readonly recommendations: readonly AiRecommendation[];
	readonly updates: Readonly<Record<string, LedgerConsentBefore>>;
	readonly rejected: Readonly<Record<string, string>>;
}

function freezeConsent<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const child of Object.values(value)) freezeConsent(child);
		Object.freeze(value);
	}
	return value;
}

function consentContext(): string {
	const session = readOfflineSessionSnapshot();
	if (
		!session ||
		typeof session.user.id !== 'string' ||
		session.user.branch !== selectedBranch.value ||
		!['pemilik', 'kasir', 'admin'].includes(String(session.user.role))
	) {
		throw new Error(
			'Sesi atau cabang berubah. Muat ulang rekomendasi sebelum memberi persetujuan.'
		);
	}
	return JSON.stringify([
		selectedBranch.value,
		selectedBranch.contextEpoch,
		session.user.id,
		session.user.role,
		session.expiresAt,
		getOfflineSessionRevision()
	]);
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
	private readonly consents = new WeakMap<
		RecommendationConsent,
		{ context: string; active: boolean }
	>();

	async prepareRecommendations(
		recommendations: readonly AiRecommendation[]
	): Promise<RecommendationConsent> {
		const context = consentContext();
		const branch = selectedBranch.value;
		if (recommendations.length > 50)
			throw new Error('Terlalu banyak rekomendasi untuk satu persetujuan.');
		const normalized: AiRecommendation[] = [];
		const updates: Record<string, LedgerConsentBefore> = Object.create(null);
		const rejected: Record<string, string> = Object.create(null);
		const ids = new Set<string>();
		for (const rec of recommendations) {
			if (!rec.id || ids.has(rec.id))
				throw new Error('Identitas rekomendasi tidak valid atau ganda.');
			ids.add(rec.id);
			const validation = validateRecommendation({ action: rec.action, data: rec.data });
			if (!validation.ok) throw new Error(`Rekomendasi tidak valid: ${validation.reason}`);
			const value = validation.value;
			normalized.push({
				...structuredClone(rec),
				title: AI_ACTION_LABEL[value.kind],
				deskripsi: value.kind === 'create_category' ? value.nama : value.deskripsi,
				data: structuredClone(value)
			});
			if (value.kind !== 'update_transaction') continue;
			if (value.type === 'penjualan') {
				rejected[rec.id] = 'Koreksi penjualan POS wajib melalui alur POS, bukan update manual.';
				continue;
			}
			const res = await apiFetch(
				`/api/buku-kas?${new URLSearchParams({ branch, id: value.id, limit: '1' })}`
			);
			await throwIfNotOk(res, 'Gagal membaca transaksi sebelum persetujuan');
			const rows: unknown = await res.json();
			const row =
				Array.isArray(rows) && rows.length === 1 ? (rows[0] as Record<string, unknown>) : null;
			const revision = decodeLedgerRevision(row?.revision);
			const amount = decodeDecimalNumber(row?.nominal);
			if (
				!row ||
				row.id !== value.id ||
				row.cabang_id !== branch ||
				!['catat', 'stok'].includes(String(row.sumber)) ||
				revision === null ||
				amount === null ||
				amount < 0 ||
				amount > Number.MAX_SAFE_INTEGER ||
				typeof row.deskripsi !== 'string' ||
				typeof row.waktu !== 'string' ||
				!['in', 'out'].includes(String(row.tipe)) ||
				!['pendapatan_usaha', 'beban_usaha', 'lainnya'].includes(String(row.jenis))
			) {
				rejected[rec.id] =
					'Target transaksi tidak tersedia atau bukan transaksi manual yang valid.';
				continue;
			}
			updates[rec.id] = {
				id: value.id,
				revision,
				nominal: normalizeMoney(amount),
				tipe: String(row.tipe),
				jenis: String(row.jenis),
				deskripsi: row.deskripsi,
				waktu: row.waktu
			};
		}
		if (consentContext() !== context)
			throw new Error('Konteks berubah saat membaca transaksi. Tinjau ulang rekomendasi.');
		const consent = freezeConsent({ recommendations: normalized, updates, rejected });
		this.consents.set(consent, { context, active: true });
		return consent;
	}

	cancelConsent(consent: RecommendationConsent | null): void {
		if (consent) this.consents.delete(consent);
	}

	public static getInstance(): AutoApplyService {
		if (!AutoApplyService.instance) {
			AutoApplyService.instance = new AutoApplyService();
		}
		return AutoApplyService.instance;
	}

	async applyRecommendations(
		recommendations: readonly AiRecommendation[],
		consent?: RecommendationConsent
	): Promise<AutoApplyResult> {
		const result: AutoApplyResult = {
			success: true,
			appliedRecommendations: [],
			errors: [],
			message: ''
		};

		try {
			const prepared = consent ? this.consents.get(consent) : undefined;
			const checkConsent = () => {
				if (
					consent &&
					(!prepared ||
						this.consents.get(consent) !== prepared ||
						!prepared.active ||
						consentContext() !== prepared.context)
				)
					throw new Error(
						'Persetujuan dibatalkan atau konteks berubah. Tinjau ulang sebelum menerapkan.'
					);
			};
			checkConsent();
			const inputs = consent ? consent.recommendations : recommendations;
			if (inputs.some((r) => r.action === 'update_transaction') && !consent)
				throw new Error('Update memerlukan target dan revisi yang ditinjau sebelum persetujuan.');
			// Retry parsial aman: lewati ID yang sudah tercatat berhasil (persisted per cabang),
			// hanya item gagal/unknown yang diulang. Dedup server via stable intent ID
			// menutup retry ambigu (respons hilang sesudah commit).
			const fresh = this.deduplicateRecommendations(inputs).filter(
				(r) => !this.isAlreadyApplied(r.id)
			);
			const skipped = inputs.length - fresh.length;

			for (const recommendation of fresh) {
				try {
					checkConsent();
					if (consent?.rejected[recommendation.id]) {
						throw new Error(consent.rejected[recommendation.id]);
					}
					const branch = selectedBranch.value;
					const note = await this.applySingleRecommendation(
						recommendation,
						consent?.updates[recommendation.id]
					);
					this.markApplied(recommendation.id, branch);
					result.appliedRecommendations.push(recommendation.id);
					if (note) result.message += (result.message ? ' ' : '') + note;
				} catch (error) {
					result.errors.push(`Gagal menerapkan ${recommendation.title}: ${error}`);
				}
			}

			if (result.appliedRecommendations.length > 0) {
				result.message =
					`Berhasil menerapkan ${result.appliedRecommendations.length} rekomendasi. Transaksi telah tercatat di laporan dan riwayat.` +
					(result.message ? ` ${result.message}` : '');
			}
			if (skipped > 0) {
				result.message += `${result.message ? ' ' : ''}${skipped} rekomendasi sudah diterapkan sebelumnya, dilewati.`;
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

	private appliedKey(capturedBranch?: string): string {
		try {
			const branch = String(capturedBranch ?? selectedBranch.value ?? 'default').toLowerCase();
			return `ai_applied_${branch}`;
		} catch {
			return 'ai_applied_default';
		}
	}

	private readApplied(): Set<string> {
		try {
			const raw = localStorage.getItem(this.appliedKey());
			const arr = raw ? (JSON.parse(raw) as unknown) : [];
			return new Set(
				Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string') : []
			);
		} catch {
			return new Set();
		}
	}

	private isAlreadyApplied(id: string): boolean {
		try {
			return this.readApplied().has(id);
		} catch {
			return false;
		}
	}

	private markApplied(id: string, branch: string): void {
		try {
			const raw: unknown = JSON.parse(localStorage.getItem(this.appliedKey(branch)) ?? '[]');
			const set = new Set(
				Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
			);
			set.add(id);
			localStorage.setItem(this.appliedKey(branch), JSON.stringify([...set].slice(-500)));
		} catch {
			// Local applied-ID cache is best-effort; stable server idempotency keys prevent duplicates.
		}
	}

	private async applySingleRecommendation(
		recommendation: AiRecommendation,
		before?: LedgerConsentBefore
	): Promise<string | void> {
		// AUD-033: validasi skema yang sama dengan parse; field model di luar
		// allowlist (id/branch/transaction_id/…) tak pernah sampai mutasi.
		const validation = validateRecommendation({
			action: recommendation.action,
			data: recommendation.data
		});
		if (!validation.ok) throw new Error(`Rekomendasi tidak valid: ${validation.reason}`);
		const validated = validation.value;
		switch (validated.kind) {
			case 'create_transaction':
				return this.createTransaction(
					{
						type: validated.type,
						amount: validated.amount,
						deskripsi: validated.deskripsi,
						category: validated.category as string | undefined,
						products: validated.products as Array<Record<string, unknown>>,
						customerName: validated.customerName ?? undefined,
						metode_bayar: validated.metode_bayar ?? undefined
					},
					recommendation.id
				);
			case 'update_transaction':
				if (!before || before.id !== validated.id) throw new Error('Target update belum ditinjau.');
				await this.updateTransaction({
					revision: before.revision,
					id: validated.id,
					type: validated.type,
					amount: validated.amount,
					deskripsi: validated.deskripsi,
					category: validated.category as string | undefined
				});
				return;
			case 'create_category':
				await this.createCategory({
					nama: validated.nama,
					deskripsi: validated.deskripsi ?? undefined
				});
				return;
		}
	}

	private async createTransaction(
		data: TransactionData,
		recommendationId?: string
	): Promise<string | void> {
		if (!data.type) throw new Error('Type transaksi tidak valid');
		if (!data.amount || data.amount <= 0)
			throw new Error('Amount transaksi tidak valid atau kosong');
		if (!data.deskripsi || data.deskripsi.trim() === '')
			throw new Error('Description transaksi tidak valid atau kosong');

		if (data.type === 'penjualan') {
			return this.createPenjualanViaQuote(data, recommendationId || 'tanpa-id');
		}

		const branch = selectedBranch.value;
		// [CATATAN]: 'penjualan' sudah ditangani & return di atas, jadi sisanya cuma pemasukan/pengeluaran
		const tipe = data.type === 'pemasukan' ? 'in' : 'out';
		// AUD-032: arah saja tak menentukan jenis usaha. Ambigu = tolak
		// eksplisit agar pemilik konfirmasi manual, bukan default diam.
		const resolved = resolveLedgerCategory({
			type: data.type,
			category: data.category,
			deskripsi: data.deskripsi
		});
		if ('needsConfirmation' in resolved) {
			throw new Error(`Kategori perlu konfirmasi: ${resolved.reason}`);
		}
		// Intent stabil per rekomendasi: retry aman via dedup id server.
		const transactionId = `ai-manual-${recommendationId || crypto.randomUUID()}`;

		const payload = {
			id: transactionId,
			tipe,
			nominal: Number(data.amount),
			deskripsi: String(data.deskripsi).trim(),
			jenis: resolved.jenis,
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
	): Promise<string> {
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
		const cekNominal = (total: number) => {
			if (Number.isFinite(modelAmount) && modelAmount > 0 && modelAmount !== total) {
				throw new Error(
					`Total quote Rp ${total.toLocaleString('id-ID')} berbeda dari rekomendasi Rp ${modelAmount.toLocaleString('id-ID')}. Tinjau di POS sebelum mencatat.`
				);
			}
		};
		cekNominal(quote.total_amount);

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
				if (!quote.quote_token || typeof quote.total_amount !== 'number')
					throw new Error('Quote harga tidak valid');
				// Requote WAJIB divalidasi ulang; nominal berubah perlu review kembali.
				cekNominal(quote.total_amount);
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
		// Kontrak kas eksplisit: tunai dicatat lunas persis total quote.
		// Pastikan uang tunai benar-benar diterima sebelum menandai sukses.
		return `Penjualan Rp ${Number(quote.total_amount).toLocaleString('id-ID')} tercatat lunas ${metode === 'tunai' ? 'tunai' : 'non-tunai'} sesuai quote.`;
	}

	private async updateTransaction(data: UpdateTransactionData): Promise<void> {
		if (!data.id) throw new Error('ID transaksi diperlukan untuk update');
		if (!data.amount || !Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0)
			throw new Error('Amount transaksi tidak valid atau kosong');
		if (!data.deskripsi || String(data.deskripsi).trim() === '')
			throw new Error('Description transaksi tidak valid atau kosong');
		const branch = selectedBranch.value;
		const payload: Record<string, unknown> = {
			revision: data.revision,
			tipe: data.type === 'pemasukan' ? 'in' : 'out',
			nominal: data.amount,
			deskripsi: data.deskripsi
		};
		// AUD-032/033: kategori model wajib valid; absen = jangan sentuh
		// jenis existing (bukan default diam / mentah ke server).
		if (data.category !== undefined) {
			const resolved = resolveLedgerCategory({
				type: data.type,
				category: data.category,
				deskripsi: data.deskripsi
			});
			if ('needsConfirmation' in resolved) {
				throw new Error(`Kategori perlu konfirmasi: ${resolved.reason}`);
			}
			payload.jenis = resolved.jenis;
		}

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
		const nama = String(data.nama || '').trim();
		if (!nama) throw new Error('Nama kategori tidak valid');
		// Idempoten: kategori nama sama dianggap sudah diterapkan.
		const existing = (await productService.getCategories()) as Array<{ nama?: string }>;
		if (
			existing.some(
				(c) =>
					String(c.nama || '')
						.trim()
						.toLowerCase() === nama.toLowerCase()
			)
		)
			return;
		const res = await apiFetch('/api/kategori', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				branch,
				payload: { id: crypto.randomUUID(), nama, deskripsi: data.deskripsi }
			})
		});

		await throwIfNotOk(res, 'Gagal membuat kategori');
	}

	private deduplicateRecommendations(
		recommendations: readonly AiRecommendation[]
	): AiRecommendation[] {
		const seen = new Set<string>();
		return recommendations.filter((rec) => {
			const data = rec.data as Record<string, unknown>;
			const key = `${rec.action}_${rec.action === 'update_transaction' ? data?.id : ''}_${data?.amount}_${data?.type}_${data?.deskripsi}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}
}
