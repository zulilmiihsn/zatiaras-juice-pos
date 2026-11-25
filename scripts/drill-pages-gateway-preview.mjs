import assert from 'node:assert/strict';
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
const previewBranch = 'cutover-check';
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
			pages_build_output_dir: 'public',
			compatibility_date: '2026-06-29',
			compatibility_flags: ['nodejs_compat']
		}),
		{ flag: 'wx', mode: 0o600 }
	);
	started = true;
	const created = await api('', 'POST', { name, production_branch: productionBranch });
	assert.ok(created.name === name && created.production_branch === productionBranch);
	wranglerPages(name, dir, token, gateway.account_id, [
		'deploy',
		'public',
		'--project-name',
		name,
		'--branch',
		previewBranch
	]);
	const list = await api(`/${name}/deployments?env=preview&per_page=2`);
	const deployment = list.find(
		(entry) =>
			entry.environment === 'preview' &&
			entry.deployment_trigger?.metadata?.branch === previewBranch
	);
	assert.ok(deployment, 'Deployment belum terkonfirmasi sebagai preview');
	const immutable = new URL(deployment.url);
	const prefix = immutable.hostname.split('.')[0];
	assert.match(prefix, /^[a-f0-9]{8}$/);
	assert.equal(immutable.origin, `https://${prefix}.${name}.pages.dev`);
	const origin = `https://${previewBranch}.${name}.pages.dev`;
	const readiness = await Promise.allSettled([
		verifyPaused('deployment', immutable.origin),
		verifyPaused('alias', origin)
	]);
	const errors = readiness.filter((result) => result.status === 'rejected');
	if (errors.length)
		throw new AggregateError(
			errors.map((result) => result.reason),
			'Preview belum siap'
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
	console.log(
		'Pages preview terverifikasi: login ketiga cabang tetap dijeda pada satu alias; tanpa binding data'
	);
} catch (error) {
	failures.push(error);
} finally {
	if (started) {
		try {
			const current = await api(`/${name}`);
			if (current) {
				assert.ok(
					current.name === name && current.production_branch === productionBranch,
					'Identitas project tidak cocok untuk cleanup'
				);
				await api(`/${name}`, 'DELETE');
				console.log('Project Pages fixture dibersihkan');
			}
		} catch (error) {
			failures.push(error);
		}
	}
	await rm(dir, { recursive: true, force: true }).catch((error) => failures.push(error));
}
if (failures.length) throw new AggregateError(failures, 'Preview Pages atau cleanup belum lengkap');
