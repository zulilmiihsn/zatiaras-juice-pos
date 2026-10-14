/**
 * Orkestrasi HTTP asisten AI: rate-limit, gate halaman, dispatch, dan bentuk payload
 * JSON/SSE. Route hanya meneruskan parameter (termasuk kredensial provider dari env).
 * Modul ini TIDAK import $env agar suite unit tsx tetap jalan.
 */

import { type BranchContext, getD1Database, getDrizzleDb } from '../branchResolver';
import { getRawDb } from '../dataApiHelpers';
import { requireSessionBranch } from '../apiAuth';
import { consumeRateLimit } from '../rateLimit';
import { requirePageAccess } from '../pageAccess';
import {
	AI_STREAM_IDLE_MS,
	AI_STREAM_TOTAL_MS,
	AiGatewayError,
	publicAiErrorMessage,
	publicAiErrorStatus,
	pumpAiStream,
	redactForLog,
	requestAiStreamResilient,
	type AiTool
} from '../aiGateway';
import { parseMemoryCommand, runMemoryAction } from './businessMemory';
import {
	type AiDeps,
	analyzeBusinessData,
	buildProductPromptData,
	analyzeTransactionText,
	prepareReportAnalysis
} from './aiChatUseCase';

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

// Analisis Transaksi Teks Kasir
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

// Chat Laporan Finansial (Streaming SSE + SQL Agregasi + Multi-Turn)
export async function handleRegularChat(input: {
	platform: App.Platform | undefined;
	session: AiSession;
	rawBody: unknown;
	deps: AiDeps;
	chatModel: string;
	clientSignal: AbortSignal;
}): Promise<RegularChatResult> {
	const { platform, session, rawBody, chatModel, clientSignal } = input;
	// Semua panggilan upstream (non-stream maupun stream) ikut batal saat klien pergi.
	const deps: AiDeps = { ...input.deps, clientSignal };
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
			businessMemory,
			sanitizedHistory
		} = pipeline;

		// Budget AI Rp 0 — tool openrouter:web_search ditagih per pencarian, jadi
		// pencarian web dimatikan; shouldSearchWeb tetap dipakai untuk memilih prompt.
		const searchTools: AiTool[] | undefined = undefined;
		const webSearchUsed = Boolean(searchTools);

		// 1. Jika streaming diaktifkan (default) -> kembalikan SSE stream.
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
				// Body provider tak tepercaya tak masuk log; status cukup.
				console.error('[OpenRouter Stream Error]', upstreamRes.status);
				// Body respons gagal tidak dibaca; lepas koneksinya.
				upstreamRes.body?.cancel().catch(() => {
					// Best-effort.
				});
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
								webSearch: webSearchUsed
							})}\n\n`
						)
					);

					const reader = upstreamRes.body!.getReader();
					let buffer = '';

					// Baca upstream lewat pump berdeadline (total +
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
						// Pesan publik tetap per kelas; teks mentah
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

		// 2. Jika streaming dinonaktifkan (fallback non-streaming response)
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
				webSearch: webSearchUsed
			}
		};
	} catch (error) {
		// Log teredaksi; respons pesan tetap + status per kelas.
		// Putus klien bukan kegagalan provider: tidak dicatat sebagai error.
		if (!(error instanceof AiGatewayError && error.code === 'CLIENT_ABORTED')) {
			console.error('[AI Chat Error]', redactForLog(error));
		}
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
