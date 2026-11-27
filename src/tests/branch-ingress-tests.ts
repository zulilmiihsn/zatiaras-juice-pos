import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptBranchRelay, createBranchIngress } from '../lib/server/branchIngress';
import {
	createBranchGateway,
	PAUSED_CONNECTION_PATH,
	probePausedGateway
} from '../lib/server/branchGateway';
import { readBranchAccountDeployment } from '../lib/server/branchAccountDeployment';
import type { BranchId } from '../lib/server/branchResolver';
import { isBranchStorageKey } from '../lib/server/branchStoragePolicy';
import { createBranchStorageGateway } from '../lib/server/branchStorageGateway';
import { checkPausedBranchConnection } from '../lib/server/pausedBranchConnection';
import { createBranchStorageClient } from '../lib/server/branchStorageClient';
import { withBranchStorage } from '../lib/server/branchStorageEnvironment';
import storageWorker from '../../staging/branch-storage-worker';

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

await test('gateway Pages dan Worker memakai binding privat tanpa fallback untuk backend satu akun', async () => {
	const config = {
		mode: 'gateway',
		paused: false,
		publicOrigin: origin,
		routeSecret,
		backends
	} as const;
	const contacted: string[] = [];
	const env = {
		BRANCH_LOCAL_ORIGIN: backends.get('samarinda')!.origin,
		BRANCH_LOCAL_BACKEND: {
			async fetch(request: Request) {
				contacted.push(`local:${request.headers.get('x-zatiaras-relay-branch')}`);
				return reply();
			}
		}
	};
	const remote = async (request: Request) => {
		contacted.push(`remote:${request.headers.get('x-zatiaras-relay-branch')}`);
		return reply();
	};
	const gateway = createBranchGateway(config, env, async () => reply(), remote);
	assert.equal((await gateway(loginRequest('samarinda'))).status, 204);
	assert.equal((await gateway(loginRequest('berau'))).status, 204);
	const missing = createBranchGateway(
		config,
		{ BRANCH_LOCAL_ORIGIN: env.BRANCH_LOCAL_ORIGIN },
		async () => reply(),
		remote
	);
	assert.equal((await missing(loginRequest('samarinda'))).status, 503);
	const paused = createBranchGateway({ ...config, paused: true }, env, async () => reply(), remote);
	assert.equal((await paused(loginRequest('balikpapan'))).status, 503);
	assert.deepEqual(contacted, ['local:samarinda', 'remote:berau']);
});

await test('probe Pages hanya meneruskan path baca yang tetap ketika gateway terkunci', async () => {
	const probeKey = 'probe'.repeat(8);
	const env = { BRANCH_PRODUCTION_CANDIDATE: 'yes', BRANCH_GATEWAY_PROBE_SECRET: probeKey };
	const deployment = {
		mode: 'gateway',
		paused: true,
		publicOrigin: origin,
		routeSecret,
		backends
	} as const;
	const reached: string[] = [];
	const forward = async (request: Request) => {
		const url = new URL(request.url);
		assert.equal(url.pathname, PAUSED_CONNECTION_PATH);
		assert.equal(url.search, '');
		assert.equal(request.method, 'GET');
		assert.equal(request.headers.get('x-zpos-cutover-probe'), null);
		assert.equal(request.headers.get('cookie'), null);
		const branch = request.headers.get('x-zatiaras-relay-branch') as BranchId;
		assert.equal(url.origin, backends.get(branch)?.origin);
		assert.equal(request.headers.get('x-zatiaras-relay-key'), backends.get(branch)?.secret);
		reached.push(branch);
		return new Response(null, { status: branch === 'berau' ? 503 : 204 });
	};
	const request = (search: string, key = probeKey, method = 'GET', from = origin) =>
		new Request(`${from}${PAUSED_CONNECTION_PATH}?${search}`, {
			method,
			headers: { 'x-zpos-cutover-probe': key, cookie: 'ambient=ignored' }
		});
	for (const invalid of [
		request('branch=samarinda', 'invalid'),
		request('branch=samarinda', probeKey, 'POST'),
		request('branch=samarinda', probeKey, 'GET', 'https://wrong.test'),
		request('branch=samarinda&branch=berau')
	]) {
		assert.equal((await probePausedGateway(invalid, deployment, env, forward))?.status, 404);
	}
	assert.equal(
		(
			await probePausedGateway(
				request('branch=samarinda'),
				{ ...deployment, paused: false },
				env,
				forward
			)
		)?.status,
		404
	);
	assert.deepEqual(reached, []);
	assert.equal(
		await probePausedGateway(new Request(`${origin}/login`), deployment, env, forward),
		null
	);
	assert.equal(
		(await probePausedGateway(request('branch=samarinda'), deployment, env, forward))?.status,
		204
	);
	assert.equal(
		(await probePausedGateway(request('branch=berau'), deployment, env, forward))?.status,
		503
	);
	assert.deepEqual(reached, ['samarinda', 'berau']);
});

