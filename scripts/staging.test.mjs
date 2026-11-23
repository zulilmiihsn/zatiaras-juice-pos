import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	applyDatabaseIds,
	missingStagingIds,
	STAGING_CONFIGS,
	STAGING_DATABASES
} from './staging.mjs';

import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const production = ['wrangler.jsonc', 'wrangler.pages.jsonc', 'wrangler.realtime.jsonc'].map(read);
const productionIds = new Set(
	production.flatMap((text) =>
		[...text.matchAll(/"database_id": "([0-9a-f-]{36})"/g)].map((m) => m[1])
	)
);

await test('staging configs never point at production resources', () => {
	for (const file of STAGING_CONFIGS) {
		const text = read(file);
		for (const id of productionIds) assert.ok(!text.includes(id), `${file} memuat ID D1 produksi`);
		for (const name of text.matchAll(
			/"(?:database_name|bucket_name|name|script_name)": "([^"]+)"/g
		))
			assert.match(
				name[1],
				/-staging$|^REALTIME_HUB$/,
				`${file}: ${name[1]} bukan resource staging`
			);
	}
});

await test('branch staging gateway has no data bindings and backends are account-scoped', () => {
	const branches = ['samarinda', 'balikpapan', 'berau'];
	const backends = Object.fromEntries(
		branches.map((branch, index) => [
			branch,
			{
				name: `zpos-${branch}-staging`,
				subdomain: branch,
				accountId: String(index + 1).repeat(32),
				databaseId: `${String(index + 1).repeat(8)}-1111-4111-8111-111111111111`
			}
		])
	);
	const input = {
		gateway: { ...backends.samarinda, name: 'zpos-gateway-staging' },
		backends,
		main: '/fixture/worker.mjs',
		publicAssets: '/fixture/assets'
	};
	const configs = buildBranchStagingConfigs(input);
	assert.equal(configs.gateway.d1_databases, undefined);
	assert.equal(configs.gateway.durable_objects, undefined);
	assert.equal(configs.gateway.triggers, undefined);
	for (const branch of branches) {
		const config = configs.backends[branch];
		assert.equal(config.account_id, backends[branch].accountId);
		assert.deepEqual(
			config.d1_databases.map((item) => item.binding),
			[`DB_${branch.toUpperCase()}_GROUP`]
		);
		assert.equal(config.vars.KIOSK_PROJECTION_BRANCHES, branch);
		assert.equal(config.triggers, undefined);
		assert.equal(
			config.vars.BRANCH_PUBLIC_ORIGIN,
			'https://zpos-gateway-staging.samarinda.workers.dev'
		);
		assert.equal(
			configs.gateway.vars[`BRANCH_ORIGIN_${branch.toUpperCase()}`],
			`https://zpos-${branch}-staging.${branch}.workers.dev`
		);
		assert.equal(config.assets.run_worker_first, true);
		assert.ok(!Object.keys(config.vars).some((key) => /SECRET|RELAY/.test(key)));
	}
	assert.throws(
		() =>
			buildBranchStagingConfigs({
				...input,
				backends: {
					...backends,
					berau: { ...backends.berau, accountId: backends.balikpapan.accountId }
				}
			}),
		/akun backend berbeda/
	);
	assert.throws(
		() =>
			buildBranchStagingConfigs({ ...input, gateway: { ...input.gateway, name: 'zatiaraspos' } }),
		/staging tidak valid/
	);
});

await test('every staging config binds all three shards', () => {
	for (const file of STAGING_CONFIGS) {
		const text = read(file);
		for (const [binding, name] of Object.entries(STAGING_DATABASES)) {
			assert.ok(text.includes(`"binding": "${binding}"`), `${file} tanpa ${binding}`);
			assert.ok(text.includes(`"database_name": "${name}"`), `${file} tanpa ${name}`);
		}
	}
});

await test('setup writes ids per binding; check blocks placeholders', () => {
	const ids = {
		DB_SAMARINDA_GROUP: '11111111-1111-4111-8111-111111111111',
		DB_BALIKPAPAN_GROUP: '22222222-2222-4222-8222-222222222222',
		DB_BERAU_GROUP: '33333333-3333-4333-8333-333333333333'
	};
	for (const file of STAGING_CONFIGS) {
		const updated = applyDatabaseIds(read(file), ids);
		for (const id of Object.values(ids)) assert.ok(updated.includes(id));
		assert.equal(missingStagingIds(() => updated).length, 0);
		// Idempoten: ID lama terganti, bukan bertambah.
		const again = applyDatabaseIds(updated, {
			...ids,
			DB_BERAU_GROUP: '44444444-4444-4444-8444-444444444444'
		});
		assert.ok(!again.includes(ids.DB_BERAU_GROUP));
	}
	assert.equal(missingStagingIds(() => '"database_id": "STAGING_ID_DB_BERAU_GROUP"').length, 2);
});
