import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { wrangler } from './deploy-branch-worker-cli.mjs';
import {
	legacyProductionOrigin,
	productionStorageName
} from './branch-production-candidate-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
assert.ok(process.env.RUNNER_TEMP);
const key = process.env.BRANCH_PRODUCTION_PREP_KEY;
const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
const enableWrites = process.argv.includes('--enable-writes');
const hardenLive = process.argv.includes('--harden-live');
assert.ok(!(enableWrites && hardenLive), 'Mode relay tidak boleh digabung');
if (enableWrites || hardenLive) assert.ok(process.env.GITHUB_STEP_SUMMARY);
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
const name = productionStorageName;
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
	const response = await fetch(`${legacyProductionOrigin}/login`, {
		redirect: 'error',
		signal: AbortSignal.timeout(10_000)
	});
	assert.equal(response.status, 503);
	assert.equal((await response.json()).message, 'Kasir sedang dalam pemeliharaan');
	if (enableWrites) {
		assert.equal(response.headers.get('x-zpos-gateway'), 'branch-paused');
		const project = await data('pages/projects/zatiaraspos');
		assert.equal(project.subdomain, new URL(legacyProductionOrigin).hostname);
		assert.equal(project.canonical_deployment?.environment, 'production');
		const sha = project.canonical_deployment?.deployment_trigger?.metadata?.commit_hash;
		assert.match(sha ?? '', /^[a-f0-9]{40}$/);
		const keyForProbe = createHmac('sha256', key)
			.update(`candidate-pages-probe:${sha}`)
			.digest('hex');
		for (const branch of Object.keys(backends)) {
			const probe = await fetch(
				`${legacyProductionOrigin}/internal/cutover/connection?${new URLSearchParams({ branch })}`,
				{
					headers: { 'x-zpos-cutover-probe': keyForProbe },
					redirect: 'error',
					signal: AbortSignal.timeout(11_000)
				}
			);
			await probe.body?.cancel();
			assert.equal(probe.status, 204, `${branch}: gateway belum mencapai backend tertutup`);
		}
	}
}
async function checkOpen() {
	const response = await fetch(`${legacyProductionOrigin}/login`, {
		redirect: 'error',
		signal: AbortSignal.timeout(10_000)
	});
	await response.body?.cancel();
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('x-zpos-gateway'), 'branch-open');
}
async function activeVersion() {
	const { deployments } = await data(`workers/scripts/${name}/deployments`);
	const active = deployments?.[0]?.versions;
	assert.equal(active?.length, 1, 'Menolak mengubah relay dengan beberapa versi aktif');
	assert.equal(active[0].percentage, 100);
	const version = active[0].version_id;
	assert.match(version ?? '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
	return version;
}
function fetchRelay(secret, objectKey, method = 'GET', body) {
	return fetch(`${origin}/object?${new URLSearchParams({ key: objectKey })}`, {
		method,
		// Mode probes omit the body and carry an invalid MIME; only synthetic fixtures can write.
		headers: {
			'x-storage-secret': secret,
			...(method === 'PUT' ? { 'content-type': body ? 'image/png' : 'invalid/probe' } : {})
		},
		body,
		redirect: 'manual',
		signal: AbortSignal.timeout(12_000)
	});
}
async function probe(secret, objectKey, status, method, body) {
	const response = await fetchRelay(secret, objectKey, method, body);
	await response.body?.cancel();
	assert.equal(response.status, status, 'Respons isolasi relay tidak sesuai');
}
const bucketPath = `r2/buckets/${bucketName}`;
const checkGateway = hardenLive ? checkOpen : checkPaused;
await checkGateway();
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
const exists = scripts.some(({ id }) => id === name);
if (enableWrites || hardenLive) assert.ok(exists, 'Relay produksi harus sudah terpasang');
async function assertBindings(expectedReadOnly) {
	const settings = await data(`workers/scripts/${name}/settings`);
	assert.ok(
		settings.bindings?.some(
			({ type, name, text }) =>
				type === 'plain_text' &&
				name === 'STORAGE_PRODUCTION_READ_ONLY' &&
				text === (expectedReadOnly ? 'yes' : 'no')
		),
		'Mode relay saat ini tidak cocok dengan tahap deploy'
	);
	assert.ok(
		settings.bindings?.some(
			({ type, name, bucket_name }) =>
				type === 'r2_bucket' && name === 'STORAGE' && bucket_name === bucketName
		),
		'Relay tidak menunjuk bucket yang diizinkan'
	);
	if (hardenLive) {
		assert.equal(settings.bindings.length, 2 + Object.keys(secrets).length);
		for (const branch of Object.keys(secrets)) {
			assert.ok(
				settings.bindings.some(
					({ type, name }) =>
						type === 'secret_text' && name === `STORAGE_SECRET_${branch.toUpperCase()}`
				),
				`${branch}: binding secret relay tidak sesuai`
			);
		}
	}
}
if (exists) await assertBindings(!hardenLive);
const dir = await mkdtemp(join(process.env.RUNNER_TEMP, 'zpos-production-storage-'));
const readOnlyTestKey = `produk/samarinda/${randomUUID()}.png`;
async function deploy(readOnly) {
	const config = join(dir, readOnly ? 'readonly.json' : 'writable.json');
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
			vars: { STORAGE_PRODUCTION_READ_ONLY: readOnly ? 'yes' : 'no' },
			r2_buckets: [{ binding: 'STORAGE', bucket_name: bucketName }]
		}),
		{ mode: 0o600, flag: 'wx' }
	);
	if (hardenLive) {
		// Preserve the live runtime settings and all existing secrets; only this script is updated.
		wrangler(name, config, token, ['deploy', '--keep-vars']);
		return;
	}
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
}
async function waitMode(readOnly) {
	// An invalid MIME never writes. It returns 405 before parsing in read-only mode, or 415 when writable.
	const expected = readOnly ? 405 : 415;
	let status;
	for (const delay of [0, 2000, 4000, 8000, 16000]) {
		if (delay) await sleep(delay);
		const response = await fetchRelay(secrets.samarinda, readOnlyTestKey, 'PUT');
		status = response.status;
		await response.body?.cancel();
		if (status === expected) break;
	}
	assert.equal(status, expected, 'Mode relay belum terverifikasi');
}
async function verifySyntheticWrites(branch) {
	const objectKey = `produk/${branch}/${randomUUID()}.png`;
	const png = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
		'base64'
	);
	await probe(secrets[branch], objectKey, 404);
	await appendFile(process.env.GITHUB_STEP_SUMMARY, `Fixture R2 ditargetkan: \`${objectKey}\`\n`);
	let failure;
	try {
		await probe(secrets[branch], objectKey, 204, 'PUT', png);
		const response = await fetchRelay(secrets[branch], objectKey);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get('content-type'), 'image/png');
		assert.ok(png.equals(Buffer.from(await response.arrayBuffer())), 'Isi fixture R2 berubah');
		for (const other of Object.keys(backends).filter((name) => name !== branch)) {
			await probe(secrets[other], objectKey, 404);
			await probe(secrets[other], objectKey, 404, 'DELETE');
		}
	} catch (error) {
		failure = error;
	}
	try {
		await probe(secrets[branch], objectKey, 204, 'DELETE');
		await probe(secrets[branch], objectKey, 404);
	} catch (error) {
		throw new AggregateError(
			failure ? [failure, error] : [error],
			`Fixture R2 perlu pembersihan manual: ${objectKey}`
		);
	}
	await appendFile(process.env.GITHUB_STEP_SUMMARY, `Fixture R2 bersih: \`${objectKey}\`\n`);
	if (failure) throw failure;
	console.log(
		`${branch}: tulis, baca balik, isolasi, dan pembersihan gambar sintetis terverifikasi`
	);
}
let writableAttempted = false;
let priorVersion;
try {
	if (hardenLive) {
		await waitMode(false);
		await probe(secrets.samarinda, images[0].key, 200);
		priorVersion = await activeVersion();
		await appendFile(
			process.env.GITHUB_STEP_SUMMARY,
			`Versi relay sebelum update: \`${priorVersion}\`\n`
		);
		await checkGateway();
		assert.equal(await activeVersion(), priorVersion, 'Relay berubah selama preflight');
	}
	if (enableWrites) await waitMode(true);
	writableAttempted = enableWrites;
	const readOnly = !(enableWrites || hardenLive);
	await deploy(readOnly);
	await waitMode(readOnly);
	if (hardenLive) {
		assert.notEqual(await activeVersion(), priorVersion, 'Versi relay belum berubah');
		await assertBindings(false);
	}
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
	if (enableWrites) {
		for (const branch of Object.keys(backends)) await verifySyntheticWrites(branch);
	}
	await checkGateway();
	console.log(
		hardenLive
			? `${images.length} gambar asli cocok; relay anti-timpa dirilis, kasir tetap buka.`
			: `${images.length} gambar asli cocok; relay R2 ${enableWrites ? 'siap baca-tulis' : 'baca-saja'}. URL kasir tetap dijeda.`
	);
} catch (failure) {
	if (hardenLive && priorVersion)
		console.error(
			`Jika versi baru sempat aktif dan relay bermasalah, tinjau rollback relay ke ${priorVersion}. Jangan ubah gateway kasir.`
		);
	if (writableAttempted) {
		try {
			await deploy(true);
			await waitMode(true);
			console.log('Relay kembali ke baca-saja.');
		} catch (rollbackError) {
			throw new AggregateError(
				[failure, rollbackError],
				'Status relay belum pasti; jangan buka kasir'
			);
		}
	}
	throw failure;
} finally {
	await rm(dir, { recursive: true, force: true });
}
