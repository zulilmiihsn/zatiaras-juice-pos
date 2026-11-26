import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const production = await readFile('wrangler.pages.jsonc', 'utf8');
const schemas = new Map();

for (const [branch, config] of Object.entries(backends)) {
	const [db] = config.d1_databases;
	assert.equal(db.database_name, `zpos-${branch}-staging`);
	assert.ok(!production.includes(db.database_id), 'Target staging menunjuk D1 produksi');
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token ${branch} tidak tersedia`);
	const base = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${db.database_id}`;
	async function read(path, sql) {
		const response = await fetch(base + path, {
			method: sql ? 'POST' : 'GET',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: sql ? JSON.stringify({ sql }) : undefined,
			signal: AbortSignal.timeout(12_000)
		});
		const data = await response.json();
		if (!response.ok || !data.success) {
			const codes = data.errors
				?.map(({ code }) => code)
				.filter(Number.isSafeInteger)
				.join(',');
			throw new Error(`${branch}: D1 HTTP ${response.status}; kode ${codes || '-'}`);
		}
		return data.result;
	}
	const identity = await read('');
	assert.ok(
		identity.name === db.database_name && identity.uuid === db.database_id,
		`${branch}: identitas target D1 staging salah`
	);
	const [result] = await read(
		'/query',
		`SELECT type, name, tbl_name, sql FROM sqlite_schema
		WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY type, name`
	);
	assert.ok(
		result.success && Array.isArray(result.results) && result.results.length > 0,
		`${branch}: schema tidak terbaca`
	);
	const objects = result.results.map(({ type, name, tbl_name, sql }) => ({
		type,
		name,
		table: tbl_name,
		sql
	}));
	const tables = objects.filter(({ type }) => type === 'table');
	for (const name of ['buku_kas', 'produk', 'sesi_toko', 'kiosk_shift_cutover'])
		assert.ok(
			tables.some((table) => table.name === name),
			`${branch}: tabel ${name} tidak ada`
		);
	const hash = createHash('sha256').update(JSON.stringify(objects)).digest('hex');
	schemas.set(branch, { hash, tables: tables.map(({ name }) => name), objects });
	console.log(`${branch}: ${tables.length} tabel, ${objects.length} objek schema, SHA-256 ${hash}`);
}

const reference = schemas.get('samarinda');
for (const branch of ['balikpapan', 'berau']) {
	const schema = schemas.get(branch);
	const names = new Set(schema.tables);
	const previous = new Set(reference.tables);
	const missing = reference.tables.filter((name) => !names.has(name));
	const added = schema.tables.filter((name) => !previous.has(name));
	const safeNames = (items) =>
		items.filter((name) => /^[a-z0-9_]{1,100}$/i.test(name)).join(',') || '-';
	console.log(
		`${branch} vs Samarinda: daftar tabel ${missing.length || added.length ? 'berbeda' : 'sama'}; definisi schema ${schema.hash === reference.hash ? 'sama' : 'berbeda'}`
	);
	if (missing.length || added.length)
		console.log(`  Tabel kurang: ${safeNames(missing)}; tabel tambahan: ${safeNames(added)}`);
	if (schema.hash !== reference.hash) {
		const original = new Map(
			reference.objects.map((object) => [`${object.type}:${object.name}`, object])
		);
		const changed = schema.objects.filter(
			(object) =>
				JSON.stringify(original.get(`${object.type}:${object.name}`)) !== JSON.stringify(object)
		);
		console.log(`  Objek tambahan/definisi berubah: ${safeNames(changed.map(({ name }) => name))}`);
		process.exitCode = 1;
	}
}
