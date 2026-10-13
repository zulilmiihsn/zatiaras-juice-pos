#!/usr/bin/env node
/** Read-only source -> disposable SQLite/workerd. Never a production restore command. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateD1Config, verifyManifest, canonicalizeExternalPath } from './d1-backup.mjs';
import { BRANCH_GROUPS } from '../src/lib/server/branchResolver.ts';
import {
	validateBukuKasBusiness,
	validateTransaksiKasirBusiness,
	validateRestoreRelationships
} from './restore-archive-lib.mjs';

const directory = new URL('../drizzle/', import.meta.url);
const contracts = new Map();
const tableSql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY name`;
const schemaSql = `SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_cf_*' ORDER BY type,name`;
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const fail = (name, detail) => {
	throw new Error(`DRILL FAIL ${name}: ${detail}`);
};

function canonicalSql(sql) {
	// Whitespace/casing outside quoted values is irrelevant; literal defaults must stay exact.
	return (
		String(sql).match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[\w]+|[^\s]/g) ?? []
	)
		.map((token) => (/^[\w]+$/.test(token) ? token.toLowerCase() : token))
		.join(' ');
}

/** Derive complete schema and version from verified canonical migrations, not a two-table allowlist. */
export function loadDrillContract(expectedMigration) {
	const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', directory), 'utf8'));
	const manifest = JSON.parse(readFileSync(new URL('meta/manifest.json', directory), 'utf8'));
	const names = journal.entries.map((entry) => `${entry.tag}.sql`);
	const end = expectedMigration ? names.indexOf(expectedMigration) + 1 : names.length;
	if (!end) fail('migrasi', 'target migrasi tidak dikenal');
	const files = names.slice(0, end);
	const target = files.at(-1);
	if (contracts.has(target)) return contracts.get(target);
	const db = new DatabaseSync(':memory:');
	try {
		for (const file of files) {
			const bytes = readFileSync(new URL(file, directory));
			if (createHash('sha256').update(bytes).digest('hex') !== manifest[file])
				fail('migrasi', `checksum sumber migrasi berbeda: ${file}`);
			db.exec(bytes.toString('utf8'));
		}
		const tables = db
			.prepare(tableSql)
			.all()
			.map((row) => String(row.name));
		const columns = Object.fromEntries(
			tables.map((name) => [
				name,
				db
					.prepare(`PRAGMA table_info(${identifier(name)})`)
					.all()
					.map((c) => String(c.name))
			])
		);
		const objects = db
			.prepare(schemaSql)
			.all()
			.map((row) => ({ key: `${row.type}:${row.name}`, sql: canonicalSql(row.sql) }));
		const contract = { files, target, tables, columns, objects };
		contracts.set(target, contract);
		return contract;
	} finally {
		db.close();
	}
}

// Compatibility for existing consumers; actual checks derive every application table/column.
const currentContract = loadDrillContract();
export const POS_REQUIRED_COLUMNS = Object.freeze({
	buku_kas: currentContract.columns.buku_kas,
	transaksi_kasir: currentContract.columns.transaksi_kasir
});

