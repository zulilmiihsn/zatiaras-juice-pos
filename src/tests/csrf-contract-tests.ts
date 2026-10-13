import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { isCsrfProtectedRequest, reuseOrIssueCsrfToken } from '../lib/server/csrfPolicy';
import { clearCsrfTokenCache, fetchWithCsrfRetry, getCsrfToken } from '../lib/utils/csrf';

// Synthetic, not credentials; real random minting is exercised separately.
const cookieA = 'a'.repeat(64);
const cookieB = 'b'.repeat(64);

test('CSRF established cookie survives two interleaved caller refreshes without reissuing', () => {
	let issued = 0;
	const issue = () => {
		issued++;
		return cookieB;
	};
	for (let attempt = 0; attempt < 2; attempt++) {
		const heldHeader = reuseOrIssueCsrfToken(cookieA, issue);
		const competingCookie = reuseOrIssueCsrfToken(cookieA, issue);
		assert.equal(heldHeader, competingCookie);
		assert.equal(heldHeader, cookieA);
	}
	assert.equal(issued, 0);
});

test('CSRF missing/malformed/prototype/noncanonical cookie issues a new full-entropy token', () => {
	for (const value of [
		undefined,
		null,
		false,
		0,
		[],
		{},
		new String(cookieA),
		'',
		'a'.repeat(63),
		'a'.repeat(65),
		'A'.repeat(64),
		'g'.repeat(64),
		' ' + cookieA,
		cookieA + '\n'
	]) {
		let issued = 0;
		const token = reuseOrIssueCsrfToken(value, () => {
			issued++;
			return randomBytes(32).toString('hex');
		});
		assert.equal(issued, 1);
		assert.match(token, /^[a-f0-9]{64}$/);
	}
});

test('CSRF independently initialized cookie jars still mint independently; no fabricated global token', () => {
	const first = reuseOrIssueCsrfToken(undefined, () => cookieA);
	const second = reuseOrIssueCsrfToken(undefined, () => cookieB);
	assert.notEqual(first, second);
	assert.equal(
		reuseOrIssueCsrfToken(undefined, () => cookieB),
		cookieB,
		'An absent/expired cookie is reissued, not taken from server-global cache'
	);
});

test('CSRF protection keeps all mutating methods and exact existing exemptions', () => {
	for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
		for (const path of [
			'/api/buku-kas',
			'/api/bahan/purchase',
			'/api/csrf/foreign',
			'/api/veriflogin/foreign'
		])
			assert.equal(isCsrfProtectedRequest(path, method), true);
		for (const path of ['/api/csrf', '/api/veriflogin', '/api/logout'])
			assert.equal(isCsrfProtectedRequest(path, method), false);
	}
	for (const method of ['GET', 'HEAD', 'OPTIONS'])
		assert.equal(isCsrfProtectedRequest('/api/buku-kas', method), false);
});

test('CSRF client refresh still performs a fresh no-store network read, not forced cookie rotation', async () => {
	const originalFetch = globalThis.fetch;
	clearCsrfTokenCache();
	let calls = 0;
	globalThis.fetch = async (input, init) => {
		assert.equal(input, '/api/csrf');
		assert.equal(init?.credentials, 'include');
		assert.equal(init?.cache, 'no-store');
		calls++;
		return Response.json({ token: cookieA });
	};
	try {
		assert.equal(await getCsrfToken(), cookieA);
		assert.equal(await getCsrfToken(), cookieA);
		assert.equal(calls, 1);
		assert.equal(await getCsrfToken(true), cookieA);
		assert.equal(calls, 2);
	} finally {
		globalThis.fetch = originalFetch;
		clearCsrfTokenCache();
	}
});

test('CSRF client permits exactly one identified retry and retains immutable request intent', async () => {
	const originalFetch = globalThis.fetch;
	const requestBody = JSON.stringify({
		payload: { id: 'owned-csrf-client-intent', nominal: 25001 }
	});
	try {
		for (const outcome of [
			'recover',
			'still-invalid',
			'other-forbidden',
			'server-failure',
			'malformed-forbidden'
		] as const) {
			clearCsrfTokenCache();
			let gets = 0,
				mutations = 0;
			globalThis.fetch = async (input, init) => {
				if (input === '/api/csrf') {
					gets++;
					return Response.json({ token: gets === 1 ? cookieA : cookieB });
				}
				mutations++;
				assert.equal(input, '/api/buku-kas');
				assert.equal(init?.method, 'PATCH');
				assert.equal(init?.body, requestBody);
				const headers = new Headers(init?.headers);
				assert.equal(headers.get('Content-Type'), 'application/json');
				assert.equal(headers.get('X-CSRF-Token'), mutations === 1 ? cookieA : cookieB);
				if (outcome === 'server-failure')
					return Response.json({ code: 'SERVER_ERROR' }, { status: 500 });
				if (outcome === 'malformed-forbidden') return new Response('not-json', { status: 403 });
				if (outcome === 'other-forbidden')
					return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
				if (outcome === 'recover' && mutations === 2) return Response.json({ success: true });
				return Response.json({ code: 'CSRF_INVALID' }, { status: 403 });
			};
			const response = await fetchWithCsrfRetry('/api/buku-kas', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: requestBody
			});
			const retries = outcome === 'recover' || outcome === 'still-invalid';
			assert.equal(mutations, retries ? 2 : 1);
			assert.equal(gets, retries ? 2 : 1);
			assert.equal(
				response.status,
				outcome === 'recover' ? 200 : outcome === 'server-failure' ? 500 : 403
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
		clearCsrfTokenCache();
	}
});
