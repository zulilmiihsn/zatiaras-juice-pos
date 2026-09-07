import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { formatRupiah } from '$lib/utils/currency';
import { getD1Database, getDrizzleDb, normalizeBranch } from '$lib/server/branchResolver';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { requirePageAccess } from '$lib/server/pageAccess';
import { kategori, produk, tambahan } from '$lib/database/schema';
import { eq } from 'drizzle-orm';
import {
	buildIdentifyDataRequirementsPrompt,
	buildAnalyzeBusinessDataPrompt,
	buildAnalyzeTransactionTextPrompt,
	parseDataRequirements,
	type DataRequirements
} from './prompts';
import {
	fetchReportDataSql,
	buildReportContext
} from './reportData';

// [CATATAN]: OpenRouter / AI Model configuration
const OPENROUTER_API_URL = env.AI_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'minimax/minimax-m3:free';
const FALLBACK_MODEL = 'google/gemma-4-31b-it:free';
const MODEL = env.AI_MODEL || env.OPENROUTER_MODEL || DEFAULT_MODEL;

const AI_WINDOW_MS = 15 * 60 * 1000;
const AI_MAX_REQUESTS = 40;
const OPENROUTER_TIMEOUT_MS = 25_000;

interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface OpenRouterOpts {
	title: string;
	maxTokens: number;
	temperature: number;
	errorLabel: string;
	model?: string;
	tools?: Array<{ type: string; [key: string]: unknown }>;
}

/** Panggil OpenRouter chat-completion non-streaming dengan fallback model & tools otomatis. */
async function callOpenRouter(
	apiKey: string,
	messages: ChatMessage[],
	opts: OpenRouterOpts
): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
	const targetModel = opts.model || MODEL;

	const buildPayload = (modelName: string, withTools: boolean) => {
		const payload: Record<string, unknown> = {
			model: modelName,
			messages,
			max_tokens: opts.maxTokens,
			temperature: opts.temperature
		};
		if (withTools && opts.tools && opts.tools.length > 0) {
			payload.tools = opts.tools;
		}
		return JSON.stringify(payload);
	};

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
			body: buildPayload(targetModel, true),
			signal: controller.signal
		});

		// [CATATAN]: Jika gagal saat menyertakan tools, coba panggil ulang tanpa tools
		if (!response.ok && opts.tools && opts.tools.length > 0) {
			response = await fetch(OPENROUTER_API_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://zatiaraspos.com',
					'X-Title': `${opts.title} (No Tools)`
				},
				body: buildPayload(targetModel, false),
				signal: controller.signal
			});
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(`${opts.errorLabel}: upstream timeout`);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		// [CATATAN]: Coba model cadangan jika model utama gagal (429 atau 5xx)
		if (targetModel !== FALLBACK_MODEL) {
			try {
				let fallbackRes = await fetch(OPENROUTER_API_URL, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${apiKey}`,
						'Content-Type': 'application/json',
						'HTTP-Referer': 'https://zatiaraspos.com',
						'X-Title': `${opts.title} (Fallback)`
					},
					body: buildPayload(FALLBACK_MODEL, Boolean(opts.tools?.length))
				});

				if (!fallbackRes.ok && opts.tools && opts.tools.length > 0) {
					fallbackRes = await fetch(OPENROUTER_API_URL, {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${apiKey}`,
							'Content-Type': 'application/json',
							'HTTP-Referer': 'https://zatiaraspos.com',
							'X-Title': `${opts.title} (Fallback No Tools)`
						},
						body: buildPayload(FALLBACK_MODEL, false)
					});
				}

				if (fallbackRes.ok) {
					const fallbackData = (await fallbackRes.json()) as any;
					return fallbackData?.choices?.[0]?.message?.content || '';
				}
			} catch {}
		}
		throw new Error(`${opts.errorLabel}: ${response.status}`);
	}

	const data = (await response.json()) as any;
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

