import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import {
	buildBranchProductionCandidateConfigs,
	legacyProductionOrigin,
	productionStorageName
} from './branch-production-candidate-config.mjs';
import { snapshotBuiltAssets } from './test-fixtures/compiled-browser.mjs';
import { wrangler } from './deploy-branch-worker-cli.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const master = process.env.BRANCH_PRODUCTION_PREP_KEY;
assert.ok(/^[a-f0-9]{64}$/.test(master ?? ''), 'Kunci kandidat produksi tidak tersedia');
const derive = (purpose) => createHmac('sha256', master).update(purpose).digest('hex');
const inventory = JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}');
const activateClosed = process.argv.includes('--activate-closed');
if (activateClosed) {
	assert.equal(process.env.BRANCH_ACTIVATION_ACK, 'STOCK_AND_CUTOFF_CONFIRMED');
	assert.ok(process.env.GITHUB_STEP_SUMMARY);
	assert.match(process.env.RELEASE_COMMIT_SHA ?? '', /^[a-f0-9]{40}$/);
}
const activationKey = (branch) =>
	derive(`candidate-activation:${process.env.RELEASE_COMMIT_SHA}:${branch}`);
const prepareOperational = activateClosed || process.argv.includes('--prepare-operational');
const connectPaused = prepareOperational || process.argv.includes('--connect-paused');
async function assertProductionPaused() {
	const response = await fetch(`${legacyProductionOrigin}/login`, {
		redirect: 'error',
		signal: AbortSignal.timeout(12_000)
	});
	assert.equal(response.status, 503);
	assert.equal((await response.json()).message, 'Kasir sedang dalam pemeliharaan');
	if (prepareOperational) {
		assert.equal(response.headers.get('x-zpos-gateway'), 'branch-paused');
		const project = await cloud('samarinda', 'pages/projects/zatiaraspos');
		assert.equal(project.subdomain, new URL(legacyProductionOrigin).hostname);
		assert.equal(project.canonical_deployment?.environment, 'production');
		const sha = project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash;
		assert.match(sha ?? '', /^[a-f0-9]{40}$/);
		for (const branch of branches) {
			const probe = await fetch(
				`${legacyProductionOrigin}/internal/cutover/connection?${new URLSearchParams({ branch })}`,
				{
					headers: { 'x-zpos-cutover-probe': derive(`candidate-pages-probe:${sha}`) },
					redirect: 'error',
					signal: AbortSignal.timeout(14_000)
				}
			);
			await probe.body?.cancel();
			assert.equal(probe.status, 204, `${branch}: rute privat Pages belum siap`);
		}
	}
}
const liveConfig = await readFile('wrangler.pages.jsonc', 'utf8');
const staging = buildBranchStagingConfigs({
	...inventory,
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
const branches = Object.keys(staging.backends);
const tokens = Object.fromEntries(
	branches.map((branch) => [branch, process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`]])
);

async function cloud(branch, path, sql) {
	assert.ok(tokens[branch], `Token kandidat ${branch} tidak tersedia`);
	const url = `https://api.cloudflare.com/client/v4/accounts/${staging.backends[branch].account_id}/${path}`;
	const response = await fetch(url, {
		method: sql ? 'POST' : 'GET',
		headers: { authorization: `Bearer ${tokens[branch]}`, 'content-type': 'application/json' },
		body: sql ? JSON.stringify({ sql }) : undefined,
		signal: AbortSignal.timeout(12_000)
	});
	const data = await response.json();
	if (!response.ok || !data.success)
		throw Error(
			`${branch}: verifikasi kandidat HTTP ${response.status}; kode ${
				data.errors
					?.map(({ code }) => code)
					.filter(Number.isSafeInteger)
					.join(',') || '-'
			}`
		);
	return data.result;
}

if (connectPaused) {
	await assertProductionPaused();
	const storage = await cloud('samarinda', `workers/scripts/${productionStorageName}/settings`);
	assert.ok(
		storage.bindings?.some(
			({ type, name, text }) =>
				type === 'plain_text' &&
				name === 'STORAGE_PRODUCTION_READ_ONLY' &&
				text === (prepareOperational ? 'no' : 'yes')
		),
		'Relay produksi belum pada mode yang diperlukan'
	);
}
const destinations = {};
for (const branch of branches) {
	const [source] = staging.backends[branch].d1_databases;
	const stagingDb = await cloud(branch, `d1/database/${source.database_id}`);
	assert.ok(
		stagingDb?.uuid === source.database_id && stagingDb.name === `zpos-${branch}-staging`,
		`${branch}: identitas akun tidak terverifikasi`
	);
	const name = `zatiaraspos-${branch}`;
	const list = await cloud(branch, `d1/database?${new URLSearchParams({ name })}`);
	const exact = list.filter((entry) => entry.name === name);
	assert.equal(exact.length, 1, `${branch}: harus ada tepat satu tujuan`);
	destinations[branch] = { name, id: exact[0].uuid };
}

const temporary = await mkdtemp(join(tmpdir(), 'zpos-prod-candidate-'));
try {
	const publicAssets = join(temporary, 'assets');
	const config = buildBranchProductionCandidateConfigs({
		inventory,
		destinations,
		main: resolve('staging/branch-account-worker.mjs'),
		publicAssets,
		liveConfig,
		connectPaused,
		prepareOperational
	});
	for (const branch of branches) {
		const { id, name } = destinations[branch];
		const identity = await cloud(branch, `d1/database/${id}`);
		assert.ok(identity?.uuid === id && identity.name === name);
		const [result] = await cloud(
			branch,
			`d1/database/${id}/query`,
			connectPaused
				? `SELECT (SELECT count(*) FROM profil WHERE cabang_id='${branch}') AS profiles,
				  (SELECT count(*) FROM sesi_toko WHERE cabang_id='${branch}' AND is_active=1) AS shifts,
				  (SELECT count(*) FROM kiosk_shift_cutover WHERE cabang_id='${branch}') AS managed`
				: "SELECT count(*) n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'"
		);
		const row = result.results?.[0];
		assert.ok(
			result.success &&
				(connectPaused
					? row?.profiles > 0 &&
						row.shifts === 0 &&
						(row.managed === 0 || (activateClosed && row.managed === 1))
					: row?.n === 0),
			`${branch}: kondisi D1 tidak sesuai tahap kandidat`
		);
	}
	// Never overwrite a worker outside this setup, even when the name is identical.
	const workers = Object.entries(config.backends);
	if (!connectPaused) workers.push(['samarinda', config.gateway]);
	for (const [branch, worker] of workers) {
		const list = await cloud(branch, 'workers/scripts');
		if (!list.some(({ id }) => id === worker.name)) {
			assert.ok(!connectPaused, `${worker.name}: kandidat tertutup belum ada`);
			continue;
		}
		const settings = await cloud(branch, `workers/scripts/${worker.name}/settings`);
		const vars = new Map(
			settings.bindings
				?.filter(({ type }) => type === 'plain_text')
				.map(({ name, text }) => [name, text])
		);
		const previousOrigin = vars.get('BRANCH_PUBLIC_ORIGIN');
		assert.ok(
			vars.get('BRANCH_PRODUCTION_CANDIDATE') === 'yes' &&
				vars.get('BRANCH_CUTOVER_STATE') === 'paused' &&
				vars.get('BRANCH_ACCOUNT_MODE') === worker.vars.BRANCH_ACCOUNT_MODE &&
				vars.get('BRANCH_ACCOUNT_IDENTITY') === worker.vars.BRANCH_ACCOUNT_IDENTITY &&
				(prepareOperational
					? vars.get('BRANCH_CONNECTION_PROBE') === 'yes' &&
						previousOrigin === legacyProductionOrigin
					: vars.get('BRANCH_OPERATIONAL_READY') !== 'yes') &&
				(!activateClosed || vars.get('BRANCH_OPERATIONAL_READY') === 'yes') &&
				(previousOrigin === worker.vars.BRANCH_PUBLIC_ORIGIN ||
					(connectPaused && previousOrigin === config.gateway.vars.BRANCH_PUBLIC_ORIGIN)),
			`${worker.name}: resource yang sudah ada bukan kandidat yang cocok`
		);
	}
	await snapshotBuiltAssets(resolve('.svelte-kit/cloudflare'), publicAssets);
	async function deploy(branch, worker, secrets) {
		const file = join(temporary, `${worker.name}.json`);
		await writeFile(file, JSON.stringify(worker), { flag: 'wx', mode: 0o600 });
		wrangler(worker.name, file, tokens[branch], ['deploy']);
		wrangler(worker.name, file, tokens[branch], ['secret', 'bulk'], JSON.stringify(secrets));
	}
	async function verify(url, expected, headers, isPaused) {
		let status;
		for (const delay of [0, 2000, 4000, 8000, 16000]) {
			if (delay) await sleep(delay);
			const response = await fetch(url, {
				headers,
				redirect: 'manual',
				signal: AbortSignal.timeout(10_000)
			});
			status = response.status;
			const matches = status === expected && (isPaused ? await isPaused(response) : true);
			if (!response.bodyUsed) await response.body?.cancel();
			if (matches) return;
		}
		throw Error(`Kandidat tidak terverifikasi: HTTP ${status}, diharapkan ${expected}`);
	}
	for (const branch of branches) {
		const secret = derive(`candidate-relay:${branch}`);
		await deploy(branch, config.backends[branch], {
			BRANCH_RELAY_SECRET: secret,
			...(connectPaused ? { BRANCH_STORAGE_SECRET: derive(`production-storage:${branch}`) } : {}),
			...(prepareOperational
				? { POS_PRICE_SIGNING_KEY: derive(`production-price:${branch}`) }
				: {}),
			...(activateClosed ? { BRANCH_ACTIVATION_SECRET: activationKey(branch) } : {})
		});
		const host = config.gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`];
		await verify(`${host}/login`, 401);
		await verify(
			`${host}/login`,
			503,
			{ 'x-zatiaras-relay-key': secret, 'x-zatiaras-relay-branch': branch },
			(response) => response.headers.get('x-zpos-candidate') === 'paused'
		);
		if (connectPaused) {
			const probe = `${host}/internal/cutover/connection`;
			await verify(probe, 401);
			await verify(
				probe,
				204,
				{
					'x-zatiaras-relay-key': secret,
					'x-zatiaras-relay-branch': branch
				},
				prepareOperational
					? (response) => response.headers.get('x-zpos-operational-ready') === 'yes'
					: undefined
			);
			console.log(
				prepareOperational
					? `${branch}: koordinator kosong, katalog bertanda tangan lolos, dan binding maintenance siap; kasir tetap tertutup`
					: `${branch}: D1 hasil impor dan relay R2 terhubung; trafik kasir ditolak`
			);
		} else console.log(`${branch}: backend kandidat menolak trafik; D1 tujuan kosong`);
	}
	if (connectPaused) {
		await assertProductionPaused();
		if (activateClosed) {
			for (const branch of branches) {
				const host = config.gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`];
				const response = await fetch(`${host}/internal/cutover/activate`, {
					method: 'POST',
					headers: {
						'x-zatiaras-relay-key': derive(`candidate-relay:${branch}`),
						'x-zatiaras-relay-branch': branch,
						'x-zpos-cutover-activation': activationKey(branch)
					},
					redirect: 'error',
					signal: AbortSignal.timeout(30_000)
				});
				assert.equal(response.status, 204, `${branch}: aktivasi belum pasti; pertahankan jeda`);
				assert.equal(response.headers.get('x-zpos-coordinator-shift'), 'closed');
				await appendFile(
					process.env.GITHUB_STEP_SUMMARY,
					`- ${branch}: koordinator aktif, shift tertutup dan fence D1 terverifikasi.\n`
				);
				console.log(
					`${branch}: koordinator aktif dengan shift tertutup dan fence D1 terverifikasi`
				);
			}
			await assertProductionPaused();
		}
		console.log('Ketiga backend terhubung dan tertutup. Pages produksi tidak diubah.');
	} else {
		await deploy('samarinda', config.gateway, {
			BRANCH_ROUTE_SECRET: derive('candidate-route'),
			...Object.fromEntries(
				branches.map((branch) => [
					`BRANCH_RELAY_${branch.toUpperCase()}`,
					derive(`candidate-relay:${branch}`)
				])
			)
		});
		await verify(
			`${config.gateway.vars.BRANCH_PUBLIC_ORIGIN}/login`,
			503,
			undefined,
			async (response) => {
				const body = await response.json().catch(() => null);
				return body?.message === 'Kasir sedang dalam pemeliharaan';
			}
		);
		console.log('Gateway kandidat terverifikasi dijeda; tidak ada rute produksi yang diubah');
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
}