/** Block SQL capable of escaping the in-memory database; do not inspect quoted business text. */
export function assertSafeDrillSql(sql) {
	const executable = sql.replace(
		/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g,
		' '
	);
	if (/\b(?:ATTACH|DETACH|VACUUM|load_extension)\b/i.test(executable))
		fail('safety', 'dump mengandung operasi file/extension yang tidak diizinkan');
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashPattern = /^[0-9a-f]{64}$/;

export function drillDatabaseIdentity(binding) {
	const identity = validateD1Config(
		readFileSync(new URL('../wrangler.pages.jsonc', import.meta.url), 'utf8')
	).find((database) => database.binding === binding);
	if (!identity) fail('baseline', 'shard target wajib valid');
	return identity;
}

/** The approved hash is an out-of-band trust anchor, never recomputed from the candidate dump. */
export function validateDrillBaseline(
	options,
	contract = loadDrillContract(options.expectedMigration)
) {
	const input = options.baseline;
	if (!input || typeof input.text !== 'string' || !hashPattern.test(input.approvedSha256 ?? ''))
		fail('baseline', 'baseline eksternal dan SHA-256 approved wajib diberikan');
	if (sha256(input.text) !== input.approvedSha256)
		fail('baseline', 'SHA-256 baseline berbeda dari approved reference');
	let baseline;
	try {
		baseline = JSON.parse(input.text);
	} catch {
		fail('baseline', 'JSON baseline tidak valid');
	}
	if (
		!isRecord(baseline) ||
		baseline.schema !== 'zatiaraspos-drill-baseline-v1' ||
		!isRecord(baseline.database) ||
		!isRecord(baseline.source) ||
		!isRecord(baseline.tables)
	)
		fail('baseline', 'schema baseline tidak valid');
	const identity = options.databaseIdentity;
	if (
		!identity ||
		!['binding', 'name', 'id'].every(
			(field) => typeof identity[field] === 'string' && identity[field] === baseline.database[field]
		) ||
		!Object.hasOwn(BRANCH_GROUPS, identity.binding)
	)
		fail('baseline', 'identity baseline tidak cocok dengan target');
	const configured = drillDatabaseIdentity(identity.binding);
	if (!['binding', 'name', 'id'].every((field) => identity[field] === configured[field]))
		fail('baseline', 'identity target berbeda dari konfigurasi canonical');
	if (baseline.migration !== contract.target)
		fail('baseline', 'migration baseline tidak cocok dengan target eksplisit');
	const source = options.sourceIdentity;
	if (
		!Number.isSafeInteger(baseline.source.bytes) ||
		baseline.source.bytes <= 0 ||
		!hashPattern.test(baseline.source.sha256 ?? '') ||
		!source ||
		source.bytes !== baseline.source.bytes ||
		source.sha256 !== baseline.source.sha256
	)
		fail('baseline', 'bytes/SHA-256 source tidak cocok dengan baseline');
	for (const name of [...contract.tables, 'd1_migrations'])
		if (!Object.hasOwn(baseline.tables, name))
			fail('baseline', 'inventory tabel wajib tidak lengkap');
	for (const value of Object.values(baseline.tables))
		if (
			!isRecord(value) ||
			!Number.isSafeInteger(value.count) ||
			value.count < 0 ||
			!hashPattern.test(value.sha256 ?? '')
		)
			fail('baseline', 'count/hash inventory tidak valid');
	return baseline;
}

export function loadDrillBaseline(file, approvedSha256, sourceBytes, binding, expectedMigration) {
	if (!file || !approvedSha256)
		fail('baseline', '--expect-baseline dan --expect-baseline-sha256 wajib diberikan');
	const options = {
		expectedMigration,
		baseline: { text: readFileSync(resolve(file), 'utf8'), approvedSha256 },
		databaseIdentity: drillDatabaseIdentity(binding),
		sourceIdentity: { bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) }
	};
	validateDrillBaseline(options);
	return options;
}

/** Shared immutable source boundary for destructive consumers; no target calls or mutation here. */
export async function verifyRecoverySource(
	{ binding, file, backupManifest, baselineFile, baselineSha256, expectedMigration },
	capture = () => undefined
) {
	let sqlFile;
	let entry;
	if (backupManifest) {
		const verified = await verifyManifest(backupManifest, { requireComplete: true });
		entry = verified.manifest.shards.find((shard) => shard.binding === binding);
		if (!entry) throw new Error('Manifest tidak memuat shard target');
		sqlFile = join(dirname(verified.manifestPath), entry.file);
	} else sqlFile = await canonicalizeExternalPath(file, { mustExist: true });
	if (!sqlFile.endsWith('.sql')) throw new Error('File sumber harus .sql');
	const bytes = readFileSync(sqlFile);
	if (entry && (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256))
		throw new Error('Source berubah setelah manifest verification');
	const sql = bytes.toString('utf8');
	if (!Buffer.from(sql, 'utf8').equals(bytes))
		throw new Error('Source bukan UTF-8 utuh; recovery ditolak tanpa rewrite bytes');
	if (!sql.trim()) throw new Error('File sumber kosong. Hentikan.');
	assertSafeDrillSql(sql);
	const reference = baselineFile
		? await canonicalizeExternalPath(baselineFile, { mustExist: true })
		: null;
	const options = loadDrillBaseline(reference, baselineSha256, bytes, binding, expectedMigration);
	const mem = new DatabaseSync(':memory:');
	try {
		mem.exec('PRAGMA foreign_keys=OFF;');
		mem.exec(sql);
		const adapter = sqliteAdapter(mem);
		const report = await checkDrillDatabase(adapter, 'full', options);
		return {
			sqlFile,
			sql,
			tables: report.tables.length,
			capture: await capture(mem),
			target: report.target
		};
	} catch (error) {
		throw new Error(`Drill sumber gagal, recovery ditolak: ${error.message}`);
	} finally {
		mem.close();
	}
}

