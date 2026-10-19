import assert from 'node:assert/strict';
import { readJsonBody, readFormDataBody, RequestBodyError } from '../lib/server/requestBody';
import { POST as GANTIKEAMANAN_POST } from '../routes/api/gantikeamanan/+server';
import { POST as PIN_VERIFY_POST } from '../routes/api/pin/verify/+server';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { PRODUCT_IMAGE_MAX_BYTES } from '../lib/server/r2ObjectPolicy';

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

// Hanya boundary env SvelteKit yang diganti; parser, handler, dan stream tetap asli.
const envHook = registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '$env/dynamic/private')
			return { url: 'data:text/javascript,export const env={};', shortCircuit: true };
		return next(specifier, context);
	}
});
const { POST: UPLOAD_POST } = await import('../routes/api/upload/+server');
envHook.deregister();

await test('upload rejects oversized advertised multipart before parsing or storage access', async () => {
	const form = new FormData();
	form.set(
		'file',
		new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'jambu.png', {
			type: 'image/png'
		})
	);
	const request = post(form, {
		'content-length': String(PRODUCT_IMAGE_MAX_BYTES + 256 * 1024 + 1)
	});
	let parsed = false;
	const original = request.formData.bind(request);
	request.formData = async () => {
		parsed = true;
		return original();
	};
	const response = await UPLOAD_POST({
		request,
		platform: { env: {} },
		locals: { authSession: owner }
	} as Parameters<typeof UPLOAD_POST>[0]);
	assert.equal(response.status, 413);
	assert.equal(parsed, false);
	assert.equal(request.bodyUsed, false);
});

await test('upload enforces actual streamed bytes and cancels oversized multipart without trusting Content-Length', async () => {
	let pulls = 0;
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulls++;
			controller.enqueue(new Uint8Array(64 * 1024));
			if (pulls === 128) controller.close();
		},
		cancel() {
			cancelled = true;
		}
	});
	const request = new Request('http://localhost/api/upload', {
		method: 'POST',
		body: stream,
		duplex: 'half',
		headers: { 'content-type': 'multipart/form-data; boundary=fixture' }
	} as RequestInit);
	const response = await UPLOAD_POST({
		request,
		platform: { env: {} },
		locals: { authSession: owner }
	} as Parameters<typeof UPLOAD_POST>[0]);
	assert.equal(response.status, 413);
	assert.equal(cancelled, true);
	assert.ok(pulls < 128, 'stream harus dihentikan sebelum seluruh body dikonsumsi');
});

await test('bounded multipart preserves binary files and malformed forms return validation errors', async () => {
	const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const form = new FormData();
	form.set('file', new File([image], 'jambu.png', { type: 'image/png' }));
	const parsed = await readFormDataBody(post(form), 1024);
	const file = parsed.get('file');
	assert.ok(file instanceof File);
	assert.deepEqual(new Uint8Array(await file.arrayBuffer()), image);
	assert.equal(file.type, 'image/png');
	await rejects(
		readFormDataBody(
			post('invalid', { 'content-type': 'multipart/form-data; boundary=fixture' }),
			1024
		),
		400,
		'VALIDATION_ERROR'
	);
});

await test('upload keeps session branch ownership and signature checks while accepting a bounded file', async () => {
	const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	let writes = 0;
	let stored: Uint8Array | undefined;
	const bucket = {
		put: async (_key: string, body: ArrayBuffer | Uint8Array) => {
			writes++;
			stored = body instanceof Uint8Array ? body : new Uint8Array(body);
			return null;
		}
	};
	const makeForm = (type: string) => {
		const form = new FormData();
		form.set('file', new File([image], '../../jambu.png', { type }));
		form.set('branch', 'berau');
		return form;
	};
	const valid = await UPLOAD_POST({
		request: post(makeForm('image/png')),
		locals: { authSession: owner },
		platform: { env: { STORAGE: bucket } }
	} as Parameters<typeof UPLOAD_POST>[0]);
	assert.equal(valid.status, 200);
	const data = (await valid.json()) as { key: string; url: string };
	assert.match(data.key, /^produk\/samarinda\/[0-9a-f-]+\.png$/);
	assert.equal(writes, 1);
	assert.deepEqual(stored, image);
	const invalid = await UPLOAD_POST({
		request: post(makeForm('image/jpeg')),
		locals: { authSession: owner },
		platform: { env: { STORAGE: bucket } }
	} as Parameters<typeof UPLOAD_POST>[0]);
	assert.equal(invalid.status, 400);
	assert.equal(writes, 1);
});

await test('upload denies anonymous and cashier callers before consuming their bodies', async () => {
	for (const [session, status] of [
		[undefined, 401],
		[{ ...owner, role: 'kasir' }, 403]
	] as const) {
		const request = post('not-parsed');
		await assert.rejects(
			() =>
				UPLOAD_POST({
					request,
					locals: { authSession: session },
					platform: { env: {} }
				} as Parameters<typeof UPLOAD_POST>[0]),
			(error: unknown) =>
				typeof error === 'object' && error !== null && 'status' in error && error.status === status
		);
		assert.equal(request.bodyUsed, false);
	}
});

await test('JSON streaming preserves split UTF-8 and limits bytes rather than character count', async () => {
	const bytes = new TextEncoder().encode('"Café"');
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(bytes.subarray(0, 5));
			controller.enqueue(bytes.subarray(5));
			controller.close();
		}
	});
	const request = new Request('http://localhost/api/x', {
		method: 'POST',
		body,
		duplex: 'half'
	} as RequestInit);
	assert.equal(await readJsonBody(request, bytes.byteLength), 'Café');
	await rejects(readJsonBody(post('"Café"'), bytes.byteLength - 1), 413, 'PAYLOAD_TOO_LARGE');
});
