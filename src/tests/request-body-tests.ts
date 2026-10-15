import assert from 'node:assert/strict';
import { readJsonBody, RequestBodyError } from '../lib/server/requestBody';
import { POST as GANTIKEAMANAN_POST } from '../routes/api/gantikeamanan/+server';
import { POST as PIN_VERIFY_POST } from '../routes/api/pin/verify/+server';

// Semua route API membaca body JSON lewat satu pintu: JSON rusak 400, kebesaran 413.
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
	new Request('http://localhost/api/x', { method: 'POST', body, headers });

const rejects = async (promise: Promise<unknown>, status: number, code: string) => {
	await assert.rejects(
		promise,
		(error: unknown) =>
			error instanceof RequestBodyError && error.status === status && error.code === code
	);
};

assert.deepEqual(await readJsonBody(post('{"a":1}')), { a: 1 });
await rejects(readJsonBody(post('{"a":')), 400, 'INVALID_JSON');
await rejects(readJsonBody(post('')), 400, 'INVALID_JSON');
// Batas dari header dan dari byte yang benar-benar dialirkan.
await rejects(
	readJsonBody(post('{}', { 'content-length': '2000' }), 1000),
	413,
	'PAYLOAD_TOO_LARGE'
);
await rejects(
	readJsonBody(
		new Request('http://localhost/api/x', {
			method: 'POST',
			duplex: 'half',
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(`"${'x'.repeat(2000)}"`));
					controller.close();
				}
			})
		} as RequestInit),
		1000
	),
	413,
	'PAYLOAD_TOO_LARGE'
);

// Route tier B: JSON rusak dijawab 400 INVALID_JSON, bukan 500 SERVER_ERROR.
const owner = {
	id: 's-owner',
	userId: 'u-owner',
	username: 'pemilik',
	role: 'pemilik',
	branch: 'samarinda',
	createdAt: 0,
	expiresAt: Date.now() + 60_000,
	unlockedPages: [],
	unlockExpiresAt: 0
};
const login = (await GANTIKEAMANAN_POST({
	request: post('{rusak'),
	getClientAddress: () => '127.0.0.1',
	locals: { authSession: owner },
	platform: { env: {} }
} as never)) as Response;
assert.equal(login.status, 400);
assert.equal(((await login.json()) as { code: string }).code, 'INVALID_JSON');

// Route tier A: JSON rusak menjadi HttpError 400 sebelum logika apa pun.
await assert.rejects(
	async () =>
		PIN_VERIFY_POST({
			request: post('{rusak'),
			platform: { env: {} },
			locals: {
				authSession: {
					id: 's',
					userId: 'u',
					username: 'k',
					role: 'kasir',
					branch: 'samarinda',
					createdAt: 0,
					expiresAt: Date.now() + 60_000,
					unlockedPages: [],
					unlockExpiresAt: 0
				}
			}
		} as never),
	(error: unknown) => (error as { status?: number }).status === 400
);

console.log('request-body-tests: JSON rusak 400, body kebesaran 413, tier A dan B seragam');
