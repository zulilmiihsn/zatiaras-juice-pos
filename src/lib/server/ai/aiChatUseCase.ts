/**
 * AI chat use case — inti asisten laporan: analisis kebutuhan data (AI 1), analis
 * bisnis (AI 2), analisis teks transaksi (AI 3), dan penyiapan data laporan.
 *
 * Helper teks ada di chatText.ts, memori bisnis di businessMemory.ts, dan orkestrasi
 * HTTP di aiChatHandlers.ts. Tidak import SvelteKit runtime maupun modul route.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { type BranchContext, getDrizzleDb } from '../branchResolver';
import { eq } from 'drizzle-orm';
import { kategori, produk, tambahan } from '../../database/schema';
import { formatRupiah } from '$lib/utils/currency';
import { isBudgetRefusal, callAiChat, type AiChatMessage, type AiTool } from '../aiGateway';
import {
	buildIdentifyDataRequirementsPrompt,
	buildAnalyzeBusinessDataPrompt,
	buildAnalyzeTransactionTextPrompt,
	parseDataRequirements,
	type DataRequirements
} from './prompts';
import { fetchReportDataSql, buildReportContext, type RangeContext } from './reportData';
import {
	extractJsonFromText,
	toYMDWita,
	fastResolveRequirements,
	isWebSearchRequested,
	isStrategicQuestion,
	isInventoryQuestion,
	formatDateForAI,
	sanitizeChatHistory,
	recentContextForAi1
} from './chatText';
import { getBusinessMemory } from './businessMemory';

export type ChatMessage = AiChatMessage;

export interface AiDeps {
	apiKey: string;
	model: string;
	url: string;
	/** Putus klien membatalkan panggilan upstream yang sedang berjalan. */
	clientSignal?: AbortSignal | null;
}

// AI 1: Data Requirement Analyzer (didukung konteks multi-turn & auto-fallback aman)
export async function identifyDataRequirements(
	question: string,
	deps: AiDeps,
	recentContext?: string
): Promise<DataRequirements> {
	const now = new Date();
	const todayWita = toYMDWita(now);
	const currentMonthStart = `${todayWita.slice(0, 7)}-01`;

	try {
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
			(await callAiChat(deps.apiKey, deps.url, messages, {
				title: 'Zatiaras POS - Data Requirement Analyzer',
				maxTokens: 500,
				temperature: 0.2,
				model: deps.model,
				errorLabel: 'AI 1 Error',
				clientSignal: deps.clientSignal ?? null
			})) || '{}';

		const cleanContent = extractJsonFromText(content);
		const parsed: unknown = JSON.parse(cleanContent);
		return parseDataRequirements(parsed, todayWita);
	} catch (error) {
		// Klien sudah pergi / salah konfigurasi budget AI: jangan lanjut menyiapkan laporan.
		if (deps.clientSignal?.aborted || isBudgetRefusal(error)) throw error;
		console.warn('[AI Chat] identifyDataRequirements gagal/timeout, fallback aman:', error);
		return {
			periode: { start: currentMonthStart, end: todayWita, type: 'monthly' },
			jenisData: [
				'buku_kas',
				'transaksi_kasir',
				'produk_terlaris',
				'financial_summary',
				'hpp_margin',
				'stok_bahan'
			],
			prioritas: 'strategic_consulting',
			scope: 'general_analysis',
			reasoning: 'Fallback otomatis: Analisis komprehensif bisnis Zatiaras'
		};
	}
}

// AI 2: Business Analyst (Non-streaming fallback dengan memori bisnis & tools web)
export async function analyzeBusinessData(
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
	deps: AiDeps,
	history: ChatMessage[] = [],
	businessMemory?: string,
	tools?: AiTool[]
): Promise<string> {
	const systemMessage: ChatMessage = {
		role: 'system',
		content: buildAnalyzeBusinessDataPrompt(question, reportData, dateRange, businessMemory)
	};

	const messages: ChatMessage[] = [systemMessage, ...history, { role: 'user', content: question }];

	return (
		(await callAiChat(deps.apiKey, deps.url, messages, {
			title: 'Zatiaras POS - Business Analyst',
			maxTokens: 2500,
			temperature: 0.6,
			model: deps.model,
			errorLabel: 'AI 2 Error',
			clientSignal: deps.clientSignal ?? null,
			tools
		})) || 'Maaf, tidak dapat menghasilkan jawaban.'
	);
}

