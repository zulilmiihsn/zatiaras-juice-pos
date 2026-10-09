/**
 * AI chat use case — orkestrasi asisten laporan & analisis transaksi.
 *
 * Route (`src/routes/api/aichat/+server.ts`) hanya: auth, rate-limit, parsing,
 * panggil fungsi di sini, bangun respons HTTP/SSE. Seluruh klasifikasi intent,
 * memori bisnis, requirement analyzer, agregasi laporan, dan prompt Tawanan
 * tinggal di sini atau di modul $lib/server/ai/.
 *
 * Tidak import SvelteKit runtime maupun modul route.
 */
import type { D1Database } from '@cloudflare/workers-types';
import type { BranchContext } from '../branchResolver';
import { getD1Database, getDrizzleDb } from '../branchResolver';
import { getRawDb } from '../dataApiHelpers';
import { requireSessionBranch } from '../apiAuth';
import { consumeRateLimit } from '../rateLimit';
import { requirePageAccess } from '../pageAccess';
import { eq } from 'drizzle-orm';
import { kategori, produk, tambahan } from '../../database/schema';
import { formatRupiah } from '$lib/utils/currency';
import { resolveAiPeriod, hasPeriodQualifier, detectAiIntent } from '../aiPeriod';
import {
	AI_STREAM_IDLE_MS,
	AI_STREAM_TOTAL_MS,
	callAiChat,
	publicAiErrorMessage,
	publicAiErrorStatus,
	pumpAiStream,
	redactForLog,
	requestAiStreamResilient
} from '../aiGateway';
import type { AiChatMessage, AiTool } from '../aiGateway';
import {
	buildIdentifyDataRequirementsPrompt,
	buildAnalyzeBusinessDataPrompt,
	buildAnalyzeTransactionTextPrompt,
	parseDataRequirements,
	type DataRequirements
} from './prompts';
import { fetchReportDataSql, buildReportContext, type RangeContext } from './reportData';

export type ChatMessage = AiChatMessage;

export interface AiDeps {
	apiKey: string;
	model: string;
	url: string;
}

/** Bersihkan markdown code-fence atau teks percakapan dan ekstrak object JSON murni. */
export function extractJsonFromText(content: string): string {
	let clean = content.trim();
	const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	if (fenceMatch) {
		clean = fenceMatch[1].trim();
	}
	const firstBrace = clean.indexOf('{');
	const lastBrace = clean.lastIndexOf('}');
	if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
		clean = clean.slice(firstBrace, lastBrace + 1).trim();
	}
	return clean;
}

/** Format YYYY-MM-DD dalam zona waktu WITA (UTC+8). */
export function toYMDWita(date: Date): string {
	const utcTime = date.getTime();
	const witaTime = new Date(utcTime + 8 * 60 * 60 * 1000);
	return witaTime.toISOString().slice(0, 10);
}

/**
 * Fast-path intent & date resolver (F27): periode eksplisit dulu, lalu intent.
 * Ambigu/tak dikenali -> null agar analyzer lanjutan dipakai.
 */
export function fastResolveRequirements(
	question: string,
	todayWita: string
): DataRequirements | null {
	const q = question.toLowerCase().trim();
	const period = resolveAiPeriod(q, todayWita);
	if (hasPeriodQualifier(q) && !period) return null;
	const intent = detectAiIntent(q);
	if (!intent) return null;
	const resolved = period ?? {
		start: `${todayWita.slice(0, 7)}-01`,
		end: todayWita,
		type: 'monthly' as const
	};
	try {
		return parseDataRequirements(
			{
				periode: resolved,
				jenisData: intent.jenisData,
				prioritas: intent.prioritas,
				scope: intent.scope
			},
			todayWita
		);
	} catch {
		return null;
	}
}

/** Deteksi apakah pertanyaan memerlukan riset eksternal ke web/internet */
export function isWebSearchRequested(question: string): boolean {
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
export function isStrategicQuestion(question: string): boolean {
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
		'cara',
		'harus apa',
		'apa yang harus',
		'saran',
		'menurutmu',
		'pendapatmu',
		'gimana',
		'bagaimana',
		'maju',
		'laris',
		'ramai',
		'sepi',
		'kaya',
		'sukses',
		'tingkatkan',
		'kembangkan',
		'evaluasi',
		'solusi',
		'ide',
		'bantu',
		'digital marketing',
		'local seo',
		'reciprocity',
		'loss aversion',
		'promosi'
	];
	return keywords.some((kw) => q.includes(kw));
}

