import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptBranchRelay, createBranchIngress } from '../lib/server/branchIngress';
import { readBranchAccountDeployment } from '../lib/server/branchAccountDeployment';
import type { BranchId } from '../lib/server/branchResolver';
import { isBranchStorageKey } from '../lib/server/branchStoragePolicy';
import { createBranchStorageGateway } from '../lib/server/branchStorageGateway';
import { createBranchStorageClient } from '../lib/server/branchStorageClient';

const origin = 'https://kasir.example.test';
const routeSecret = 'r'.repeat(32);
const sessionCookie = 'zatiaras_sid';
const backends = new Map<BranchId, { origin: string; secret: string }>([
	['samarinda', { origin: 'https://samarinda.example.test', secret: 's'.repeat(32) }],
	['balikpapan', { origin: 'https://balikpapan.example.test', secret: 'a'.repeat(32) }],
	['berau', { origin: 'https://berau.example.test', secret: 'b'.repeat(32) }]
]);
const reply = () => new Response(null, { status: 204 });
const loginRequest = (branch: string) =>
	new Request(`${origin}/api/veriflogin`, {
		method: 'POST',
		headers: {
			origin,
			'content-type': 'application/json',
			'x-zatiaras-relay-key': 'spoofed',
			'cf-connecting-ip': '192.0.2.1',
			'x-zatiaras-relay-client-ip': '192.0.2.100'
		},
		body: JSON.stringify({ branch, username: 'kasir', password: 'uji' })
	});

function fixture() {
	const called: string[] = [];
	const outages = new Set<BranchId>();
	const handle = createBranchIngress({
		origin,
		backends,
		routeSecret,
		sessionCookie,
		servePublic: async () => reply(),
		forward: async (request) => {
			const url = new URL(request.url);
			const entry = [...backends].find(([, backend]) => backend.origin === url.origin);
			assert.ok(entry);
			const [branch, backend] = entry;
			called.push(branch);
			assert.equal(request.redirect, 'manual');
			const internal = acceptBranchRelay(request, {
				branch,
				secret: backend.secret,
				publicOrigin: origin
			});
			assert.ok(internal);
			assert.equal(internal.headers.get('x-zatiaras-relay-key'), null);
			assert.equal(internal.headers.get('x-zatiaras-relay-branch'), null);
			assert.equal(new URL(internal.url).origin, origin);
			if (url.pathname === '/api/upload' && request.method === 'GET') {
				assert.equal(internal.headers.get('cookie'), null);
				assert.equal(internal.headers.get('authorization'), null);
			}
			if (outages.has(branch)) throw new Error('Backend offline');
			if (url.pathname === '/api/veriflogin') {
				assert.equal(internal.headers.get('origin'), origin);
				assert.equal(internal.headers.get('cf-connecting-ip'), '192.0.2.1');
				assert.equal(internal.headers.get('x-zatiaras-relay-client-ip'), null);
				assert.deepEqual(await internal.json(), { branch, username: 'kasir', password: 'uji' });
				const response = Response.json({ success: true });
				response.headers.append(
					'set-cookie',
					`${sessionCookie}=fixture-${branch}; Path=/; HttpOnly`
				);
				response.headers.append('set-cookie', 'zatiaras_csrf=csrf; Path=/');
				return response;
			}
			return Response.json({ branch, url: internal.url, body: await internal.text() });
		}
	});
	return { handle, called, outages };
}

