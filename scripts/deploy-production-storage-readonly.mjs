import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { wrangler } from './deploy-branch-worker-cli.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.ok(process.env.RUNNER_TEMP);
const key = process.env.BRANCH_PRODUCTION_PREP_KEY;
const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
assert.ok(/^[a-f0-9]{64}$/.test(key ?? ''), 'Kunci persiapan produksi tidak valid');
assert.ok(token);
const inventory = JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}');
const { gateway, backends } = buildBranchStagingConfigs({
	...inventory,
	main: 'unused',
	publicAssets: 'unused',
	storageMain: 'unused'
});
assert.equal(gateway.name, 'zpos-gateway-staging');
const account = gateway.account_id;
assert.equal(account, backends.samarinda.account_id);
assert.match(account, /^[a-f0-9]{26}f4ce43$/);
const bucketName = 'zatiaras-assets';
const name = 'zatiaraspos-storage';
const origin = `https://${name}.${inventory.gateway.subdomain}.workers.dev`;
const secrets = Object.fromEntries(
	Object.keys(backends).map((branch) => [
		branch,
		createHmac('sha256', key).update(`production-storage:${branch}`).digest('hex')
	])
);

async function cloud(path) {
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
		headers: { authorization: `Bearer ${token}` },
		redirect: 'error',
		signal: AbortSignal.timeout(12_000)
	});
	if (!response.ok) throw Error(`Cloudflare HTTP ${response.status}`);
	return response;
}
async function data(path) {
	const result = await (await cloud(path)).json();
	assert.ok(result.success, 'Cloudflare tidak mengonfirmasi hasil');
	return result.result;
}
async function checkPaused() {
	const response = await fetch('https://zatiaraspos.pages.dev/login', {
		redirect: 'error',
		signal: AbortSignal.timeout(10_000)
	});
	assert.equal(response.status, 503);
	assert.equal((await response.json()).message, 'Kasir sedang dalam pemeliharaan');
}
function fetchRelay(secret, objectKey, method = 'GET') {
	return fetch(`${origin}/object?${new URLSearchParams({ key: objectKey })}`, {
		method,
		// An invalid MIME means that even an incorrectly writable relay cannot write the probe.
		headers: {
			'x-storage-secret': secret,
			...(method === 'PUT' ? { 'content-type': 'invalid/probe' } : {})
		},
		redirect: 'manual',
		signal: AbortSignal.timeout(12_000)
	});
}
async function probe(secret, objectKey, status, method) {
	const response = await fetchRelay(secret, objectKey, method);
	await response.body?.cancel();
	assert.equal(response.status, status, 'Respons isolasi relay tidak sesuai');
}
const bucketPath = `r2/buckets/${bucketName}`;
await checkPaused();
const bucket = await data(bucketPath);
assert.equal(bucket.name, bucketName);
assert.equal(bucket.storage_class, 'Standard');
const objects = await data(`${bucketPath}/objects?prefix=produk%2Fsamarinda%2F&per_page=1000`);
assert.ok(Array.isArray(objects) && objects.length < 1000);
const images = objects.filter(({ key }) =>
	/^produk\/samarinda\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(key)
);
assert.ok(images.length > 0, 'Gambar Samarinda untuk uji baca tidak tersedia');
const scripts = await data('workers/scripts');
if (scripts.some(({ id }) => id === name)) {
	const settings = await data(`workers/scripts/${name}/settings`);
	assert.ok(
		settings.bindings?.some(
			({ type, name, text }) =>
				type === 'plain_text' && name === 'STORAGE_PRODUCTION_READ_ONLY' && text === 'yes'
		),
		'Menolak menimpa Worker yang bukan relay read-only'
	);
	assert.ok(
		settings.bindings?.some(
			({ type, name, bucket_name }) =>
				type === 'r2_bucket' && name === 'STORAGE' && bucket_name === bucketName
		),
		'Relay tidak menunjuk bucket yang diizinkan'
	);
}
const dir = await mkdtemp(join(process.env.RUNNER_TEMP, 'zpos-production-storage-'));
try {
	const config = join(dir, 'wrangler.json');
	await writeFile(
		config,
		JSON.stringify({
			name,
			main: resolve('staging/branch-storage-worker.ts'),
			account_id: account,
			compatibility_date: gateway.compatibility_date,
			compatibility_flags: gateway.compatibility_flags,
			workers_dev: true,
			preview_urls: false,
			vars: { STORAGE_PRODUCTION_READ_ONLY: 'yes' },
			r2_buckets: [{ binding: 'STORAGE', bucket_name: bucketName }]
		}),
		{ mode: 0o600, flag: 'wx' }
	);
	wrangler(name, config, token, ['deploy']);
	wrangler(
		name,
		config,
		token,
		['secret', 'bulk'],
		JSON.stringify(
			Object.fromEntries(
				Object.entries(secrets).map(([branch, secret]) => [
					`STORAGE_SECRET_${branch.toUpperCase()}`,
					secret
				])
			)
		)
	);
	const testKey = `produk/samarinda/${randomUUID()}.png`;
	let status;
	for (const delay of [0, 2000, 4000, 8000, 16000]) {
		if (delay) await sleep(delay);
		const response = await fetchRelay(secrets.samarinda, testKey, 'PUT');
		status = response.status;
		await response.body?.cancel();
		if (status === 405) break;
	}
	assert.equal(status, 405, 'Relay belum membuktikan mode read-only');
	const example = images[0].key;
	await probe('invalid', example, 401);
	for (const branch of ['balikpapan', 'berau']) await probe(secrets[branch], example, 404);
	const digest = (data) => createHash('sha256').update(data).digest('hex');
	for (const { key, size } of images) {
		const [direct, relayed] = await Promise.all([
			cloud(`${bucketPath}/objects/${encodeURIComponent(key)}`),
			fetchRelay(secrets.samarinda, key)
		]);
		assert.equal(relayed.status, 200);
		assert.equal(relayed.headers.get('content-type'), direct.headers.get('content-type'));
		const [source, result] = await Promise.all([direct.arrayBuffer(), relayed.arrayBuffer()]);
		assert.equal(source.byteLength, size);
		assert.ok(
			digest(Buffer.from(source)) === digest(Buffer.from(result)),
			'Isi objek R2 dari relay berbeda'
		);
	}
	await checkPaused();
	console.log(
		`${images.length} gambar produksi terverifikasi melalui relay read-only; penulisan dan akses lintas cabang ditolak. URL kasir tetap dijeda.`
	);
} finally {
	await rm(dir, { recursive: true, force: true });
}