/** Deteksi apakah pertanyaan seputar stok/inventaris bahan baku */
export function isInventoryQuestion(question: string): boolean {
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

/** Format tanggal untuk prompt AI (locale id-ID, deterministik input -> output). */
export function formatDateForAI(dateStr: string): string {
	const parts = dateStr.split('-');
	const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
	return date.toLocaleDateString('id-ID', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

/** Saring riwayat multi-turn: 10 bubble terakhir, konten dibatasi 1500 char. */
export function sanitizeChatHistory(history: unknown): ChatMessage[] {
	if (!Array.isArray(history)) return [];
	return history
		.slice(-10)
		.filter(
			(m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
		)
		.map((m) => ({
			role: m.role as 'user' | 'assistant',
			content: String(m.content).slice(0, 1500)
		}));
}

/** Ringkasan 4 bubble terakhir untuk konteks AI 1. */
export function recentContextForAi1(history: ChatMessage[]): string {
	return history
		.slice(-4)
		.map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 250)}`)
		.join('\n');
}

export type MemoryCommand =
	{ type: 'save'; note: string } | { type: 'view' } | { type: 'clear' } | null;

/** Klasifikasi perintah memori bisnis dari pertanyaan yang sudah di-trim. */
export function parseMemoryCommand(cleanQ: string): MemoryCommand {
	const rememberMatch = cleanQ.match(
		/^(?:ingat|catat|simpan(?:\s+catatan)?|tambah(?:\s+memori)?)\s*:\s*(.+)$/i
	);
	if (rememberMatch) return { type: 'save', note: rememberMatch[1].trim() };

	const qLower = cleanQ.toLowerCase();
	if (
		qLower === 'lihat memori' ||
		qLower === 'lihat catatan bisnis' ||
		qLower === 'cek memori' ||
		qLower === 'apa saja memorimu?' ||
		qLower === 'catatan bisnis' ||
		qLower.includes('catatan bisnis yang tersimpan')
	) {
		return { type: 'view' };
	}
	if (
		qLower === 'hapus memori' ||
		qLower === 'reset memori' ||
		qLower === 'hapus catatan bisnis' ||
		qLower === 'bersihkan memori'
	) {
		return { type: 'clear' };
	}
	return null;
}

function parseBusinessMemoryNotes(raw: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new Error('Memori bisnis tersimpan rusak; simpan catatan baru dibatalkan.', { cause });
	}
	if (
		!parsed ||
		typeof parsed !== 'object' ||
		!('catatan' in parsed) ||
		!Array.isArray(parsed.catatan) ||
		!parsed.catatan.every((note): note is string => typeof note === 'string')
	) {
		throw new Error('Format memori bisnis tersimpan tidak valid; simpan catatan baru dibatalkan.');
	}
	return parsed.catatan;
}

/** Ambil daftar memori & target bisnis cabang dari tabel pengaturan */
export async function getBusinessMemory(rawDb: D1Database, branch: BranchContext): Promise<string> {
	try {
		const row = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
			)
			.bind(branch)
			.first()) as { nilai?: string } | null;
		if (row?.nilai) {
			const notes = parseBusinessMemoryNotes(row.nilai);
			return notes.map((note, index) => `${index + 1}. ${note}`).join('\n');
		}
	} catch (error) {
		// Best-effort context for AI: answering without memory is safer than blocking the chat.
		console.warn('[AI] Business memory unavailable; continuing without it', error);
	}
	return '';
}

/** Simpan catatan / target bisnis ke memori permanen cabang (maksimal 10). */
export async function saveBusinessMemoryNote(
	rawDb: D1Database,
	branch: BranchContext,
	note: string
): Promise<string[]> {
	const currentNotes: string[] = [];
	const row = (await rawDb
		.prepare(
			`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
		)
		.bind(branch)
		.first()) as { nilai?: string } | null;
	if (row?.nilai) currentNotes.push(...parseBusinessMemoryNotes(row.nilai));

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
export async function clearBusinessMemory(rawDb: D1Database, branch: BranchContext): Promise<void> {
	await rawDb
		.prepare(`DELETE FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory'`)
		.bind(branch)
		.run();
}

/** Jalankan perintah memori dan bangun teks jawaban. */
export async function runMemoryAction(
	rawDb: D1Database,
	branch: BranchContext,
	action: Exclude<MemoryCommand, null>
): Promise<{ answer: string }> {
	if (action.type === 'save') {
		const updatedNotes = await saveBusinessMemoryNote(rawDb, branch, action.note);
		return {
			answer:
				`Catatan bisnis berhasil disimpan ke memori permanen cabang **${branch}**:\n\n` +
				updatedNotes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
				`\n\n_Catatan ini akan otomatis dijadikan tolok ukur acuan pada setiap analisis laporan mendatang._`
		};
	}
	if (action.type === 'view') {
		const memoryText = await getBusinessMemory(rawDb, branch);
		return {
			answer: memoryText
				? `Berikut catatan memori bisnis cabang **${branch}** saat ini:\n\n${memoryText}\n\n_Ketik \`Ingat: <catatan>\` untuk menambah, atau \`Hapus memori\` untuk mereset._`
				: `Belum ada catatan memori bisnis untuk cabang **${branch}**.\n\nKetik contoh: \`Ingat: Target omzet bulan ini 50 juta\` untuk mengajari AI acuan tokomu.`
		};
	}
	await clearBusinessMemory(rawDb, branch);
	return {
		answer: `Seluruh catatan memori bisnis cabang **${branch}** telah berhasil dibersihkan.`
	};
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
				errorLabel: 'AI 1 Error'
			})) || '{}';

		const cleanContent = extractJsonFromText(content);
		const parsed: unknown = JSON.parse(cleanContent);
		return parseDataRequirements(parsed, todayWita);
	} catch (error) {
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
			errorLabel: 'AI 3 Error'
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

// ---------------------------------------------------------------------------
// Orkestrasi HTTP route (AUD-053): auth/rate-limit + dispatch + bangun payload.
// Route hanya teruskan parameter (termasuk kredensial provider dari env),
// kembalikan json/stream. Seluruh SQL, provider AI, dan shaping tinggal di sini.
// Modul ini TIDAK import $env agar suite unit tsx tetap jalan.
// ---------------------------------------------------------------------------

const AI_WINDOW_MS = 15 * 60 * 1000;
const AI_MAX_REQUESTS = 40;

export interface AiRouteResult {
	status: number;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
}

export type AiSession = NonNullable<App.Locals['authSession']>;

export async function checkAiChatRateLimit(
	platform: App.Platform | undefined,
	branch: BranchContext,
	userId: string
): Promise<AiRouteResult | null> {
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
	const rateLimit = await consumeRateLimit(
		db,
		branch,
		`aichat:user:${userId}`,
		AI_MAX_REQUESTS,
		AI_WINDOW_MS,
		platform
	);

	if (!rateLimit.available) {
		return {
			status: 503,
			body: {
				success: false,
				error: 'AI chat sementara tidak tersedia. Coba lagi beberapa saat.',
				code: 'RATE_LIMITER_UNAVAILABLE'
			},
			headers: { 'Retry-After': '5' }
		};
	}
	if (!rateLimit.allowed) {
		return {
			status: 429,
			body: {
				success: false,
				error: 'Terlalu banyak request. Coba lagi beberapa menit lagi.',
				code: 'RATE_LIMITED',
				retryAfterSeconds: rateLimit.retryAfterSeconds
			},
			headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) }
		};
	}
	return null;
}

