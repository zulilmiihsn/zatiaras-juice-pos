import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getAuthSession } from '../src/lib/server/sessionStore.ts';
import { RealtimeDurableObject } from '../src/lib/server/realtimeDurableObject.js';
import { wranglerInvocation } from './wrangler-cli.mjs';
import {
	snapshotBuiltAssets,
	verifyBuiltSnapshot,
	seedCompiledBrowser,
	compiledFixtureCertificate,
	ensureCompiledTlsReady,
	runCompiledBrowser
} from './test-fixtures/compiled-browser.mjs';
import {
	renderRealtimeWorker,
	verifyPatchedWorker,
	validateAdapterModule,
	compileRealtimeEntry,
	main,
	interceptMarker
} from './export-durable-objects.mjs';

const NOW = Date.UTC(2026, 6, 1, 12);
const ADAPTER =
	'const renamed_adapter={async fetch(){return new Response("delegated")}}; export {renamed_adapter as default};';
function authFixture() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec(`CREATE TABLE profil (id TEXT,cabang_id TEXT,username TEXT,role TEXT);
	CREATE TABLE auth_sessions (id TEXT PRIMARY KEY,cabang_id TEXT,user_id TEXT,username TEXT,role TEXT,created_at INTEGER,expires_at INTEGER,unlocked_pages TEXT,unlock_expires_at INTEGER);`);
	const sid = 'samarinda.synthetic-session';
	sqlite
		.prepare('INSERT INTO profil VALUES (?,?,?,?)')
		.run('live-profile', 'samarinda', 'live-name', 'pemilik');
	sqlite
		.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?,?,?,?)')
		.run(sid, 'samarinda', 'live-profile', 'stale-name', 'kasir', NOW - 1000, NOW + 60000, '[]', 0);
	const db = {
		prepare(sql) {
			return {
				bind(...values) {
					return {
						async first() {
							return sqlite.prepare(sql).get(...values) || null;
						}
					};
				}
			};
		}
	};
	const visits = [];
	const env = {
		DB_SAMARINDA_GROUP: db,
		DB_BALIKPAPAN_GROUP: db,
		DB_BERAU_GROUP: db,
		REALTIME_HUB: {
			idFromName(branch) {
				visits.push(branch);
				return branch;
			},
			get(branch) {
				return {
					async fetch(request) {
						return request.headers.get('Upgrade') === 'websocket'
							? new Response(JSON.stringify({ branch }), { status: 200 })
							: new Response('Expected WebSocket upgrade', { status: 426 });
					}
				};
			}
		}
	};
	return {
		sqlite,
		env,
		visits,
		sid,
		request(branch = 'samarinda', cookie = sid, method = 'GET') {
			return new Request(`https://local.invalid/api/realtime?branch=${branch}`, {
				method,
				headers: { Cookie: `zatiaras_sid=${cookie}`, Upgrade: 'websocket' }
			});
		}
	};
}

