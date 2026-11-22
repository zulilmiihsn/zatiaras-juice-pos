import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptBranchRelay, createBranchIngress } from '../lib/server/branchIngress';
import type { BranchId } from '../lib/server/branchResolver';

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
		headers: { origin, 'content-type': 'application/json', 'x-zatiaras-relay-key': 'spoofed' },
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
			if (outages.has(branch)) throw new Error('Backend offline');
			if (url.pathname === '/api/veriflogin') {
				assert.equal(internal.headers.get('origin'), origin);
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
