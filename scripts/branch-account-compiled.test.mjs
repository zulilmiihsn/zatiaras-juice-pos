// Owned Workerd resources only: a compiled gateway and three fully isolated application workers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { snapshotBuiltAssets } from './test-fixtures/compiled-browser.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';

const branches = ['samarinda', 'balikpapan', 'berau'];
const publicOrigin = 'https://kasir.branch.test';
const backendOrigin = (branch) => `https://${branch}.branch.test`;
const secret = () => randomBytes(32).toString('hex');
const relayKeys = Object.fromEntries(branches.map((branch) => [branch, secret()]));
const dbBinding = (branch) => `DB_${branch.toUpperCase()}_GROUP`;
const fixtures = await mkdtemp(join(tmpdir(), 'zpos-branch-compiled-'));
let runtime;
let unavailableBackend = backendOrigin('berau');

async function buildWorker() {
	const name = 'owned-branch-account-test';
	const config = join(fixtures, 'wrangler.json');
	const source = resolve('staging/branch-account-worker.mjs');
	const out = join(fixtures, 'bundle');
	await writeFile(
		config,
		JSON.stringify({
			name,
			main: source,
			compatibility_date: '2026-06-29',
			compatibility_flags: ['nodejs_compat']
		}),
		{ flag: 'wx' }
	);
	const run = wranglerInvocation(['deploy', '--dry-run', '--config', config, '--outdir', out]);
	const result = spawnSync(run.command, run.args, {
		...run.options,
		env: { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_SEND_METRICS: 'false' },
		timeout: 75_000
	});
	if (result.error) throw result.error;
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return join(out, 'branch-account-worker.js');
}

async function seed(branch, passwordHash, migrations) {
	const db = await runtime.getD1Database(dbBinding(branch), branch);
	for (const schema of migrations) await db.batch(schema.map((sql) => db.prepare(sql)));
	await db
		.prepare(
			"INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,'kasir',?,'kasir')"
		)
		.bind(`${branch}-cashier`, branch, passwordHash)
		.run();
	await db
		.prepare(
			"INSERT INTO produk (id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES('juice',?,'Jus Uji',10000,5,1,0,1)"
		)
		.bind(branch)
		.run();
	await db
		.prepare(
			"INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,'pemilik',?,'pemilik')"
		)
		.bind(`${branch}-owner`, branch, passwordHash)
		.run();
	const namespace = await runtime.getDurableObjectNamespace('REALTIME_HUB', branch);
	const hub = namespace.get(namespace.idFromName(`cashier:${branch}`));
	const project = (action) =>
		hub.fetch(`https://cashier.internal/projection/${action}`, {
			method: 'POST',
			body: JSON.stringify({ branch })
		});
	const activation = await project('activate-production');
	assert.equal(activation.status, 200, `${branch}: aktivasi fixture`);
	assert.deepEqual(await activation.json(), { ok: true, status: 'initialized' });
	return { db };
}

function browserCaller() {
	const cookies = new Map();
	return {
		cookies,
		async fetch(path, init = {}) {
			const headers = new Headers(init.headers);
			headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
			headers.set('cf-connecting-ip', '192.0.2.5');
			if (init.method === 'POST') headers.set('origin', publicOrigin);
			const response = await runtime.dispatchFetch(publicOrigin + path, {
				...init,
				headers,
				redirect: 'manual'
			});
			for (const value of response.headers.getSetCookie()) {
				const pair = value.split(';', 1)[0];
				const equals = pair.indexOf('=');
				cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
			}
			return response;
		}
	};
}

