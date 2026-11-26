import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { smokeFromPages } from './smoke-branch-account-staging.mjs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { wrangler, wranglerPages } from './deploy-branch-worker-cli.mjs';

const { GITHUB_ACTIONS, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, RUNNER_TEMP } = process.env;
assert.equal(GITHUB_ACTIONS, 'true');
assert.equal(GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.match(GITHUB_RUN_ID ?? '', /^\d{1,16}$/);
assert.match(GITHUB_RUN_ATTEMPT ?? '', /^\d{1,4}$/);
assert.ok(RUNNER_TEMP);
const { gateway, backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
assert.equal(gateway.name, 'zpos-gateway-staging');
assert.equal(gateway.account_id, backends.samarinda.account_id);
const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
assert.ok(token);
const name = `zpos-pages-drill-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`;
const productionBranch = 'hold-unused';
const pagesKey = randomBytes(32).toString('hex');
const root = `https://api.cloudflare.com/client/v4/accounts/${gateway.account_id}/pages/projects`;
const dir = await mkdtemp(join(RUNNER_TEMP, 'zpos-pages-preview-'));

async function api(path, method = 'GET', payload) {
	const response = await fetch(root + path, {
		method,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: payload && JSON.stringify(payload),
		signal: AbortSignal.timeout(12_000)
	});
	const data = await response.json();
	if (method === 'GET' && path === `/${name}` && response.status === 404) return null;
	if (!response.ok || !data.success)
		throw Error(
			`Pages fixture ${method} HTTP ${response.status}; kode ${
				data.errors
					?.map(({ code }) => code)
					.filter(Number.isSafeInteger)
					.join(',') || '-'
			}`
		);
	return data.result;
}
async function verifyPaused(label, origin) {
	const observations = new Set();
	for (const delay of [0, 2000, 4000, 8000, 16000, 30000, 30000]) {
		if (delay) await sleep(delay);
		try {
			const response = await fetch(`${origin}/login`, {
				redirect: 'manual',
				signal: AbortSignal.timeout(8_000)
			});
			observations.add(`HTTP ${response.status}`);
			const body = await response.json().catch(() => null);
			if (
				response.status === 503 &&
				response.headers.get('cache-control') === 'no-store' &&
				body?.message === 'Kasir sedang dalam pemeliharaan'
			) {
				console.log(`Pages preview ${label}: gateway dijeda terverifikasi`);
				return;
			}
		} catch (error) {
			const code = error?.cause?.code ?? error?.name;
			observations.add(
				typeof code === 'string' && /^[A-Z][A-Z0-9_/-]{1,60}$/i.test(code) ? code : 'fetch gagal'
			);
		}
	}
	throw new Error(`Pages preview ${label} belum terverifikasi: ${[...observations].join(', ')}`);
}

const visibilityDelays = [0, 2000, 4000, 8000, 16000, 30000];
async function findProject() {
	for (const delay of visibilityDelays) {
		if (delay) await sleep(delay);
		const current = await api(`/${name}`);
		if (!current) continue;
		assert.ok(
			current.name === name && current.production_branch === productionBranch,
			'Identitas project fixture tidak cocok'
		);
		return current;
	}
	return null;
}

let started = false;
const failures = [];
try {
	assert.equal(await api(`/${name}`), null, 'Nama project preview sudah dipakai');
	const built = join(dir, 'bundle');
	const publicFiles = join(dir, 'public');
	await mkdir(publicFiles);
	const buildConfig = join(dir, 'build.jsonc');
	await writeFile(
		buildConfig,
		JSON.stringify({
			name,
			account_id: gateway.account_id,
			main: resolve('staging/pages-cutover-preview.ts'),
			compatibility_date: '2026-06-29',
			compatibility_flags: ['nodejs_compat']
		}),
		{ flag: 'wx', mode: 0o600 }
	);
	wrangler(name, buildConfig, token, ['deploy', '--dry-run', '--outdir', built]);
	await copyFile(join(built, 'pages-cutover-preview.js'), join(publicFiles, '_worker.js'));
	await writeFile(
		join(publicFiles, '_routes.json'),
		JSON.stringify({ version: 1, include: ['/*'], exclude: [] })
	);
	await writeFile(join(publicFiles, 'index.html'), '<!doctype html><title>Preview cutover</title>');
	const deployConfig = join(dir, 'wrangler.jsonc');
	await writeFile(
		deployConfig,
		JSON.stringify({
			name,
			services: [{ binding: 'STAGING_GATEWAY', service: gateway.name }],
			pages_build_output_dir: 'public',
			compatibility_date: '2026-06-29',
			compatibility_flags: ['nodejs_compat']
		}),
		{ flag: 'wx', mode: 0o600 }
	);
	started = true;
	const created = await api('', 'POST', { name, production_branch: productionBranch });
	assert.ok(created.name === name && created.production_branch === productionBranch);
	assert.ok(await findProject(), 'Project Pages belum terlihat setelah dibuat');
	await api(`/${name}`, 'PATCH', {
		deployment_configs: {
			production: { env_vars: { PAGES_SMOKE_KEY: { type: 'secret_text', value: pagesKey } } }
		}
	});
	function upload(branch) {
		wranglerPages(name, dir, token, gateway.account_id, [
			'deploy',
			'public',
			'--project-name',
			name,
			'--branch',
			branch
		]);
	}
	// Use the disposable project's stable hostname; preview aliases are not a production route.
	let uploadError;
	for (const delay of visibilityDelays) {
		if (delay) await sleep(delay);
		try {
			upload(productionBranch);
			uploadError = undefined;
			break;
		} catch (error) {
			// A missing project means no upload happened; other failures may have created a deployment.
			if (
				!(error instanceof Error) ||
				!error.message.includes(`The Pages project "${name}" does not exist.`)
			)
				throw error;
			uploadError = error;
		}
	}
	if (uploadError) throw uploadError;
	const stable = await api(`/${name}/deployments?env=production&per_page=2`);
	assert.ok(
		stable.some(
			(entry) =>
				entry.environment === 'production' &&
				entry.deployment_trigger?.metadata?.branch === productionBranch
		),
		'Deployment hostname utama fixture belum terkonfirmasi'
	);
	const origin = `https://${name}.pages.dev`;
	await verifyPaused('hostname utama fixture', origin);
	assert.equal(
		(
			await fetch(`${origin}/login`, {
				headers: { 'x-zpos-pages-smoke': 'invalid' },
				redirect: 'manual',
				signal: AbortSignal.timeout(8000)
			})
		).status,
		404,
		'Relay smoke harus menolak otorisasi yang salah'
	);
	for (const branch of ['samarinda', 'balikpapan', 'berau']) {
		const response = await fetch(origin + '/api/veriflogin', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ branch }),
			signal: AbortSignal.timeout(8_000)
		});
		assert.equal(response.status, 503);
		assert.equal((await response.json()).message, 'Kasir sedang dalam pemeliharaan');
	}
	console.log('Pages terisolasi: login publik ketiga cabang tetap dijeda');
	await smokeFromPages(origin, pagesKey);
} catch (error) {
	failures.push(error);
} finally {
	if (started) {
		try {
			const current = await findProject();
			if (current) {
				assert.ok(
					current.name === name && current.production_branch === productionBranch,
					'Identitas project tidak cocok untuk cleanup'
				);
				await api(`/${name}`, 'DELETE');
				let removed = false;
				for (const delay of visibilityDelays) {
					if (delay) await sleep(delay);
					if (!(await api(`/${name}`))) {
						removed = true;
						break;
					}
				}
				assert.ok(removed, 'Penghapusan project Pages belum terverifikasi');
				console.log('Project Pages fixture dibersihkan');
			}
		} catch (error) {
			failures.push(error);
		}
	}
	await rm(dir, { recursive: true, force: true }).catch((error) => failures.push(error));
}
if (failures.length) throw new AggregateError(failures, 'Preview Pages atau cleanup belum lengkap');