/** Panggil OpenRouter dengan streaming response aktif & dukungan tools web search. */
async function callOpenRouterStream(
	apiKey: string,
	messages: ChatMessage[],
	opts: {
		title: string;
		maxTokens: number;
		temperature: number;
		model?: string;
		tools?: Array<{ type: string; [key: string]: unknown }>;
	}
): Promise<Response> {
	const targetModel = opts.model || MODEL;
	const bodyObj: Record<string, unknown> = {
		model: targetModel,
		messages,
		max_tokens: opts.maxTokens,
		temperature: opts.temperature,
		stream: true
	};
	if (opts.tools && opts.tools.length > 0) {
		bodyObj.tools = opts.tools;
	}

	return await fetch(OPENROUTER_API_URL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'HTTP-Referer': 'https://zatiaraspos.com',
			'X-Title': opts.title
		},
		body: JSON.stringify(bodyObj)
	});
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

/** Format YYYY-MM-DD dalam zona waktu WITA (UTC+8). */
function toYMDWita(date: Date): string {
	const utcTime = date.getTime();
	const witaTime = new Date(utcTime + 8 * 60 * 60 * 1000);
	return witaTime.toISOString().slice(0, 10);
}

/**
 * Fast-path intent & date resolver:
 * Memintas panggilan AI 1 untuk pertanyaan saran tombol cepat dan kata kunci standar.
 * Menghasilkan latency 0ms dan zero token untuk 80% pertanyaan umum.
 */