function fixture(paused = false) {
	const called: string[] = [];
	const outages = new Set<BranchId>();
	const handle = createBranchIngress({
		origin,
		backends,
		routeSecret,
		paused,
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

test('mode jeda menutup akses ketiga cabang sebelum menyentuh backend', async () => {
	const { handle, called } = fixture(true);
	for (const branch of ['samarinda', 'balikpapan', 'berau']) {
		const response = await handle(loginRequest(branch));
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('cache-control'), 'no-store');
		assert.equal(response.headers.has('set-cookie'), false);
	}
	assert.equal(
		(await handle(new Request(`${origin}/operasional?/sale`, { method: 'POST' }))).status,
		503
	);
	assert.equal((await handle(new Request(`${origin}/login`))).status, 503);
	assert.deepEqual(called, []);
});

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
	const bucket: Parameters<typeof createBranchStorageGateway>[0] = {
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
	};
	const handle = createBranchStorageGateway(bucket, secrets);
	const readOnly = createBranchStorageGateway(bucket, secrets, { readOnly: true });
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
	const probe = (method: string, secret: string) =>
		readOnly(
			new Request(`https://storage.test/object?key=${own}`, {
				method,
				headers: { 'x-storage-secret': secret, 'content-type': 'image/png' },
				body: method === 'PUT' ? new Uint8Array([9]) : undefined
			})
		);
	assert.equal((await probe('PUT', secrets.get('berau')!)).status, 405);
	assert.equal(value, undefined, 'Read-only PUT cannot touch the bucket');
	assert.equal((await request('invalid', own)).status, 401);
	assert.equal((await request(secrets.get('samarinda')!, own)).status, 404);
	assert.equal((await request(secrets.get('berau')!, own, 'PUT', new Uint8Array([1]))).status, 204);
	assert.equal((await probe('DELETE', secrets.get('berau')!)).status, 405);
	assert.equal((await probe('GET', secrets.get('samarinda')!)).status, 404);
	assert.deepEqual(
		[...new Uint8Array(await (await probe('GET', secrets.get('berau')!)).arrayBuffer())],
		[1]
	);
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
		customMetadata: { branch: 'berau', sha256: '1234', uploaded_by: 'Kasir É' }
	});
	assert.deepEqual(metadata, { branch: 'berau', sha256: '1234', uploaded_by: 'Kasir É' });
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

test('worker R2 menolak konfigurasi hilang dan identitas palsu', async () => {
	const request = new Request('https://storage.test/object?key=produk%2Fberau%2F1234.png');
	assert.equal((await storageWorker.fetch(request, {})).status, 503);
	const env = {
		STORAGE: { get: async () => null },
		STORAGE_SECRET_SAMARINDA: 's'.repeat(32),
		STORAGE_SECRET_BALIKPAPAN: 'b'.repeat(32),
		STORAGE_SECRET_BERAU: 'r'.repeat(32)
	};
	assert.equal((await storageWorker.fetch(request, env)).status, 401);
	assert.equal(
		(
			await storageWorker.fetch(
				new Request(request, { headers: { 'x-storage-secret': env.STORAGE_SECRET_BERAU } }),
				env
			)
		).status,
		404
	);
	assert.equal(
		(
			await storageWorker.fetch(request, {
				...env,
				STORAGE_SECRET_BERAU: env.STORAGE_SECRET_SAMARINDA
			})
		).status,
		503
	);
});

