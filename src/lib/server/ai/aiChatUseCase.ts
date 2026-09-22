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
import type { BranchId } from '../branchResolver';
import type { getDrizzleDb } from '../branchResolver';
import { eq } from 'drizzle-orm';
import { kategori, produk, tambahan } from '../../database/schema';
import { formatRupiah } from '$lib/utils/currency';
import { resolveAiPeriod, hasPeriodQualifier, detectAiIntent } from '../aiPeriod';
import { callAiChat } from '../aiGateway';
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

/** Ambil daftar memori & target bisnis cabang dari tabel pengaturan */
export async function getBusinessMemory(rawDb: D1Database, branch: BranchId): Promise<string> {
	try {
		const row = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
			)
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

/** Simpan catatan / target bisnis ke memori permanen cabang (maksimal 10). */
export async function saveBusinessMemoryNote(
	rawDb: D1Database,
	branch: BranchId,
	note: string
): Promise<string[]> {
	const currentNotes: string[] = [];
	try {
		const row = (await rawDb
			.prepare(
				`SELECT nilai FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory' LIMIT 1`
			)
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
export async function clearBusinessMemory(rawDb: D1Database, branch: BranchId): Promise<void> {
	await rawDb
		.prepare(`DELETE FROM pengaturan WHERE cabang_id = ? AND kunci = 'ai_business_memory'`)
		.bind(branch)
		.run();
}

/** Jalankan perintah memori dan bangun teks jawaban. */
export async function runMemoryAction(
	rawDb: D1Database,
	branch: BranchId,
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
	branch: BranchId
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
	branch: BranchId;
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