function fastResolveRequirements(question: string, todayWita: string): DataRequirements | null {
	const q = question.toLowerCase().trim();
	const currentMonthStart = `${todayWita.slice(0, 7)}-01`;
	const currentDate = new Date(`${todayWita}T00:00:00.000Z`);

	const getPastDateStr = (daysAgo: number) => {
		const d = new Date(currentDate);
		d.setUTCDate(d.getUTCDate() - daysAgo);
		return d.toISOString().slice(0, 10);
	};

	// 1. Performa Penjualan / Hari ini
	if (
		q.includes('performa penjualan') ||
		q.includes('penjualan toko hari ini') ||
		q.includes('omzet hari ini') ||
		q === 'hari ini' ||
		q.includes('bagaimana performa')
	) {
		return {
			periode: { start: todayWita, end: todayWita, type: 'daily' },
			jenisData: ['buku_kas', 'transaksi_kasir', 'payment_analysis'],
			prioritas: 'sales_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis performa penjualan hari ini'
		};
	}

	// 2. Kemarin
	if (q.includes('kemarin') || q.includes('penjualan kemarin')) {
		const yesterday = getPastDateStr(1);
		return {
			periode: { start: yesterday, end: yesterday, type: 'daily' },
			jenisData: ['buku_kas', 'transaksi_kasir'],
			prioritas: 'sales_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis performa kemarin'
		};
	}

	// 3. Menu / Produk Terlaris
	if (
		q.includes('menu terlaris') ||
		q.includes('paling laris') ||
		q.includes('banyak terjual') ||
		q.includes('produk terlaris')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['produk_terlaris', 'transaksi_kasir', 'produk'],
			prioritas: 'product_analysis',
			scope: 'product_performance',
			reasoning: 'Shortcut Heuristik: Analisis produk terlaris bulan ini'
		};
	}

	// 4. Keuntungan Bersih / Laba
	if (
		q.includes('keuntungan bersih') ||
		q.includes('laba kotor') ||
		q.includes('laba bersih') ||
		q.includes('profit')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['buku_kas', 'financial_summary'],
			prioritas: 'financial_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis laba dan keuangan bulan ini'
		};
	}

	// 5. Tren Penjualan / 7 Hari Terakhir
	if (
		q.includes('tren penjualan') ||
		q.includes('seminggu terakhir') ||
		q.includes('7 hari') ||
		q.includes('1 minggu')
	) {
		const sevenDaysAgo = getPastDateStr(6);
		return {
			periode: { start: sevenDaysAgo, end: todayWita, type: 'daily' },
			jenisData: ['buku_kas', 'daily_trends', 'payment_analysis'],
			prioritas: 'trend_analysis',
			scope: 'trend_analysis',
			reasoning: 'Shortcut Heuristik: Analisis tren seminggu terakhir'
		};
	}

	// 6. Bulan Lalu
	if (q.includes('bulan lalu') || q.includes('bulan kemarin')) {
		const firstOfCurrentMonth = new Date(
			Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1)
		);
		const lastOfPrevMonth = new Date(firstOfCurrentMonth.getTime() - 86400000);
		const firstOfPrevMonth = new Date(
			Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1)
		);
		return {
			periode: {
				start: firstOfPrevMonth.toISOString().slice(0, 10),
				end: lastOfPrevMonth.toISOString().slice(0, 10),
				type: 'monthly'
			},
			jenisData: ['buku_kas', 'transaksi_kasir', 'financial_summary'],
			prioritas: 'sales_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis bulan lalu'
		};
	}

	// 7. Bulan Ini
	if (q.includes('bulan ini')) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['buku_kas', 'transaksi_kasir', 'financial_summary'],
			prioritas: 'sales_analysis',
			scope: 'revenue_analysis',
			reasoning: 'Shortcut Heuristik: Analisis bulan ini'
		};
	}

	// 8. Riset Pasar, Tren & Web Browsing
	if (
		q.includes('riset') ||
		q.includes('tren') ||
		q.includes('viral') ||
		q.includes('browsing') ||
		q.includes('internet') ||
		q.includes('kompetitor') ||
		q.includes('pesaing') ||
		q.includes('tiktok') ||
		q.includes('instagram') ||
		q.includes('ide menu') ||
		q.includes('resep baru')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['produk_terlaris', 'produk'],
			prioritas: 'market_analysis',
			scope: 'market_analysis',
			reasoning: 'Shortcut Heuristik: Riset pasar dan tren minuman viral via web'
		};
	}

	// 9. Konsultasi Strategi Bisnis, Menu Engineering & Psikologi Harga
	if (
		q.includes('strategi') ||
		q.includes('psikologi') ||
		q.includes('decoy') ||
		q.includes('anchoring') ||
		q.includes('bundling') ||
		q.includes('marketing') ||
		q.includes('cara menaikkan') ||
		q.includes('rekomendasi harga') ||
		q.includes('menu engineering') ||
		q.includes('promosi')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['produk_terlaris', 'transaksi_kasir', 'financial_summary'],
			prioritas: 'strategic_consulting',
			scope: 'market_analysis',
			reasoning: 'Shortcut Heuristik: Konsultasi strategi bisnis FnB dan psikologi harga'
		};
	}

	// 10. Stok Bahan Baku & Peringatan Bahan Kritis
	if (
		q.includes('stok') ||
		q.includes('bahan') ||
		q.includes('sisa buah') ||
		q.includes('buah habis') ||
		q.includes('ambang stok') ||
		q.includes('restok') ||
		q.includes('persediaan')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['stok_bahan', 'produk'],
			prioritas: 'inventory_analysis',
			scope: 'inventory_management',
			reasoning: 'Shortcut Heuristik: Evaluasi stok bahan baku dan peringatan restok'
		};
	}

	// 11. HPP & Margin Profitabilitas Menu
	if (
		q.includes('hpp') ||
		q.includes('margin') ||
		q.includes('modal produk') ||
		q.includes('paling untung') ||
		q.includes('margin terbesar') ||
		q.includes('margin tipis') ||
		q.includes('keuntungan per cup')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['hpp_margin', 'transaksi_kasir', 'financial_summary'],
			prioritas: 'margin_analysis',
			scope: 'margin_optimization',
			reasoning: 'Shortcut Heuristik: Analisis HPP dan margin keuntungan produk'
		};
	}

	// 12. Selera & Kustomisasi Konsumen (Gula & Es)
	if (
		q.includes('gula') ||
		q.includes('es') ||
		q.includes('less sugar') ||
		q.includes('level gula') ||
		q.includes('selera') ||
		q.includes('kustomisasi')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['customer_behavior', 'transaksi_kasir'],
			prioritas: 'customer_analysis',
			scope: 'customer_insights',
			reasoning: 'Shortcut Heuristik: Analisis preferensi kustomisasi pelanggan (gula & es)'
		};
	}

	// 13. Performa Shift & Sesi Toko
	if (
		q.includes('shift') ||
		q.includes('sesi kasir') ||
		q.includes('sesi toko') ||
		q.includes('buka toko') ||
		q.includes('tutup toko')
	) {
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: ['shift_analysis', 'buku_kas'],
			prioritas: 'shift_analysis',
			scope: 'operational_efficiency',
			reasoning: 'Shortcut Heuristik: Analisis performa shift dan sesi toko'
		};
	}

	return null;
}