await test('worker R2 harus secara eksplisit keluar dari mode read-only produksi', async () => {
	let puts = 0;
	const env = {
		STORAGE: {
			put: async () => {
				puts++;
			}
		},
		STORAGE_SECRET_SAMARINDA: 's'.repeat(32),
		STORAGE_SECRET_BALIKPAPAN: 'b'.repeat(32),
		STORAGE_SECRET_BERAU: 'r'.repeat(32)
	};
	const put = (readOnly: string, secret = env.STORAGE_SECRET_BERAU) =>
		storageWorker.fetch(
			new Request('https://storage.test/object?key=produk%2Fberau%2F1234.png', {
				method: 'PUT',
				headers: { 'x-storage-secret': secret, 'content-type': 'image/png' },
				body: new Uint8Array([1])
			}),
			{ ...env, STORAGE_PRODUCTION_READ_ONLY: readOnly }
		);
	assert.equal((await put('yes')).status, 405);
	assert.equal((await put('invalid')).status, 405);
	assert.equal((await put('no', env.STORAGE_SECRET_SAMARINDA)).status, 404);
	assert.equal(puts, 0);
	assert.equal((await put('no')).status, 204);
	assert.equal(puts, 1);
});

await test('probe tertutup hanya membaca D1 cabang dan R2; shift aktif atau relay gagal menolak kesiapan', async () => {
	let shifts = 0;
	let relayStatus = 404;
	let reads = 0;
	const env = {
		DB_SAMARINDA_GROUP: {
			prepare(sql: string) {
				assert.match(sql, /^SELECT\s+\(SELECT COUNT\(\*\) FROM sesi_toko WHERE cabang_id = \?/);
				assert.match(sql, /FROM kiosk_shift_cutover WHERE cabang_id = \?/);
				return {
					bind(branch: string, fenceBranch: string) {
						assert.equal(branch, 'samarinda');
						assert.equal(fenceBranch, branch);
						return { first: async () => ({ shifts, managed: 0 }) };
					}
				};
			}
		},
		BRANCH_STORAGE_ORIGIN: 'https://storage.test',
		BRANCH_STORAGE_SECRET: 'storage'.repeat(6),
		BRANCH_STORAGE_LOCAL: {
			async fetch(request: Request) {
				reads++;
				assert.equal(request.method, 'GET');
				assert.match(new URL(request.url).searchParams.get('key') ?? '', /^produk\/samarinda\//);
				return new Response(null, { status: relayStatus });
			}
		}
	};
	assert.equal((await checkPausedBranchConnection(env, 'samarinda')).status, 204);
	assert.equal(reads, 1);
	assert.equal((await checkPausedBranchConnection(env, 'berau')).status, 503);
	shifts = 1;
	assert.equal((await checkPausedBranchConnection(env, 'samarinda')).status, 503);
	assert.equal(reads, 1);
	shifts = 0;
	relayStatus = 401;
	assert.equal((await checkPausedBranchConnection(env, 'samarinda')).status, 503);
	assert.equal(reads, 2);
});

test('adapter hanya aktif pada backend dengan konfigurasi lengkap dan tidak menimpa bucket lokal', () => {
	const original = { OTHER: 1 };
	assert.equal(withBranchStorage(original, 'berau'), original);
	assert.throws(() =>
		withBranchStorage({ BRANCH_STORAGE_ORIGIN: 'https://storage.test' }, 'berau')
	);
	assert.throws(() =>
		withBranchStorage(
			{
				BRANCH_STORAGE_ORIGIN: 'https://storage.test',
				BRANCH_STORAGE_SECRET: 's'.repeat(32),
				STORAGE: {}
			},
			'berau'
		)
	);
	const result = withBranchStorage(
		{
			BRANCH_STORAGE_ORIGIN: 'https://storage.test',
			BRANCH_STORAGE_SECRET: 's'.repeat(32),
			BRANCH_STORAGE_LOCAL: { fetch: async () => new Response(null, { status: 404 }) }
		},
		'berau'
	);
	assert.ok(result.STORAGE);
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
	const paused = readBranchAccountDeployment({
		...gatewayWithRoutes,
		BRANCH_CUTOVER_STATE: 'paused'
	});
	assert.equal(paused.mode === 'gateway' && paused.paused, true);
	assert.throws(
		() =>
			readBranchAccountDeployment({
				...gatewayWithRoutes,
				BRANCH_PRODUCTION_CANDIDATE: 'yes',
				BRANCH_CUTOVER_STATE: 'open'
			}),
		/Kandidat produksi wajib tetap dijeda/
	);
	assert.throws(
		() => readBranchAccountDeployment({ ...gatewayWithRoutes, BRANCH_CUTOVER_STATE: 'unexpected' }),
		/Status peralihan/
	);
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