try {
	const scriptPath = await buildWorker();
	const assetDirectory = join(fixtures, 'assets');
	await snapshotBuiltAssets(resolve('.svelte-kit/cloudflare'), assetDirectory);
	const common = {
		modules: true,
		compatibilityDate: '2026-06-29',
		compatibilityFlags: ['nodejs_compat'],
		scriptPath,
		// Workerd resolves bundled module names relative to this root, not the repo cwd.
		modulesRoot: fixtures,
		assets: { directory: assetDirectory, binding: 'ASSETS', run_worker_first: true }
	};
	const shared = { BRANCH_PUBLIC_ORIGIN: publicOrigin };
	runtime = new Miniflare(
		convertV4MiniflareOptions({
			workers: [
				{
					...common,
					name: 'gateway',
					routes: [publicOrigin + '/*'],
					serviceBindings: {
						BRANCH_LOCAL_BACKEND: async (request) => {
							if (new URL(request.url).origin !== backendOrigin('samarinda'))
								return new Response(null, { status: 502 });
							return runtime.dispatchFetch(request);
						}
					},
					outboundService: async (request) => {
						if (new URL(request.url).origin === unavailableBackend)
							return new Response('Backend is down', { status: 503 });
						if (
							!branches
								.slice(1)
								.some((branch) => backendOrigin(branch) === new URL(request.url).origin)
						)
							return new Response(null, { status: 502 });
						return runtime.dispatchFetch(request);
					},
					bindings: {
						...shared,
						BRANCH_ACCOUNT_MODE: 'gateway',
						BRANCH_LOCAL_ORIGIN: backendOrigin('samarinda'),
						BRANCH_ROUTE_SECRET: secret(),
						...Object.fromEntries(
							branches.flatMap((branch) => [
								[`BRANCH_ORIGIN_${branch.toUpperCase()}`, backendOrigin(branch)],
								[`BRANCH_RELAY_${branch.toUpperCase()}`, relayKeys[branch]]
							])
						)
					}
				},
				...branches.map((branch) => ({
					...common,
					name: branch,
					routes: [backendOrigin(branch) + '/*'],
					d1Databases: { [dbBinding(branch)]: randomUUID() },
					durableObjects: { REALTIME_HUB: { className: 'RealtimeDurableObject', useSQLite: true } },
					bindings: {
						...shared,
						BRANCH_ACCOUNT_MODE: 'backend',
						BRANCH_ACCOUNT_IDENTITY: branch,
						BRANCH_RELAY_SECRET: relayKeys[branch],
						KIOSK_PRODUCTION_PILOT: branch,
						KIOSK_PROJECTION_BRANCHES: branch,
						POS_PRICE_SIGNING_KEY: secret()
					}
				}))
			]
		})
	);
	await runtime.ready;
	const migrations = [];
	for (const file of (await readdir('drizzle')).filter((file) => file.endsWith('.sql')).sort()) {
		migrations.push(
			(await readFile(join('drizzle', file), 'utf8'))
				.split('--> statement-breakpoint')
				.map((sql) => sql.trim())
				.filter(Boolean)
		);
	}
	const password = randomUUID();
	const passwordHash = await bcrypt.hash(password, 4);
	const loginPage = await runtime.dispatchFetch(publicOrigin + '/login');
	assert.equal(loginPage.status, 200);
	assert.match(await loginPage.text(), /Masuk untuk memulai sesi kasir/);
	const asset = await runtime.dispatchFetch(publicOrigin + '/img/logo.svg');
	assert.equal(asset.status, 200);
	await asset.body?.cancel();
	for (const branch of branches) {
		if (branch === 'berau') unavailableBackend = '';
		const { db } = await seed(branch, passwordHash, migrations);
		assert.equal((await runtime.dispatchFetch(backendOrigin(branch) + '/login')).status, 401);
		const browser = browserCaller();
		const anonymous = await browser.fetch('/api/perangkat-kasir');
		assert.equal(anonymous.status, 401);
		await anonymous.body?.cancel();
		const csrf = await browser.fetch('/api/csrf');
		assert.equal(csrf.status, 200);
		const { token } = await csrf.json();
		const loginTo = (target) =>
			browser.fetch('/api/veriflogin', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-csrf-token': token },
				body: JSON.stringify({ branch: target, username: 'kasir', password })
			});
		if (unavailableBackend) {
			const down = await loginTo('berau');
			assert.equal(down.status, 503);
			assert.equal(await down.text(), 'Backend is down');
		}
		const login = await loginTo(branch);
		assert.equal(login.status, 200, `${branch}: login ${await login.clone().text()}`);
		assert.deepEqual(await login.json(), { success: true, scope: 'operasional' });
		const forbidden = await browser.fetch('/api/perangkat-kasir');
		assert.equal(forbidden.status, 403);
		await forbidden.body?.cancel();
		const owner = browserCaller();
		const ownerToken = (await (await owner.fetch('/api/csrf')).json()).token;
		const ownerLogin = await owner.fetch('/api/veriflogin', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-csrf-token': ownerToken },
			body: JSON.stringify({ branch, username: 'pemilik', password })
		});
		assert.equal(ownerLogin.status, 200);
		await ownerLogin.body?.cancel();
		const other = branches.find((target) => target !== branch);
		const foreign = await owner.fetch(`/api/perangkat-kasir?branch=${other}`);
		assert.equal(foreign.status, 403);
		await foreign.body?.cancel();
		const statusResponse = await owner.fetch('/api/perangkat-kasir');
		assert.equal(statusResponse.status, 200);
		assert.equal(statusResponse.headers.get('cache-control'), 'no-store');
		assert.deepEqual(await statusResponse.json(), { shift: 'closed', pending: 0, paused: false });
		assert.match(browser.cookies.get('__Host-zatiaras_branch'), new RegExp(`^${branch}\\.`));
		const status = await browser.fetch('/operasional');
		assert.equal(status.status, 200);
		assert.match(await status.text(), new RegExp(`cabang ${branch}`));
		const action = (name, values) =>
			browser.fetch(`/operasional?/${name}`, { method: 'POST', body: new URLSearchParams(values) });
		const shiftId = 'shift-fixture';
		const opened = await action('open', { id: shiftId, openingCash: '100000' });
		assert.equal(opened.status, 200, `${branch}: buka shift`);
		assert.match(await opened.text(), /Pembukaan shift terkonfirmasi/);
		const sale = await action('sale', {
			id: 'sale-fixture',
			shiftId,
			productId: 'juice',
			qty: '1',
			unitPrice: '10000',
			portion: 'reguler',
			payment: 'tunai',
			cash: '10000'
		});
		assert.equal(sale.status, 200, `${branch}: penjualan`);
		const actionResult = await sale.json();
		assert.equal(actionResult.type, 'success');
		assert.match(actionResult.data, /receiptId/);
		assert.match(actionResult.data, /sale-fixture/);
		const closed = await action('close', { id: shiftId, confirm: 'yes' });
		assert.equal(closed.status, 200, `${branch}: tutup shift`);
		assert.match(await closed.text(), /Shift ditutup/);
		// No Cron or private drain call: the durable alarm must project the entire shift.
		const closedRow = () =>
			db
				.prepare('SELECT is_active FROM sesi_toko WHERE cabang_id=? AND id=?')
				.bind(branch, shiftId)
				.first('is_active');
		const deadline = performance.now() + 20_000;
		while ((await closedRow()) !== 0 && performance.now() < deadline) await sleep(250);
		const total = await db
			.prepare(
				'SELECT COUNT(*) AS n,SUM(nominal) AS total FROM buku_kas WHERE cabang_id=? AND id_sesi_toko=?'
			)
			.bind(branch, shiftId)
			.first();
		assert.deepEqual({ ...total }, { n: 1, total: 10000 });
		assert.equal(
			await db
				.prepare('SELECT is_active FROM sesi_toko WHERE cabang_id=? AND id=?')
				.bind(branch, shiftId)
				.first('is_active'),
			0
		);
		assert.equal(
			await db
				.prepare("SELECT stok FROM produk WHERE cabang_id=? AND id='juice'")
				.bind(branch)
				.first('stok'),
			4
		);
		console.log(`branch-account-compiled: ${branch} login, struk, shift dan D1 cocok`);
	}
} finally {
	try {
		await runtime?.dispose();
	} finally {
		await rm(fixtures, { recursive: true, force: true });
	}
}
