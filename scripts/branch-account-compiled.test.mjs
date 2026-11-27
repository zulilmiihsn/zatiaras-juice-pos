// Owned Workerd resources only: a compiled gateway and three fully isolated application workers.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { snapshotBuiltAssets } from './test-fixtures/compiled-browser.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';
import {
	assertDrillParity,
	captureDrillParity,
	copyToD1,
	drillIdentifier
} from './restore-drill-local.mjs';

const branches = ['samarinda', 'balikpapan', 'berau'];
const publicOrigin = 'https://kasir.branch.test';
const backendOrigin = (branch) => `https://${branch}.branch.test`;
const storageOrigin = 'https://storage.branch.test';
const secret = () => randomBytes(32).toString('hex');
const maintenanceSecret = secret();
const storageKeys = Object.fromEntries(branches.map((branch) => [branch, secret()]));
const relayKeys = Object.fromEntries(branches.map((branch) => [branch, secret()]));
const dbBinding = (branch) => `DB_${branch.toUpperCase()}_GROUP`;
const fixtures = await mkdtemp(join(tmpdir(), 'zpos-branch-compiled-'));
let runtime;
let unavailableBackend = backendOrigin('berau');
let corruptArchiveReadback = false;
function sendToStorage(request) {
	const url = new URL(request.url);
	if (url.origin !== storageOrigin) return new Response(null, { status: 502 });
	if (
		corruptArchiveReadback &&
		request.method === 'GET' &&
		url.searchParams.get('key')?.startsWith('arsip/')
	)
		return new Response('{}', { headers: { 'content-type': 'application/json' } });
	return runtime.dispatchFetch(request);
}

async function buildWorker(entry) {
	const name = `owned-${entry.split('.')[0]}`;
	const config = join(fixtures, `${name}.json`);
	const source = resolve('staging', entry);
	const out = join(fixtures, name);
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
	return join(out, `${entry.split('.')[0]}.js`);
}

function d1Adapter(db) {
	return { all: async (sql) => (await db.prepare(sql).all()).results };
}

/** Mirrors the staging export/replay assertions on synthetic, local D1 only. */
async function restoreOwnedSnapshot(source, target) {
	const adapter = d1Adapter(source);
	const before = await captureDrillParity(adapter);
	const snapshot = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
	try {
		const objects = await adapter.all(
			"SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type,name"
		);
		for (const type of ['table', 'index'])
			for (const object of objects.filter((o) => o.type === type)) snapshot.exec(object.sql);
		for (const table of Object.keys(before)) {
			const identifier = drillIdentifier(table);
			const columns = snapshot
				.prepare(`PRAGMA table_info(${identifier})`)
				.all()
				.map((c) => c.name);
			const insert = snapshot.prepare(
				`INSERT INTO ${identifier} (${columns.map(drillIdentifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`
			);
			for (const row of await adapter.all(`SELECT * FROM ${identifier}`))
				insert.run(...columns.map((column) => row[column]));
		}
		for (const object of objects.filter((o) => o.type === 'trigger')) snapshot.exec(object.sql);
		assert.equal(snapshot.prepare('PRAGMA foreign_key_check').all().length, 0);
		await copyToD1(snapshot, target);
		assertDrillParity(before, await captureDrillParity(d1Adapter(target)));
	} finally {
		snapshot.close();
	}
}

