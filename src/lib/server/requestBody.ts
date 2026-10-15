/**
 * Satu-satunya pintu baca body JSON request API: batas ukuran dibaca per chunk (tanpa
 * menunggu seluruh body masuk memori) dan error seragam. JSON rusak = 400 INVALID_JSON,
 * body kebesaran = 413 PAYLOAD_TOO_LARGE. Route memetakan RequestBodyError ke respons
 * sesuai tier kontraknya.
 */

/** Cukup untuk checkout 100 item bertoken harga dan riwayat chat AI; jauh di bawah batas Cloudflare. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export class RequestBodyError extends Error {
	constructor(
		readonly status: 400 | 413,
		readonly code: 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE',
		message: string
	) {
		super(message);
		this.name = 'RequestBodyError';
	}
}

const tooLarge = () =>
	new RequestBodyError(413, 'PAYLOAD_TOO_LARGE', 'Data yang dikirim terlalu besar');
const invalid = () => new RequestBodyError(400, 'INVALID_JSON', 'Format data tidak valid');

export async function readJsonBody(
	request: Request,
	maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<unknown> {
	if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
	const reader = request.body?.getReader();
	if (!reader) throw invalid();
	const decoder = new TextDecoder();
	let text = '';
	let bytes = 0;
	try {
		for (;;) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch {
				throw invalid();
			}
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw tooLarge();
			}
			text += decoder.decode(chunk.value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw invalid();
	}
}

/** Respons error body untuk route tier B (`{ success, code, message }`). */
export function bodyErrorResponse(cause: RequestBodyError): Response {
	return new Response(
		JSON.stringify({ success: false, code: cause.code, message: cause.message }),
		{ status: cause.status, headers: { 'Content-Type': 'application/json' } }
	);
}