async function sourceTests() {
	await test('compiled browser snapshot preserves public bytes and excludes Worker/config bytes', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'owned compiled assets '));
		try {
			const source = join(directory, 'source'),
				target = join(directory, 'target');
			await mkdir(join(source, '_app'), { recursive: true });
			await writeFile(join(source, '_app', 'client.js'), 'export const actual=1;');
			await writeFile(join(source, '_worker.js'), 'PRIVATE_WORKER_FIXTURE');
			await writeFile(join(source, '_headers'), 'PRIVATE_CONFIG_FIXTURE');
			const snapshot = await snapshotBuiltAssets(source, target);
			assert.deepEqual(snapshot.publicFiles, ['_app/client.js']);
			assert.equal(
				await readFile(join(target, '_app', 'client.js'), 'utf8'),
				'export const actual=1;'
			);
			assert.deepEqual((await readdir(target)).sort(), ['_app']);
			await writeFile(join(source, '_app', 'client.js'), 'changed');
			await assert.rejects(verifyBuiltSnapshot(source, snapshot.hashes), /Build bytes changed/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await test('compiled browser snapshot rejects empty client inventory and symlink escape before serving', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'owned compiled assets negative '));
		try {
			const source = join(directory, 'source'),
				target = join(directory, 'target');
			await mkdir(source);
			await assert.rejects(
				snapshotBuiltAssets(source, target),
				/Actual compiled client assets required/
			);
			await mkdir(join(directory, 'outside'));
			await symlink(join(directory, 'outside'), join(source, 'escape'), 'junction');
			await assert.rejects(snapshotBuiltAssets(source, target), /refuses symlinks/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await test('compiled browser snapshot detects added build files instead of certifying a mutable build', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'owned compiled assets inventory '));
		try {
			const source = join(directory, 'source'),
				target = join(directory, 'target');
			await mkdir(join(source, '_app'), { recursive: true });
			await writeFile(join(source, '_app', 'client.js'), 'compiled');
			const snapshot = await snapshotBuiltAssets(source, target);
			await writeFile(join(source, '_app', 'extra.js'), 'extra');
			await assert.rejects(
				verifyBuiltSnapshot(source, snapshot.hashes),
				/Build bytes changed|inventory changed/
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await test('compiled TLS readiness rejects foreign/credential origins and changed deadlines before network', async () => {
		for (const origin of [
			'http://127.0.0.1:1234',
			'https://foreign.invalid:1234',
			'https://owner:fixture@127.0.0.1:1234',
			'https://127.0.0.1:1234/login',
			'https://127.0.0.1:1234?x=1'
		]) {
			await assert.rejects(
				ensureCompiledTlsReady(origin, 120000, 'unused'),
				/exact owned TLS loopback/
			);
		}
		for (const budget of [0, -1, 120001, 1.5])
			await assert.rejects(
				ensureCompiledTlsReady('https://127.0.0.1:1234', budget, 'unused'),
				/startup budget/
			);
	});
	await test('real DO acknowledges normal/reserved close and tolerates an already-closed peer', async () => {
		const hub = new RealtimeDurableObject({}, {});
		const received = [];
		const socket = {
			close(code, reason) {
				received.push({ code, reason });
			}
		};
		await hub.webSocketClose(socket, 1000);
		await hub.webSocketClose(socket, 1006);
		assert.deepEqual(received, [
			{ code: 1000, reason: 'peer closed' },
			{ code: 1000, reason: 'peer closed' }
		]);
		await assert.doesNotReject(() =>
			hub.webSocketClose(
				{
					close() {
						throw new Error('OWNED_ALREADY_CLOSED');
					}
				},
				1000
			)
		);
	});
	await test('explicit wrapper delegates/preserves exports without generated variable names', () => {
		const wrapper = renderRealtimeWorker();
		assert.equal(verifyPatchedWorker(wrapper), true);
		assert.equal(wrapper.split(interceptMarker).length - 1, 1);
		assert.ok(wrapper.includes('return adapter.fetch(request, env, context);'));
		assert.ok(wrapper.includes("export * from './_worker.sveltekit.js'"));
		assert.doesNotMatch(wrapper, /auth_sessions|SELECT|worker_default|env2/);
		assert.equal(renderRealtimeWorker(), wrapper);
		assert.throws(() => verifyPatchedWorker(wrapper + '\n//tampered'), /contract mismatch/);
		assert.throws(() => verifyPatchedWorker(ADAPTER), /contract mismatch/);
	});
	await test('adapter AST validates renamed/arbitrary default exports and rejects invalid modules', () => {
		for (const code of [
			ADAPTER,
			'export default {fetch(){}};',
			'export default function worker(){}'
		])
			assert.equal(validateAdapterModule(code), true);
		for (const code of ['const x={};', 'export default {', 'not a module'])
			assert.throws(() => validateAdapterModule(code), /valid ESM/);
	});
	const directory = await mkdtemp(join(tmpdir(), 'zatiaras canonical auth & '));
	try {
		const compiled = await compileRealtimeEntry();
		await writeFile(join(directory, 'auth.mjs'), compiled, { mode: 0o600, flag: 'wx' });
		const { handleRealtimeRequest: handler } = await import(
			pathToFileURL(join(directory, 'auth.mjs')).href
		);
		for (const mutation of [
			'unknown-role',
			'deleted-profile',
			'wrong-profile-branch',
			'expired-session',
			'revoked-session'
		]) {
			await test(`generated consumer rejects ${mutation} using canonical live authority`, async () => {
				const f = authFixture(),
					originalNow = Date.now;
				Date.now = () => NOW;
				try {
					if (mutation === 'unknown-role') f.sqlite.exec("UPDATE profil SET role='supervisor'");
					if (mutation === 'deleted-profile') f.sqlite.exec('DELETE FROM profil');
					if (mutation === 'wrong-profile-branch')
						f.sqlite.exec("UPDATE profil SET cabang_id='samarinda2'");
					if (mutation === 'expired-session')
						f.sqlite.prepare('UPDATE auth_sessions SET expires_at=?').run(NOW);
					if (mutation === 'revoked-session') f.sqlite.exec('DELETE FROM auth_sessions');
					assert.equal(await getAuthSession({ env: f.env }, f.sid), null);
					assert.equal((await handler(f.request(), f.env)).status, 401);
					assert.equal(f.visits.length, 0, 'Unauthorized requests must never reach the DO');
				} finally {
					Date.now = originalNow;
					f.sqlite.close();
				}
			});
		}
		await test('generated branch policy preserves canonical admin and rejects ordinary foreign branches', async () => {
			const f = authFixture(),
				originalNow = Date.now;
			Date.now = () => NOW;
			try {
				assert.equal((await handler(f.request('samarinda2'), f.env)).status, 403);
				assert.equal(f.visits.length, 0);
				// Cross-site WebSocket hijacking: a valid session cookie from a foreign page never reaches the DO.
				const foreign = f.request();
				foreign.headers.set('Origin', 'https://attacker.invalid');
				assert.equal((await handler(foreign, f.env)).status, 403);
				const sameOrigin = f.request();
				sameOrigin.headers.set('Origin', 'https://local.invalid');
				assert.equal((await handler(sameOrigin, f.env)).status, 200);
				assert.deepEqual(f.visits, ['samarinda']);
				f.visits.length = 0;
				f.sqlite.exec("UPDATE profil SET role=' ADMIN '");
				assert.equal((await getAuthSession({ env: f.env }, f.sid)).role, 'admin');
				assert.equal((await handler(f.request('berau'), f.env)).status, 200);
				assert.deepEqual(f.visits, ['berau']);
			} finally {
				Date.now = originalNow;
				f.sqlite.close();
			}
		});
		await test('DB outage sanitized; malformed/missing credentials fail closed', async () => {
			const f = authFixture(),
				originalNow = Date.now;
			Date.now = () => NOW;
			try {
				const broken = {
					...f.env,
					DB_SAMARINDA_GROUP: {
						prepare() {
							throw new Error('OWNED_SENSITIVE_DATABASE_DETAIL');
						}
					}
				};
				const response = await handler(f.request(), broken);
				assert.equal(response.status, 503);
				assert.doesNotMatch(await response.text(), /OWNED_SENSITIVE_DATABASE_DETAIL/);
				for (const sid of ['%E0%A4%A', '', 'berau.not-the-session', 'constructor.fake'])
					assert.equal((await handler(f.request('samarinda', sid), f.env)).status, 401);
			} finally {
				Date.now = originalNow;
				f.sqlite.close();
			}
		});
		await test('live role/username, prefix scope, branch/method/nonupgrade/missing hub and normal delegation', async () => {
			const f = authFixture(),
				originalNow = Date.now;
			Date.now = () => NOW;
			try {
				for (const role of [' KASIR ', 'pemilik', 'admin']) {
					f.sqlite.prepare('UPDATE profil SET role=?').run(role);
					assert.equal((await handler(f.request(), f.env)).status, 200);
					assert.equal((await getAuthSession({ env: f.env }, f.sid)).username, 'live-name');
				}
				assert.equal((await handler(f.request('__proto__'), f.env)).status, 400);
				assert.equal((await handler(f.request('samarinda', f.sid, 'POST'), f.env)).status, 405);
				assert.equal(
					(
						await handler(
							new Request('https://local.invalid/api/realtime', {
								headers: { Cookie: `zatiaras_sid=${f.sid}` }
							}),
							f.env
						)
					).status,
					426
				);
				assert.equal(
					(await handler(f.request(), { ...f.env, REALTIME_HUB: undefined })).status,
					503
				);
				assert.equal(await handler(new Request('https://local.invalid/login'), f.env), null);
				f.sqlite.exec(
					"UPDATE auth_sessions SET cabang_id='samarinda2'; UPDATE profil SET cabang_id='samarinda2'"
				);
				assert.equal(await getAuthSession({ env: f.env }, f.sid), null);
				assert.equal((await handler(f.request(), f.env)).status, 401);
			} finally {
				Date.now = originalNow;
				f.sqlite.close();
			}
		});
		await test('actual generator is byte-idempotent, preserves adapter, and refuses tampered/legacy modules before write', async () => {
			await writeFile(join(directory, '_worker.js'), ADAPTER);
			await main(directory);
			const first = await readFile(join(directory, '_worker.js'), 'utf8');
			assert.equal(await readFile(join(directory, '_worker.sveltekit.js'), 'utf8'), ADAPTER);
			const auth = await readFile(join(directory, '_worker.auth.js'), 'utf8');
			await main(directory);
			assert.equal(await readFile(join(directory, '_worker.js'), 'utf8'), first);
			assert.equal(await readFile(join(directory, '_worker.auth.js'), 'utf8'), auth);
			for (const invalid of [
				'// ZATIARAS_REALTIME_WORKER_INTERCEPT\n' + ADAPTER,
				'export default {'
			]) {
				await writeFile(join(directory, '_worker.js'), invalid);
				await assert.rejects(() => main(directory), /Legacy session-only|valid ESM/);
				assert.equal(await readFile(join(directory, '_worker.js'), 'utf8'), invalid);
			}
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
	await test('deploy:check validates external DO, shared shard configuration and cron', () => {
		const r = spawnSync(process.execPath, ['scripts/verify-cloudflare-deploy-config.mjs'], {
			encoding: 'utf8',
			stdio: 'pipe',
			env: {
				...process.env,
				CLOUDFLARE_API_TOKEN: 'dummy-ci-token-32-karakter-xxxx',
				POS_PRICE_SIGNING_KEY: 'dummy-ci-signing-key-32-karakter-x'
			}
		});
		assert.equal(r.status, 0, r.stderr || r.stdout);
		assert.match(r.stdout, /deploy config looks ready/);
	});
}

function socketMessage(socket, expected) {
	return new Promise((resolveMessage, reject) => {
		const timer = setTimeout(
			() => finish(new Error(`WebSocket message deadline: ${expected}`)),
			5000
		);
		const listener = (event) => {
			if (String(event.data) === expected) finish(undefined, String(event.data));
		};
		const finish = (error, value) => {
			clearTimeout(timer);
			socket.removeEventListener('message', listener);
			if (error) reject(error);
			else resolveMessage(value);
		};
		socket.addEventListener('message', listener);
	});
}

function closeSocket(socket, reason) {
	if (socket.readyState === 3) return Promise.resolve();
	return new Promise((resolveClose, reject) => {
		const finish = (error) => {
			clearTimeout(timer);
			socket.removeEventListener('close', closed);
			socket.removeEventListener('error', errored);
			if (error) reject(error);
			else resolveClose();
		};
		const closed = () => finish();
		const errored = () => finish(new Error('Owned WebSocket close failed'));
		const timer = setTimeout(
			() => finish(new Error('Owned WebSocket close acknowledgement deadline')),
			5000
		);
		socket.addEventListener('close', closed);
		socket.addEventListener('error', errored);
		if (socket.readyState === 1) socket.close(1000, reason);
	});
}

async function compiledLedgerHttpTests({ wireResponse, WorkerRequest, databases, branches }) {
	const actors = {};
	async function repair(branch) {
		const db = databases[branches[branch]],
			actor = actors[branch];
		await db.prepare('DELETE FROM profil WHERE id=?').bind(actor.id).run();
		await db
			.prepare(
				"INSERT INTO profil(id,cabang_id,username,password,role)VALUES(?,?,?,'unusable-fixture-hash','pemilik')"
			)
			.bind(actor.id, branch, actor.id)
			.run();
		await db
			.prepare(
				'INSERT OR REPLACE INTO auth_sessions(id,cabang_id,user_id,username,role,created_at,expires_at,unlocked_pages,unlock_expires_at)VALUES(?,?,?,?,?,?,?,?,?)'
			)
			.bind(
				actor.sid,
				branch,
				actor.id,
				'stale-name',
				'kasir',
				NOW,
				Number.MAX_SAFE_INTEGER,
				'[]',
				0
			)
			.run();
	}
	for (const branch of Object.keys(branches)) {
		actors[branch] = { id: `owned-ledger-${branch}`, sid: `${branch}.${randomUUID()}` };
		await repair(branch);
	}
	const row = (id, extra = {}) => ({
		id,
		tipe: 'in',
		jenis: 'pendapatan_usaha',
		sumber: 'catat',
		nominal: '100000.123456',
		waktu: '2026-07-01T12:00:00.000Z',
		deskripsi: 'Owned compiled ledger fixture',
		metode_bayar: 'qris',
		...extra
	});
	async function request(branch, method, path, body, options = {}) {
		const sid = options.anonymous ? undefined : actors[branch].sid;
		let cookie = sid ? `zatiaras_sid=${sid}` : '';
		const headers = { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
		if (method !== 'GET') {
			const csrf = await wireResponse(
				'pages',
				new WorkerRequest('https://compiled.invalid/api/csrf', { headers })
			);
			assert.equal(csrf.status, 200, 'Native CSRF endpoint must issue the token');
			const token = JSON.parse(csrf.body).token;
			const cookies = csrf.headers['set-cookie'] || [];
			const issued = cookies.find((value) => value.startsWith('zatiaras_csrf='))?.split(';')[0];
			assert.ok(
				typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
				'Expected server-issued CSRF token, not a synthetic bypass'
			);
			assert.ok(
				issued === `zatiaras_csrf=${token}`,
				'Server response cookie must match its token; never print cookie values'
			);
			cookie = [cookie, issued].filter(Boolean).join('; ');
			headers.Cookie = cookie;
			headers['X-CSRF-Token'] = options.badCsrf ? 'owned-invalid-token' : token;
			headers['Content-Type'] = 'application/json';
		}
		return wireResponse(
			'pages',
			new WorkerRequest(`https://compiled.invalid${path}`, {
				method,
				headers,
				...(body === undefined ? {} : { body: JSON.stringify(body) })
			}),
			options.discardBody
		);
	}
	async function snapshot() {
		const result = {};
		for (const [binding, db] of Object.entries(databases)) {
			result[binding] = {};
			for (const table of [
				'buku_kas',
				'bahan',
				'bahan_mutasi',
				'produk',
				'produk_mutasi',
				'transaksi_kasir',
				'ringkasan_penjualan_harian',
				'penjualan_produk_harian',
				'ringkasan_kas_arsip_harian',
				'audit_logs',
				'audit_log_outbox'
			]) {
				const rows = (await db.prepare(`SELECT * FROM ${table}`).all()).results;
				result[binding][table] = rows.map((value) => JSON.stringify(value)).sort();
			}
		}
		return result;
	}
	async function stored(branch, id) {
		return databases[branches[branch]]
			.prepare(
				'SELECT nominal,metode_bayar,revision,cabang_id FROM buku_kas WHERE cabang_id=? AND id=?'
			)
			.bind(branch, id)
			.first();
	}
	await test('compiled native CSRF: interleaved established-cookie refreshes preserve both mutation attempts', async () => {
		const sid = `zatiaras_sid=${actors.samarinda.sid}`;
		async function refresh(cookie) {
			const response = await wireResponse(
				'pages',
				new WorkerRequest('https://compiled.invalid/api/csrf', { headers: { Cookie: cookie } })
			);
			assert.equal(response.status, 200);
			const token = JSON.parse(response.body).token;
			assert.ok(
				typeof token === 'string' && /^[a-f0-9]{64}$/.test(token),
				'Server must mint full-entropy token shape'
			);
			const issued = response.headers['set-cookie']
				?.find((value) => value.startsWith('zatiaras_csrf='))
				?.split(';')[0];
			assert.ok(
				issued === `zatiaras_csrf=${token}`,
				'Issued cookie/header coherence; no secret output'
			);
			return { token, cookie: `${sid}; ${issued}` };
		}
		let jar = (await refresh(sid)).cookie;
		const statuses = [];
		for (let attempt = 0; attempt < 2; attempt++) {
			const intended = await refresh(jar);
			// A second legitimate caller finishes its GET between token acquisition and mutation.
			const competing = await refresh(intended.cookie);
			jar = competing.cookie;
			const response = await wireResponse(
				'pages',
				new WorkerRequest('https://compiled.invalid/api/buku-kas', {
					method: 'POST',
					headers: {
						Cookie: jar,
						'X-CSRF-Token': intended.token,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ payload: row('owned-csrf-interleaved') })
				})
			);
			statuses.push(response.status);
		}
		assert.deepEqual(
			statuses,
			[200, 200],
			'Established-cookie interleaving must not exhaust the one-retry budget'
		);
		assert.equal((await stored('samarinda', 'owned-csrf-interleaved')).nominal, 100000);
		const beforeDenied = await snapshot();
		for (const headers of [
			{ Cookie: jar },
			{ Cookie: jar, 'X-CSRF-Token': 'owned-mismatch' },
			{ Cookie: sid, 'X-CSRF-Token': 'owned-without-cookie' }
		]) {
			const denied = await wireResponse(
				'pages',
				new WorkerRequest('https://compiled.invalid/api/buku-kas', {
					method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify({ payload: row('owned-csrf-denied') })
				})
			);
			assert.equal(denied.status, 403);
			assert.equal(JSON.parse(denied.body).code, 'CSRF_INVALID');
		}
		assert.deepEqual(
			await snapshot(),
			beforeDenied,
			'CSRF failures cannot mutate business/audit rows'
		);
		for (const invalid of ['', 'short-owned-cookie', 'A'.repeat(64), 'a'.repeat(65)]) {
			const issued = await wireResponse(
				'pages',
				new WorkerRequest('https://compiled.invalid/api/csrf', {
					headers: { Cookie: `${sid}; zatiaras_csrf=${invalid}` }
				})
			);
			assert.equal(issued.status, 200);
			assert.match(JSON.parse(issued.body).token, /^[a-f0-9]{64}$/);
			assert.equal(issued.headers['cache-control'], 'no-store');
			assert.ok(issued.headers.vary?.includes('Cookie'));
			const cookie = issued.headers['set-cookie'].find((value) =>
				value.startsWith('zatiaras_csrf=')
			);
			assert.ok(/;\s*Secure(?:;|$)/i.test(cookie), 'Compiled cookie stays Secure');
			assert.ok(
				/;\s*SameSite=Strict(?:;|$)/i.test(cookie),
				'Compiled cookie stays SameSite Strict'
			);
			assert.ok(/;\s*Max-Age=7200(?:;|$)/i.test(cookie), 'Existing two-hour cookie expiry remains');
		}
		assert.equal(
			(
				await databases.DB_SAMARINDA_GROUP.prepare(
					"SELECT COUNT(*) AS count FROM buku_kas WHERE id='owned-csrf-interleaved'"
				).first()
			).count,
			1
		);
	});
	await test('compiled native ledger HTTP: five branches canonical create/same-intent replay/PATCH', async () => {
		for (const branch of Object.keys(branches)) {
			// buku_kas.id is globally unique within a shard, including its sibling branches.
			const id = `owned-http-canonical-${branch}`;
			for (let attempt = 0; attempt < 2; attempt++) {
				const response = await request(branch, 'POST', '/api/buku-kas', { payload: row(id) });
				assert.equal(response.status, 200, `Canonical ${branch} attempt ${attempt}`);
				const body = JSON.parse(response.body);
				assert.equal(body.data[0].nominal, 100000);
				assert.equal(body.data[0].metode_bayar, 'non-tunai');
				assert.equal(body.data[0].cabang_id, branch);
				assert.equal(body.duplicate === true, attempt === 1);
			}
			assert.equal(
				(
					await databases[branches[branch]]
						.prepare('SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id=? AND id=?')
						.bind(branch, id)
						.first()
				).n,
				1
			);
			const patch = await request(branch, 'PATCH', '/api/buku-kas', {
				where: { id },
				payload: { revision: 0, nominal: '2.50006e4' }
			});
			assert.equal(patch.status, 200);
			assert.deepEqual(
				{ ...(await stored(branch, id)) },
				{ nominal: 25001, metode_bayar: 'non-tunai', revision: 1, cabang_id: branch }
			);
		}
	});
	await test('compiled native ledger HTTP: malformed/domain/money tail rejects whole batch and PATCH without business/effect mutation', async () => {
		const invalid = [
			null,
			[],
			true,
			...[
				null,
				true,
				false,
				[],
				[1000],
				{},
				'',
				' ',
				'not-a-number',
				'0x10',
				'Infinity',
				-1,
				Number.MAX_SAFE_INTEGER + 1,
				'-1e-999',
				'9007199254740991.1'
			].map((nominal) => row('owned-http-invalid-tail', { nominal })),
			...[
				{ tipe: 'credit' },
				{ tipe: 'out' },
				{ jenis: 'modal' },
				{ sumber: 'unknown' },
				{ waktu: 'not-a-date' },
				{ metode_bayar: 'transfer' },
				{ deskripsi: '' }
			].map((extra) => row('owned-http-invalid-tail', extra))
		];
		for (const tail of invalid) {
			const before = await snapshot();
			assert.equal(
				(
					await request('samarinda', 'POST', '/api/buku-kas', {
						payload: [row('owned-http-invalid-head'), tail]
					})
				).status,
				400
			);
			assert.deepEqual(await snapshot(), before);
		}
		for (const nominal of [false, null, 'not-a-number', '-1e-999', '9007199254740991.1']) {
			const before = await snapshot();
			assert.equal(
				(
					await request('samarinda', 'PATCH', '/api/buku-kas', {
						where: { id: 'owned-http-canonical-samarinda' },
						payload: { revision: 1, nominal }
					})
				).status,
				400
			);
			assert.deepEqual(await snapshot(), before);
		}
	});
	await test('compiled native ledger HTTP: anonymous/CSRF/body-role/POS/foreign branch gates fail before mutation', async () => {
		const before = await snapshot();
		assert.equal(
			(
				await request(
					'samarinda',
					'POST',
					'/api/buku-kas',
					{ payload: row('owned-http-anon') },
					{ anonymous: true }
				)
			).status,
			401
		);
		const csrf = await request(
			'samarinda',
			'POST',
			'/api/buku-kas',
			{ payload: row('owned-http-csrf') },
			{ badCsrf: true }
		);
		assert.equal(csrf.status, 403);
		assert.equal(JSON.parse(csrf.body).code, 'CSRF_INVALID');
		assert.equal(
			(
				await request('samarinda', 'POST', '/api/buku-kas', {
					payload: row('owned-http-pos', { sumber: 'pos' })
				})
			).status,
			409
		);
		for (const foreign of ['samarinda2', 'berau']) {
			for (const role of ['pemilik', 'admin']) {
				await databases.DB_SAMARINDA_GROUP.prepare(
					'UPDATE profil SET role=? WHERE cabang_id=? AND id=?'
				)
					.bind(role, 'samarinda', actors.samarinda.id)
					.run();
				for (const body of [
					{ branch: foreign, payload: row('owned-http-foreign', { role: 'admin' }) },
					{
						payload: [
							row('owned-http-foreign-head'),
							row('owned-http-foreign-tail', { branch: foreign })
						]
					},
					{ payload: row('owned-http-foreign', { cabang_id: foreign }) }
				]) {
					const denied = await request('samarinda', 'POST', '/api/buku-kas', body);
					assert.equal(denied.status, 403);
					assert.match(JSON.parse(denied.body).message, /Branch tidak sesuai session/);
				}
				assert.equal(
					(
						await request('samarinda', 'PATCH', '/api/buku-kas', {
							where: { id: 'owned-http-canonical-samarinda' },
							payload: { revision: 1, nominal: 500, cabang_id: foreign }
						})
					).status,
					403
				);
			}
		}
		await repair('samarinda');
		assert.deepEqual(await snapshot(), before);
	});
	await test('compiled native ledger HTTP: live unknown/deleted/wrong-profile/expired/revoked authority cannot be supplied by body', async () => {
		const db = databases.DB_SAMARINDA_GROUP,
			actor = actors.samarinda;
		const mutations = [
			["UPDATE profil SET role='supervisor' WHERE id=?", actor.id],
			['DELETE FROM profil WHERE id=?', actor.id],
			["UPDATE profil SET cabang_id='samarinda2' WHERE id=?", actor.id],
			['UPDATE auth_sessions SET expires_at=0 WHERE id=?', actor.sid],
			['DELETE FROM auth_sessions WHERE id=?', actor.sid]
		];
		for (const [sql, value] of mutations) {
			try {
				await db.prepare(sql).bind(value).run();
				const before = await snapshot();
				const denied = await request('samarinda', 'POST', '/api/buku-kas', {
					role: 'pemilik',
					payload: row('owned-http-invalid-authority')
				});
				assert.equal(denied.status, 401);
				assert.doesNotMatch(denied.body, /SELECT|auth_sessions|database_id/);
				assert.deepEqual(await snapshot(), before);
			} finally {
				await repair('samarinda');
			}
		}
	});
	await test('compiled native ledger HTTP: cashier/PIN live unlock, expired/corrupt unlock and PATCH role fence', async () => {
		const db = databases.DB_SAMARINDA_GROUP,
			actor = actors.samarinda;
		const settings = await db
			.prepare(
				"SELECT id,pin_hash,halaman_terkunci FROM pengaturan WHERE cabang_id='samarinda' AND kunci IS NULL LIMIT 1"
			)
			.first();
		const settingId = settings?.id ?? 900005;
		try {
			await db
				.prepare("UPDATE profil SET role='kasir' WHERE id=? AND cabang_id='samarinda'")
				.bind(actor.id)
				.run();
			if (!settings)
				await db
					.prepare(
						"INSERT INTO pengaturan(id,cabang_id,pin_hash,halaman_terkunci)VALUES(?,'samarinda',NULL,'[]')"
					)
					.bind(settingId)
					.run();
			const allowed = await request('samarinda', 'POST', '/api/buku-kas', {
				payload: row('owned-http-cashier')
			});
			assert.equal(allowed.status, 200);
			await db
				.prepare(
					"UPDATE pengaturan SET pin_hash='unusable-fixture-pin-hash',halaman_terkunci='[\"catat\"]' WHERE id=? AND cabang_id='samarinda'"
				)
				.bind(settingId)
				.run();
			let before = await snapshot();
			const locked = await request('samarinda', 'POST', '/api/buku-kas', {
				payload: row('owned-http-locked')
			});
			assert.equal(locked.status, 403);
			assert.equal(JSON.parse(locked.body).message, 'PIN_REQUIRED');
			assert.equal(
				(
					await request('samarinda', 'PATCH', '/api/buku-kas', {
						where: { id: 'owned-http-canonical-samarinda' },
						payload: { revision: 1, nominal: 500 }
					})
				).status,
				403
			);
			assert.deepEqual(await snapshot(), before);
			await db
				.prepare(
					'UPDATE auth_sessions SET unlocked_pages=\'["catat"]\',unlock_expires_at=? WHERE id=?'
				)
				.bind(Number.MAX_SAFE_INTEGER, actor.sid)
				.run();
			assert.equal(
				(
					await request('samarinda', 'POST', '/api/buku-kas', {
						payload: row('owned-http-unlocked')
					})
				).status,
				200
			);
			before = await snapshot();
			await db
				.prepare('UPDATE auth_sessions SET unlock_expires_at=0 WHERE id=?')
				.bind(actor.sid)
				.run();
			assert.equal(
				(
					await request('samarinda', 'POST', '/api/buku-kas', {
						payload: row('owned-http-expired-unlock')
					})
				).status,
				403
			);
			await db
				.prepare(
					"UPDATE auth_sessions SET unlocked_pages='not-json',unlock_expires_at=? WHERE id=?"
				)
				.bind(Number.MAX_SAFE_INTEGER, actor.sid)
				.run();
			assert.equal(
				(
					await request('samarinda', 'POST', '/api/buku-kas', {
						payload: row('owned-http-corrupt-unlock')
					})
				).status,
				403
			);
			assert.deepEqual(await snapshot(), before);
		} finally {
			if (settings)
				await db
					.prepare(
						"UPDATE pengaturan SET pin_hash=?,halaman_terkunci=? WHERE id=? AND cabang_id='samarinda'"
					)
					.bind(settings.pin_hash, settings.halaman_terkunci, settingId)
					.run();
			else
				await db
					.prepare("DELETE FROM pengaturan WHERE id=? AND cabang_id='samarinda'")
					.bind(settingId)
					.run();
			await repair('samarinda');
		}
	});
	await test('compiled native ledger HTTP: late INSERT rollback leaves all shards/business/effect rows unchanged', async () => {
		const db = databases.DB_SAMARINDA_GROUP;
		await db
			.prepare(
				"CREATE TRIGGER owned_compiled_ledger_fault BEFORE INSERT ON buku_kas WHEN NEW.id='owned-http-fault-tail' BEGIN SELECT RAISE(ABORT,'OWNED_COMPILED_LEDGER_FAULT'); END"
			)
			.run();
		try {
			const before = await snapshot();
			assert.equal(
				(
					await request('samarinda', 'POST', '/api/buku-kas', {
						payload: [row('owned-http-fault-head'), row('owned-http-fault-tail')]
					})
				).status,
				500
			);
			assert.deepEqual(await snapshot(), before);
		} finally {
			await db.prepare('DROP TRIGGER owned_compiled_ledger_fault').run();
		}
	});
	await test('compiled native ledger HTTP: lost response body and concurrent identical retries leave one canonical ledger row', async () => {
		const id = 'owned-http-lost-response',
			body = { payload: row(id, { nominal: '2.50006e4' }) };
		await assert.rejects(
			request('samarinda', 'POST', '/api/buku-kas', body, { discardBody: true }),
			/OWNED_LEDGER_RESPONSE_LOST/
		);
		assert.equal(
			(await stored('samarinda', id)).nominal,
			25001,
			'Verify committed state before controlled identical retry'
		);
		const before = await snapshot();
		const responses = await Promise.all([
			request('samarinda', 'POST', '/api/buku-kas', body),
			request('samarinda', 'POST', '/api/buku-kas', body)
		]);
		for (const response of responses) {
			assert.equal(response.status, 200);
			assert.equal(JSON.parse(response.body).duplicate, true);
			assert.equal(JSON.parse(response.body).data[0].nominal, 25001);
		}
		assert.deepEqual(await snapshot(), before);
		const concurrentId = 'owned-http-concurrent-first';
		for (const response of await Promise.all([
			request('samarinda', 'POST', '/api/buku-kas', { payload: row(concurrentId) }),
			request('samarinda', 'POST', '/api/buku-kas', { payload: row(concurrentId) })
		]))
			assert.equal(response.status, 200);
		assert.equal(
			(
				await databases.DB_SAMARINDA_GROUP.prepare(
					'SELECT COUNT(*) AS n FROM buku_kas WHERE cabang_id=? AND id=?'
				)
					.bind('samarinda', concurrentId)
					.first()
			).n,
			1
		);
	});
}

async function compiledTests() {
	const {
		Miniflare,
		convertV4MiniflareOptions,
		Request: WorkerRequest
	} = await import('miniflare');
	const root = process.cwd(),
		entry = resolve('.svelte-kit/cloudflare/_worker.js');
	verifyPatchedWorker(await readFile(entry, 'utf8'));
	const directory = await mkdtemp(join(tmpdir(), 'zatiaras built worker & '));
	let runtime;
	let retainOwnedState = false;
	const browserMode = process.argv.includes('--browser');
	const sockets = [];
	try {
		const assetsPath = join(directory, 'public-assets');
		const assetsSnapshot = browserMode
			? await snapshotBuiltAssets(resolve('.svelte-kit/cloudflare'), assetsPath)
			: null;
		const d1Databases = Object.fromEntries(
			['DB_SAMARINDA_GROUP', 'DB_BALIKPAPAN_GROUP', 'DB_BERAU_GROUP'].map((binding) => [
				binding,
				randomUUID()
			])
		);
		const common = {
			modules: true,
			compatibilityDate: '2026-06-29',
			compatibilityFlags: ['nodejs_compat'],
			modulesRoot: root
		};
		const configPath = join(directory, 'wrangler.json');
		await writeFile(
			configPath,
			JSON.stringify({
				name: 'owned-compiled-smoke',
				main: entry,
				compatibility_date: common.compatibilityDate,
				compatibility_flags: common.compatibilityFlags,
				d1_databases: Object.entries(d1Databases).map(([binding, database_id]) => ({
					binding,
					database_id,
					database_name: `owned-${binding}`
				})),
				durable_objects: {
					bindings: [
						{ name: 'REALTIME_HUB', class_name: 'RealtimeDurableObject', script_name: 'realtime' }
					]
				}
			}),
			{ mode: 0o600, flag: 'wx' }
		);
		// Real Worker dry-run bundles this exact Pages entry; it is not a Pages deploy/dry-run claim.
		const invocation = wranglerInvocation([
			'deploy',
			'--dry-run',
			'--config',
			configPath,
			'--outdir',
			join(directory, 'bundle')
		]);
		const childEnv = { CLOUDFLARE_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', CI: 'true' };
		for (const key of [
			'PATH',
			'PATHEXT',
			'SystemRoot',
			'TEMP',
			'TMP',
			'USERPROFILE',
			'APPDATA',
			'LOCALAPPDATA'
		])
			if (process.env[key]) childEnv[key] = process.env[key];
		const bundled = spawnSync(invocation.command, invocation.args, {
			...invocation.options,
			cwd: directory,
			env: childEnv,
			timeout: 120000
		});
		assert.equal(
			bundled.status,
			0,
			'Owned Wrangler Worker dry-run must compile before smoke; no remote deploy'
		);
		const modules = [];
		for (const file of await readdir(join(directory, 'bundle'))) {
			if (file.endsWith('.js') || file.endsWith('.mjs'))
				modules.push({ type: 'ESModule', path: join(directory, 'bundle', file) });
		}
		assert.ok(modules.length, 'Dry-run must produce actual module bytes');
		common.modulesRoot = directory;
		const doSource = await readFile(resolve('src/lib/server/realtimeDurableObject.js'), 'utf8');
		const doFile = join(directory, 'real-do.mjs');
		await writeFile(
			doFile,
			doSource + '\nexport default {fetch(){return new Response("Not found",{status:404})}};',
			{ mode: 0o600, flag: 'wx' }
		);
		const certificate = browserMode ? await compiledFixtureCertificate() : undefined;
		const startupStarted = performance.now();
		runtime = new Miniflare(
			convertV4MiniflareOptions({
				https: browserMode,
				resourcePersistencePath: join(directory, 'runtime-state'),
				workers: [
					{
						...common,
						name: 'pages',
						routes: ['pages.compiled.invalid/*', ...(browserMode ? ['127.0.0.1/*'] : [])],
						modules,
						d1Databases,
						durableObjects: {
							REALTIME_HUB: { className: 'RealtimeDurableObject', scriptName: 'realtime' }
						},
						...(browserMode
							? { assets: { directory: assetsPath, binding: 'ASSETS', run_worker_first: true } }
							: { serviceBindings: { ASSETS: 'assets' } })
					},
					{
						...common,
						name: 'realtime',
						scriptPath: doFile,
						modulesRoot: directory,
						durableObjects: { REALTIME_HUB: 'RealtimeDurableObject' }
					},
					{
						...common,
						name: 'assets',
						script: 'export default {fetch(){return new Response("Missing asset",{status:404})}};'
					},
					{
						...common,
						name: 'no-hub',
						routes: ['no-hub.compiled.invalid/*'],
						modules,
						d1Databases
					},
					{ ...common, name: 'no-db', routes: ['no-db.compiled.invalid/*'], modules }
				]
			})
		);
		const address = await runtime.ready;
		// Native HTTP owns rejected upgrade sockets; v5 SDK unexpected-response requests stay open.
		const wireResponse = async (worker, req, discardBody = false) => {
			const body = req.body ? await req.text() : undefined;
			return new Promise((resolveResponse, reject) => {
				const original = new URL(req.url);
				const headers = { ...Object.fromEntries(req.headers), Host: `${worker}.compiled.invalid` };
				if (headers.upgrade) {
					headers.Connection = 'Upgrade';
					headers['Sec-WebSocket-Key'] = 'dGhlIHNhbXBsZSBub25jZQ==';
					headers['Sec-WebSocket-Version'] = '13';
				}
				const outgoing = httpRequest(
					new URL(original.pathname + original.search, address),
					{
						method: req.method,
						headers,
						agent: false
					},
					(response) => {
						if (discardBody) {
							clearTimeout(timer);
							response.destroy();
							outgoing.destroy();
							reject(
								new Error(
									response.statusCode === 200
										? 'OWNED_LEDGER_RESPONSE_LOST'
										: 'Owned body fault requires committed200 response headers'
								)
							);
							return;
						}
						const chunks = [];
						response.on('data', (chunk) => chunks.push(chunk));
						response.on('error', (error) => {
							clearTimeout(timer);
							reject(error);
						});
						response.on('end', () => {
							clearTimeout(timer);
							resolveResponse({
								status: response.statusCode,
								headers: response.headers,
								body: Buffer.concat(chunks).toString('utf8')
							});
							outgoing.destroy();
						});
					}
				);
				const timer = setTimeout(
					() => outgoing.destroy(new Error('Owned HTTP response deadline')),
					5000
				);
				outgoing.on('error', (error) => {
					clearTimeout(timer);
					reject(error);
				});
				outgoing.on('upgrade', (_response, socket) => {
					clearTimeout(timer);
					socket.destroy();
					reject(new Error('Negative authorization unexpectedly upgraded'));
				});
				outgoing.end(body);
			});
		};
		const databases = {};
		const migrations = (await readdir('drizzle')).filter((file) => file.endsWith('.sql')).sort();
		for (const binding of Object.keys(d1Databases)) {
			const db = await runtime.getD1Database(binding, 'pages');
			databases[binding] = db;
			for (const file of migrations) {
				const queries = (await readFile(join('drizzle', file), 'utf8'))
					.split('--> statement-breakpoint')
					.map((sql) => sql.trim())
					.filter(Boolean);
				await db.batch(queries.map((sql) => db.prepare(sql)));
			}
		}
		const branches = {
			samarinda: 'DB_SAMARINDA_GROUP',
			samarinda2: 'DB_SAMARINDA_GROUP',
			balikpapan: 'DB_BALIKPAPAN_GROUP',
			balikpapan2: 'DB_BALIKPAPAN_GROUP',
			berau: 'DB_BERAU_GROUP'
		};
		const credentials = {};
		for (const [branch, binding] of Object.entries(branches)) {
			const db = databases[binding],
				id = `owned-${branch}`,
				sid = `${branch}.${randomUUID()}`;
			credentials[branch] = sid;
			await db
				.prepare(
					"INSERT INTO profil(id,cabang_id,username,password,role)VALUES(?,?,?,'unusable-fixture-hash','pemilik')"
				)
				.bind(id, branch, id)
				.run();
			await db
				.prepare(
					'INSERT INTO auth_sessions(id,cabang_id,user_id,username,role,created_at,expires_at,unlocked_pages,unlock_expires_at)VALUES(?,?,?,?,?,?,?,?,?)'
				)
				.bind(sid, branch, id, 'stale-name', 'supervisor', NOW, Number.MAX_SAFE_INTEGER, '[]', 0)
				.run();
		}
		if (browserMode) {
			const password = await seedCompiledBrowser(databases.DB_SAMARINDA_GROUP);
			try {
				await runCompiledBrowser({ address, password, startupStarted, certificate });
			} catch (error) {
				retainOwnedState = error.retainOwnedState === true;
				throw error;
			}
			await verifyBuiltSnapshot(resolve('.svelte-kit/cloudflare'), assetsSnapshot.hashes);
			console.log('COMPILED_BROWSER_BUILD ' + JSON.stringify(assetsSnapshot));
			// Native HTTP/WebSocket and real HTTPS browser callers own separate runtime selections.
			// Default --compiled still executes all eleven native cases; no gate is removed.
			return;
		}
		await compiledLedgerHttpTests({ wireResponse, WorkerRequest, databases, branches });
		const pages = await runtime.getWorker('pages');
		const request = (branch, sid = credentials[branch], upgrade = true, method = 'GET') =>
			new WorkerRequest(`https://compiled.invalid/api/realtime?branch=${branch}`, {
				method,
				headers: { Cookie: `zatiaras_sid=${sid}`, ...(upgrade ? { Upgrade: 'websocket' } : {}) }
			});
		const connect = async (branch) => {
			const response = await pages.fetch(request(branch));
			assert.equal(response.status, 101);
			assert.ok(response.webSocket);
			response.webSocket.accept();
			sockets.push(response.webSocket);
			return response.webSocket;
		};
		await test('actual built Pages module delegates to compiled SvelteKit session route', async () => {
			const response = await pages.fetch(
				new WorkerRequest('https://compiled.invalid/api/session', {
					headers: { Cookie: `zatiaras_sid=${credentials.samarinda}` }
				})
			);
			assert.equal(response.status, 200);
			const body = await response.json();
			assert.equal(body.authenticated, true);
			assert.equal(body.user.role, 'pemilik');
			assert.equal(body.user.username, 'owned-samarinda');

			const pageResponse = (path, sid) =>
				pages.fetch(
					new WorkerRequest(`https://compiled.invalid${path}`, {
						redirect: 'manual',
						headers: sid ? { Cookie: `zatiaras_sid=${sid}` } : {}
					})
				);
			for (const path of ['/laporan', '/pengaturan/pemilik/arsip']) {
				const anonymous = await pageResponse(path);
				assert.equal(anonymous.status, 303);
				assert.equal(anonymous.headers.get('Location'), '/login?reason=unauthorized');
				await anonymous.text();
			}
			const db = databases.DB_SAMARINDA_GROUP;
			for (const role of ['pemilik', 'kasir', 'admin']) {
				await db
					.prepare("UPDATE profil SET role=? WHERE cabang_id='samarinda' AND id='owned-samarinda'")
					.bind(role)
					.run();
				const archive = await pageResponse('/pengaturan/pemilik/arsip', credentials.samarinda);
				// Admin setara pemilik di halaman arsip (F17).
				const canOpenArchive = role === 'pemilik' || role === 'admin';
				assert.equal(archive.status, canOpenArchive ? 200 : 303);
				if (!canOpenArchive) assert.equal(archive.headers.get('Location'), '/unauthorized');
				await archive.text();
			}
			await db
				.prepare(
					"UPDATE profil SET role='pemilik' WHERE cabang_id='samarinda' AND id='owned-samarinda'"
				)
				.run();
		});
		await test('actual built entry + external real DO: all branches connect, heartbeat, fanout, isolation and reconnect', async () => {
			const a = await connect('samarinda'),
				b = await connect('samarinda'),
				sibling = await connect('samarinda2'),
				foreign = await connect('berau');
			for (const branch of ['balikpapan', 'balikpapan2']) await connect(branch);
			const pong = socketMessage(a, 'pong');
			a.send('ping');
			await pong;
			const ns = await runtime.getDurableObjectNamespace('REALTIME_HUB', 'realtime');
			const publish = async (branch, payload) =>
				ns
					.get(ns.idFromName(branch))
					.fetch('https://do.invalid/publish', { method: 'POST', body: JSON.stringify(payload) });
			const payload = {
					table: 'produk',
					action: 'update',
					id: 'owned-fanout',
					data: { marker: 'same-branch' }
				},
				encoded = JSON.stringify(payload);
			let leaked = 0;
			const rejectLeak = (event) => {
				if (String(event.data) === encoded) leaked++;
			};
			sibling.addEventListener('message', rejectLeak);
			foreign.addEventListener('message', rejectLeak);
			const received = [socketMessage(a, encoded), socketMessage(b, encoded)];
			assert.equal((await (await publish('samarinda', payload)).json()).delivered, 2);
			await Promise.all(received);
			// Independent branch round-trips fence the observation without sleep-based assertions.
			const fences = [socketMessage(sibling, 'pong'), socketMessage(foreign, 'pong')];
			sibling.send('ping');
			foreign.send('ping');
			await Promise.all(fences);
			assert.equal(leaked, 0);
			await closeSocket(a, 'owned reconnect');
			const reconnected = await connect('samarinda');
			const heartbeat = socketMessage(reconnected, 'pong');
			reconnected.send('ping');
			await heartbeat;
		});
		await test('compiled D1 live authority rejects unknown/deleted/wrong-profile/expired/revoked/prefix and foreign sessions', async () => {
			const db = databases.DB_SAMARINDA_GROUP,
				sid = credentials.samarinda;
			const repair = async () => {
				await db
					.prepare(
						"INSERT OR REPLACE INTO profil(id,cabang_id,username,password,role)VALUES('owned-samarinda','samarinda','owned-samarinda','unusable-fixture-hash','pemilik')"
					)
					.run();
				await db
					.prepare("UPDATE auth_sessions SET cabang_id='samarinda',expires_at=? WHERE id=?")
					.bind(Number.MAX_SAFE_INTEGER, sid)
					.run();
			};
			for (const role of [' KASIR ', 'pemilik', 'admin']) {
				await db.prepare("UPDATE profil SET role=? WHERE id='owned-samarinda'").bind(role).run();
				const authorized = await connect('samarinda');
				await closeSocket(authorized, 'owned role matrix');
			}
			await repair();
			for (const mutation of [
				"UPDATE profil SET role='supervisor' WHERE id='owned-samarinda'",
				"DELETE FROM profil WHERE id='owned-samarinda'",
				"UPDATE profil SET cabang_id='samarinda2' WHERE id='owned-samarinda'",
				"UPDATE auth_sessions SET expires_at=0 WHERE user_id='owned-samarinda'",
				[
					"UPDATE auth_sessions SET cabang_id='samarinda2' WHERE user_id='owned-samarinda'",
					"UPDATE profil SET cabang_id='samarinda2' WHERE id='owned-samarinda'"
				]
			]) {
				const statements = Array.isArray(mutation) ? mutation : [mutation];
				await db.batch(statements.map((sql) => db.prepare(sql)));
				const denied = await wireResponse('pages', request('samarinda'));
				assert.equal(denied.status, 401);
				assert.doesNotMatch(denied.body, /SELECT|auth_sessions|database_id/);
				await db.prepare("DELETE FROM profil WHERE id='owned-samarinda'").run();
				await repair();
			}
			for (const foreignBranch of ['samarinda2', 'berau']) {
				const denied = await wireResponse('pages', request(foreignBranch, sid));
				assert.equal(denied.status, 403);
				assert.doesNotMatch(denied.body, /SELECT|auth_sessions|database_id/);
			}
			await db.prepare("UPDATE profil SET role=' ADMIN ' WHERE id='owned-samarinda'").run();
			const response = await pages.fetch(request('berau', sid));
			assert.equal(response.status, 101);
			response.webSocket.accept();
			sockets.push(response.webSocket);
			await repair();
			await db.prepare('DELETE FROM auth_sessions WHERE id=?').bind(sid).run();
			const revoked = await wireResponse('pages', request('samarinda'));
			assert.equal(revoked.status, 401);
			assert.doesNotMatch(revoked.body, /SELECT|auth_sessions|database_id/);
		});
		await test('compiled invalid cookie/branch/method/nonupgrade and missing bindings fail closed', async () => {
			const expectStatus = async (worker, req, status, label) => {
				const response = await wireResponse(worker, req);
				assert.equal(response.status, status, label);
				assert.doesNotMatch(response.body, /SELECT|auth_sessions|database_id/);
			};
			for (const [index, cookie] of ['', '%E0%A4%A', 'constructor.invalid'].entries())
				await expectStatus('pages', request('berau', cookie), 401, `credential fixture ${index}`);
			await expectStatus('pages', request('__proto__', credentials.berau), 400, 'invalid branch');
			await expectStatus(
				'pages',
				request('berau', credentials.berau, false, 'POST'),
				405,
				'method'
			);
			await expectStatus('pages', request('berau', credentials.berau, false), 426, 'nonupgrade');
			for (const worker of ['no-hub', 'no-db'])
				await expectStatus(worker, request('berau'), 503, worker);
			const noHubDb = await runtime.getD1Database('DB_BERAU_GROUP', 'no-hub');
			assert.equal(
				(await noHubDb.prepare("SELECT id FROM profil WHERE id='owned-berau'").first()).id,
				'owned-berau',
				'Missing-hub fixture must still have live DB authority'
			);
			const db = databases.DB_BERAU_GROUP;
			await db.prepare('ALTER TABLE profil RENAME TO owned_authority_outage').run();
			try {
				await expectStatus('pages', request('berau'), 503, 'actual D1 auth query outage');
			} finally {
				await db.prepare('ALTER TABLE owned_authority_outage RENAME TO profil').run();
			}
		});
		const artifactHashes = {};
		for (const file of ['_worker.js', '_worker.sveltekit.js', '_worker.auth.js'])
			artifactHashes[file] = createHash('sha256')
				.update(await readFile(resolve('.svelte-kit/cloudflare', file)))
				.digest('hex');
		for (const module of modules)
			artifactHashes[`wrangler-bundle/${module.path.split(/[\\/]/).at(-1)}`] = createHash('sha256')
				.update(await readFile(module.path))
				.digest('hex');
		artifactHashes['realtimeDurableObject.js'] = createHash('sha256')
			.update(doSource)
			.digest('hex');
		console.log(
			'COMPILED_REALTIME_ARTIFACT ' +
				JSON.stringify({
					scope:
						'local actual workerd; exact Pages entry bundled by owned Wrangler Worker dry-run; not Pages upload or staging',
					artifactHashes,
					branches: Object.keys(branches),
					migrations: migrations.length
				})
		);
	} finally {
		const closures = await Promise.allSettled(
			sockets.map((socket) => closeSocket(socket, 'owned cleanup'))
		);
		console.log(
			'COMPILED_CLEANUP close acknowledgement failures=' +
				closures.filter((result) => result.status === 'rejected').length
		);
		await runtime?.dispose();
		console.log('COMPILED_CLEANUP runtime disposed');
		if (retainOwnedState) {
			console.log('COMPILED_CLEANUP browser stop unconfirmed; exact owned state retained');
		} else {
			await rm(directory, { recursive: true, force: true });
			console.log('COMPILED_CLEANUP owned state removed');
		}
		assert.equal(
			closures.filter((result) => result.status === 'rejected').length,
			0,
			'Every owned accepted socket must acknowledge close'
		);
	}
}

if (process.argv.includes('--compiled')) {
	await compiledTests();
} else {
	await sourceTests();
}