async function seed(branch, passwordHash, migrations, worker = branch, activate = true) {
	const db = await runtime.getD1Database(dbBinding(branch), worker);
	const source =
		branch === 'balikpapan'
			? await runtime.getD1Database('LEGACY_FIXTURE', 'cutover-fixtures')
			: db;
	for (const schema of migrations) await source.batch(schema.map((sql) => source.prepare(sql)));
	await source
		.prepare(
			"INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,'kasir',?,'kasir')"
		)
		.bind(`${branch}-cashier`, branch, passwordHash)
		.run();
	await source
		.prepare(
			"INSERT INTO produk (id,cabang_id,nama,harga,stok,lacak_stok,lacak_bahan,is_active) VALUES('juice',?,'Jus Uji',10000,5,1,0,1)"
		)
		.bind(branch)
		.run();
	await source
		.prepare(
			"INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,'pemilik',?,'pemilik')"
		)
		.bind(`${branch}-owner`, branch, passwordHash)
		.run();
	if (source !== db) {
		await source.prepare('INSERT INTO kiosk_shift_cutover(cabang_id) VALUES(?)').bind(branch).run();
		await restoreOwnedSnapshot(source, db);
	}
	if (!activate) return { db, source };
	const namespace = await runtime.getDurableObjectNamespace('REALTIME_HUB', worker);
	const hub = namespace.get(namespace.idFromName(`cashier:${branch}`));
	const project = (action) =>
		hub.fetch(`https://cashier.internal/projection/${action}`, {
			method: 'POST',
			body: JSON.stringify({ branch })
		});
	const activation = await project('activate-production');
	assert.equal(activation.status, 200, `${branch}: aktivasi fixture`);
	assert.deepEqual(await activation.json(), { ok: true, status: 'initialized' });
	return { db, source };
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
	const scriptPath = await buildWorker('branch-account-worker.mjs');
	const storageScript = await buildWorker('branch-storage-worker.ts');
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
	const readyOrigin = 'https://berau-ready.example.test';
	const backend = (branch, name = branch, origin = backendOrigin(branch)) => ({
		...common,
		name,
		routes: [origin + '/*'],
		d1Databases: { [dbBinding(branch)]: randomUUID() },
		...(branch === 'samarinda'
			? { serviceBindings: { BRANCH_STORAGE_LOCAL: sendToStorage } }
			: { outboundService: sendToStorage }),
		durableObjects: {
			REALTIME_HUB: { className: 'RealtimeDurableObject', useSQLite: true },
			BRANCH_MAINTENANCE: { className: 'BranchMaintenanceAlarm', useSQLite: true }
		},
		bindings: {
			...shared,
			BRANCH_ACCOUNT_MODE: 'backend',
			BRANCH_ACCOUNT_IDENTITY: branch,
			BRANCH_MAINTENANCE_SECRET: maintenanceSecret,
			BRANCH_STORAGE_ORIGIN: storageOrigin,
			BRANCH_STORAGE_SECRET: storageKeys[branch],
			BRANCH_RELAY_SECRET: relayKeys[branch],
			KIOSK_PRODUCTION_PILOT: branch,
			KIOSK_PROJECTION_BRANCHES: branch,
			POS_PRICE_SIGNING_KEY: secret()
		}
	});
	const readyBackend = backend('berau', 'berau-ready', readyOrigin);
	const activationSecret = secret();
	Object.assign(readyBackend.bindings, {
		BRANCH_ACTIVATION_SECRET: activationSecret,
		BRANCH_PRODUCTION_CANDIDATE: 'yes',
		BRANCH_CUTOVER_STATE: 'paused',
		BRANCH_CONNECTION_PROBE: 'yes',
		BRANCH_OPERATIONAL_READY: 'yes'
	});
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
				{
					modules: true,
					compatibilityDate: common.compatibilityDate,
					compatibilityFlags: common.compatibilityFlags,
					scriptPath: storageScript,
					modulesRoot: fixtures,
					name: 'storage',
					routes: [storageOrigin + '/*'],
					r2Buckets: { STORAGE: 'assets-shared' },
					bindings: Object.fromEntries(
						branches.map((branch) => [
							`STORAGE_SECRET_${branch.toUpperCase()}`,
							storageKeys[branch]
						])
					)
				},
				{
					...common,
					name: 'cutover-fixtures',
					d1Databases: { LEGACY_FIXTURE: randomUUID(), ROLLBACK_FIXTURE: randomUUID() }
				},
				...branches.map((branch) => backend(branch)),
				readyBackend
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
	const { db: preparedDb } = await seed(
		'berau',
		passwordHash,
		migrations,
		readyBackend.name,
		false
	);
	const readyProbe = readyOrigin + '/internal/cutover/connection';
	const headers = { 'x-zatiaras-relay-key': relayKeys.berau, 'x-zatiaras-relay-branch': 'berau' };
	assert.equal((await runtime.dispatchFetch(readyProbe)).status, 401);
	const readiness = await runtime.dispatchFetch(readyProbe, { headers });
	assert.equal(readiness.status, 204, 'Production-style preparation must not need a live shift');
	assert.equal(readiness.headers.get('x-zpos-operational-ready'), 'yes');
	assert.equal(readiness.headers.get('x-zpos-coordinator-shift'), 'uninitialized');
	assert.equal((await runtime.dispatchFetch(readyOrigin + '/login', { headers })).status, 503);
	assert.equal(
		(
			await runtime.dispatchFetch(readyOrigin + '/internal/maintenance/start', {
				method: 'POST',
				headers: { 'x-maintenance-secret': maintenanceSecret }
			})
		).status,
		404
	);
	assert.equal(
		await preparedDb
			.prepare("SELECT count(*) AS n FROM kiosk_shift_cutover WHERE cabang_id='berau'")
			.first('n'),
		0
	);
	assert.equal(
		await preparedDb
			.prepare("SELECT stok FROM produk WHERE cabang_id='berau' AND id='juice'")
			.first('stok'),
		5
	);
	const activatePath = readyOrigin + '/internal/cutover/activate';
	const activate = (key, method = 'POST') =>
		runtime.dispatchFetch(activatePath, {
			method,
			headers: { ...headers, 'x-zpos-cutover-activation': key }
		});
	assert.equal(
		(
			await runtime.dispatchFetch(activatePath, {
				method: 'POST',
				headers: { 'x-zpos-cutover-activation': activationSecret }
			})
		).status,
		401
	);
	assert.equal((await activate('invalid')).status, 404);
	assert.equal((await activate(activationSecret, 'GET')).status, 404);
	assert.equal(
		await preparedDb
			.prepare("SELECT count(*) AS n FROM kiosk_shift_cutover WHERE cabang_id='berau'")
			.first('n'),
		0
	);
	for (let attempt = 0; attempt < 2; attempt++) {
		const activation = await activate(activationSecret);
		assert.equal(activation.status, 204);
		assert.equal(activation.headers.get('x-zpos-coordinator-shift'), 'closed');
	}
	assert.equal(
		await preparedDb
			.prepare("SELECT count(*) AS n FROM kiosk_shift_cutover WHERE cabang_id='berau'")
			.first('n'),
		1
	);
	assert.equal(
		await preparedDb
			.prepare("SELECT count(*) AS n FROM sesi_toko WHERE cabang_id='berau' AND is_active=1")
			.first('n'),
		0
	);
	assert.equal((await runtime.dispatchFetch(readyOrigin + '/login', { headers })).status, 503);
	const loginPage = await runtime.dispatchFetch(publicOrigin + '/login');
	assert.equal(loginPage.status, 200);
	assert.match(await loginPage.text(), /Masuk untuk memulai sesi kasir/);
	const asset = await runtime.dispatchFetch(publicOrigin + '/img/logo.svg');
	assert.equal(asset.status, 200);
	await asset.body?.cancel();
	for (const branch of branches) {
		if (branch === 'berau') unavailableBackend = '';
		const maintenance = backendOrigin(branch) + '/internal/maintenance/start';
		assert.equal((await runtime.dispatchFetch(maintenance, { method: 'POST' })).status, 404);
		const boot = () =>
			runtime.dispatchFetch(maintenance, {
				method: 'POST',
				headers: { 'x-maintenance-secret': maintenanceSecret }
			});
		assert.equal((await boot()).status, 204);
		assert.equal((await boot()).status, 204);
		const { db, source } = await seed(branch, passwordHash, migrations);
		const key = `produk/${branch}/1234.webp`;
		const bucket = await runtime.getR2Bucket('STORAGE', 'storage');
		await bucket.put(key, branch, { httpMetadata: { contentType: 'image/webp' } });
		const image = await browserCaller().fetch(`/api/upload?${new URLSearchParams({ key })}`);
		assert.equal(image.status, 200);
		assert.equal(image.headers.get('content-type'), 'image/webp');
		assert.equal(await image.text(), branch);
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
		// Operational-only kiosk sessions are rejected before normal owner role checks.
		assert.equal(forbidden.status, 401);
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
		const day = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const report = await owner.fetch(`/api/reports/aggregate?start_date=${day}&end_date=${day}`);
		assert.equal(report.status, 200);
		assert.equal((await report.json()).summary.pendapatan, 10000);
		const wrongReport = await owner.fetch(
			`/api/reports/aggregate?branch=${other}&start_date=${day}&end_date=${day}`
		);
		assert.equal(wrongReport.status, 403);
		await wrongReport.body?.cancel();
		if (source !== db) {
			const legacyOpen = (target) =>
				target
					.prepare(
						"INSERT INTO sesi_toko(id,cabang_id,waktu_buka,kas_awal,is_active) VALUES('legacy-reopened',?,'2026-01-01T00:00:00Z',0,1)"
					)
					.bind(branch)
					.run();
			await assert.rejects(() => legacyOpen(source), /KIOS_CUTOVER_PAUSED/);
			await assert.rejects(() => legacyOpen(db), /KIOS_CUTOVER_PAUSED/);
			const [coordinator, rollback] = await Promise.all([
				owner.fetch('/api/perangkat-kasir'),
				runtime.getD1Database('ROLLBACK_FIXTURE', 'cutover-fixtures')
			]);
			assert.equal(coordinator.status, 200);
			assert.deepEqual(await coordinator.json(), { shift: 'closed', pending: 0, paused: false });
			await restoreOwnedSnapshot(db, rollback);
			const readLedger = (target) =>
				target
					.prepare(
						'SELECT nominal,receipt_snapshot,nomor_harian FROM buku_kas WHERE cabang_id=? AND id_sesi_toko=?'
					)
					.bind(branch, shiftId)
					.all();
			const [original, restored, legacy] = await Promise.all([
				readLedger(db),
				readLedger(rollback),
				readLedger(source)
			]);
			assert.equal(original.results.length, 1);
			assert.equal(original.results[0].nominal, 10000);
			assert.ok(original.results[0].receipt_snapshot);
			assert.ok(original.results[0].nomor_harian > 0);
			assert.deepEqual(restored.results, original.results);
			assert.deepEqual(legacy.results, []);
			// Reopen only the verified rollback copy. Both other local D1s remain fenced.
			await rollback
				.prepare('DELETE FROM kiosk_shift_cutover WHERE cabang_id=?')
				.bind(branch)
				.run();
			await legacyOpen(rollback);
			await assert.rejects(() => legacyOpen(db), /KIOS_CUTOVER_PAUSED/);
			await assert.rejects(() => legacyOpen(source), /KIOS_CUTOVER_PAUSED/);
			console.log(
				'cutover-fixtures: Balikpapan export/replay ulang menyimpan transaksi, struk, nomor pesanan, dan stok'
			);
		}
		const oldId = 'archive-shared-fixture';
		await db
			.prepare(
				"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,nominal,jenis) VALUES(?,?,'2024-06-01T02:00:00Z','manual','pemasukan',3000,'usaha')"
			)
			.bind(oldId, branch)
			.run();
		const csrfOwner = (await (await owner.fetch('/api/csrf')).json()).token;
		const archived = await owner.fetch('/api/archive', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-csrf-token': csrfOwner },
			body: JSON.stringify({ before_year: 2025 })
		});
		const result = await archived.json();
		assert.equal(archived.status, 200, JSON.stringify(result));
		assert.equal(result.count, 1);
		assert.match(result.key, new RegExp(`^arsip/${branch}/`));
		const snapshot = await bucket.get(result.key);
		assert.equal(snapshot.customMetadata.branch, branch);
		assert.equal(
			await db
				.prepare('SELECT id FROM buku_kas WHERE cabang_id=? AND id=?')
				.bind(branch, oldId)
				.first('id'),
			null
		);
		const download = await owner.fetch(
			`/api/archive/download?${new URLSearchParams({ job_id: result.job_id })}`
		);
		assert.equal(download.status, 200);
		assert.deepEqual(await download.json(), await snapshot.json());
		if (branch === 'berau') {
			await db
				.prepare(
					"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,nominal,jenis) VALUES('archive-corrupt',?,'2023-06-01T02:00:00Z','manual','pemasukan',3000,'usaha')"
				)
				.bind(branch)
				.run();
			corruptArchiveReadback = true;
			try {
				const failed = await owner.fetch('/api/archive', {
					method: 'POST',
					headers: { 'content-type': 'application/json', 'x-csrf-token': csrfOwner },
					body: JSON.stringify({ before_year: 2024 })
				});
				assert.equal(failed.status, 500);
				await failed.body?.cancel();
				assert.equal(
					await db
						.prepare("SELECT nominal FROM buku_kas WHERE cabang_id=? AND id='archive-corrupt'")
						.bind(branch)
						.first('nominal'),
					3000
				);
			} finally {
				corruptArchiveReadback = false;
			}
		}
		console.log(`branch-account-compiled: ${branch} login, struk, shift, D1 dan arsip R2 cocok`);
	}
} finally {
	try {
		await runtime?.dispose();
	} finally {
		await rm(fixtures, { recursive: true, force: true });
	}
}
