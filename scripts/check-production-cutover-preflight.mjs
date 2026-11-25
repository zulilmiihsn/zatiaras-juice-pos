import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { stripJsonc, validateD1Config } from './d1-backup.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { gateway, backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
assert.equal(gateway.account_id, backends.samarinda.account_id);
const currentConfig = await readFile('wrangler.pages.jsonc', 'utf8');
const pages = JSON.parse(stripJsonc(currentConfig));
assert.equal(pages.name, 'zatiaraspos');
const source = validateD1Config(currentConfig);
const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
assert.ok(token, 'Token pemeriksaan produksi tidak tersedia');
const account = gateway.account_id;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function read(path, sql, params) {
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
		method: sql ? 'POST' : 'GET',
		headers,
		body: sql ? JSON.stringify({ sql, params }) : undefined,
		signal: AbortSignal.timeout(12_000)
	});
	const res = await response.json();
	if (!response.ok || !res.success)
		throw Error(
			`Cloudflare HTTP ${response.status}; kode ${
				res.errors
					?.map(({ code }) => code)
					.filter(Number.isSafeInteger)
					.join(',') || '-'
			}`
		);
	return res.result;
}
async function check(label, action) {
	try {
		await action();
	} catch (cause) {
		const message =
			cause instanceof Error && /^Cloudflare HTTP \d{3}; kode [\d,-]+$/.test(cause.message)
				? cause.message
				: 'hasil tidak dapat diverifikasi';
		console.error(`${label}: ${message}`);
		process.exitCode = 1;
	}
}
for (const [branch, backend] of Object.entries(backends)) {
	await check(branch, async () => {
		const [stage] = backend.d1_databases;
		const db = source.find((entry) => entry.binding === stage.binding);
		assert.ok(db && db.id !== stage.database_id);
		const path = `d1/database/${db.id}`;
		const live = await read(path);
		assert.ok(live?.uuid === db.id && live.name === db.name);
		const [report] = await read(
			`${path}/query`,
			`SELECT
			(SELECT COUNT(*) FROM sesi_toko WHERE cabang_id=? AND is_active=1) AS active_shifts,
			(SELECT EXISTS(SELECT 1 FROM kiosk_shift_cutover WHERE cabang_id=?)) AS kiosk_enabled`,
			[branch, branch]
		);
		const row = report.results?.[0];
		assert.ok(
			report.success &&
				Number.isSafeInteger(row?.active_shifts) &&
				[0, 1].includes(row.kiosk_enabled)
		);
		console.log(
			`${branch}: sumber produksi terverifikasi; shift aktif ${row.active_shifts}; pagar kios ${row.kiosk_enabled ? 'aktif' : 'tidak aktif'}`
		);
	});
}
await check('R2 produksi', async () => {
	const bucket = pages.r2_buckets.find(({ binding }) => binding === 'STORAGE')?.bucket_name;
	assert.equal(bucket, 'zatiaras-assets');
	const identity = await read(`r2/buckets/${bucket}`);
	assert.equal(identity.name, bucket);
	console.log(
		'R2 produksi: bucket referensi dapat diidentifikasi; objek tidak diubah atau diperiksa'
	);
});
await check('Pages produksi', async () => {
	const project = await read('pages/projects/zatiaraspos');
	const deployment = project.canonical_deployment;
	assert.ok(deployment?.environment === 'production' && /^[a-f0-9-]{36}$/.test(deployment.id));
	console.log(
		`Pages produksi: deployment aktif …${deployment.id.slice(-8)} terverifikasi sebagai referensi rollback; cocokkan ID penuh di dashboard saat eksekusi`
	);
});
console.log(
	'Pemeriksaan hanya membaca metadata dan jumlah shift; bukan bukti antrean kosong, backup, atau izin cutover.'
);
