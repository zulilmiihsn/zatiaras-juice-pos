import assert from 'node:assert/strict';
import {
	buildBranchStagingConfigs,
	SHARED_STAGING_BUCKET
} from './branch-account-staging-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});

if (process.argv.includes('--prepare')) {
	const account = backends.samarinda.account_id;
	assert.equal(backends.samarinda.name, 'zpos-samarinda-staging');
	assert.equal(backends.samarinda.d1_databases[0].database_name, 'zpos-samarinda-staging');
	const token = process.env.BRANCH_CF_TOKEN_SAMARINDA;
	assert.ok(token, 'Token Samarinda belum tersedia');
	const root = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
	const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
	async function call(path, method = 'GET', payload) {
		const response = await fetch(root + path, {
			method,
			headers,
			body: payload && JSON.stringify(payload),
			signal: AbortSignal.timeout(12_000)
		});
		const data = await response.json();
		const codes = data.errors?.map(({ code }) => code).filter(Number.isSafeInteger) ?? [];
		return { status: response.status, ok: response.ok && data.success === true, codes, data };
	}
	function requireSuccess(result) {
		if (!result.ok)
			throw new Error(`R2 staging HTTP ${result.status}; kode ${result.codes.join(',') || '-'}`);
		return result.data.result;
	}
	const path = `/${SHARED_STAGING_BUCKET}`;
	const current = await call(path);
	if (!current.ok) {
		if (current.status !== 404 || !current.codes.includes(10006)) requireSuccess(current);
		// An entitled account and documented free bucket count are prerequisites, not an R2 subscription action.
		const list = await call('?per_page=1');
		requireSuccess(list);
		const count = list.data.result_info?.total_count;
		assert.ok(
			Number.isSafeInteger(count) && count >= 0 && count < 100_000,
			'Kuota jumlah bucket gratis belum terverifikasi'
		);
		requireSuccess(
			await call('', 'POST', { name: SHARED_STAGING_BUCKET, storageClass: 'Standard' })
		);
	}
	const bucket = requireSuccess(await call(path));
	assert.ok(
		bucket?.name === SHARED_STAGING_BUCKET && bucket.storage_class === 'Standard',
		'Identitas dan kelas bucket staging belum terverifikasi'
	);
	const managed = requireSuccess(await call(`${path}/domains/managed`));
	const custom = requireSuccess(await call(`${path}/domains/custom`));
	assert.ok(
		managed?.enabled === false &&
			Array.isArray(custom?.domains) &&
			custom.domains.every((entry) => entry.enabled === false),
		'Bucket staging memiliki akses publik atau akses privat belum terverifikasi'
	);
	console.log(
		`Samarinda: bucket privat Standard ${SHARED_STAGING_BUCKET} siap; tidak ada upload atau perubahan billing`
	);
	process.exit(0);
}

for (const [branch, config] of Object.entries(backends)) {
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token staging ${branch} tidak tersedia`);
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/r2/buckets?per_page=1`,
			{ headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) }
		);
		const result = await response.json();
		if (response.ok && result.success && Array.isArray(result.result?.buckets)) {
			console.log(
				`${branch}: R2 dapat diakses; bucket ${result.result.buckets.length ? 'ada' : 'belum ada'}`
			);
		} else {
			// A permissions error is not evidence that R2 is disabled on the account.
			const codes = result.errors
				?.map(({ code }) => code)
				.filter(Number.isSafeInteger)
				.join(',');
			console.log(
				`${branch}: R2 belum dapat diverifikasi (HTTP ${response.status}; kode ${codes || '-'})`
			);
		}
	} catch {
		console.log(`${branch}: pemeriksaan R2 gagal sebelum mendapat hasil API`);
	}
}
