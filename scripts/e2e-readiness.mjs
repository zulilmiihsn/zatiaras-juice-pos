const MAX_LOGIN_HTML_BYTES = 512 * 1024;

export async function ensureE2eApplicationReady(baseURL, remainingMs) {
	const url = new URL(baseURL);
	if (
		url.protocol !== 'http:' ||
		url.hostname !== '127.0.0.1' ||
		!url.port ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/'
	) {
		throw new Error('E2E readiness requires the exact owned loopback origin');
	}
	if (!Number.isSafeInteger(remainingMs) || remainingMs <= 0 || remainingMs > 120000) {
		throw new Error('E2E application startup budget exhausted or invalid');
	}
	const response = await fetch(new URL('/login', url), {
		redirect: 'error',
		credentials: 'omit',
		cache: 'no-store',
		headers: { Accept: 'text/html' },
		signal: AbortSignal.timeout(remainingMs)
	});
	await validateRenderedLoginResponse(response);
}

export async function validateRenderedLoginResponse(response) {
	if (
		response.status !== 200 ||
		!response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
	) {
		await response.body?.cancel();
		throw new Error(`E2E login readiness rejected status/content-type (${response.status})`);
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error('E2E login readiness missing body');
	const chunks = [];
	let bytes = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_LOGIN_HTML_BYTES) throw new Error('E2E login readiness HTML budget exceeded');
			chunks.push(Buffer.from(value));
		}
	} catch (error) {
		// Preserve the readiness failure; cancellation is best-effort after an aborted/failed body.
		await reader.cancel().catch(() => undefined);
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (!/<form(?:\s|>)/i.test(Buffer.concat(chunks).toString('utf8'))) {
		throw new Error('E2E login readiness missing rendered form');
	}
}
