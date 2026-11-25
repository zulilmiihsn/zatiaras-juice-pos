import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { snapshotBuiltAssets } from './test-fixtures/compiled-browser.mjs';
import { wranglerInvocation } from './wrangler-cli.mjs';

if (process.env.GITHUB_ACTIONS !== 'true')
	throw new Error('Deploy staging lintas akun hanya melalui workflow GitHub');

const branches = ['samarinda', 'balikpapan', 'berau'];
const inventory = JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? 'null');
const master = process.env.BRANCH_STAGING_KEY;
if (!inventory?.gateway || !inventory.backends || !/^[a-f0-9]{64}$/.test(master ?? ''))
	throw new Error('Inventori atau kunci staging belum siap');
const tokens = Object.fromEntries(
	branches.map((branch) => [branch, process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`]])
);
if (Object.values(tokens).some((token) => !token))
	throw new Error('Token akun staging belum lengkap');
const derive = (purpose) => createHmac('sha256', master).update(purpose).digest('hex');
const temporary = await mkdtemp(join(tmpdir(), 'zpos-branch-deploy-'));

function wrangler(name, config, token, args, input) {
	const run = wranglerInvocation([...args, '--config', config]);
	// Only the credential of the current deployment crosses the subprocess boundary.
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) =>
			/^(PATH|HOME|USERPROFILE|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA)$/i.test(name)
		)
	);
	const result = spawnSync(run.command, run.args, {
		...run.options,
		env: {
			...env,
			CLOUDFLARE_API_TOKEN: token,
			WRANGLER_SEND_METRICS: 'false',
			WRANGLER_WRITE_LOGS: 'false'
		},
		input,
		timeout: 90_000
	});
	if (result.error || result.status !== 0) {
		// Secret upload receives derived values on stdin; never include its CLI output in logs.
		const details =
			input === undefined
				? (result.stderr ?? '')
						.replaceAll(token, '[REDACTED]')
						.replaceAll('\u001b', '')
						.replace(/https?:\/\/[^\s)\]"']+/g, '[URL]')
						.replaceAll('\r', '')
						.trim()
						.slice(-1800)
				: '';
		throw new Error(
			`${name}: Wrangler ${args.join(' ')} gagal (${result.error?.code ?? result.status})${details ? `\n${details}` : ''}`
		);
	}
}

try {
	const publicAssets = join(temporary, 'assets');
	const configs = buildBranchStagingConfigs({
		...inventory,
		main: resolve('staging/branch-account-worker.mjs'),
		storageMain: resolve('staging/branch-storage-worker.ts'),
		publicAssets
	});
	const prod = await readFile('wrangler.pages.jsonc', 'utf8');
	for (const branch of branches) {
		const config = configs.backends[branch];
		const [db] = config.d1_databases;
		const bucket = config.r2_buckets?.[0]?.bucket_name;
		if (db.database_name !== `zpos-${branch}-staging` || prod.includes(db.database_id))
			throw new Error(`${branch}: target D1 bukan staging khusus`);
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${db.database_id}`,
			{ headers: { authorization: `Bearer ${tokens[branch]}` }, signal: AbortSignal.timeout(12000) }
		);
		const identity = await response.json();
		if (
			!response.ok ||
			!identity.success ||
			identity.result?.name !== db.database_name ||
			identity.result?.uuid !== db.database_id
		)
			throw new Error(
				`${branch}: identitas D1 staging tidak terverifikasi (HTTP ${response.status})`
			);
		if (bucket) {
			const r2 = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/r2/buckets/${bucket}`,
				{
					headers: { authorization: `Bearer ${tokens[branch]}` },
					signal: AbortSignal.timeout(12000)
				}
			);
			if (!r2.ok || (await r2.json()).result?.name !== bucket)
				throw new Error(`${branch}: identitas R2 staging tidak terverifikasi (HTTP ${r2.status})`);
		}
	}
	if (
		configs.gateway.name !== 'zpos-gateway-staging' ||
		configs.gateway.account_id !== configs.backends.samarinda.account_id
	)
		throw new Error('Identitas gateway staging tidak cocok');
	await snapshotBuiltAssets(resolve('.svelte-kit/cloudflare'), publicAssets);
	async function deploy(name, config, token, secrets) {
		const file = join(temporary, `${name}.json`);
		await writeFile(file, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
		wrangler(name, file, token, ['deploy']);
		wrangler(name, file, token, ['secret', 'bulk'], JSON.stringify(secrets));
		console.log(`${name}: Worker dan secret staging tersedia`);
	}
	if (configs.storage) {
		const [bucket] = configs.storage.r2_buckets;
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${configs.storage.account_id}/r2/buckets/${bucket.bucket_name}`,
			{
				headers: { authorization: `Bearer ${tokens.samarinda}` },
				signal: AbortSignal.timeout(12000)
			}
		);
		const identity = await response.json();
		if (!response.ok || !identity.success || identity.result?.name !== bucket.bucket_name)
			throw new Error(
				`Identitas bucket R2 bersama staging tidak terverifikasi (HTTP ${response.status})`
			);
		await deploy(
			'storage',
			configs.storage,
			tokens.samarinda,
			Object.fromEntries(
				branches.map((branch) => [
					`STORAGE_SECRET_${branch.toUpperCase()}`,
					derive(`storage:${branch}`)
				])
			)
		);
	}
	for (const branch of branches) {
		await deploy(branch, configs.backends[branch], tokens[branch], {
			...(configs.storage ? { BRANCH_STORAGE_SECRET: derive(`storage:${branch}`) } : {}),
			BRANCH_RELAY_SECRET: derive(`relay:${branch}`),
			BRANCH_MAINTENANCE_SECRET: derive(`maintenance:${branch}`),
			POS_PRICE_SIGNING_KEY: derive(`price:${branch}`)
		});
		const origin = configs.gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`];
		const target = new URL('/internal/maintenance/start', origin);
		let status;
		// Deploy and secret upload return before the new version necessarily reaches the edge.
		// Start is idempotent; retry only responses compatible with a still-propagating version.
		for (const delay of [0, 2000, 4000, 8000, 16000]) {
			if (delay) await sleep(delay);
			const response = await fetch(target, {
				method: 'POST',
				redirect: 'manual',
				headers: { 'x-maintenance-secret': derive(`maintenance:${branch}`) },
				signal: AbortSignal.timeout(12000)
			});
			status = response.status;
			await response.body?.cancel();
			if (status === 204 || ![404, 503].includes(status)) break;
		}
		if (status !== 204)
			throw new Error(`${branch}: alarm maintenance belum aktif (HTTP ${status})`);
		console.log(`${branch}: alarm maintenance staging aktif`);
	}
	await deploy('gateway', configs.gateway, tokens.samarinda, {
		BRANCH_ROUTE_SECRET: derive('route'),
		...Object.fromEntries(
			branches.map((branch) => [`BRANCH_RELAY_${branch.toUpperCase()}`, derive(`relay:${branch}`)])
		)
	});
	console.log(`Staging: ${configs.gateway.vars.BRANCH_PUBLIC_ORIGIN}/login`);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
