import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { getD1Database, getDrizzleDb, type BranchContext } from '$lib/server/branchResolver';
import { getRawDb } from '$lib/server/dataApiHelpers';
import { requireAuthSession, requireSessionBranch } from '$lib/server/apiAuth';
import { consumeRateLimit } from '$lib/server/rateLimit';
import { requirePageAccess } from '$lib/server/pageAccess';
import { requestAiStreamResilient } from '$lib/server/aiGateway';
import {
	analyzeBusinessData,
	analyzeTransactionText,
	buildProductPromptData,
	parseMemoryCommand,
	prepareReportAnalysis,
	runMemoryAction
} from '$lib/server/ai/aiChatUseCase';

// [CATATAN]: OpenRouter / AI Model configuration (env). Daftar fallback model,
// timeout, dan retry dimiliki $lib/server/aiGateway; orkestrasi AI di aiChatUseCase.
const OPENROUTER_API_URL = env.AI_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free';
const MODEL = env.AI_MODEL || env.OPENROUTER_MODEL || DEFAULT_MODEL;

function getOpenRouterApiKey(platform: any): string | undefined {
	return (
		((platform?.env as Record<string, unknown> | undefined)?.OPENROUTER_API_KEY as string) ||
		env.OPENROUTER_API_KEY
	);
}

function getOpenRouterModel(platform: any): string {
	const platformEnv = platform?.env as Record<string, unknown> | undefined;
	return (
		(platformEnv?.AI_MODEL as string) ||
		(platformEnv?.OPENROUTER_MODEL as string) ||
		env.AI_MODEL ||
		env.OPENROUTER_MODEL ||
		DEFAULT_MODEL
	);
}

const AI_WINDOW_MS = 15 * 60 * 1000;
const AI_MAX_REQUESTS = 40;

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

		const apiKey = getOpenRouterApiKey(event.platform);
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

		const analysis = await analyzeTransactionText(
			text,
			{ apiKey, model: MODEL, url: OPENROUTER_API_URL },
			productData
		);
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

		const apiKey = getOpenRouterApiKey(event.platform);
		if (!apiKey) {
			return json(
				{
					success: false,
					error:
						'API key OpenRouter tidak dikonfigurasi. Silakan tambahkan OPENROUTER_API_KEY di file .env atau Cloudflare Secrets',
					code: 'SERVICE_UNAVAILABLE'
				},
				{ status: 500 }
			);
		}

		let requestedBranch: BranchContext;
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

		// Perintah memori bisnis (simpan/lihat/hapus) — logika di aiChatUseCase.
		const memoryCommand = parseMemoryCommand(cleanQ);
		if (memoryCommand) {
			const { answer } = await runMemoryAction(rawDb, requestedBranch, memoryCommand);
			return json({
				success: true,
				answer,
				isMemoryAction: true
			});
		}

		// Pipeline agregasi laporan — logika di aiChatUseCase.
		const pipeline = await prepareReportAnalysis({
			rawDb,
			db,
			branch: requestedBranch,
			cleanQ,
			deps: { apiKey, model: MODEL, url: OPENROUTER_API_URL },
			history,
			webSearchFlag: body.webSearch
		});
		if (pipeline.kind === 'empty') {
			return json({ success: false, ...pipeline.payload }, { status: 404 });
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
			const chatModel = getOpenRouterModel(event.platform);
			const upstreamRes = await requestAiStreamResilient(apiKey, OPENROUTER_API_URL, fullMessages, {
				title: 'Zatiaras POS - Business Analyst',
				maxTokens: 2500,
				temperature: 0.6,
				model: chatModel,
				tools: searchTools,
				errorLabel: 'AI Stream Error'
			});

			if (!upstreamRes.ok || !upstreamRes.body) {
				const errText = await upstreamRes.text().catch(() => '');
				console.error('[OpenRouter Stream Error]', upstreamRes.status, errText);
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
			{ apiKey, model: MODEL, url: OPENROUTER_API_URL },
			sanitizedHistory,
			businessMemory,
			searchTools
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
		console.error('[AI Chat 500 Error]', error);
		const errorMsg =
			error instanceof Error && error.message
				? error.message
				: 'Terjadi kesalahan saat memproses pertanyaan. Silakan coba lagi.';
		return json(
			{
				success: false,
				error: errorMsg,
				code: 'SERVER_ERROR'
			},
			{ status: 500 }
		);
	}
}