export async function checkAiChatPageAccess(
	platform: App.Platform | undefined,
	branch: BranchContext,
	session: AiSession
): Promise<void> {
	const db = getD1Database(platform?.env as Record<string, unknown> | undefined, branch);
	await requirePageAccess(db, session, 'laporan');
}

// [CATATAN]: Analisis Transaksi Teks Kasir
export async function handleAnalyzeTransaction(
	platform: App.Platform | undefined,
	branch: BranchContext,
	rawBody: unknown,
	deps: AiDeps
): Promise<AiRouteResult> {
	const fail = (status: number, body: Record<string, unknown>): AiRouteResult => ({
		status,
		body
	});
	try {
		const { text } = (rawBody ?? {}) as { text?: unknown };
		if (!text || typeof text !== 'string') {
			return fail(400, {
				success: false,
				error: 'Teks transaksi diperlukan',
				code: 'VALIDATION_ERROR'
			});
		}
		if (text.length > 2000) {
			return fail(400, {
				success: false,
				error: 'Teks transaksi terlalu panjang',
				code: 'VALIDATION_ERROR'
			});
		}

		const apiKey = deps.apiKey;
		if (!apiKey) {
			return fail(500, {
				success: false,
				error: 'API key OpenRouter tidak dikonfigurasi',
				code: 'SERVICE_UNAVAILABLE'
			});
		}

		let productData = '';
		try {
			productData = await buildProductPromptData(getDrizzleDb(platform, branch), branch);
		} catch {
			productData = 'Data produk tidak tersedia saat ini.';
		}

		const analysis = await analyzeTransactionText(text, deps, productData);
		return {
			status: 200,
			body: {
				success: true,
				transactions: analysis.transactions,
				confidence: analysis.confidence,
				recommendations: analysis.recommendations
			}
		};
	} catch {
		return fail(500, {
			success: false,
			error: 'Terjadi kesalahan saat menganalisis transaksi',
			code: 'SERVER_ERROR'
		});
	}
}

