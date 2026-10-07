/**
 * OpenRouter gateway khusus server — satu-satunya tempat yang boleh memanggil
 * upstream AI. Menegakkan timeout, fallback model, dan typed error.
 *
 * Batasan:
 * - Tidak import SvelteKit, store, atau browser global. Murni fetch + timer.
 * - API key tidak pernah masuk pesan error.
 * - Tiap percobaan (primary, retry tanpa tools, tiap fallback) punya deadline
 *   respons awal sendiri; baca body non-stream ikut deadline via readJson.
 * - Aliran stream diikat pumpAiStream (deadline total + idle + abort klien).
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

/**
 * Pesan publik tetap per kelas error (AUD-037). Teks mentah provider/
 * Error tak pernah jadi respons publik. Kode respons tetap dalam
 * registry kontrak (SERVER_ERROR); status membedakan retryability
 * (504 timeout, 502 upstream, 500 tak dikenal) — UI memperlakukan
 * semua 5xx seragam sehingga kompatibel.
 */
export function publicAiErrorMessage(error: unknown): string {
	if (error instanceof AiGatewayError) {
		if (error.code === 'UPSTREAM_TIMEOUT') {
			return 'Asisten AI kehabisan waktu. Silakan coba lagi.';
		}
		if (error.code === 'INVALID_RESPONSE') {
			return 'Respons AI tidak valid. Silakan coba lagi.';
		}
		return 'Asisten AI sementara tidak dapat merespons. Silakan coba lagi.';
	}
	return 'Terjadi kesalahan saat memproses pertanyaan. Silakan coba lagi.';
}

export function publicAiErrorStatus(error: unknown): number {
	if (error instanceof AiGatewayError) {
		if (error.code === 'UPSTREAM_TIMEOUT') return 504;
		return 502;
	}
	return 500;
}

const SENSITIVE_LOG_PATTERNS = [
	/sk-[A-Za-z0-9\-_]{4,}/g,
	/Bearer\s+[A-Za-z0-9\-_.~+/=]+/g,
	/OPENROUTER_API_KEY\s*[:=]\s*\S+/gi,
	/\bpassword\s*[:=]\s*\S+/gi
];

/**
 * Redaksi untuk log server (AUD-037): pola kredensial disamarkan,
 * panjang dibatasi. Pesan error mentah tak boleh lolos utuh ke log.
 */
export function redactForLog(value: unknown, maxLength = 500): string {
	const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value ?? '');
	let redacted = text;
	for (const pattern of SENSITIVE_LOG_PATTERNS) {
		pattern.lastIndex = 0;
		redacted = redacted.replace(pattern, '[redacted]');
	}
	return redacted.slice(0, maxLength);
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
	/** Sinyal putus klien: diteruskan agar upstream ikut batal. */
	clientSignal?: AbortSignal | null;
}

export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_TIMEOUT_MS = 25_000;
export const AI_FALLBACK_MODELS = [
	'nvidia/nemotron-3.5-lightning:free',
	'inclusionai/ling-3.0-flash-fin:free'
];
// AUD-034: deadline body/stream. attemptPost hanya membatasi respons awal
// (headers); baca body + aliran stream diikat deadline sendiri agar
// stall tak gantung worker selamanya.
export const AI_BODY_TIMEOUT_MS = 60_000;
export const AI_STREAM_TOTAL_MS = 120_000;
export const AI_STREAM_IDLE_MS = 30_000;

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
 * clientSignal (putus klien) diteruskan agar upstream ikut batal.
 */
