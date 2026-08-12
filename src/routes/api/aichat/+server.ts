import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { witaRangeToWitaQuery } from '$lib/utils/dateTime';
import { formatRupiah } from '$lib/utils/currency';
import { getD1Database, getDrizzleDb, normalizeBranch } from '$lib/server/branchResolver';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { requirePageAccess } from '$lib/server/pageAccess';
import { kategori, produk, tambahan } from '$lib/database/schema';
import { eq } from 'drizzle-orm';
import {
	buildIdentifyDataRequirementsPrompt,
	buildAnalyzeBusinessDataPrompt,
	buildAnalyzeTransactionTextPrompt
} from './prompts';
import {
	fetchReportData,
	aggregateMonthly,
	computeAnalytics,
	buildReportContext
} from './reportData';

// OpenRouter API configuration
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-chat';
const AI_WINDOW_MS = 15 * 60 * 1000;
const AI_MAX_REQUESTS = 30;
const OPENROUTER_TIMEOUT_MS = 15_000;
const MAX_REPORT_RANGE_DAYS = 732;

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface OpenRouterOpts {
	title: string;
	maxTokens: number;
	temperature: number;
	errorLabel: string;
}

/** Panggil OpenRouter chat-completion, kembalikan konten string (caller terapkan default/parse). */
async function callOpenRouter(
	apiKey: string,
	systemMessage: ChatMessage,
	opts: OpenRouterOpts
): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(OPENROUTER_API_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://zatiaraspos.com',
				'X-Title': opts.title
			},
			body: JSON.stringify({
				model: MODEL,
				messages: [systemMessage],
				max_tokens: opts.maxTokens,
				temperature: opts.temperature
			}),
			signal: controller.signal
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`${opts.errorLabel}: upstream timeout`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		throw new Error(`${opts.errorLabel}: ${response.status}`);
	}

	const data: unknown = await response.json();
	if (
		typeof data !== 'object' ||
		data === null ||
		!('choices' in data) ||
		!Array.isArray(data.choices) ||
		typeof data.choices[0] !== 'object' ||
		data.choices[0] === null ||
		!('message' in data.choices[0]) ||
		typeof data.choices[0].message !== 'object' ||
		data.choices[0].message === null ||
		!('content' in data.choices[0].message) ||
		typeof data.choices[0].message.content !== 'string'
	) {
		throw new Error(`${opts.errorLabel}: respons upstream tidak valid`);
	}
	return data.choices[0].message.content;
}

/** Bersihkan markdown code-fence (```json ... ```) dari output AI. */
function stripJsonFence(content: string): string {
	let clean = content.trim();
	if (clean.startsWith('```json')) {
		clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
	}
	if (clean.startsWith('```')) {
		clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
	}
	return clean;
}