export type RegularChatResult =
	| { kind: 'json'; status: number; body: Record<string, unknown> }
	| { kind: 'stream'; stream: ReadableStream<Uint8Array> };

// [CATATAN]: Chat Laporan Finansial (Streaming SSE + SQL Agregasi + Multi-Turn)
export async function handleRegularChat(input: {
	platform: App.Platform | undefined;
	session: AiSession;
	rawBody: unknown;
	deps: AiDeps;
	chatModel: string;
	clientSignal: AbortSignal;
}): Promise<RegularChatResult> {
	const { platform, session, rawBody, deps, chatModel, clientSignal } = input;
	const fail = (status: number, body: Record<string, unknown>): RegularChatResult => ({
		kind: 'json',
		status,
		body
	});
	try {
		const body = (rawBody ?? {}) as {
			question?: unknown;
			branch?: unknown;
			stream?: unknown;
			history?: unknown;
			webSearch?: unknown;
		};
		const { question, stream = true, history } = body;

		if (!question || typeof question !== 'string') {
			return fail(400, {
				success: false,
				error: 'Pertanyaan diperlukan',
				code: 'VALIDATION_ERROR'
			});
		}

		const cleanQ = question.trim();
		if (!cleanQ) {
			return fail(400, {
				success: false,
				error: 'Pertanyaan tidak boleh kosong',
				code: 'VALIDATION_ERROR'
			});
		}

		if (cleanQ.length > 2000) {
			return fail(400, {
				success: false,
				error: 'Pertanyaan terlalu panjang',
				code: 'VALIDATION_ERROR'
			});
		}

		const apiKey = deps.apiKey;
		if (!apiKey) {
			return fail(500, {
				success: false,
				error: 'Kunci AI belum dikonfigurasi. Minta pemilik mengaktifkannya atau lanjut tanpa AI.',
				code: 'SERVICE_UNAVAILABLE'
			});
		}

		let requestedBranch: BranchContext;
		try {
			requestedBranch = requireSessionBranch(
				{ authSession: session } as App.Locals,
				body.branch as string | null
			);
		} catch {
			return fail(403, {
				success: false,
				error: 'Branch tidak sesuai session',
				code: 'BRANCH_FORBIDDEN'
			});
		}

		const rawDb = getRawDb(platform, requestedBranch);
		const db = getDrizzleDb(platform, requestedBranch);

		// Perintah memori bisnis (simpan/lihat/hapus) — logika di modul ini.
		const memoryCommand = parseMemoryCommand(cleanQ);
		if (memoryCommand) {
			const { answer } = await runMemoryAction(rawDb, requestedBranch, memoryCommand);
			return {
				kind: 'json',
				status: 200,
				body: {
					success: true,
					answer,
					isMemoryAction: true
				}
			};
		}

		// Pipeline agregasi laporan — logika di modul ini.
		const pipeline = await prepareReportAnalysis({
			rawDb,
			db,
			branch: requestedBranch,
			cleanQ,
			deps,
			history,
			webSearchFlag: body.webSearch as boolean
		});
		if (pipeline.kind === 'empty') {
			return { kind: 'json', status: 404, body: { success: false, ...pipeline.payload } };
		}
		const {
			dataRequirements,
			rangeContext,
			reportContext,
			fullMessages,
			shouldSearchWeb,
			businessMemory,
			sanitizedHistory
		} = pipeline;

		const searchTools = shouldSearchWeb ? [{ type: 'openrouter:web_search' }] : undefined;

		// [CATATAN]: 1. Jika streaming diaktifkan (default) -> kembalikan SSE stream.
		// Retry tanpa tools + fallback model ditangani aiGateway (dengan timeout).
		if (stream !== false) {
			const upstreamRes = await requestAiStreamResilient(apiKey, deps.url, fullMessages, {
				title: 'Zatiaras POS - Business Analyst',
				maxTokens: 2500,
				temperature: 0.6,
				model: chatModel,
				tools: searchTools,
				errorLabel: 'AI Stream Error',
				clientSignal
			});

			if (!upstreamRes.ok || !upstreamRes.body) {
				// AUD-037: body provider tak tepercaya tak masuk log; status cukup.
				console.error('[OpenRouter Stream Error]', upstreamRes.status);
				return fail(502, {
					success: false,
					error: 'Asisten AI sementara tidak dapat merespons. Silakan coba lagi.'
				});
			}

			const encoder = new TextEncoder();
			const decoder = new TextDecoder();

			const sseStream = new ReadableStream<Uint8Array>({
				async start(controller) {
					const safeEnqueue = (bytes: Uint8Array) => {
						try {
							controller.enqueue(bytes);
						} catch {
							// Klien pergi: hentikan diam-diam.
						}
					};
					const safeClose = () => {
						try {
							controller.close();
						} catch {
							// Sudah tutup.
						}
					};
					// Kirim meta data pertama kali
					safeEnqueue(
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

					// AUD-034: baca upstream lewat pump berdeadline (total +
					// idle) + abort putus klien; reader selalu dilepas.
					try {
						const outcome = await pumpAiStream(reader, {
							totalMs: AI_STREAM_TOTAL_MS,
							idleMs: AI_STREAM_IDLE_MS,
							errorLabel: 'AI Stream Error',
							clientSignal,
							onChunk: (value) => {
								buffer += decoder.decode(value, { stream: true });
								const lines = buffer.split('\n');
								buffer = lines.pop() || '';

								for (const line of lines) {
									const trimmed = line.trim();
									if (!trimmed || trimmed.startsWith(':')) continue;
									if (trimmed.startsWith('data: ')) {
										const dataStr = trimmed.slice(6).trim();
										if (dataStr === '[DONE]') return true;
										try {
											const parsed = JSON.parse(dataStr);
											const token = parsed.choices?.[0]?.delta?.content;
											if (token) {
												safeEnqueue(
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
								return false;
							}
						});
						if (outcome === 'done') {
							safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
						}
						safeClose();
					} catch (err: unknown) {
						// AUD-037: pesan publik tetap per kelas; teks mentah
						// (SQL/skema/endpoint/kredensial) tak pernah ke SSE.
						safeEnqueue(
							encoder.encode(
								`data: ${JSON.stringify({ type: 'error', error: publicAiErrorMessage(err) })}\n\n`
							)
						);
						safeClose();
					}
				}
			});

			return { kind: 'stream', stream: sseStream };
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
			deps,
			sanitizedHistory,
			businessMemory,
			searchTools
		);

		return {
			kind: 'json',
			status: 200,
			body: {
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
			}
		};
	} catch (error) {
		// AUD-037: log teredaksi; respons pesan tetap + status per kelas.
		console.error('[AI Chat Error]', redactForLog(error));
		return {
			kind: 'json',
			status: publicAiErrorStatus(error),
			body: {
				success: false,
				error: publicAiErrorMessage(error),
				code: 'SERVER_ERROR'
			}
		};
	}
}
