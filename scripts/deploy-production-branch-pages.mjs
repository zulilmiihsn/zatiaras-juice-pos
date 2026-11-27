import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
	appendFile,
	copyFile,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import {
	buildBranchProductionCandidateConfigs,
	legacyProductionOrigin
} from './branch-production-candidate-config.mjs';
import { wrangler, wranglerPages } from './deploy-branch-worker-cli.mjs';
import { snapshotBuiltAssets } from './test-fixtures/compiled-browser.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.ok(process.env.RUNNER_TEMP && process.env.GITHUB_STEP_SUMMARY);
const sha = process.env.RELEASE_COMMIT_SHA;
assert.match(sha ?? '', /^[a-f0-9]{40}$/);
const master = process.env.BRANCH_PRODUCTION_PREP_KEY;
assert.ok(/^[a-f0-9]{64}$/.test(master ?? ''), 'Kunci persiapan produksi tidak valid');
const derive = (purpose) => createHmac('sha256', master).update(purpose).digest('hex');
const inventory = JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}');
const staging = buildBranchStagingConfigs({
	...inventory,
	main: 'unused',
	publicAssets: 'unused',
	storageMain: 'unused'
});
const branches = Object.keys(staging.backends);
const account = staging.gateway.account_id;
assert.equal(account, staging.backends.samarinda.account_id);
assert.match(account, /^[a-f0-9]{26}f4ce43$/);
const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
assert.ok(token);
const name = 'zatiaraspos';
const connectionPath = '/internal/cutover/connection';
const probeKey = derive(`candidate-pages-probe:${sha}`);
const openPublic = process.argv.includes('--open-public');
if (openPublic)
	assert.equal(process.env.BRANCH_PUBLIC_OPEN_ACK, 'ACTIVATION_STOCK_CUTOFF_CONFIRMED');
const previousGate = openPublic ? 'new' : 'legacy';
const backendOrigins = new Map();
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