/** Sync and async adapters share the same checker; callers MUST await it. */
export async function checkDrillDatabase(adapter, scope = 'full', options = {}) {
	const contract = loadDrillContract(options.expectedMigration);
	const tables = (await adapter.all(tableSql)).map((row) => String(row.name));
	const checks = [];
	for (const table of contract.tables) {
		if (!tables.includes(table)) fail('schema', `tabel aplikasi hilang: ${table}`);
		const have = new Set(
			(await adapter.all(`PRAGMA table_info(${identifier(table)})`)).map((c) => String(c.name))
		);
		const missing = contract.columns[table].filter((c) => !have.has(c));
		if (missing.length) fail('schema', `${table} kolom hilang: ${missing.join(', ')}`);
	}
	const actual = new Map(
		(await adapter.all(schemaSql)).map((row) => [`${row.type}:${row.name}`, canonicalSql(row.sql)])
	);
	for (const object of contract.objects) {
		if (actual.get(object.key) !== object.sql)
			fail('schema', `definisi/constraint hilang atau berbeda: ${object.key}`);
	}
	if (!tables.includes('d1_migrations')) fail('migrasi', 'ledger d1_migrations hilang');
	const migrated = (await adapter.all('SELECT name FROM d1_migrations ORDER BY id')).map((row) =>
		String(row.name)
	);
	if (JSON.stringify(migrated) !== JSON.stringify(contract.files))
		fail('migrasi', 'ledger tidak cocok target migrasi');
	checks.push({
		name: 'schema',
		detail: `${contract.tables.length} tabel aplikasi lengkap; target ${contract.target}`
	});
	checks.push({ name: 'migrasi', detail: `${migrated.length} migrasi sesuai manifest` });
	if (scope === 'full') {
		for (const pragma of ['integrity_check', 'quick_check']) {
			const result = await adapter.all(`PRAGMA ${pragma}`);
			if (result.length !== 1 || String(result[0][pragma]).toLowerCase() !== 'ok')
				fail(pragma, 'integritas SQLite tidak sehat');
			checks.push({ name: pragma, detail: 'ok' });
		}
		if ((await adapter.all('PRAGMA foreign_key_check')).length)
			fail('foreign-key', 'referensi FK deklaratif tidak sehat');
	}
	// D1 enforces declared FKs. Legacy relations without FKs still need branch-aware detectors.
	const zeroChecks = [
		[
			'orphan',
			`SELECT COUNT(*) AS n FROM transaksi_kasir t LEFT JOIN buku_kas b ON b.id=t.buku_kas_id AND b.cabang_id=t.cabang_id WHERE b.id IS NULL`,
			'transaksi_kasir yatim'
		],
		[
			'orphan-mutasi',
			`SELECT COUNT(*) AS n FROM bahan_mutasi m LEFT JOIN bahan b ON b.id=m.bahan_id AND b.cabang_id=m.cabang_id WHERE b.id IS NULL`,
			'bahan_mutasi yatim'
		],
		[
			'stok-negatif',
			`SELECT (SELECT COUNT(*) FROM bahan WHERE stok_saat_ini < 0)+(SELECT COUNT(*) FROM produk WHERE stok < 0) AS n`,
			'stok negatif'
		],
		[
			'nomor-pair',
			`SELECT COUNT(*) AS n FROM buku_kas WHERE (nomor_harian IS NULL) != (tanggal_nomor IS NULL)`,
			'pasangan nomor tidak lengkap'
		],
		[
			'counter',
			`SELECT COUNT(*) AS n FROM (SELECT b.cabang_id,b.tanggal_nomor FROM buku_kas b LEFT JOIN pos_nomor_harian n ON n.cabang_id=b.cabang_id AND n.tanggal=b.tanggal_nomor WHERE b.nomor_harian IS NOT NULL GROUP BY b.cabang_id,b.tanggal_nomor HAVING MAX(n.terakhir) IS NULL OR MAX(n.terakhir) < MAX(b.nomor_harian))`,
			'counter hilang/tertinggal'
		],
		[
			'money',
			`SELECT COUNT(*) AS n FROM buku_kas WHERE nominal < 0 OR nominal > 9007199254740991 OR nominal != CAST(nominal AS INTEGER)`,
			'nominal kas tidak valid'
		]
	];
	for (const [name, sql, reason] of zeroChecks) {
		const count = Number((await adapter.get(sql))?.n);
		if (!Number.isSafeInteger(count) || count !== 0) fail(name, reason);
		checks.push({ name, detail: '0 pelanggaran' });
	}
	for (const [table, validate] of [
		['buku_kas', validateBukuKasBusiness],
		['transaksi_kasir', validateTransaksiKasirBusiness]
	]) {
		for (const row of await adapter.all(`SELECT * FROM ${identifier(table)}`)) {
			const errors = validate(row);
			if (errors.length) fail('business', errors.join('; '));
		}
	}
	const relationshipErrors = validateRestoreRelationships(
		await adapter.all('SELECT * FROM buku_kas'),
		await adapter.all('SELECT * FROM transaksi_kasir')
	);
	if (relationshipErrors.length) fail('relationships', relationshipErrors.join('; '));
	checks.push({
		name: 'relationships',
		detail: 'header/detail/receipt financial invariants cocok; legacy unknown tidak dikarang'
	});
	checks.push({
		name: 'receipt',
		detail: 'preflight bisnis canonical (angka/tanggal/snapshot totals); NULL legacy tidak dikarang'
	});
	const baseline = validateDrillBaseline(options, contract);
	for (const name of tables) {
		if (!baseline.tables[name])
			fail('baseline', 'source memiliki tabel di luar inventory approved');
		const columns = (await adapter.all(`PRAGMA table_info(${identifier(name)})`)).map((column) =>
			String(column.name)
		);
		if (columns.includes('cabang_id')) {
			const branches = await adapter.all(
				`SELECT DISTINCT cabang_id FROM ${identifier(name)} WHERE cabang_id IS NOT NULL`
			);
			if (
				branches.some(
					(row) => !BRANCH_GROUPS[options.databaseIdentity.binding].includes(row.cabang_id)
				)
			)
				fail('baseline', 'tenant source bukan milik shard target');
		}
	}
	const inventory = await captureDrillParity(adapter);
	const names = Object.keys(inventory).sort();
	if (
		JSON.stringify(names) !== JSON.stringify(Object.keys(baseline.tables).sort()) ||
		names.some(
			(name) =>
				inventory[name].count !== baseline.tables[name].count ||
				inventory[name].sha256 !== baseline.tables[name].sha256
		)
	)
		fail('baseline', 'expected counts/field hashes berbeda dari reference approved');
	checks.push({
		name: 'baseline',
		detail: 'approved identity/source digest/migration dan inventory semua tabel cocok'
	});
	const total = Object.values(inventory).reduce((sum, value) => sum + value.count, 0);
	return { tables, total, checks, target: contract.target, baselineVerified: true };
}