/** Bangun teks daftar produk/harga untuk analisis transaksi AI 3. */
export async function buildProductPromptData(
	db: ReturnType<typeof getDrizzleDb>,
	branch: BranchContext
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

// AI 3: Transaction Analyzer (Text input ke transaksi kasir)
export async function analyzeTransactionText(
	text: string,
	deps: AiDeps,
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
		(await callAiChat(deps.apiKey, deps.url, [systemMessage], {
			title: 'Zatiaras POS - Transaction Analyzer',
			maxTokens: 1000,
			temperature: 0.3,
			model: deps.model,
			errorLabel: 'AI 3 Error',
			clientSignal: deps.clientSignal ?? null
		})) || '{}';

	try {
		const cleanContent = extractJsonFromText(content);
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

export interface ReportPipelineReady {
	kind: 'ready';
	dataRequirements: DataRequirements;
	rangeContext: RangeContext;
	reportContext: string;
	fullMessages: ChatMessage[];
	shouldSearchWeb: boolean;
	businessMemory: string;
	sanitizedHistory: ChatMessage[];
}

export interface ReportPipelineEmpty {
	kind: 'empty';
	payload: {
		code: 'NO_DATA';
		error: string;
		dateRange: string;
		dataRequirements: {
			jenisData: string[];
			prioritas: string;
			scope: string;
		};
		suggestion: string;
	};
}

/**
 * Pipeline agregasi laporan: requirements -> range -> SQL D1 -> konteks prompt.
 * Mengembalikan pesan NO_DATA bila periode kosong dan bukan riset strategi.
 */
export async function prepareReportAnalysis(input: {
	rawDb: D1Database;
	db: ReturnType<typeof getDrizzleDb>;
	branch: BranchContext;
	cleanQ: string;
	deps: AiDeps;
	history: unknown;
	webSearchFlag: boolean;
}): Promise<ReportPipelineReady | ReportPipelineEmpty> {
	const { rawDb, db, branch, cleanQ, deps, webSearchFlag } = input;
	const businessMemory = await getBusinessMemory(rawDb, branch);
	const sanitizedHistory = sanitizeChatHistory(input.history);
	const recentContext = recentContextForAi1(sanitizedHistory);
	const todayWita = toYMDWita(new Date());

	let dataRequirements = fastResolveRequirements(cleanQ, todayWita);
	if (!dataRequirements) {
		dataRequirements = await identifyDataRequirements(cleanQ, deps, recentContext);
	}

	const rangeContext: RangeContext = {
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

	const reportResult = await fetchReportDataSql(
		rawDb,
		branch,
		dataRequirements.periode.start,
		dataRequirements.periode.end
	);

	// Monitoring stok nonaktif: jawab deterministik tanpa memanggil gateway AI.
	if (reportResult.serverReportData.stokBahan?.monitoringPaused && isInventoryQuestion(cleanQ)) {
		return {
			kind: 'empty',
			payload: {
				code: 'NO_DATA',
				error:
					'Monitoring stok sedang dijeda untuk cabang ini sehingga saldo sistem bukan kondisi terkini. Lakukan hitung fisik untuk mengetahui stok aktual.',
				dateRange: `${dataRequirements.periode.start} hingga ${dataRequirements.periode.end}`,
				dataRequirements: {
					jenisData: dataRequirements.jenisData,
					prioritas: dataRequirements.prioritas,
					scope: dataRequirements.scope
				},
				suggestion:
					'Aktifkan kembali monitoring stok lewat pengaturan pemilik setelah rekonsiliasi fisik bila ingin analisis stok otomatis.'
			}
		};
	}

	const shouldSearchWeb = Boolean(webSearchFlag) || isWebSearchRequested(cleanQ);
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
		return {
			kind: 'empty',
			payload: {
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
			}
		};
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

	// Jika user menanyakan harga produk spesifik, ambil info produk dari DB
	if (dataRequirements.prioritas === 'product_analysis' && cleanQ.toLowerCase().includes('harga')) {
		try {
			const productsList = await db
				.select({
					id: produk.id,
					nama: produk.nama,
					harga: produk.harga
				})
				.from(produk)
				.where(eq(produk.cabang_id, branch))
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
		} catch {
			// Product-name enrichment is optional; the aggregate report can answer without it.
		}
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

	return {
		kind: 'ready',
		dataRequirements,
		rangeContext,
		reportContext,
		fullMessages: [
			{ role: 'system', content: systemPrompt },
			...sanitizedHistory,
			{ role: 'user', content: cleanQ }
		],
		shouldSearchWeb,
		businessMemory,
		sanitizedHistory
	};
}
