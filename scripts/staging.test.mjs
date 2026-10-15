import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
	applyDatabaseIds,
	missingStagingIds,
	STAGING_CONFIGS,
	STAGING_DATABASES
} from './staging.mjs';

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
