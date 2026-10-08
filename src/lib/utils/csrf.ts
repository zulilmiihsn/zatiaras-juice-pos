let cachedCsrfToken: string | null = null;

export async function getCsrfToken(forceRefresh: boolean = false): Promise<string> {
	if (cachedCsrfToken && !forceRefresh) {
		return cachedCsrfToken;
	}

	const response = await fetch('/api/csrf', {
		method: 'GET',
		credentials: 'include',
		// Token segar tiap ambil: tanpa no-store, browser boleh menyajikan
		// token basi dari cache HTTP (flaky 403 pada mutasi beruntun).
		cache: 'no-store'
	});

	if (!response.ok) {
		throw new Error('Gagal mendapatkan CSRF token');
	}

	const payload = await response.json();
	if (!payload?.token || typeof payload.token !== 'string') {
		throw new Error('CSRF token tidak valid');
	}

	const token = payload.token;
	cachedCsrfToken = token;
	return token;
}

export async function buildCsrfHeaders(baseHeaders: HeadersInit = {}): Promise<HeadersInit> {
	const token = await getCsrfToken();
	return {
		...baseHeaders,
		'X-CSRF-Token': token
	};
}

export async function fetchWithCsrfRetry(
	input: RequestInfo | URL,
	init: RequestInit = {}
): Promise<Response> {
	const firstHeaders = await buildCsrfHeaders(init.headers || {});
	const firstResponse = await fetch(input, {
		...init,
		headers: firstHeaders
	});

	if (firstResponse.status !== 403) {
		return firstResponse;
	}

	let responsePayload: { code?: string } | null = null;
	try {
		responsePayload = await firstResponse.clone().json();
	} catch {
		responsePayload = null;
	}

	if (responsePayload?.code !== 'CSRF_INVALID') {
		return firstResponse;
	}

	clearCsrfTokenCache();
	const refreshedToken = await getCsrfToken(true);
	const retryHeaders: HeadersInit = {
		...(init.headers || {}),
		'X-CSRF-Token': refreshedToken
	};

	return fetch(input, {
		...init,
		headers: retryHeaders
	});
}

export function clearCsrfTokenCache(): void {
	cachedCsrfToken = null;
}
