import type { AiReportEvent, AiReportMessage, AiReportMeta } from '$lib/types/ai';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';

export class AiReportError extends Error {
	name = 'AiReportError';
}

function invalidResponse(): never {
	throw new AiReportError('Format respons Asisten AI tidak valid. Silakan coba lagi.');
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
	return value as Record<string, unknown>;
}

function metadata(value: Record<string, unknown>): AiReportMeta {
	const result: AiReportMeta = {};
	if (value.webSearch !== undefined) {
		if (typeof value.webSearch !== 'boolean') invalidResponse();
		result.webSearch = value.webSearch;
	}
	if (value.dateRange !== undefined) {
		const range = record(value.dateRange);
		result.dateRange = {};
		for (const key of ['start', 'end', 'reasoning'] as const) {
			if (range[key] === undefined) continue;
			if (typeof range[key] !== 'string') invalidResponse();
			result.dateRange[key] = range[key];
		}
	}
	return result;
}

function parseEvent(data: string): AiReportEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		invalidResponse();
	}
	const event = record(parsed);
	switch (event.type) {
		case 'token':
			if (typeof event.text !== 'string') invalidResponse();
			return { type: 'token', text: event.text };
		case 'meta':
			return { type: 'meta', ...metadata(event) };
		case 'done':
			return { type: 'done' };
		case 'error':
			if (typeof event.error !== 'string') invalidResponse();
			return { type: 'error', error: event.error };
		default:
			// Future event kinds may be added without changing existing clients.
			return null;
	}
}

export async function* streamAiReport(input: {
	question: string;
	branch: string;
	history: ReadonlyArray<Pick<AiReportMessage, 'role' | 'content'>>;
	signal: AbortSignal;
}): AsyncGenerator<AiReportEvent> {
	const { signal } = input;
	signal.throwIfAborted();
	const response = await fetchWithCsrfRetry('/api/aichat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			question: input.question,
			branch: input.branch,
			stream: true,
			history: input.history
		}),
		signal
	});
	signal.throwIfAborted();
	if (!response.ok) {
		const data: unknown = await response.json().catch(() => ({}));
		const error = record(data);
		if (response.status !== 404) reportApiFailure(error, response.status, '/api/aichat');
		const message = getApiErrorMessage(
			error,
			response.status,
			`Gagal menghubungi AI (${response.status})`
		);
		throw new AiReportError(
			typeof error.suggestion === 'string'
				? `${message}\n\n_${error.suggestion}_`
				: `Error: ${message}`
		);
	}
	if (!response.headers.get('content-type')?.includes('text/event-stream')) {
		const result = record(await response.json());
		if (result.success !== true)
			throw new AiReportError(
				getApiErrorMessage(result, response.status, 'Terjadi kesalahan saat memproses pertanyaan.')
			);
		if (typeof result.answer !== 'string') invalidResponse();
		yield { type: 'meta', ...metadata(result) };
		yield { type: 'token', text: result.answer };
		yield { type: 'done' };
		return;
	}
	if (!response.body) invalidResponse();
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let dataLines: string[] = [];
	const cancel = () => {
		void reader.cancel().catch(() => {
			// Best-effort: a failed connection may already have closed its body.
		});
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		while (true) {
			signal.throwIfAborted();
			const chunk = await reader.read();
			signal.throwIfAborted();
			buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
			if (chunk.done) buffer += '\n\n';
			let newline: number;
			while ((newline = buffer.indexOf('\n')) !== -1) {
				const line = buffer.slice(0, newline).replace(/\r$/, '');
				buffer = buffer.slice(newline + 1);
				if (line.startsWith('data:')) {
					dataLines.push(line.slice(5).replace(/^ /, ''));
				} else if (line === '' && dataLines.length) {
					const event = parseEvent(dataLines.join('\n'));
					dataLines = [];
					if (event) yield event;
					if (event?.type === 'done') return;
				}
			}
			if (chunk.done) return;
		}
	} finally {
		signal.removeEventListener('abort', cancel);
		try {
			await reader.cancel();
		} catch {
			// Best-effort: preserve the original read/validation error when cancellation fails.
		}
		reader.releaseLock();
	}
}
