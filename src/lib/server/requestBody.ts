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
		readonly code: 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE' | 'VALIDATION_ERROR',
		message: string
	) {
		super(message);
		this.name = 'RequestBodyError';
	}
}

const tooLarge = () =>
	new RequestBodyError(413, 'PAYLOAD_TOO_LARGE', 'Data yang dikirim terlalu besar');
const invalid = () => new RequestBodyError(400, 'INVALID_JSON', 'Format data tidak valid');
const invalidForm = () =>
	new RequestBodyError(400, 'VALIDATION_ERROR', 'Form unggahan tidak valid');

async function* readBoundedChunks(
	request: Request,
	maxBytes: number,
	malformed: () => RequestBodyError = invalid
): AsyncGenerator<Uint8Array> {
	if (Number(request.headers.get('content-length')) > maxBytes) throw tooLarge();
	const reader = request.body?.getReader();
	if (!reader) throw malformed();
	let bytes = 0;
	try {
		for (;;) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch {
				throw malformed();
			}
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) {
				// Pembatalan best-effort: kegagalannya tidak boleh menyembunyikan penolakan ukuran.
				await reader.cancel().catch(() => undefined);
				throw tooLarge();
			}
			yield chunk.value;
		}
	} finally {
		reader.releaseLock();
	}
}

export async function readJsonBody(
	request: Request,
	maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<unknown> {
	const decoder = new TextDecoder();
	let text = '';
	for await (const chunk of readBoundedChunks(request, maxBytes))
		text += decoder.decode(chunk, { stream: true });
	text += decoder.decode();
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw invalid();
	}
}

/** Batas berlaku sebelum parser multipart mengalokasikan seluruh form dan File. */
export async function readFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	for await (const chunk of readBoundedChunks(request, maxBytes, invalidForm)) {
		chunks.push(chunk);
		total += chunk.byteLength;
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return await new Response(bytes, {
			headers: { 'Content-Type': request.headers.get('content-type') || '' }
		}).formData();
	} catch {
		throw invalidForm();
	}
}

/** Respons error body untuk route tier B (`{ success, code, message }`). */
export function bodyErrorResponse(cause: RequestBodyError): Response {
	return new Response(
		JSON.stringify({ success: false, code: cause.code, message: cause.message }),
		{ status: cause.status, headers: { 'Content-Type': 'application/json' } }
	);
}