/** Deteksi apakah pertanyaan memerlukan riset eksternal ke web/internet */
function isWebSearchRequested(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'browsing',
		'browse',
		'internet',
		'cari di web',
		'cari di internet',
		'cari di google',
		'googling',
		'search',
		'tren',
		'trend',
		'viral',
		'hits',
		'kompetitor',
		'pesaing',
		'pasaran',
		'harga pasar',
		'tiktok',
		'instagram',
		'sosmed',
		'media sosial',
		'resep baru',
		'ide menu baru',
		'kekinian'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Deteksi apakah pertanyaan merupakan konsultasi strategi/edukasi bisnis FnB */
function isStrategicQuestion(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'strategi',
		'taktik',
		'tips',
		'rekomendasi',
		'psikologi',
		'decoy',
		'anchoring',
		'bundling',
		'charm pricing',
		'menu engineering',
		'cara menaikkan omzet',
		'tingkatkan penjualan',
		'digital marketing',
		'local seo',
		'reciprocity',
		'loss aversion'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Deteksi apakah pertanyaan seputar stok/inventaris bahan baku */
function isInventoryQuestion(question: string): boolean {
	const q = question.toLowerCase();
	const keywords = [
		'stok',
		'bahan',
		'sisa buah',
		'buah habis',
		'ambang stok',
		'restok',
		'persediaan'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Ambil daftar memori & target bisnis cabang dari tabel pengaturan */
async function getBusinessMemory(rawDb: ReturnType<typeof getRawDb>, branch: string): Promise<string> {
	try {
		const row = (await rawDb
			.prepare(`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (row?.nilai) {
			const parsed = JSON.parse(row.nilai);
			if (Array.isArray(parsed.catatan) && parsed.catatan.length > 0) {
				return parsed.catatan.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n');
			}
		}
	} catch {}
	return '';
}

/** Simpan catatan / target bisnis ke memori permanen cabang */
async function saveBusinessMemoryNote(
	rawDb: ReturnType<typeof getRawDb>,
	branch: string,
	note: string
): Promise<string[]> {
	const currentNotes: string[] = [];
	try {
		const row = (await rawDb
			.prepare(`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (row?.nilai) {
			const parsed = JSON.parse(row.nilai);
			if (Array.isArray(parsed.catatan)) {
				currentNotes.push(...parsed.catatan);
			}
		}
	} catch {}

	currentNotes.push(note.trim());
	const trimmedNotes = currentNotes.slice(-10);

	const payload = JSON.stringify({
		catatan: trimmedNotes,
		updated_at: new Date().toISOString()
	});

	await rawDb
		.prepare(
			`INSERT INTO pengaturan (id, cabang_id, kunci, nilai, updated_at)
			 VALUES (?, ?, 'ai_business_memory', ?, datetime('now'))
			 ON CONFLICT(cabang_id, kunci) DO UPDATE SET nilai = excluded.nilai, updated_at = datetime('now')`
		)
		.bind(crypto.randomUUID(), branch, payload)
		.run();

	return trimmedNotes;
}

/** Bersihkan semua memori bisnis cabang */
async function clearBusinessMemory(rawDb: ReturnType<typeof getRawDb>, branch: string): Promise<void> {
	await rawDb
		.prepare(`DELETE FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory'`)
		.bind(branch)
		.run();
}

// [CATATAN]: AI 1: Data Requirement Analyzer (didukung konteks multi-turn)
async function identifyDataRequirements(
	question: string,
	apiKey: string,
	recentContext?: string
): Promise<DataRequirements> {
	const now = new Date();
	const todayWita = toYMDWita(now);

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: buildIdentifyDataRequirementsPrompt(question, todayWita, recentContext)
		},
		{
			role: 'user',
			content: question
		}
	];

	const content =
		(await callOpenRouter(apiKey, messages, {
			title: 'Zatiaras POS - Data Requirement Analyzer',
			maxTokens: 500,
			temperature: 0.2,
			errorLabel: 'AI 1 Error'
		})) || '{}';

	try {
		const cleanContent = stripJsonFence(content);
		const parsed: unknown = JSON.parse(cleanContent);
		return parseDataRequirements(parsed, todayWita);
	} catch (error) {
		throw new Error(`AI 1 gagal mengidentifikasi kebutuhan data: ${error}`);
	}
}

// [CATATAN]: AI 2: Business Analyst (Non-streaming fallback dengan memori bisnis & tools web)
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
	apiKey: string,
	history: ChatMessage[] = [],
	businessMemory?: string,
	tools?: Array<{ type: string; [key: string]: unknown }>
): Promise<string> {
	const systemMessage: ChatMessage = {
		role: 'system',
		content: buildAnalyzeBusinessDataPrompt(question, reportData, dateRange, businessMemory)
	};

	const messages: ChatMessage[] = [systemMessage, ...history, { role: 'user', content: question }];

	return (
		(await callOpenRouter(apiKey, messages, {
			title: 'Zatiaras POS - Business Analyst',
			maxTokens: 2500,
			temperature: 0.6,
			errorLabel: 'AI 2 Error',
			tools
		})) || 'Maaf, tidak dapat menghasilkan jawaban.'
	);
}

/** Bangun teks daftar produk/harga untuk analisis transaksi AI 3. */
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

// [CATATAN]: AI 3: Transaction Analyzer (Text input ke transaksi kasir)
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
		(await callOpenRouter(apiKey, [systemMessage], {
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
	} catch {
		return {
			transactions: [],
			confidence: 0.5,
			recommendations: []
		};
	}
}

// [CATATAN]: POST Endpoint Utama /api/aichat
export const POST: RequestHandler = async (event) => {
	const { url } = event;
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

	const action = url.searchParams.get('action');
	if (action === 'analyze') {
		return await handleTransactionAnalysis(event);
	}

	await requirePageAccess(db, session, 'laporan');
	return await handleRegularChat(event);
};

// [CATATAN]: Handler Analisis Transaksi Teks Kasir
async function handleTransactionAnalysis(event: import('./$types').RequestEvent) {
	const request = event.request;
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

		let productData = '';
		try {
			productData = await buildProductPromptData(getDrizzleDb(event.platform, branch), branch);
		} catch {
			productData = 'Data produk tidak tersedia saat ini.';
		}

		const analysis = await analyzeTransactionText(text, apiKey, productData);
		return json({
			success: true,
			transactions: analysis.transactions,
			confidence: analysis.confidence,
			recommendations: analysis.recommendations
		});
	} catch {
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

// [CATATAN]: Handler Chat Laporan Finansial (Streaming SSE + SQL Agregasi + Multi-Turn)
async function handleRegularChat(event: import('./$types').RequestEvent) {
	const request = event.request;

	try {
		const body = await request.json();
		const { question, branch, stream = true, history } = body;

		if (!question || typeof question !== 'string') {
			return json(
				{ success: false, error: 'Pertanyaan diperlukan', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		const cleanQ = question.trim();
		if (!cleanQ) {
			return json(
				{ success: false, error: 'Pertanyaan tidak boleh kosong', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

		if (cleanQ.length > 2000) {
			return json(
				{ success: false, error: 'Pertanyaan terlalu panjang', code: 'VALIDATION_ERROR' },
				{ status: 400 }
			);
		}

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

		let requestedBranch: ReturnType<typeof normalizeBranch>;
		try {
			requestedBranch = requireSessionBranch(event.locals, branch);
		} catch {
			return json(
				{ success: false, error: 'Branch tidak sesuai session', code: 'BRANCH_FORBIDDEN' },
				{ status: 403 }
			);
		}

		const rawDb = getRawDb(event.platform, requestedBranch);
		const db = getDrizzleDb(event.platform, requestedBranch);

		const qLower = cleanQ.toLowerCase();

		// [CATATAN]: Perintah Simpan Catatan / Target Memori Bisnis (Long-Term Memory)
		const rememberMatch = cleanQ.match(
			/^(?:ingat|catat|simpan(?:\s+catatan)?|tambah(?:\s+memori)?)\s*:\s*(.+)$/i
		);
		if (rememberMatch) {
			const noteToRemember = rememberMatch[1].trim();
			const updatedNotes = await saveBusinessMemoryNote(rawDb, requestedBranch, noteToRemember);
			const responseText =
				`Catatan bisnis berhasil disimpan ke memori permanen cabang **${requestedBranch}**:\n\n` +
				updatedNotes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
				`\n\n_Catatan ini akan otomatis dijadikan tolok ukur acuan pada setiap analisis laporan mendatang._`;
			return json({
				success: true,
				answer: responseText,
				isMemoryAction: true
			});
		}

		// [CATATAN]: Perintah Lihat Memori Bisnis
		if (
			qLower === 'lihat memori' ||
			qLower === 'lihat catatan bisnis' ||
			qLower === 'cek memori' ||
			qLower === 'apa saja memorimu?' ||
			qLower === 'catatan bisnis' ||
			qLower.includes('catatan bisnis yang tersimpan')
		) {
			const memoryText = await getBusinessMemory(rawDb, requestedBranch);
			const responseText = memoryText
				? `Berikut catatan memori bisnis cabang **${requestedBranch}** saat ini:\n\n${memoryText}\n\n_Ketik \`Ingat: <catatan>\` untuk menambah, atau \`Hapus memori\` untuk mereset._`
				: `Belum ada catatan memori bisnis untuk cabang **${requestedBranch}**.\n\nKetik contoh: \`Ingat: Target omzet bulan ini 50 juta\` untuk mengajari AI acuan tokomu.`;
			return json({
				success: true,
				answer: responseText,
				isMemoryAction: true
			});
		}

		// [CATATAN]: Perintah Hapus Memori Bisnis
		if (
			qLower === 'hapus memori' ||
			qLower === 'reset memori' ||
			qLower === 'hapus catatan bisnis' ||
			qLower === 'bersihkan memori'
		) {
			await clearBusinessMemory(rawDb, requestedBranch);
			return json({
				success: true,
				answer: `Seluruh catatan memori bisnis cabang **${requestedBranch}** telah berhasil dibersihkan.`,
				isMemoryAction: true
			});
		}

		// [CATATAN]: Ambil catatan memori bisnis cabang untuk disuntikkan ke prompt analisis
		const businessMemory = await getBusinessMemory(rawDb, requestedBranch);

		// [CATATAN]: Format riwayat chat multi-turn (10 bubble terakhir / 5 putaran tanya-jawab)
		const sanitizedHistory: ChatMessage[] = Array.isArray(history)
			? history
					.slice(-10)
					.filter(
						(m) =>
							m &&
							(m.role === 'user' || m.role === 'assistant') &&
							typeof m.content === 'string'
					)
					.map((m) => ({
						role: m.role as 'user' | 'assistant',
						content: String(m.content).slice(0, 1500)
					}))
			: [];

		// [CATATAN]: Ringkasan konteks percakapan terakhir untuk memandu AI 1 memahami kata rujukan
		const recentContextForAi1 = sanitizedHistory
			.slice(-4)
			.map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 250)}`)
			.join('\n');

		const todayWita = toYMDWita(new Date());

		// [CATATAN]: Tahap 1: Evaluasi Kebutuhan Data (Bypass Heuristik Cepat atau AI 1 berkonteks)
		let dataRequirements = fastResolveRequirements(cleanQ, todayWita);
		if (!dataRequirements) {
			dataRequirements = await identifyDataRequirements(cleanQ, apiKey, recentContextForAi1);
		}

		const formatDateForAI = (dateStr: string) => {
			const parts = dateStr.split('-');
			const date = new Date(
				parseInt(parts[0], 10),
				parseInt(parts[1], 10) - 1,
				parseInt(parts[2], 10)
			);
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

		// [CATATAN]: Tarik data agregasi langsung dari SQL D1 (skala besar, hemat RAM & anti timeout)
		const reportResult = await fetchReportDataSql(
			rawDb,
			requestedBranch,
			dataRequirements.periode.start,
			dataRequirements.periode.end
		);

		const shouldSearchWeb = Boolean(body.webSearch) || isWebSearchRequested(cleanQ);
		const isStrategyOrResearch =
			dataRequirements.prioritas === 'market_analysis' ||
			dataRequirements.prioritas === 'strategic_consulting' ||
			dataRequirements.prioritas === 'inventory_analysis' ||
			dataRequirements.prioritas === 'margin_analysis' ||
			dataRequirements.prioritas === 'shift_analysis' ||
			shouldSearchWeb ||
			isStrategicQuestion(cleanQ) ||
			isInventoryQuestion(cleanQ);

		if (!reportResult.hasData && !isStrategyOrResearch) {
			return json(
				{
					success: false,
					code: 'NO_DATA',
					error: 'Tidak ada data transaksi ditemukan untuk periode yang diminta',
					dateRange: `${dataRequirements.periode.start} hingga ${dataRequirements.periode.end}`,
					dataRequirements: {
						jenisData: dataRequirements.jenisData,
						prioritas: dataRequirements.prioritas,
						scope: dataRequirements.scope
					},
					suggestion:
						'Coba gunakan periode lain atau pastikan toko sudah memiliki data transaksi di rentang waktu tersebut'
				},
				{ status: 404 }
			);
		}

		if (!reportResult.hasData && isStrategyOrResearch) {
			reportResult.serverReportData.summary = {
				pendapatan: 0,
				pengeluaran: 0,
				labaKotor: 0,
				pajak: 0,
				labaBersih: 0,
				totalTransaksi: 0,
				requestedMonthlyData: []
			};
		}

		// [CATATAN]: Jika user menanyakan harga produk spesifik, ambil info produk dari DB
		if (
			dataRequirements.prioritas === 'product_analysis' &&
			cleanQ.toLowerCase().includes('harga')
		) {
			try {
				const productsList = await db
					.select({
						id: produk.id,
						nama: produk.nama,
						harga: produk.harga
					})
					.from(produk)
					.where(eq(produk.cabang_id, requestedBranch))
					.limit(500);

				reportResult.serverReportData.products = productsList;
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
				const foundKeyword = productKeywords.find((k) => cleanQ.toLowerCase().includes(k));
				if (foundKeyword) {
					reportResult.serverReportData.specificProduct =
						productsList.find((p) => p.nama.toLowerCase().includes(foundKeyword)) || null;
				}
			} catch {}
		}

		reportResult.serverReportData.dataRequirements = dataRequirements;
		const reportContext = buildReportContext(reportResult.serverReportData, rangeContext);

		const systemPrompt = buildAnalyzeBusinessDataPrompt(
			cleanQ,
			reportContext,
			{
				start: rangeContext.requested.start,
				startFormatted: rangeContext.requested.startFormatted,
				end: rangeContext.requested.end,
				endFormatted: rangeContext.requested.endFormatted,
				type: rangeContext.requested.type,
				dataRequirements: rangeContext.dataRequirements
			},
			businessMemory
		);

		const fullMessages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			...sanitizedHistory,
			{ role: 'user', content: cleanQ }
		];

		const webSearchTools = shouldSearchWeb
			? [{ type: 'openrouter:web_search' }]
			: undefined;

		// [CATATAN]: 1. Jika streaming diaktifkan (default) -> kembalikan SSE stream
		if (stream !== false) {
			let upstreamRes = await callOpenRouterStream(apiKey, fullMessages, {
				title: 'Zatiaras POS - Business Analyst',
				maxTokens: 2500,
				temperature: 0.6,
				tools: webSearchTools
			});

			// Jika gagal saat menyertakan tools (misal model upstream menolak web search), coba tanpa tools
			if (!upstreamRes.ok && webSearchTools) {
				try {
					upstreamRes = await callOpenRouterStream(apiKey, fullMessages, {
						title: 'Zatiaras POS - Business Analyst (No Tools)',
						maxTokens: 2500,
						temperature: 0.6
					});
				} catch {}
			}

			if (!upstreamRes.ok && MODEL !== FALLBACK_MODEL) {
				try {
					upstreamRes = await callOpenRouterStream(apiKey, fullMessages, {
						title: 'Zatiaras POS - Business Analyst (Fallback)',
						maxTokens: 2500,
						temperature: 0.6,
						model: FALLBACK_MODEL,
						tools: webSearchTools
					});
					if (!upstreamRes.ok && webSearchTools) {
						upstreamRes = await callOpenRouterStream(apiKey, fullMessages, {
							title: 'Zatiaras POS - Business Analyst (Fallback No Tools)',
							maxTokens: 2500,
							temperature: 0.6,
							model: FALLBACK_MODEL
						});
					}
				} catch {}
			}

			if (!upstreamRes.ok || !upstreamRes.body) {
				return json(
					{
						success: false,
						error: 'Asisten AI sementara tidak dapat merespons. Silakan coba lagi.'
					},
					{ status: 502 }
				);
			}

			const encoder = new TextEncoder();
			const decoder = new TextDecoder();

			const sseStream = new ReadableStream({
				async start(controller) {
					// Kirim meta data pertama kali
					controller.enqueue(
						encoder.encode(
							`data: ${JSON.stringify({
								type: 'meta',
								dateRange: {
									start: dataRequirements.periode.start,
									end: dataRequirements.periode.end,
									reasoning: dataRequirements.reasoning
								},
								dataRequirements: {
									jenisData: dataRequirements.jenisData,
									prioritas: dataRequirements.prioritas,
									scope: dataRequirements.scope
								},
								webSearch: shouldSearchWeb
							})}\n\n`
						)
					);

					const reader = upstreamRes.body!.getReader();
					let buffer = '';

					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;

							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split('\n');
							buffer = lines.pop() || '';

							for (const line of lines) {
								const trimmed = line.trim();
								if (!trimmed || trimmed.startsWith(':')) continue;
								if (trimmed.startsWith('data: ')) {
									const dataStr = trimmed.slice(6).trim();
									if (dataStr === '[DONE]') {
										controller.enqueue(
											encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
										);
										controller.close();
										return;
									}
									try {
										const parsed = JSON.parse(dataStr);
										const token = parsed.choices?.[0]?.delta?.content;
										if (token) {
											controller.enqueue(
												encoder.encode(
													`data: ${JSON.stringify({ type: 'token', text: token })}\n\n`
												)
											);
										}
									} catch {
										// Abaikan chunk json parsial
									}
								}
							}
						}
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
						controller.close();
					} catch (err: any) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									type: 'error',
									error: err?.message || 'Koneksi stream terputus.'
								})}\n\n`
							)
						);
						controller.close();
					}
				}
			});

			return new Response(sseStream, {
				headers: {
					'Content-Type': 'text/event-stream; charset=utf-8',
					'Cache-Control': 'no-cache, no-transform',
					Connection: 'keep-alive'
				}
			});
		}

		// [CATATAN]: 2. Jika streaming dinonaktifkan (fallback non-streaming response)
		const answer = await analyzeBusinessData(
			cleanQ,
			reportContext,
			{
				start: rangeContext.requested.start,
				startFormatted: rangeContext.requested.startFormatted,
				end: rangeContext.requested.end,
				endFormatted: rangeContext.requested.endFormatted,
				type: rangeContext.requested.type,
				dataRequirements: rangeContext.dataRequirements
			},
			apiKey,
			sanitizedHistory,
			businessMemory,
			webSearchTools
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
			},
			webSearch: shouldSearchWeb
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