// Util: format YYYY-MM-DD dalam zona WITA
function toYMDWita(date: Date): string {
	const d = new Date(date);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

type DataRequirements = {
	periode: { start: string; end: string; type: 'daily' | 'weekly' | 'monthly' | 'yearly' };
	jenisData: string[];
	prioritas: string;
	scope: string;
	reasoning: string;
};

const PERIOD_TYPES = new Set<DataRequirements['periode']['type']>([
	'daily',
	'weekly',
	'monthly',
	'yearly'
]);
const SAFE_AI_LABEL = /^[a-z0-9_-]{1,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value: unknown): Date | null {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function parseDataRequirements(value: unknown, fallbackDate: string): DataRequirements {
	if (typeof value !== 'object' || value === null) {
		throw new Error('output bukan object JSON');
	}
	const root = value as Record<string, unknown>;
	const periode =
		typeof root.periode === 'object' && root.periode !== null
			? (root.periode as Record<string, unknown>)
			: root;
	const startDate = parseIsoDate(periode.start ?? root.start) ?? parseIsoDate(fallbackDate)!;
	const endDate = parseIsoDate(periode.end ?? root.end) ?? parseIsoDate(fallbackDate)!;
	if (startDate > endDate) throw new Error('rentang tanggal terbalik');
	const rangeDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
	if (rangeDays > MAX_REPORT_RANGE_DAYS) {
		throw new Error(`rentang tanggal melebihi ${MAX_REPORT_RANGE_DAYS} hari`);
	}
	const typeValue = periode.type ?? root.type;
	const type =
		typeof typeValue === 'string' &&
		PERIOD_TYPES.has(typeValue as DataRequirements['periode']['type'])
			? (typeValue as DataRequirements['periode']['type'])
			: 'daily';
	const jenisData = Array.isArray(root.jenisData)
		? root.jenisData
				.filter((item): item is string => typeof item === 'string' && SAFE_AI_LABEL.test(item))
				.slice(0, 12)
		: [];
	const safeLabel = (candidate: unknown, fallback: string) =>
		typeof candidate === 'string' && SAFE_AI_LABEL.test(candidate) ? candidate : fallback;

	return {
		periode: {
			start: startDate.toISOString().slice(0, 10),
			end: endDate.toISOString().slice(0, 10),
			type
		},
		jenisData,
		prioritas: safeLabel(root.prioritas, 'general_analysis'),
		scope: safeLabel(root.scope, 'general_analysis'),
		reasoning:
			typeof root.reasoning === 'string'
				? root.reasoning.trim().slice(0, 500)
				: 'Kebutuhan data diidentifikasi berdasarkan pertanyaan user'
	};
}

// AI 1: Data Requirement Analyzer
async function identifyDataRequirements(
	question: string,
	apiKey: string
): Promise<DataRequirements> {
	// Hitung tanggal saat ini dalam WITA
	const now = new Date();
	const todayWita = toYMDWita(now);

	const systemMessage: ChatMessage = {
		role: 'system',
		content: buildIdentifyDataRequirementsPrompt(question, todayWita)
	};

	const content =
		(await callOpenRouter(apiKey, systemMessage, {
			title: 'Zatiaras POS - Data Requirement Analyzer',
			maxTokens: 500,
			temperature: 0.3,
			errorLabel: 'AI 1 Error'
		})) || '{}';

	try {
		const cleanContent = stripJsonFence(content);

		const parsed: unknown = JSON.parse(cleanContent);
		return parseDataRequirements(parsed, todayWita);
	} catch (error) {
		// Tidak ada fallback, langsung error
		throw new Error(`AI 1 gagal mengidentifikasi kebutuhan data: ${error}`);
	}
}

// AI 2: Business Analyst
async function analyzeBusinessData(
	question: string,
	reportData: string,
	dateRange: {
		start?: string;
		startFormatted?: string;
		end?: string;
		endFormatted?: string;
		type?: string;
		reasoning?: string;
		dataRequirements?: { jenisData?: string[]; prioritas?: string; scope?: string };
	},
	apiKey: string
): Promise<string> {
	const systemMessage: ChatMessage = {
		role: 'system',
		content: buildAnalyzeBusinessDataPrompt(question, reportData, dateRange)
	};

	return (
		(await callOpenRouter(apiKey, systemMessage, {
			title: 'Zatiaras POS - Business Analyst',
			maxTokens: 2000,
			temperature: 0.6,
			errorLabel: 'AI 2 Error'
		})) || 'Maaf, tidak dapat menghasilkan jawaban.'
	);
}

/**
 * Bangun teks daftar produk/harga untuk prompt AI — query LANGSUNG dari DB yang
 * sudah di-scope ke branch (bukan productAnalysisService yang client-coupled +
 * cache module-global tak ber-key-branch → bocor lintas cabang). Lihat P0-1.
 */
async function buildProductPromptData(
	db: ReturnType<typeof getDrizzleDb>,
	branch: ReturnType<typeof normalizeBranch>
): Promise<string> {
	const [products, cats, addOns] = await Promise.all([
		db
			.select({
				id: produk.id,
				nama: produk.nama,
				harga: produk.harga,
				kategori_id: produk.kategori_id,
				is_active: produk.is_active,
				ekstra_ids: produk.ekstra_ids
			})
			.from(produk)
			.where(eq(produk.cabang_id, branch)),
		db
			.select({ id: kategori.id, nama: kategori.nama })
			.from(kategori)
			.where(eq(kategori.cabang_id, branch)),
		db
			.select({
				id: tambahan.id,
				nama: tambahan.nama,
				harga: tambahan.harga,
				is_active: tambahan.is_active
			})
			.from(tambahan)
			.where(eq(tambahan.cabang_id, branch))
	]);

	const idsOf = (p: (typeof products)[number]) => (Array.isArray(p.ekstra_ids) ? p.ekstra_ids : []);

	let promptData = 'DAFTAR PRODUK DAN HARGA:\n\n';
	const byCategory = products.reduce(
		(acc, p) => {
			const name = cats.find((c) => c.id === p.kategori_id)?.nama || 'Lainnya';
			(acc[name] ||= []).push(p);
			return acc;
		},
		{} as Record<string, typeof products>
	);

	for (const [catName, items] of Object.entries(byCategory)) {
		promptData += `📂 ${catName.toUpperCase()}:\n`;
		for (const p of items) {
			if (!p.is_active) continue;
			promptData += `  • ${p.nama}: Rp ${formatRupiah(p.harga)}`;
			const pAddOns = addOns.filter((a) => a.is_active && idsOf(p).includes(a.id));
			if (pAddOns.length > 0) {
				promptData += `\n    Topping/Tambahan:`;
				for (const a of pAddOns) promptData += `\n      - ${a.nama}: Rp ${formatRupiah(a.harga)}`;
			}
			promptData += `\n`;
		}
		promptData += `\n`;
	}

	const standalone = addOns.filter(
		(a) => a.is_active && !products.some((p) => idsOf(p).includes(a.id))
	);
	if (standalone.length > 0) {
		promptData += `📂 TAMBAHAN/TOPPING STANDALONE:\n`;
		for (const a of standalone) promptData += `  • ${a.nama}: Rp ${formatRupiah(a.harga)}\n`;
		promptData += `\n`;
	}
	return promptData;
}

// AI 3: Transaction Analyzer
async function analyzeTransactionText(
	text: string,
	apiKey: string,
	productData = ''
): Promise<{
	transactions: Record<string, unknown>[];
	confidence: number;
	recommendations: Record<string, unknown>[];
}> {
	const systemMessage: ChatMessage = {
		role: 'system',
		content: buildAnalyzeTransactionTextPrompt(text, productData)
	};

	const content =
		(await callOpenRouter(apiKey, systemMessage, {
			title: 'Zatiaras POS - Transaction Analyzer',
			maxTokens: 1000,
			temperature: 0.3,
			errorLabel: 'AI 3 Error'
		})) || '{}';

	try {
		const cleanContent = stripJsonFence(content);

		const parsed = JSON.parse(cleanContent);

		return {
			transactions: parsed.transactions || [],
			confidence: parsed.confidence || 0.7,
			recommendations: parsed.recommendations || []
		};
	} catch (error) {
		// Fallback: coba parse manual berdasarkan kata kunci
		const fallbackTransactions = [];

		// Cari pola "masukkan uang X" atau "setor X"
		const masukkanMatch = text.match(
			/(?:masukkan|setor|tambah|masuk)\s*(?:uang\s*)?(\d+(?:rb|ribu|k|000)?)/i
		);
		if (masukkanMatch) {
			let amount = parseInt(masukkanMatch[1].replace(/[^\d]/g, ''));
			if (
				masukkanMatch[1].includes('rb') ||
				masukkanMatch[1].includes('ribu') ||
				masukkanMatch[1].includes('k')
			) {
				amount *= 1000;
			}

			fallbackTransactions.push({
				type: 'pemasukan',
				amount: amount,
				deskripsi: 'Setoran ke kas',
				confidence: 0.8
			});
		}

		// Cari pola "ambil X" atau "beli X" (bukan untuk produk)
		const ambilMatch = text.match(
			/(?:ambil|bayar|keluar|belanja|jajan)\s*(?:uang\s*)?(\d+(?:rb|ribu|k|000)?)/i
		);
		if (ambilMatch) {
			let amount = parseInt(ambilMatch[1].replace(/[^\d]/g, ''));
			if (
				ambilMatch[1].includes('rb') ||
				ambilMatch[1].includes('ribu') ||
				ambilMatch[1].includes('k')
			) {
				amount *= 1000;
			}

			fallbackTransactions.push({
				type: 'pengeluaran',
				amount: amount,
				deskripsi: 'Pengeluaran',
				confidence: 0.8
			});
		}

		// Cari pola penjualan produk
		const penjualanMatch = text.match(
			/(?:customer|ada|tadi|membeli|beli|catat|catatlah).*?(\d+)\s*([a-zA-Z\s]+)/i
		);

		if (penjualanMatch) {
			const quantity = parseInt(penjualanMatch[1]);
			const productName = penjualanMatch[2].trim().toLowerCase();

			// Untuk fallback, kita tidak bisa hitung harga tanpa data produk
			// Tapi kita bisa identifikasi sebagai penjualan
			fallbackTransactions.push({
				type: 'penjualan',
				amount: 0, // Akan diisi oleh user atau sistem
				deskripsi: `Penjualan ${quantity} ${productName}`,
				confidence: 0.7
			});
		}

		return {
			transactions: fallbackTransactions,
			confidence: 0.6,
			recommendations: []
		};
	}
}

// Endpoint untuk analisis transaksi AI
export const POST: RequestHandler = async (event) => {
	const { url } = event;
	// P0-1: endpoint ini sebelumnya hanya rate-limit IP tanpa auth. Wajib login.
	const session = requireAuthSession(event.locals);
	const branch = requireSessionBranch(event.locals);
	const db = getD1Database(event.platform?.env as Record<string, unknown> | undefined, branch);
	const rateLimit = await consumeRateLimit(
		db,
		branch,
		`aichat:user:${session.userId}`,
		AI_MAX_REQUESTS,
		AI_WINDOW_MS,
		event.platform
	);
	if (!rateLimit.available) {
		return json(
			{
				success: false,
				error: 'AI chat sementara tidak tersedia. Coba lagi beberapa saat.',
				code: 'RATE_LIMITER_UNAVAILABLE'
			},
			{ status: 503, headers: { 'Retry-After': '5' } }
		);
	}
	if (!rateLimit.allowed) {
		return json(
			{
				success: false,
				error: 'Terlalu banyak request. Coba lagi beberapa menit lagi.',
				code: 'RATE_LIMITED',
				retryAfterSeconds: rateLimit.retryAfterSeconds
			},
			{
				status: 429,
				headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
			}
		);
	}

	// Cek apakah ini request untuk analisis transaksi
	const action = url.searchParams.get('action');

	if (action === 'analyze') {
		return await handleTransactionAnalysis(event);
	}

	await requirePageAccess(db, session, 'laporan');

	// Default: handle regular AI chat
	return await handleRegularChat(event);
};

// Handler untuk analisis transaksi
async function handleTransactionAnalysis(event: import('./$types').RequestEvent) {
	const request = event.request;
	// P0-1: branch dari session, bukan header x-branch yang bisa dipalsukan.
	const branch = requireSessionBranch(event.locals);
	try {
		const { text } = await request.json();

		if (!text || typeof text !== 'string') {
			return json(
				{ success: false, error: 'Teks transaksi diperlukan', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		if (text.length > 2000) {
			return json(
				{ success: false, error: 'Teks transaksi terlalu panjang', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		// Get API key from environment
		const apiKey = env.OPENROUTER_API_KEY;

		if (!apiKey) {
			return json(
				{
					success: false,
					error: 'API key OpenRouter tidak dikonfigurasi',
					code: 'SERVICE_UNAVAILABLE'
				},
				{ status: 500 }
			);
		}

		// Data produk untuk konteks AI — query branch-scoped, fallback bila gagal.
		let productData = '';
		try {
			productData = await buildProductPromptData(getDrizzleDb(event.platform, branch), branch);
		} catch {
			productData =
				'Data produk tidak tersedia saat ini. JIKA USER MENYEBUTKAN PRODUK, JANGAN berikan rekomendasi untuk penjualan produk karena tidak ada informasi harga. Minta user untuk memberikan informasi harga atau detail transaksi yang lebih spesifik.';
		}

		// Analisis transaksi menggunakan AI
		const analysis = await analyzeTransactionText(text, apiKey, productData);

		return json({
			success: true,
			transactions: analysis.transactions,
			confidence: analysis.confidence,
			recommendations: analysis.recommendations
		});
	} catch (error) {
		return json(
			{
				success: false,
				error: 'Terjadi kesalahan saat menganalisis transaksi',
				code: 'SERVER_ERROR'
			},
			{ status: 500 }
		);
	}
}

// Handler untuk regular AI chat
async function handleRegularChat(event: import('./$types').RequestEvent) {
	const request = event.request;
	try {
		const { question, branch } = await request.json();

		if (!question || typeof question !== 'string') {
			return json(
				{ success: false, error: 'Pertanyaan diperlukan', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		// Get API key from environment
		const apiKey = env.OPENROUTER_API_KEY;

		if (!apiKey) {
			return json(
				{
					success: false,
					error:
						'API key OpenRouter tidak dikonfigurasi. Silakan tambahkan OPENROUTER_API_KEY di file .env',
					code: 'SERVICE_UNAVAILABLE'
				},
				{ status: 500 }
			);
		}

		if (question.length > 2000) {
			return json(
				{ success: false, error: 'Pertanyaan terlalu panjang', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		// P0-1: branch di-scope ke session (admin boleh lintas-branch). Jangan percaya
		// body mentah — sebelumnya fallback ke 'balikpapan' = baca data tenant lain.
		let requestedBranch: ReturnType<typeof normalizeBranch>;
		try {
			requestedBranch = requireSessionBranch(event.locals, branch);
		} catch {
			return json(
				{ success: false, error: 'Branch tidak sesuai session', code: 'BRANCH_FORBIDDEN' },
				{ status: 403 }
			);
		}

		// AI 1: Identifikasi kebutuhan data
		const dataRequirements = await identifyDataRequirements(question, apiKey);

		const db = getDrizzleDb(event.platform, requestedBranch);

		// Hitung waktu WITA dari rentang yang diidentifikasi AI 1
		// STANDAR: Gunakan WITA untuk query database
		const { startWita, endWita } = witaRangeToWitaQuery(
			dataRequirements.periode.start,
			dataRequirements.periode.end
		);
		const startDate = startWita;
		const endDate = endWita;

		// Konversi tanggal untuk konteks AI

		// Konversi tanggal untuk konteks AI
		const formatDateForAI = (dateStr: string) => {
			const date = new Date(dateStr);
			return date.toLocaleDateString('id-ID', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
		};

		const rangeContext = {
			requested: {
				start: dataRequirements.periode.start,
				end: dataRequirements.periode.end,
				startFormatted: formatDateForAI(dataRequirements.periode.start),
				endFormatted: formatDateForAI(dataRequirements.periode.end),
				type: dataRequirements.periode.type
			},
			dataRequirements: {
				jenisData: dataRequirements.jenisData,
				prioritas: dataRequirements.prioritas,
				scope: dataRequirements.scope
			}
		};

		// Ambil data berpaginasi untuk periode yang diminta
		const { bukuKasPos, bukuKasManual, transaksiKasirData } = await fetchReportData(
			db,
			requestedBranch,
			startDate,
			endDate
		);

		// Handle case when no data found
		if (
			(!bukuKasPos || bukuKasPos.length === 0) &&
			(!bukuKasManual || bukuKasManual.length === 0)
		) {
			return new Response(
				JSON.stringify({
					success: false,
					code: 'NO_DATA',
					error: 'Tidak ada data ditemukan untuk periode yang diminta',
					dateRange: `${dataRequirements.periode.start} hingga ${dataRequirements.periode.end}`,
					dataRequirements: {
						jenisData: dataRequirements.jenisData,
						prioritas: dataRequirements.prioritas,
						scope: dataRequirements.scope
					},
					suggestion:
						'Coba gunakan periode yang lebih pendek atau periksa apakah ada data transaksi dalam rentang waktu tersebut'
				}),
				{
					headers: { 'Content-Type': 'application/json' },
					status: 404
				}
			);
		}

		// Data periode yang diminta - gunakan logika yang sama dengan DataService
		const laporan: Record<string, unknown>[] = [];

		// 1. Tambahkan data POS dari buku_kas (sumber='pos')
		(bukuKasPos || []).forEach((item: Record<string, unknown>) => {
			laporan.push({
				...item,
				sumber: 'pos',
				nominal: item.nominal || 0 // Map amount ke nominal seperti DataService
			});
		});

		// 2. Tambahkan data manual/catat
		(bukuKasManual || []).forEach((item: Record<string, unknown>) => {
			laporan.push({
				...item,
				sumber: item.sumber || 'catat',
				nominal: item.nominal || 0 // Map amount ke nominal seperti DataService
			});
		});

		// Hitung data periode yang diminta
		const pemasukan = laporan.filter((t: Record<string, unknown>) => t.tipe === 'in');
		const pengeluaran = laporan.filter((t: Record<string, unknown>) => t.tipe === 'out');

		const totalPemasukan = pemasukan.reduce(
			(s: number, t: Record<string, unknown>) => s + ((t.nominal as number) || 0),
			0
		);
		const totalPengeluaran = pengeluaran.reduce(
			(s: number, t: Record<string, unknown>) => s + ((t.nominal as number) || 0),
			0
		);
		const labaKotor = totalPemasukan - totalPengeluaran;
		const pajak = labaKotor > 0 ? Math.round(labaKotor * 0.005) : 0;
		const labaBersih = labaKotor - pajak;

		// Format data per bulan untuk AI
		const formattedRequestedMonthlyData = aggregateMonthly(laporan, transaksiKasirData);

		const summary = {
			pendapatan: totalPemasukan,
			pengeluaran: totalPengeluaran,
			saldo: totalPemasukan - totalPengeluaran,
			labaKotor,
			pajak,
			labaBersih,
			totalTransaksi: new Set(
				(bukuKasPos || []).map((b: { transaction_id?: string }) => b.transaction_id).filter(Boolean)
			).size,
			// Data per bulan untuk periode yang diminta
			requestedMonthlyData: formattedRequestedMonthlyData
		};

		// Breakdown pembayaran, pola waktu, tren harian, & statistik
		const {
			paymentBreakdown,
			jamRamai,
			dailyPerformance,
			avgTransactionsPerDay,
			avgRevenuePerDay,
			avgTicketSize,
			totalDays,
			bestDay,
			worstDay
		} = computeAnalytics(laporan, bukuKasPos, totalPemasukan);

		// Ambil metadata produk/kategori/tambahan berdasarkan kebutuhan data
		let products: { id: string; nama: string; harga: number; kategori_id?: string | null }[] = [];
		let categories: { id: string; nama: string }[] = [];
		let addons: { id: string; nama: string; harga: number }[] = [];

		// Fetch data berdasarkan jenis data yang diperlukan
		if (dataRequirements.jenisData.includes('produk') || dataRequirements.jenisData.length === 0) {
			products = await db
				.select({
					id: produk.id,
					nama: produk.nama,
					harga: produk.harga,
					kategori_id: produk.kategori_id
				})
				.from(produk)
				.where(eq(produk.cabang_id, requestedBranch))
				.limit(1000);
		}

		if (
			dataRequirements.jenisData.includes('kategori') ||
			dataRequirements.jenisData.length === 0
		) {
			categories = await db
				.select({ id: kategori.id, nama: kategori.nama })
				.from(kategori)
				.where(eq(kategori.cabang_id, requestedBranch))
				.limit(1000);
		}

		if (
			dataRequirements.jenisData.includes('tambahan') ||
			dataRequirements.jenisData.length === 0
		) {
			addons = await db
				.select({ id: tambahan.id, nama: tambahan.nama, harga: tambahan.harga })
				.from(tambahan)
				.where(eq(tambahan.cabang_id, requestedBranch))
				.limit(1000);
		}

		// Hitung produk terlaris berdasarkan transaksi_kasir yang sudah diambil
		const productIdToSale: Record<string, { jumlah: number; revenue: number; nama?: string }> = {};
		// Prototype pollution guard: reject dangerous keys
		const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
		interface TransaksiItem {
			produk_id?: string;
			jumlah?: number;
			harga?: number;
			amount?: number;
			nama_kustom?: string;
			produk?: { nama?: string };
		}
		for (const item of transaksiKasirData || []) {
			const typedItem = item as TransaksiItem;
			const pid = typedItem.produk_id;
			if (!pid || typeof pid !== 'string' || FORBIDDEN_KEYS.has(pid)) continue;
			const jumlah = Number(typedItem.jumlah || 0) || 0;
			const satuan = Number(typedItem.harga || typedItem.amount || 0) || 0;
			const revenue = satuan * (jumlah || 1);
			// Ambil nama dari relasi produk atau nama_kustom
			const productName =
				typedItem.produk?.nama || typedItem.nama_kustom || `Produk ${pid.slice(0, 8)}`;
			if (!Object.prototype.hasOwnProperty.call(productIdToSale, pid)) {
				productIdToSale[pid] = { jumlah: 0, revenue: 0, nama: productName };
			}
			productIdToSale[pid].jumlah += jumlah || 0;
			productIdToSale[pid].revenue += revenue;
			if (!productIdToSale[pid].nama) productIdToSale[pid].nama = productName;
		}
		const produkTerlaris = Object.entries(productIdToSale)
			.map(([pid, v]) => ({
				id: pid,
				nama: v.nama || pid,
				totalTerjual: v.jumlah,
				totalPendapatan: v.revenue
			}))
			.sort((a, b) => b.totalTerjual - a.totalTerjual)
			.slice(0, 5);

		// Cari produk spesifik jika user bertanya tentang harga
		let specificProduct = null;
		if (
			dataRequirements.prioritas === 'product_analysis' &&
			question.toLowerCase().includes('harga')
		) {
			// Cari produk yang disebutkan dalam pertanyaan
			const productKeywords = [
				'alpukat',
				'mangga',
				'jeruk',
				'apel',
				'pisang',
				'semangka',
				'melon',
				'pepaya',
				'naga',
				'strawberry'
			];
			const foundKeyword = productKeywords.find((keyword) =>
				question.toLowerCase().includes(keyword)
			);

			if (foundKeyword) {
				specificProduct = products.find((p) => p.nama.toLowerCase().includes(foundKeyword));
			}
		}

		// Sederhanakan konteks server
		const serverReportData = {
			summary,
			startDate: dataRequirements.periode.start,
			endDate: dataRequirements.periode.end,
			tipe: dataRequirements.periode.type,
			pembayaran: paymentBreakdown,
			jamRamai,
			products: (products || []).map((p: { id: string; nama: string; harga: number }) => ({
				id: p.id,
				nama: p.nama,
				harga: p.harga
			})),
			categories: (categories || []).map((c: { id: string; nama: string }) => ({
				id: c.id,
				nama: c.nama
			})),
			addons: (addons || []).map((a: { id: string; nama: string; harga: number }) => ({
				id: a.id,
				nama: a.nama,
				harga: a.harga
			})),
			produkTerlaris,
			specificProduct, // Produk spesifik yang dicari
			// Data analisis mendalam
			dailyPerformance,
			analytics: {
				avgTransactionsPerDay: Math.round(avgTransactionsPerDay * 100) / 100,
				avgRevenuePerDay: Math.round(avgRevenuePerDay),
				avgTicketSize: Math.round(avgTicketSize),
				totalDays,
				bestDay:
					bestDay.revenue > 0
						? {
								date: bestDay.formattedDate,
								revenue: bestDay.revenue,
								transactions: bestDay.count,
								avgTicket: Math.round(bestDay.avgTicket)
							}
						: null,
				worstDay:
					worstDay.revenue > 0
						? {
								date: worstDay.formattedDate,
								revenue: worstDay.revenue,
								transactions: worstDay.count,
								avgTicket: Math.round(worstDay.avgTicket)
							}
						: null
			},
			// Data requirements untuk konteks AI
			dataRequirements: {
				jenisData: dataRequirements.jenisData,
				prioritas: dataRequirements.prioritas,
				scope: dataRequirements.scope
			}
		};

		// Prepare context about the report data
		const reportContext = buildReportContext(serverReportData, rangeContext);

		// AI 2: Analisis data bisnis
		const answer = await analyzeBusinessData(
			question,
			reportContext,
			{
				start: rangeContext.requested.start,
				startFormatted: rangeContext.requested.startFormatted,
				end: rangeContext.requested.end,
				endFormatted: rangeContext.requested.endFormatted,
				type: rangeContext.requested.type,
				dataRequirements: rangeContext.dataRequirements
			},
			apiKey
		);

		return json({
			success: true,
			answer: answer.trim(),
			dateRange: {
				start: dataRequirements.periode.start,
				end: dataRequirements.periode.end,
				reasoning: dataRequirements.reasoning
			},
			dataRequirements: {
				jenisData: dataRequirements.jenisData,
				prioritas: dataRequirements.prioritas,
				scope: dataRequirements.scope
			}
		});
	} catch (error) {
		return json(
			{
				success: false,
				error: 'Terjadi kesalahan saat memproses pertanyaan. Silakan coba lagi.',
				code: 'SERVER_ERROR'
			},
			{ status: 500 }
		);
	}
}