/** All fields, including receipt bytes/idempotency/fingerprints, participate in deterministic parity. */
export async function captureDrillParity(adapter) {
	const tables = (await adapter.all(tableSql)).map((row) => String(row.name));
	const parity = {};
	for (const table of tables) {
		const columns = (await adapter.all(`PRAGMA table_info(${identifier(table)})`))
			.map((row) => String(row.name))
			.sort();
		const rows = await adapter.all(`SELECT * FROM ${identifier(table)}`);
		const values = rows
			.map((row) =>
				JSON.stringify(
					columns.map((column) => {
						const value = row[column];
						if (ArrayBuffer.isView(value))
							return {
								blob: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex')
							};
						if (value instanceof ArrayBuffer) return { blob: Buffer.from(value).toString('hex') };
						if (Array.isArray(value)) return { blob: Buffer.from(value).toString('hex') };
						return value;
					})
				)
			)
			.sort();
		parity[table] = {
			count: rows.length,
			sha256: createHash('sha256').update(JSON.stringify({ columns, values })).digest('hex')
		};
	}
	return parity;
}

export function assertDrillParity(expected, actual) {
	if (JSON.stringify(expected) !== JSON.stringify(actual))
		fail('parity', 'counts/field hashes sumber dan hasil restore berbeda');
}

