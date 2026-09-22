/**
 * OpenRouter gateway khusus server — satu-satunya tempat yang boleh memanggil
 * upstream AI. Menegakkan timeout, fallback model, dan typed error.
 *
 * Batasan:
 * - Tidak import SvelteKit, store, atau browser global. Murni fetch + timer.
 * - API key tidak pernah masuk pesan error.
 * - Tiap percobaan (primary, retry tanpa tools, tiap fallback) punya deadline
 *   sendiri. Sebelumnya fallback/streaming tanpa timeout bisa gantung selamanya.
 * - Urutan fallback, retry tanpa tools, dan fallback `|| ''` dipertahankan
 *   dari perilaku route lama agar parity terjaga.
 */

export interface AiChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface AiTool {
	type: string;
	[key: string]: unknown;
}

export type AiGatewayErrorCode = 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR' | 'INVALID_RESPONSE';

export class AiGatewayError extends Error {
	readonly code: AiGatewayErrorCode;
	readonly status?: number;
	readonly model?: string;

	constructor(
		code: AiGatewayErrorCode,
		message: string,
		options?: { status?: number; model?: string }
	) {
		super(message);
		this.name = 'AiGatewayError';
		this.code = code;
		this.status = options?.status;
		this.model = options?.model;
	}
}

export interface AiChatOptions {
	title: string;
	maxTokens: number;
	temperature: number;
	/** Model resolved (route meneruskan default dari env). */
	model: string;
	fallbacks?: string[];
	tools?: AiTool[];
	errorLabel: string;
	timeoutMs?: number;
}

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_TIMEOUT_MS = 25_000;
export const AI_FALLBACK_MODELS = [
	'nvidia/nemotron-3.5-lightning:free',
	'inclusionai/ling-3.0-flash-fin:free'
];

type FetchImpl = typeof fetch;

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function headers(apiKey: string, title: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'HTTP-Referer': 'https://zatiaraspos.com',
		'X-Title': title
	};
}

function chatPayload(
	model: string,
	messages: AiChatMessage[],
	opts: Pick<AiChatOptions, 'maxTokens' | 'temperature' | 'tools'>,
	withTools: boolean,
	stream: boolean
): string {
	const payload: Record<string, unknown> = {
		model,
		messages,
		max_tokens: opts.maxTokens,
		temperature: opts.temperature
	};
	if (withTools && opts.tools && opts.tools.length > 0) {
		payload.tools = opts.tools;
	}
	if (stream) payload.stream = true;
	return JSON.stringify(payload);
}

/**
 * Satu percobaan POST dengan deadline sendiri.
 * AbortError -> UPSTREAM_TIMEOUT (pesan memakai errorLabel, tanpa apiKey).
 */
async function attemptPost(
	url: string,
	apiKey: string,
	headerTitle: string,
	body: string,
	timeoutMs: number,
	errorLabel: string,
	fetchImpl: FetchImpl
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(url, {
			method: 'POST',
			headers: headers(apiKey, headerTitle),
			body,
			signal: controller.signal
		});
	} catch (error) {
		if (isAbortError(error)) {
			throw new AiGatewayError('UPSTREAM_TIMEOUT', `${errorLabel}: upstream timeout`);
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function hasTools(tools?: AiTool[]): boolean {
	return !!tools && tools.length > 0;
}

function extractContent(data: unknown): string | null {
	if (typeof data !== 'object' || data === null || !('choices' in data)) return null;
	const choices = (data as { choices: unknown }).choices;
	if (!Array.isArray(choices)) return null;
	const first = choices[0];
	if (typeof first !== 'object' || first === null || !('message' in first)) return null;
	const message = (first as { message: unknown }).message;
	if (typeof message !== 'object' || message === null || !('content' in message)) return null;
	const content = (message as { content: unknown }).content;
	return typeof content === 'string' ? content : null;
}

async function readJson(response: Response, errorLabel: string): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new AiGatewayError('INVALID_RESPONSE', `${errorLabel}: respons upstream tidak valid`);
	}
}

/**
 * Chat completion non-streaming dengan fallback model & retry tanpa tools.
 * Parity route lama: pesan error `${errorLabel}: <status>`, fallback `|| ''`.
 * Tambahan: tiap percobaan dibatasi timeout (dulu fallback tanpa timeout).
 */