test('satu origin mengikat rute pada sesi dan mempertahankan cookie, path, serta body', async () => {
	const { handle, called } = fixture();
	assert.equal((await handle(new Request(`${origin}/login`))).status, 204);
	assert.deepEqual(called, []);
	const response = await handle(loginRequest('berau'));
	const cookies = response.headers.getSetCookie();
	assert.equal(cookies.length, 3);
	assert.match(
		cookies[2],
		/^__Host-zatiaras_branch=berau\.[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict$/
	);
	const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
	const follow = await handle(
		new Request(`${origin}//other.test/operasional?/sale`, {
			method: 'POST',
			headers: { cookie },
			body: 'form-data'
		})
	);
	assert.deepEqual(await follow.json(), {
		branch: 'berau',
		url: `${origin}//other.test/operasional?/sale`,
		body: 'form-data'
	});
	assert.equal(
		(
			await handle(
				new Request(`${origin}/operasional`, {
					headers: { cookie: cookie.replace('fixture-berau', 'fixture-samarinda') }
				})
			)
		).status,
		401
	);
	assert.equal(
		(
			await handle(
				new Request(`${origin}/operasional`, {
					headers: { cookie: cookie.replace('branch=berau.', 'branch=balikpapan.') }
				})
			)
		).status,
		401
	);
	assert.deepEqual(called, ['berau', 'berau']);
});

test('gambar publik hanya dirutekan lewat key bercabang; jalur arsip dan tulis tetap butuh sesi', async () => {
	const { handle, called } = fixture();
	const image = (key: string, init?: RequestInit) =>
		handle(
			new Request(`${origin}/api/upload?${new URLSearchParams({ key, branch: 'samarinda' })}`, init)
		);
	const valid = await image('produk/berau/1234.webp', {
		headers: { cookie: 'fixture', authorization: 'fixture' }
	});
	assert.equal(valid.status, 200);
	const data = await valid.json();
	assert.equal(data.branch, 'berau');
	assert.deepEqual([...new URL(data.url).searchParams], [['key', 'produk/berau/1234.webp']]);
	for (const key of [
		'arsip/berau/data.json',
		'produk/1234.webp',
		'produk/berau/../abcd.webp',
		'produk/unknown/1234.webp'
	])
		assert.equal((await image(key)).status, 404);
	assert.equal((await image('produk/berau/1234.webp', { method: 'POST' })).status, 401);
	assert.equal((await handle(new Request(`${origin}/api/archive/download`))).status, 401);
	assert.deepEqual(called, ['berau']);
});

test('penyimpanan bersama hanya menerima key gambar dan arsip milik cabang', () => {
	for (const branch of ['samarinda', 'balikpapan', 'berau'] as const) {
		assert.equal(isBranchStorageKey(branch, `produk/${branch}/1234-abcd.webp`), true);
		assert.equal(
			isBranchStorageKey(branch, `arsip/${branch}/2025/arsip-${branch}-sebelum-2025-1234abcd.json`),
			true
		);
		for (const key of [
			'produk/1234.webp',
			`produk/${branch}/../abcd.webp`,
			`arsip/${branch}/2025/../../secret.json`,
			`arsip/${branch}/2025/data.txt`,
			`arsip/${branch}/2025/arsip-berau-sebelum-2025.json`,
			`private/${branch}/x`,
			'produk/unknown/1234.webp',
			'produk/berau/1234.webp?x'
		])
			assert.equal(isBranchStorageKey(branch, key), false, key);
	}
	assert.equal(isBranchStorageKey('samarinda', 'produk/berau/1234.webp'), false);
});

test('relay R2 membatasi identitas, cabang, operasi, ukuran dan kegagalan bucket', async () => {
	const secrets = new Map<BranchId, string>([
		['samarinda', 's'.repeat(32)],
		['balikpapan', 'b'.repeat(32)],
		['berau', 'r'.repeat(32)]
	]);
	let value: Uint8Array | undefined;
	let fail = false;
	const handle = createBranchStorageGateway(
		{
			async put(_key, bytes) {
				if (fail) throw new Error('secret');
				value = bytes;
			},
			async get() {
				if (fail) throw new Error('secret');
				return value
					? {
							body: new ReadableStream({
								start(c) {
									c.enqueue(value!);
									c.close();
								}
							}),
							httpMetadata: { contentType: 'image/png' }
						}
					: null;
			},
			async delete() {
				value = undefined;
			}
		},
		secrets
	);
	const request = (
		secret: string,
		key: string,
		method = 'GET',
		body?: Uint8Array,
		contentType = 'image/png'
	) =>
		handle(
			new Request(`https://storage.test/object?${new URLSearchParams({ key })}`, {
				method,
				headers: { 'x-storage-secret': secret, 'content-type': contentType },
				body: body ? new Uint8Array(body).buffer : undefined
			})
		);
	const own = 'produk/berau/1234.png';
	assert.equal((await request('invalid', own)).status, 401);
	assert.equal((await request(secrets.get('samarinda')!, own)).status, 404);
	assert.equal((await request(secrets.get('berau')!, own, 'PUT', new Uint8Array([1]))).status, 204);
	assert.deepEqual(
		[...new Uint8Array(await (await request(secrets.get('berau')!, own)).arrayBuffer())],
		[1]
	);
	assert.equal(
		(await request(secrets.get('berau')!, own, 'PUT', new Uint8Array(5 * 1024 * 1024 + 1))).status,
		413
	);
	assert.equal(
		(
			await request(
				secrets.get('berau')!,
				'arsip/berau/2025/arsip-berau-sebelum-2025-1234abcd.json',
				'DELETE'
			)
		).status,
		403
	);
	fail = true;
	const failed = await request(secrets.get('berau')!, own);
	assert.equal(failed.status, 503);
	assert.equal(await failed.text(), '');
});

test('adapter R2 meneruskan metadata dan readback serta gagal tertutup saat relay gagal', async () => {
	const secrets = new Map<BranchId, string>([
		['samarinda', 's'.repeat(32)],
		['balikpapan', 'b'.repeat(32)],
		['berau', 'r'.repeat(32)]
	]);
	let stored: Uint8Array | undefined;
	let metadata: Record<string, string> | undefined;
	let fail = false;
	const gateway = createBranchStorageGateway(
		{
			async put(_key, value, options) {
				if (fail) throw new Error('storage down');
				stored = value;
				metadata = options.customMetadata;
			},
			async get() {
				if (fail) throw new Error('storage down');
				const bytes = stored;
				return bytes
					? {
							body: new ReadableStream({
								start(c) {
									c.enqueue(bytes);
									c.close();
								}
							}),
							httpMetadata: { contentType: 'application/json' }
						}
					: null;
			},
			async delete() {
				stored = undefined;
			}
		},
		secrets
	);
	const client = createBranchStorageClient(
		'berau',
		'https://storage.test',
		secrets.get('berau')!,
		gateway
	);
	const key = 'arsip/berau/2025/arsip-berau-sebelum-2025-1234abcd.json';
	assert.equal(await client.get(key), null);
	await client.put(key, '{"test":true}', {
		httpMetadata: { contentType: 'application/json' },
		customMetadata: { branch: 'berau', sha256: '1234' }
	});
	assert.deepEqual(metadata, { branch: 'berau', sha256: '1234' });
	assert.equal(await (await client.get(key))!.text(), '{"test":true}');
	await assert.rejects(() =>
		client.put(key, '{}', {
			httpMetadata: { contentType: 'application/json' },
			customMetadata: { branch: 'samarinda' }
		})
	);
	await assert.rejects(() => client.get('produk/samarinda/1234.png'));
	fail = true;
	await assert.rejects(() => client.get(key), /sementara tidak tersedia/);
	await assert.rejects(
		() => client.put(key, '{}', { httpMetadata: { contentType: 'application/json' } }),
		/sementara tidak tersedia/
	);
	assert.throws(() =>
		createBranchStorageClient('berau', 'http://storage.test', secrets.get('berau')!, gateway)
	);
});

test('rute yang gagal tidak diteruskan ke cabang lain dan tidak membuat cookie', async () => {
	const { handle, called, outages } = fixture();
	outages.add('samarinda');
	assert.equal((await handle(loginRequest('unknown'))).status, 400);
	const tooLarge = await handle(
		new Request(`${origin}/api/veriflogin`, { method: 'POST', body: 'x'.repeat(8193) })
	);
	assert.equal(tooLarge.status, 413);
	const failure = await handle(loginRequest('samarinda'));
	assert.equal(failure.status, 503);
	assert.equal(failure.headers.has('set-cookie'), false);
	assert.equal((await handle(loginRequest('balikpapan'))).status, 200);
	assert.deepEqual(called, ['samarinda', 'balikpapan']);
});

test('konfigurasi gagal tertutup bila gateway atau backend membawa binding cabang lain', () => {
	const common = { BRANCH_PUBLIC_ORIGIN: origin };
	const gateway = { ...common, BRANCH_ACCOUNT_MODE: 'gateway', BRANCH_ROUTE_SECRET: routeSecret };
	const gatewayWithRoutes = Object.assign(
		gateway,
		Object.fromEntries(
			[...backends].flatMap(([branch, backend]) => [
				[`BRANCH_ORIGIN_${branch.toUpperCase()}`, backend.origin],
				[`BRANCH_RELAY_${branch.toUpperCase()}`, backend.secret]
			])
		)
	);
	assert.equal(readBranchAccountDeployment(gatewayWithRoutes).mode, 'gateway');
	assert.throws(
		() => readBranchAccountDeployment({ ...gatewayWithRoutes, DB_SAMARINDA_GROUP: {} }),
		/gateway tidak boleh/i
	);
	const backend = {
		...common,
		BRANCH_ACCOUNT_MODE: 'backend',
		BRANCH_ACCOUNT_IDENTITY: 'berau',
		BRANCH_RELAY_SECRET: 'b'.repeat(32),
		REALTIME_HUB: {},
		DB_BERAU_GROUP: {}
	};
	assert.equal(readBranchAccountDeployment(backend).mode, 'backend');
	assert.throws(
		() => readBranchAccountDeployment({ ...backend, DB_SAMARINDA_GROUP: {} }),
		/koordinator cabangnya sendiri/i
	);
	assert.throws(
		() => readBranchAccountDeployment({ ...backend, BRANCH_ACCOUNT_IDENTITY: 'samarinda' }),
		/koordinator cabangnya sendiri/i
	);
});

test('backend menolak akses langsung dan identitas cabang yang tidak cocok', () => {
	const backend = backends.get('berau')!;
	const opt = { branch: 'berau', secret: backend.secret, publicOrigin: origin } as const;
	assert.equal(acceptBranchRelay(new Request(backend.origin), opt), null);
	assert.equal(
		acceptBranchRelay(
			new Request(backend.origin, {
				headers: { 'x-zatiaras-relay-key': backend.secret, 'x-zatiaras-relay-branch': 'samarinda' }
			}),
			opt
		),
		null
	);
	assert.throws(
		() =>
			createBranchIngress({
				origin,
				backends: new Map([['berau', { origin, secret: backend.secret }]]),
				routeSecret,
				sessionCookie,
				servePublic: async () => reply()
			}),
		/tidak terisolasi/
	);
});
