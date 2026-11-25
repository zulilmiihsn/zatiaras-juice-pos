import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
const now = Date.now();

for (const [branch, config] of Object.entries(backends)) {
	assert.equal(config.name, `zpos-${branch}-staging`);
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token ${branch} tidak tersedia`);
	try {
		const response = await fetch(
			`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers/observability/telemetry/query`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: JSON.stringify({
					queryId: randomUUID(),
					timeframe: { from: now - 3 * 60 * 60 * 1000, to: now },
					view: 'events',
					limit: 10,
					parameters: {
						filters: [
							{ key: '$metadata.service', operation: 'eq', type: 'string', value: config.name },
							{
								key: '$metadata.message',
								operation: 'starts_with',
								type: 'string',
								value: '[audit-maintenance]'
							}
						],
						filterCombination: 'and'
					}
				}),
				signal: AbortSignal.timeout(12_000)
			}
		);
		const data = await response.json();
		if (!response.ok || !data.success) {
			const codes = data.errors
				?.map(({ code }) => code)
				.filter(Number.isSafeInteger)
				.join(',');
			throw new Error(`API log HTTP ${response.status}; kode ${codes || '-'}`);
		}
		const events = data.result?.events?.events;
		assert.ok(Array.isArray(events), 'Format hasil telemetry tidak dikenali');
		const entry = events.find((event) => {
			const metadata = event.$metadata;
			return (
				metadata?.service === config.name && metadata?.message?.startsWith('[audit-maintenance] ')
			);
		});
		if (!entry) throw new Error('event pemeliharaan belum ditemukan dalam 3 jam terakhir');
		const counters = JSON.parse(entry.$metadata.message.slice('[audit-maintenance] '.length));
		assert.equal(counters.missingBindings, 0, 'Ada binding maintenance staging yang hilang');
		assert.ok(
			Number.isSafeInteger(counters.queries) &&
				counters.queries > 0 &&
				counters.queries <= counters.queryBudget,
			'Jumlah query maintenance belum terverifikasi'
		);
		console.log(
			`${branch}: eksekusi maintenance teramati; query ${counters.queries}/${counters.queryBudget}`
		);
	} catch (error) {
		// Only errors generated above are useful; do not print log payloads or response excerpts.
		const message = error instanceof Error ? error.message : '';
		console.error(
			`${branch}: ${/^(API log HTTP|event pemeliharaan|Format hasil|Ada binding|Jumlah query)/.test(message) ? message : 'hasil maintenance belum dapat diverifikasi'}`
		);
		process.exitCode = 1;
	}
}