function sqliteAdapter(db) {
	return { all: (sql) => db.prepare(sql).all(), get: (sql) => db.prepare(sql).get() };
}

/** Tables/indexes first, rows next, triggers last: replaying triggers would double source aggregates. */
export async function copyToD1(mem, db) {
	const objects = mem.prepare(schemaSql).all();
	for (const type of ['table', 'index']) {
		for (const object of objects.filter((o) => o.type === type)) await db.prepare(object.sql).run();
	}
	for (const { name } of objects.filter((o) => o.type === 'table')) {
		const cols = mem
			.prepare(`PRAGMA table_info(${identifier(name)})`)
			.all()
			.map((c) => String(c.name));
		const rows = mem.prepare(`SELECT * FROM ${identifier(name)}`).all();
		const sql = `INSERT INTO ${identifier(name)} (${cols.map(identifier).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
		for (let i = 0; i < rows.length; i += 50) {
			await db.batch(
				rows.slice(i, i + 50).map((row) =>
					db.prepare(sql).bind(
						...cols.map((column) => {
							const value = row[column] ?? null;
							return ArrayBuffer.isView(value)
								? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
								: value;
						})
					)
				)
			);
		}
	}
	for (const object of objects.filter((o) => o.type === 'trigger'))
		await db.prepare(object.sql).run();
}

export async function main(argv = process.argv.slice(2), deps = {}) {
	let file,
		expectedMigration,
		baselineFile,
		baselineSha256,
		binding,
		useD1 = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (
			[
				'--file',
				'--expect-migration',
				'--expect-baseline',
				'--expect-baseline-sha256',
				'--shard'
			].includes(arg)
		) {
			const value = argv[++i];
			if (!value || value.startsWith('--')) throw new Error(`Nilai ${arg} wajib diisi`);
			if (arg === '--file') file = value;
			else if (arg === '--expect-migration') expectedMigration = value;
			else if (arg === '--expect-baseline') baselineFile = value;
			else if (arg === '--expect-baseline-sha256') baselineSha256 = value;
			else binding = value;
		} else if (arg === '--d1') useD1 = true;
		else throw new Error(`Argumen tidak diizinkan: ${arg}`);
	}
	if (!file)
		throw new Error(
			'Usage: --file <backup.sql> --shard <BINDING> --expect-baseline <inventory.json> --expect-baseline-sha256 <approved-hash> [--d1] [--expect-migration <nama.sql>]'
		);
	const bytes = readFileSync(resolve(file));
	const sql = bytes.toString('utf8');
	if (!sql.trim()) throw new Error('File backup kosong');
	assertSafeDrillSql(sql);
	const baselineOptions = loadDrillBaseline(
		baselineFile,
		baselineSha256,
		bytes,
		binding,
		expectedMigration
	);
	const mem = deps.createDatabase ? deps.createDatabase() : new DatabaseSync(':memory:');
	let proxy;
	try {
		mem.exec('PRAGMA foreign_keys=OFF;');
		mem.exec(sql);
		const source = sqliteAdapter(mem);
		let report = await checkDrillDatabase(source, 'full', baselineOptions);
		if (useD1) {
			const before = await captureDrillParity(source);
			const getPlatformProxy = deps.getPlatformProxy ?? (await import('wrangler')).getPlatformProxy;
			proxy = await getPlatformProxy({
				configPath: 'wrangler.pages.jsonc',
				persist: false,
				remoteBindings: false
			});
			const db = proxy.env[binding];
			await copyToD1(mem, db);
			const destination = {
				all: async (query) => (await db.prepare(query).all()).results ?? [],
				get: async (query) => db.prepare(query).first()
			};
			report = await checkDrillDatabase(destination, 'data', baselineOptions);
			assertDrillParity(before, await captureDrillParity(destination));
			report.checks.push({
				name: 'parity',
				detail:
					'all-table counts/field hashes cocok sumber SQLite; termasuk financial/receipt/idempotency'
			});
		}
		for (const check of report.checks) console.log(`- cek ${check.name}: ${check.detail}`);
		console.log(
			`PASS restore drill lokal: ${report.tables.length} tabel, ${report.total} rows (${useD1 ? 'workerd D1' : 'SQLite'}), target ${report.target}`
		);
		return report;
	} finally {
		try {
			if (proxy) await proxy.dispose();
		} finally {
			mem.close();
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		console.error(`Restore drill gagal: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
