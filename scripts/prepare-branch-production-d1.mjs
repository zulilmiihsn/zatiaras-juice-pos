import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { backends } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
const live = await readFile('wrangler.pages.jsonc', 'utf8');
const stagingIds = Object.values(backends).map((config) => config.d1_databases[0].database_id);
const maxFreeDatabases = 10;
const targets = [];
const checkOnly = process.argv.includes('--check-only');

function client(branch, config) {
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token ${branch} tidak tersedia`);
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database`;
	return async (path, payload) => {
		const response = await fetch(endpoint + path, {
			method: payload ? 'POST' : 'GET',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: payload && JSON.stringify(payload),
			signal: AbortSignal.timeout(12_000)
		});
		const result = await response.json();
		if (!response.ok || !result.success) {
			const codes = result.errors
				?.map(({ code }) => code)
				.filter(Number.isSafeInteger)
				.join(',');
			throw new Error(`${branch}: D1 HTTP ${response.status}; kode ${codes || '-'}`);
		}
		return result;
	};
}
function assertDestination(db, name) {
	assert.ok(
		db?.name === name && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(db.uuid),
		'Identitas D1 tujuan tidak cocok'
	);
	assert.ok(
		!live.includes(db.uuid) && !stagingIds.includes(db.uuid),
		'D1 tujuan tidak boleh berupa produksi aktif atau staging'
	);
}
async function assertEmpty(read, db, name) {
	const identity = (await read(`/${db.uuid}`)).result;
	assertDestination(identity, name);
	assert.equal(identity.uuid, db.uuid);
	const [result] = (
		await read(`/${db.uuid}/query`, {
			sql: "SELECT count(*) AS n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'"
		})
	).result;
	assert.ok(
		result.success && result.results?.[0]?.n === 0,
		`${name}: database tidak kosong; bukan target provision kosong`
	);
}

// Verify all three accounts before creating anything, so a bad inventory or permission stops the batch early.
for (const [branch, config] of Object.entries(backends)) {
	const [staging] = config.d1_databases;
	assert.equal(staging.database_name, `zpos-${branch}-staging`);
	assert.ok(!live.includes(staging.database_id));
	const read = client(branch, config);
	const identity = (await read(`/${staging.database_id}`)).result;
	assert.ok(
		identity.name === staging.database_name && identity.uuid === staging.database_id,
		`${branch}: akun staging tidak terverifikasi`
	);
	const inventory = await read(`?per_page=${maxFreeDatabases}`);
	const count = inventory.result_info?.total_count;
	assert.ok(
		Array.isArray(inventory.result) &&
			Number.isSafeInteger(count) &&
			count >= 1 &&
			count <= maxFreeDatabases &&
			inventory.result.length === count,
		`${branch}: daftar atau batas database Free belum terverifikasi`
	);
	const name = `zatiaraspos-${branch}`;
	assert.ok(!live.includes(`"${name}"`));
	const matches = inventory.result.filter((db) => db.name === name);
	assert.ok(matches.length <= 1);
	const [existing] = matches;
	if (existing) {
		assertDestination(existing, name);
		await assertEmpty(read, existing, name);
	} else {
		assert.ok(!checkOnly, `${branch}: D1 tujuan ${name} belum tersedia`);
		assert.ok(count < maxFreeDatabases, `${branch}: tidak ada slot D1 Free`);
	}
	targets.push({ branch, read, name, existing });
}

for (const { branch, read, name, existing } of targets) {
	if (!existing) {
		assert.ok(!checkOnly);
		const created = (await read('', { name })).result;
		assertDestination(created, name);
		await assertEmpty(read, created, name);
	}
	console.log(
		`${branch}: D1 kosong ${name} terverifikasi (${existing ? 'sudah ada' : 'baru dibuat'})`
	);
}
if (checkOnly)
	console.log('Preflight tujuan lulus untuk semua cabang; tidak ada data atau rute yang diubah.');