export async function callAiChat(
	apiKey: string,
	url: string,
	messages: AiChatMessage[],
	opts: AiChatOptions,
	fetchImpl: FetchImpl = fetch
): Promise<string> {
	const timeoutMs = opts.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
	const useTools = hasTools(opts.tools);
	const fallbacks = (opts.fallbacks ?? AI_FALLBACK_MODELS).filter((m) => m !== opts.model);

	let response = await attemptPost(
		url,
		apiKey,
		opts.title,
		chatPayload(opts.model, messages, opts, useTools, false),
		timeoutMs,
		opts.errorLabel,
		fetchImpl
	);

	// Jika gagal saat menyertakan tools, coba ulang tanpa tools.
	if (!response.ok && useTools) {
		response = await attemptPost(
			url,
			apiKey,
			`${opts.title} (No Tools)`,
			chatPayload(opts.model, messages, opts, false, false),
			timeoutMs,
			opts.errorLabel,
			fetchImpl
		);
	}

	if (!response.ok) {
		for (const [index, model] of fallbacks.entries()) {
			const isLast = index === fallbacks.length - 1;
			try {
				let fallbackRes = await attemptPost(
					url,
					apiKey,
					`${opts.title} (Fallback ${model})`,
					chatPayload(model, messages, opts, useTools, false),
					timeoutMs,
					opts.errorLabel,
					fetchImpl
				);
				if (!fallbackRes.ok && useTools) {
					fallbackRes = await attemptPost(
						url,
						apiKey,
						`${opts.title} (Fallback ${model} No Tools)`,
						chatPayload(model, messages, opts, false, false),
						timeoutMs,
						opts.errorLabel,
						fetchImpl
					);
				}
				if (fallbackRes.ok) {
					let data: unknown;
					try {
						data = await fallbackRes.json();
					} catch {
						continue;
					}
					return extractContent(data) ?? '';
				}
			} catch (error) {
				// Timeout pada fallback terakhir diteruskan apa adanya agar
				// diagnosis benar; selain itu lanjut seperti perilaku lama.
				if (error instanceof AiGatewayError && error.code === 'UPSTREAM_TIMEOUT' && isLast) {
					throw error;
				}
				if (!isLast) continue;
				break;
			}
		}
		throw new AiGatewayError('UPSTREAM_ERROR', `${opts.errorLabel}: ${response.status}`, {
			status: response.status,
			model: opts.model
		});
	}

	const content = extractContent(await readJson(response, opts.errorLabel));
	if (content === null) {
		throw new AiGatewayError(
			'INVALID_RESPONSE',
			`${opts.errorLabel}: respons upstream tidak valid`,
			{
				model: opts.model
			}
		);
	}
	return content;
}

/**
 * Satu percobaan stream dengan deadline untuk respons awal.
 * Timeout hanya membatasi respons awal (headers), bukan seluruh aliran body.
 */
export async function requestAiStream(
	apiKey: string,
	url: string,
	messages: AiChatMessage[],
	opts: Pick<
		AiChatOptions,
		'title' | 'maxTokens' | 'temperature' | 'model' | 'tools' | 'timeoutMs' | 'errorLabel'
	>,
	fetchImpl: FetchImpl = fetch
): Promise<Response> {
	const timeoutMs = opts.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
	return attemptPost(
		url,
		apiKey,
		opts.title,
		chatPayload(opts.model, messages, opts, hasTools(opts.tools), true),
		timeoutMs,
		opts.errorLabel,
		fetchImpl
	);
}

/**
 * Stream tangguh: primary -> retry tanpa tools -> tiap fallback (+retry tanpa tools).
 * Mengembalikan respons terakhir bila semua gagal (route memetakan ke 502),
 * atau melempar error terakhir bila tidak ada respons sama sekali.
 */
export async function requestAiStreamResilient(
	apiKey: string,
	url: string,
	messages: AiChatMessage[],
	opts: Pick<
		AiChatOptions,
		| 'title'
		| 'maxTokens'
		| 'temperature'
		| 'model'
		| 'fallbacks'
		| 'tools'
		| 'timeoutMs'
		| 'errorLabel'
	>,
	fetchImpl: FetchImpl = fetch
): Promise<Response> {
	const useTools = hasTools(opts.tools);
	const models = [opts.model, ...(opts.fallbacks ?? AI_FALLBACK_MODELS)].filter(
		(model, index, all) => all.indexOf(model) === index
	);
	let lastResponse: Response | null = null;
	let lastError: unknown = null;

	for (const [index, model] of models.entries()) {
		const baseTitle = index === 0 ? opts.title : `${opts.title} (Fallback ${model})`;
		const noToolsTitle =
			index === 0 ? `${opts.title} (No Tools)` : `${opts.title} (Fallback ${model} No Tools)`;
		try {
			let response = await requestAiStream(
				apiKey,
				url,
				messages,
				{ ...opts, title: baseTitle, model },
				fetchImpl
			);
			if (!response.ok && useTools) {
				response = await requestAiStream(
					apiKey,
					url,
					messages,
					{ ...opts, title: noToolsTitle, model, tools: undefined },
					fetchImpl
				);
			}
			lastResponse = response;
			if (response.ok && response.body) return response;
		} catch (error) {
			lastError = error;
		}
	}

	if (lastResponse) return lastResponse;
	throw lastError instanceof Error
		? lastError
		: new AiGatewayError('UPSTREAM_ERROR', `${opts.errorLabel}: upstream tidak merespons`);
}
