import assert from 'node:assert/strict';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});

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