async function cloud(branch, path, method = 'GET') {
	const credential = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(credential, `Token ${branch} tidak tersedia`);
	const origin = `https://api.cloudflare.com/client/v4/accounts/${staging.backends[branch].account_id}`;
	const response = await fetch(`${origin}/${path}`, {
		method,
		headers: { authorization: `Bearer ${credential}` },
		redirect: 'error',
		signal: AbortSignal.timeout(12_000)
	});
	const result = await response.json();
	if (!response.ok || !result.success) {
		const codes = result.errors
			?.map(({ code }) => code)
			.filter(Number.isSafeInteger)
			.join(',');
		throw Error(`${branch}: Cloudflare HTTP ${response.status}; kode ${codes || '-'}`);
	}
	return result.result;
}
async function canonical() {
	const project = await cloud('samarinda', `pages/projects/${name}`);
	assert.equal(project.name, name);
	assert.equal(project.subdomain, new URL(legacyProductionOrigin).hostname);
	assert.equal(project.production_branch, 'main');
	const deployment = project.canonical_deployment;
	assert.match(deployment?.id ?? '', uuid);
	assert.equal(deployment.environment, 'production');
	assert.equal(deployment.deployment_trigger?.metadata?.branch, 'main');
	return deployment;
}
function fetchOrigin(path, init, origin = legacyProductionOrigin) {
	return fetch(new URL(path, origin), {
		...init,
		redirect: 'manual',
		signal: AbortSignal.timeout(11_000)
	});
}
async function verifyGate(kind) {
	const response = await fetchOrigin('/login');
	if (kind === 'open') {
		const matched =
			response.status === 200 &&
			response.headers.get('x-zpos-gateway') === 'branch-open' &&
			(response.headers.get('content-type') ?? '').startsWith('text/html') &&
			/Masuk untuk memulai sesi kasir/.test(await response.text());
		if (!response.bodyUsed) await response.body?.cancel();
		return matched;
	}
	const matched =
		response.status === 503 &&
		response.headers.get('cache-control') === 'no-store' &&
		response.headers.get('x-zpos-gateway') === (kind === 'new' ? 'branch-paused' : null) &&
		(await response.json().catch(() => null))?.message === 'Kasir sedang dalam pemeliharaan';
	if (!response.bodyUsed) await response.body?.cancel();
	return matched;
}
async function waitGate(kind, expectedId) {
	for (const delay of [0, 2000, 4000, 8000, 16000]) {
		if (delay) await sleep(delay);
		try {
			if ((await canonical()).id === expectedId && (await verifyGate(kind))) return;
		} catch {
			// Pages API visibility and edge propagation can lag the completed upload.
		}
	}
	throw Error(`Status URL kasir belum terverifikasi (${kind})`);
}
const before = await canonical();
assert.ok(await verifyGate(previousGate), 'URL wajib berada dalam tahap jeda yang sesuai');
const destinations = {};
for (const branch of branches) {
	const name = `zatiaraspos-${branch}`;
	const matches = (await cloud(branch, `d1/database?${new URLSearchParams({ name })}`)).filter(
		(db) => db.name === name
	);
	assert.equal(matches.length, 1, `${branch}: D1 tujuan tidak unik`);
	destinations[branch] = { name, id: matches[0].uuid };
}
const dir = await mkdtemp(join(process.env.RUNNER_TEMP, 'zpos-pages-paused-'));
let uploadAttempted = false;
try {
	const publicDir = join(dir, 'public');
	const source = resolve('.svelte-kit/cloudflare');
	const { gateway, backends } = buildBranchProductionCandidateConfigs({
		inventory,
		destinations,
		main: 'unused',
		publicAssets: publicDir,
		liveConfig: await readFile('wrangler.pages.jsonc', 'utf8'),
		connectPaused: true
	});
	const relays = Object.fromEntries(
		branches.map((branch) => [branch, derive(`candidate-relay:${branch}`)])
	);
	for (const branch of branches) {
		const origin = gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`];
		backendOrigins.set(branch, origin);
		const response = await fetchOrigin(
			connectionPath,
			{
				headers: { 'x-zatiaras-relay-key': relays[branch], 'x-zatiaras-relay-branch': branch }
			},
			origin
		);
		await response.body?.cancel();
		assert.equal(response.status, 204, `${branch}: probe backend belum terverifikasi`);
		if (openPublic) {
			assert.equal(response.headers.get('x-zpos-operational-ready'), 'yes');
			assert.equal(response.headers.get('x-zpos-coordinator-shift'), 'closed');
			const login = await fetchOrigin(
				'/login',
				{
					headers: {
						'x-zatiaras-relay-key': relays[branch],
						'x-zatiaras-relay-branch': branch
					}
				},
				origin
			);
			assert.equal(login.status, 200, `${branch}: backend belum siap melayani relay`);
			assert.ok(/Masuk untuk memulai sesi kasir/.test(await login.text()));
		}
	}
	await snapshotBuiltAssets(source, publicDir);
	const routes = JSON.parse(await readFile(join(source, '_routes.json'), 'utf8'));
	assert.ok(routes.include.includes('/*'));
	for (const path of ['/login', '/api/veriflogin', connectionPath]) {
		assert.ok(
			!routes.exclude.some((rule) =>
				rule.endsWith('*') ? path.startsWith(rule.slice(0, -1)) : path === rule
			)
		);
	}
	for (const file of ['_routes.json', '_headers', '_redirects']) {
		const from = join(source, file);
		const entry = await stat(from).catch((err) => {
			if (err.code !== 'ENOENT') throw err;
		});
		if (entry?.isFile()) await copyFile(from, join(publicDir, file));
	}
	const buildConfig = join(dir, 'bundle.json');
	const bundle = join(dir, 'bundle');
	await writeFile(
		buildConfig,
		JSON.stringify({
			name: 'zpos-pages-bundle-only',
			account_id: account,
			main: resolve('staging/branch-account-pages.mjs'),
			compatibility_date: gateway.compatibility_date,
			compatibility_flags: gateway.compatibility_flags
		}),
		{ flag: 'wx', mode: 0o600 }
	);
	wrangler('zpos-pages-bundle-only', buildConfig, token, [
		'deploy',
		'--dry-run',
		'--outdir',
		bundle
	]);
	const output = await readdir(bundle);
	assert.ok(
		output.includes('branch-account-pages.js') &&
			output.every(
				(file) =>
					file === 'branch-account-pages.js' || file === 'README.md' || file.endsWith('.map')
			),
		'Gateway Pages harus berupa satu modul tanpa file runtime tambahan'
	);
	await copyFile(join(bundle, 'branch-account-pages.js'), join(publicDir, '_worker.js'));
	await writeFile(
		join(dir, 'wrangler.jsonc'),
		JSON.stringify({
			name,
			pages_build_output_dir: 'public',
			compatibility_date: gateway.compatibility_date,
			compatibility_flags: gateway.compatibility_flags,
			vars: {
				...gateway.vars,
				BRANCH_PUBLIC_ORIGIN: legacyProductionOrigin,
				...(openPublic ? { BRANCH_PRODUCTION_CANDIDATE: 'no', BRANCH_CUTOVER_STATE: 'open' } : {})
			},
			services: [{ binding: 'BRANCH_LOCAL_BACKEND', service: backends.samarinda.name }],
			d1_databases: [],
			r2_buckets: [],
			durable_objects: { bindings: [] }
		}),
		{ flag: 'wx', mode: 0o600 }
	);
	await appendFile(
		process.env.GITHUB_STEP_SUMMARY,
		`Pages maintenance rollback reference: \`${before.id}\`\n`
	);
	assert.equal((await canonical()).id, before.id, 'Pages berubah sejak pemeriksaan awal');
	wranglerPages(
		name,
		dir,
		token,
		account,
		['secret', 'bulk', '--project-name', name],
		JSON.stringify({
			BRANCH_ROUTE_SECRET: derive('production-pages-route'),
			BRANCH_GATEWAY_PROBE_SECRET: probeKey,
			...Object.fromEntries(
				branches.map((branch) => [`BRANCH_RELAY_${branch.toUpperCase()}`, relays[branch]])
			)
		})
	);
	assert.equal((await canonical()).id, before.id, 'Pages berubah sebelum upload');
	assert.ok(await verifyGate(previousGate), 'Jeda berubah sebelum upload');
	uploadAttempted = true;
	wranglerPages(name, dir, token, account, [
		'deploy',
		'public',
		'--project-name',
		name,
		'--branch',
		'main',
		'--commit-hash',
		sha
	]);
	let active;
	for (const delay of [0, 2000, 4000, 8000, 16000]) {
		if (delay) await sleep(delay);
		const candidate = await canonical();
		if (candidate.id !== before.id && candidate.deployment_trigger.metadata.commit_hash === sha) {
			active = candidate;
			break;
		}
	}
	assert.ok(active, 'Deployment Pages baru belum terkonfirmasi');
	await waitGate(openPublic ? 'open' : 'new', active.id);
	if (openPublic) {
		const blocked = await fetchOrigin(connectionPath + '?branch=samarinda', {
			headers: { 'x-zpos-cutover-probe': probeKey }
		});
		assert.equal(blocked.status, 404, 'Probe tertutup tidak boleh aktif pada gateway publik');
		await blocked.body?.cancel();
		const csrf = await fetchOrigin('/api/csrf');
		assert.equal(csrf.status, 200);
		const data = await csrf.json();
		assert.ok(typeof data?.token === 'string' && data.token.length > 0, 'CSRF publik belum siap');
		const invalidBranch = await fetchOrigin('/api/veriflogin', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ branch: 'not-a-branch' })
		});
		assert.equal(
			invalidBranch.status,
			400,
			'Login cabang tidak dikenal harus ditolak sebelum relay'
		);
		await invalidBranch.body?.cancel();
		console.log(
			'URL kasir terbuka, login dan CSRF terverifikasi; tidak membuat transaksi produksi.'
		);
	} else
		for (const branch of branches) {
			const denied = await fetchOrigin('/api/veriflogin', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ branch })
			});
			assert.equal(denied.status, 503);
			assert.equal(denied.headers.get('x-zpos-gateway'), 'branch-paused');
			await denied.body?.cancel();
			const path = `${connectionPath}?${new URLSearchParams({ branch })}`;
			assert.equal((await fetchOrigin(path)).status, 404, 'Probe tanpa otorisasi harus ditolak');
			const proof = await fetchOrigin(path, { headers: { 'x-zpos-cutover-probe': probeKey } });
			assert.equal(proof.status, 204, `${branch}: Pages belum mencapai backend tertutup`);
			assert.equal(proof.headers.get('cache-control'), 'no-store');
			console.log(`${branch}: rute Pages produksi ke D1/R2 terverifikasi, login tetap ditolak`);
		}
	assert.equal((await canonical()).id, active.id, 'Deployment Pages berubah selama probe');
	await appendFile(
		process.env.GITHUB_STEP_SUMMARY,
		`Pages branch gateway (${openPublic ? 'open' : 'paused'}): \`${active.id}\`\n`
	);
} catch (failure) {
	if (uploadAttempted) {
		try {
			const active = await canonical();
			if (active.id !== before.id) {
				assert.equal(
					active.deployment_trigger.metadata.commit_hash,
					sha,
					'Menolak rollback deployment lain'
				);
				await cloud(
					'samarinda',
					`pages/projects/${name}/deployments/${before.id}/rollback`,
					'POST'
				);
			}
			await waitGate(previousGate, before.id);
			console.log(
				openPublic
					? 'Pages kembali dijeda pada gateway cabang. Pertahankan otoritas D1/DO baru; jangan buka jalur lama.'
					: 'Pages kembali ke deployment pemeliharaan lama; backend tetap tertutup.'
			);
		} catch (rollbackError) {
			throw new AggregateError(
				[failure, rollbackError],
				'Periksa rute Pages sebelum mengulang atau membuka layanan'
			);
		}
	}
	throw failure;
} finally {
	await rm(dir, { recursive: true, force: true });
}

// Run after route verification and outside rollback: maintenance cannot make valid sales unsafe.
if (openPublic) {
	const failed = [];
	for (const [branch, origin] of backendOrigins) {
		try {
			const result = await fetchOrigin(
				'/internal/maintenance/start',
				{
					method: 'POST',
					headers: { 'x-maintenance-secret': derive(`production-maintenance:${branch}`) }
				},
				origin
			);
			await result.body?.cancel();
			if (result.status !== 204) throw new Error('Alarm belum terverifikasi');
			console.log(`${branch}: alarm maintenance aktif`);
		} catch {
			failed.push(branch);
		}
	}
	if (failed.length)
		throw new Error(
			`Kasir sudah dibuka; alarm maintenance belum terverifikasi: ${failed.join(', ')}`
		);
}
