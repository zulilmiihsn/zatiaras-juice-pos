import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';

const { GITHUB_ACTIONS, GITHUB_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, RUNNER_TEMP } = process.env;
assert.equal(GITHUB_ACTIONS, 'true');
assert.equal(GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.match(GITHUB_RUN_ID ?? '', /^\d{1,16}$/);
assert.match(GITHUB_RUN_ATTEMPT ?? '', /^\d{1,4}$/);
assert.ok(RUNNER_TEMP);
const inventory = JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}');
const { backends, gateway } = buildBranchStagingConfigs({
	...inventory,
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
assert.equal(gateway.name, 'zpos-gateway-staging');
assert.equal(gateway.account_id, backends.samarinda.account_id);
const suffix = `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}`;
const fixture = (kind, branch) => {
	const name = `zpos-route-${kind}-${suffix}`;
	const account = backends[branch].account_id;
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token staging ${branch} tidak tersedia`);
	return {
		name,
		account,
		token,
		origin: `https://${name}.${inventory.backends[branch].subdomain}.workers.dev`
	};
};
const source = fixture('source', 'samarinda');
const target = fixture('target', 'balikpapan');
const router = fixture('gateway', 'samarinda');
const pendingCleanup = new Set();
const dir = await mkdtemp(join(RUNNER_TEMP, 'zpos-route-drill-'));

async function api(resource, method, path = '') {
	const response = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${resource.account}/workers/scripts${path}`,
		{
			method,
			headers: { authorization: `Bearer ${resource.token}` },
			signal: AbortSignal.timeout(12_000)
		}
	);
	const data = await response.json();
	if (method === 'DELETE' && response.status === 404) return null;
	if (!response.ok || !data.success)
		throw new Error(`${resource.name}: Workers API HTTP ${response.status}`);
	return data.result;
}
async function deploy(resource, step) {
	const config = join(dir, `${resource.name}-${step}.json`);
	await writeFile(
		config,
		JSON.stringify({
			name: resource.name,
			account_id: resource.account,
			main: resolve('staging/cutover-route-fixture.mjs'),
			compatibility_date: '2026-06-29',
			workers_dev: true,
			preview_urls: false,
			vars: { CUTOVER_STEP: step, ...(step === 'cross-account' ? { TARGET: target.origin } : {}) },
			...(step === 'local' ? { services: [{ binding: 'LEGACY', service: source.name }] } : {})
		}),
		{ mode: 0o600 }
	);
	pendingCleanup.add(resource);
	const invocation = wranglerInvocation(['deploy', '--config', config]);
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) =>
			/^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA)$/i.test(key)
		)
	);
	const result = spawnSync(invocation.command, invocation.args, {
		...invocation.options,
		timeout: 75_000,
		env: {
			...env,
			CLOUDFLARE_API_TOKEN: resource.token,
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_WRITE_LOGS: 'false'
		}
	});
	if (result.error || result.status !== 0)
		throw new Error(
			`${resource.name}: deploy fixture ${step} gagal (${result.error?.code ?? result.status})`
		);
}
async function verify(resource, expected) {
	const observations = new Set();
	for (const delay of [0, 1000, 2000, 4000, 8000, 16000]) {
		if (delay) await sleep(delay);
		const response = await fetch(`${resource.origin}/probe`, {
			redirect: 'manual',
			signal: AbortSignal.timeout(8_000)
		});
		const step = response.headers.get('x-zpos-drill-step');
		const upstream = response.headers.get('x-zpos-drill-upstream');
		observations.add(
			[
				response.status,
				/^(source|target|paused|cross-account|local)$/.test(step ?? '') ? step : '-',
				/^(\d{3}|unexpected|fetch-failed)$/.test(upstream ?? '') ? upstream : '-'
			].join('/')
		);
		if (response.status === (expected === 'paused' ? 503 : 200)) {
			const body = await response.json().catch(() => null);
			if (body?.from === expected) return;
		} else {
			await response.body?.cancel();
		}
	}
	throw new Error(
		`${resource.name}: respons fixture ${expected} tidak terverifikasi; HTTP/step/upstream: ${[...observations].join(', ')}`
	);
}

const failures = [];
try {
	// Do not overwrite a pre-existing resource even if it coincidentally uses our reserved name.
	for (const resource of [source, target, router]) {
		const list = await api(resource, 'GET');
		assert.ok(
			Array.isArray(list) && !list.some(({ id }) => id === resource.name),
			`${resource.name}: nama fixture tidak tersedia`
		);
	}
	await deploy(source, 'source');
	await deploy(target, 'target');
	await verify(target, 'target');
	for (const [step, expected] of [
		['local', 'source'],
		['paused', 'paused'],
		['cross-account', 'target'],
		['paused', 'paused'],
		['local', 'source']
	]) {
		await deploy(router, step);
		await verify(router, expected);
		console.log(`Balikpapan fixture: ${step} → ${expected} terverifikasi`);
	}
} catch (error) {
	failures.push(error);
} finally {
	// The temporary gateway can hold a service binding to the source worker.
	for (const resource of [router, target, source]) {
		if (!pendingCleanup.has(resource)) continue;
		try {
			await api(resource, 'DELETE', `/${resource.name}`);
			console.log(`${resource.name}: fixture dibersihkan`);
		} catch (error) {
			failures.push(error);
		}
	}
	await rm(dir, { recursive: true, force: true }).catch((error) => failures.push(error));
}
if (failures.length)
	throw new AggregateError(failures, 'Latihan routing atau cleanup belum lengkap');