async function attemptPost(
	url: string,
	apiKey: string,
	headerTitle: string,
	body: string,
	timeoutMs: number,
	errorLabel: string,
	fetchImpl: FetchImpl,
	clientSignal?: AbortSignal | null
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onClientAbort = () => controller.abort();
	if (clientSignal) {
		if (clientSignal.aborted) controller.abort();
		else clientSignal.addEventListener('abort', onClientAbort, { once: true });
	}
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
		clientSignal?.removeEventListener('abort', onClientAbort);
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

async function readJson(
	response: Response,
	errorLabel: string,
	timeoutMs: number = AI_BODY_TIMEOUT_MS
): Promise<unknown> {
	// AUD-034: body stall ikut deadline (bukan cuma headers).
	const timeout = new Promise<never>((_, reject) => {
		setTimeout(
			() => reject(new AiGatewayError('UPSTREAM_TIMEOUT', `${errorLabel}: upstream timeout`)),
			timeoutMs
		);
	});
	try {
		return (await Promise.race([response.json(), timeout])) as unknown;
	} catch (error) {
		if (error instanceof AiGatewayError) throw error;
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
		fetchImpl,
		opts.clientSignal ?? null
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
			fetchImpl,
			opts.clientSignal ?? null
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
					fetchImpl,
					opts.clientSignal ?? null
				);
				if (!fallbackRes.ok && useTools) {
					fallbackRes = await attemptPost(
						url,
						apiKey,
						`${opts.title} (Fallback ${model} No Tools)`,
						chatPayload(model, messages, opts, false, false),
						timeoutMs,
						opts.errorLabel,
						fetchImpl,
						opts.clientSignal ?? null
					);
				}
				if (fallbackRes.ok) {
					// AUD-034: body ikut deadline; timeout/invalid ikut semantik catch lama.
					const data = await readJson(fallbackRes, opts.errorLabel, timeoutMs);
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

	const content = extractContent(await readJson(response, opts.errorLabel, timeoutMs));
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
 * Timeout attemptPost hanya membatasi respons awal (headers);
 * aliran body diikat pumpAiStream oleh pemanggil (route).
 */
export async function requestAiStream(
	apiKey: string,
	url: string,
	messages: AiChatMessage[],
	opts: Pick<
		AiChatOptions,
		| 'title'
		| 'maxTokens'
		| 'temperature'
		| 'model'
		| 'tools'
		| 'timeoutMs'
		| 'errorLabel'
		| 'clientSignal'
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
		fetchImpl,
		opts.clientSignal ?? null
	);
}

/**
 * Pompa stream upstream dengan deadline total + idle (AUD-034).
 * - Selesai upstream atau onChunk minta berhenti -> 'done'.
 * - Putus klien -> batalkan reader, kembalikan 'aborted' (tanpa lempar).
 * - Deadline total/idle -> batalkan reader, lempar UPSTREAM_TIMEOUT.
 * - Timer/listener selalu dibersihkan; lock reader dilepas.
 * Retry/fallback di hulu (resilient) tak pernah mengulang stream yang
 * sudah menghasilkan output: pump hanya dipakai untuk respons ok final.
 */
export async function pumpAiStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	opts: {
		totalMs?: number;
		idleMs?: number;
		errorLabel: string;
		clientSignal?: AbortSignal | null;
		onChunk: (value: Uint8Array) => boolean | void;
	}
): Promise<'done' | 'aborted'> {
	const totalMs = opts.totalMs ?? AI_STREAM_TOTAL_MS;
	const idleMs = opts.idleMs ?? AI_STREAM_IDLE_MS;
	let totalTimer: ReturnType<typeof setTimeout> | null = null;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let timeoutError: AiGatewayError | null = null;

	const tripTimeout = () => {
		if (!timeoutError) {
			timeoutError = new AiGatewayError('UPSTREAM_TIMEOUT', `${opts.errorLabel}: upstream timeout`);
		}
		reader.cancel().catch(() => {
			// Best-effort: koneksi upstream dilepas sebisanya.
		});
	};
	const onClientAbort = () => {
		reader.cancel().catch(() => {
			// Best-effort.
		});
	};
	if (opts.clientSignal) {
		if (opts.clientSignal.aborted) {
			return 'aborted';
		}
		opts.clientSignal.addEventListener('abort', onClientAbort, { once: true });
	}

	const armIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(tripTimeout, idleMs);
	};

	totalTimer = setTimeout(tripTimeout, totalMs);

	try {
		armIdle();
		while (true) {
			let read: ReadableStreamReadResult<Uint8Array>;
			try {
				read = await reader.read();
			} catch (error) {
				if (timeoutError) throw timeoutError;
				if (opts.clientSignal?.aborted || isAbortError(error)) {
					return 'aborted';
				}
				throw error;
			}
			// Cancel membuat read pending selesai; deadline menang atas done.
			if (timeoutError) throw timeoutError;
			if (opts.clientSignal?.aborted) return 'aborted';
			if (read.done) return 'done';
			armIdle();
			const stop = opts.onChunk(read.value);
			if (stop === true) return 'done';
		}
	} finally {
		if (totalTimer) clearTimeout(totalTimer);
		if (idleTimer) clearTimeout(idleTimer);
		opts.clientSignal?.removeEventListener('abort', onClientAbort);
		try {
			reader.releaseLock();
		} catch {
			// Sudah dilepas pemanggil lain.
		}
	}
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
		| 'clientSignal'
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
				{ ...opts, title: baseTitle, model, clientSignal: opts.clientSignal ?? null },
				fetchImpl
			);
			if (!response.ok && useTools) {
				response = await requestAiStream(
					apiKey,
					url,
					messages,
					{
						...opts,
						title: noToolsTitle,
						model,
						tools: undefined,
						clientSignal: opts.clientSignal ?? null
					},
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
