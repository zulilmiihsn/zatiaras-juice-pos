#!/usr/bin/env node
/**
 * AUD-059: trusted drill baseline from the LIVE production shard (read-only), and verification
 * of an isolated restore target against that baseline.
 *
 *   capture:  --shard <BINDING> --backup-manifest <manifest> --output <external.json> [--env-file .env]
 *   verify:   --shard <BINDING> --backup-manifest <manifest>
 *             --verify-target <zatiaraspos-drill-x> --target-config <external wrangler.json>
 *             --expect-baseline <baseline.json> --expect-baseline-sha256 <hash> [--env-file .env]
 *
 * Capture reads the authoritative live database, never the candidate dump, so the drill can
 * prove the dump is complete. It issues only SELECT / PRAGMA table_info statements it builds
 * itself, in two remote requests (table list, then every table plus the list again); a table
 * list that changed between them fails. Writes between backup and capture make the drill fail
 * closed, so capture right after the backup in a window without transactions.
 *
 * Verify exports the scratch target itself, so the checked SQL provably comes from the restore.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
	BACKUP_ENV_KEYS,
	CONFIG_FILE,
	REPO_ROOT,
	buildBackupChildEnv,
	canonicalizeExternalPath,
	loadAllowlistedEnv,
	parseAndVerifyInfo,
	redactValues,
	stripJsonc,
	verifyManifest
} from './d1-backup.mjs';
import {
	DRILL_TABLE_SQL,
	captureDrillParity,
	checkDrillDatabase,
	decodeVerifiedSql,
	drillDatabaseIdentity,
	drillIdentifier,
	loadDrillBaseline,
	loadDrillContract
} from './restore-drill-local.mjs';

const require = createRequire(import.meta.url);
const WRANGLER_CLI = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const MAX_OUTPUT = 256 * 1024 * 1024;
const SCRATCH_NAME = /^zatiaraspos-drill-[a-z]+$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const FLAGS = {
	'--shard': 'shard',
	'--backup-manifest': 'backupManifest',
	'--env-file': 'envFile',
	'--output': 'output',
	'--verify-target': 'verifyTarget',
	'--target-config': 'targetConfig',
	'--expect-baseline': 'baselineFile',
	'--expect-baseline-sha256': 'baselineSha256'
};
const MODE_FLAGS = {
	capture: ['shard', 'backupManifest', 'envFile', 'output'],
	verify: [
		'shard',
		'backupManifest',
		'envFile',
		'verifyTarget',
		'targetConfig',
		'baselineFile',
		'baselineSha256'
	]
};

export function parseArgs(argv) {
	const options = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--') continue;
		const key = FLAGS[argv[i]];
		if (!key || !argv[i + 1] || argv[i + 1].startsWith('--'))
			throw new Error(`Argumen tidak dikenal/kosong: ${argv[i]}`);
		options[key] = argv[++i];
	}
	if (Boolean(options.output) === Boolean(options.verifyTarget))
		throw new Error('Pilih tepat satu mode: --output (capture) atau --verify-target');
	const mode = options.output ? 'capture' : 'verify';
	const required = MODE_FLAGS[mode].filter((key) => key !== 'envFile');
	const missing = required.filter((key) => !options[key]);
	if (missing.length) throw new Error(`Mode ${mode} wajib: ${missing.join(', ')}`);
	const stray = Object.keys(options).filter((key) => !MODE_FLAGS[mode].includes(key));
	if (stray.length) throw new Error(`Flag tidak berlaku untuk mode ${mode}: ${stray.join(', ')}`);
	if (mode === 'verify' && !SCRATCH_NAME.test(options.verifyTarget))
		throw new Error('Target verifikasi wajib database scratch zatiaraspos-drill-*');
	return { ...options, mode };
}

function runWrangler(args, { env, secrets }) {
	const result = spawnSync(process.execPath, [WRANGLER_CLI, ...args], {
		cwd: REPO_ROOT,
		env: { ...env, WRANGLER_WRITE_LOGS: 'false' },
		shell: false,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		maxBuffer: MAX_OUTPUT,
		windowsHide: true
	});
	if (result.error) throw new Error(redactValues(result.error.message, secrets));
	if (result.status !== 0)
		throw new Error(
			`Wrangler gagal (${result.status}): ${redactValues(result.stderr, secrets).slice(0, 500)}`
		);
	return redactValues(result.stdout, secrets);
}

/**
 * Only statements this script builds. The prefix allowlist is the read-only guarantee; the
 * meta check afterwards is a second signal and fails closed when meta is missing or changed.
 */
export function remoteRead(identity, statements, ctx) {
	for (const sql of statements)
		if (!/^(?:SELECT |PRAGMA table_info\()/.test(sql) || sql.includes(';'))
			throw new Error('Statement di luar allowlist read-only');
	// ctx.run: injectable for tests; production always uses the real Wrangler CLI.
	const stdout = (ctx.run ?? runWrangler)(
		[
			'd1',
			'execute',
			identity.name,
			'--config',
			CONFIG_FILE,
			'--remote',
			'--json',
			'--command',
			statements.join('; ')
		],
		ctx
	);
	const parsed = JSON.parse(stdout.trim());
	if (!Array.isArray(parsed) || parsed.length !== statements.length)
		throw new Error('Jumlah hasil remote tidak sama dengan jumlah statement');
	for (const entry of parsed) {
		if (!entry?.success || !Array.isArray(entry.results)) throw new Error('Query remote gagal');
		const meta = entry.meta;
		if (typeof meta?.changed_db !== 'boolean' || !Number.isSafeInteger(meta?.rows_written))
			throw new Error('Meta remote tidak dikenali; tidak bisa membuktikan read-only');
		if (meta.changed_db || meta.rows_written !== 0)
			throw new Error('Query remote mengubah database; hentikan');
	}
	return parsed.map((entry) => entry.results);
}

export async function captureLiveParity(identity, ctx) {
	const [tables] = remoteRead(identity, [DRILL_TABLE_SQL], ctx);
	const names = tables.map((row) => String(row.name));
	const statements = [DRILL_TABLE_SQL];
	for (const name of names)
		statements.push(
			`PRAGMA table_info(${drillIdentifier(name)})`,
			`SELECT * FROM ${drillIdentifier(name)}`
		);
	const results = remoteRead(identity, statements, ctx);
	const answers = new Map(statements.map((sql, index) => [sql, results[index]]));
	// captureDrillParity issues exactly these statements; anything else is a contract drift.
	const adapter = {
		all: (sql) => {
			if (!answers.has(sql)) throw new Error(`Statement tidak di-prefetch: ${sql.slice(0, 80)}`);
			return answers.get(sql);
		}
	};
	const parity = await captureDrillParity(adapter);
	if (JSON.stringify(Object.keys(parity).sort()) !== JSON.stringify([...names].sort()))
		throw new Error('Daftar tabel berubah selama capture');
	return parity;
}

async function sourceEntry(manifestPath, binding) {
	const verified = await verifyManifest(manifestPath, { requireComplete: true });
	const entry = verified.manifest.shards.find((shard) => shard.binding === binding);
	if (!entry) throw new Error('Manifest tidak memuat shard target');
	const bytes = readFileSync(join(dirname(verified.manifestPath), entry.file));
	if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256)
		throw new Error('Source berubah setelah manifest verification');
	return { entry, bytes };
}

async function wranglerContext(envFile) {
	const secrets = await loadAllowlistedEnv(envFile, BACKUP_ENV_KEYS);
	return { env: buildBackupChildEnv(secrets), secrets };
}

async function capture(options, identity, entry) {
	const output = await canonicalizeExternalPath(options.output);
	const ctx = await wranglerContext(options.envFile);
	parseAndVerifyInfo(
		runWrangler(['d1', 'info', identity.name, '--config', CONFIG_FILE, '--json'], ctx),
		identity
	);
	const tables = await captureLiveParity(identity, ctx);
	const baseline = {
		schema: 'zatiaraspos-drill-baseline-v1',
		database: { binding: identity.binding, name: identity.name, id: identity.id },
		migration: loadDrillContract().target,
		source: { bytes: entry.bytes, sha256: entry.sha256 },
		captured_from: 'live-remote-read-only',
		captured_at: new Date().toISOString(),
		tables
	};
	const text = `${JSON.stringify(baseline, null, 2)}\n`;
	writeFileSync(output, text, { flag: 'wx', mode: 0o600 });
	const rows = Object.values(tables).reduce((sum, table) => sum + table.count, 0);
	console.log(
		`PASS baseline ${identity.binding}: ${Object.keys(tables).length} tabel, ${rows} baris -> ${output}`
	);
	console.log(`SHA-256 baseline (catat terpisah, mis. di tracker, sebelum drill): ${sha256(text)}`);
}

async function verify(options, bytes) {
	const targetConfig = await canonicalizeExternalPath(options.targetConfig, { mustExist: true });
	const databases = JSON.parse(stripJsonc(readFileSync(targetConfig, 'utf8')))?.d1_databases;
	if (
		!Array.isArray(databases) ||
		!databases.some((db) => db?.database_name === options.verifyTarget)
	)
		throw new Error('Config target tidak memuat database scratch yang diminta');
	const drillOptions = loadDrillBaseline(
		await canonicalizeExternalPath(options.baselineFile, { mustExist: true }),
		options.baselineSha256,
		bytes,
		options.shard
	);
	const ctx = await wranglerContext(options.envFile);
	const dir = mkdtempSync(join(tmpdir(), 'zatiaras-drill-verify-'));
	const exportFile = join(dir, `${options.verifyTarget}.sql`);
	const mem = new DatabaseSync(':memory:');
	try {
		runWrangler(
			[
				'd1',
				'export',
				options.verifyTarget,
				'--config',
				targetConfig,
				'--remote',
				'--skip-confirmation',
				'--output',
				exportFile
			],
			ctx
		);
		const sql = decodeVerifiedSql(exportFile, readFileSync(exportFile));
		mem.exec('PRAGMA foreign_keys=OFF;');
		mem.exec(sql);
		const report = await checkDrillDatabase(
			{ all: (s) => mem.prepare(s).all(), get: (s) => mem.prepare(s).get() },
			'full',
			drillOptions
		);
		console.log(
			`PASS target ${options.verifyTarget} (${options.shard}): ${report.tables.length} tabel, ${report.total} baris cocok baseline (${report.checks.length} check)`
		);
	} finally {
		mem.close();
		rmSync(dir, { recursive: true, force: true });
	}
}

export async function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	const identity = drillDatabaseIdentity(options.shard);
	const { entry, bytes } = await sourceEntry(options.backupManifest, options.shard);
	if (entry.name !== identity.name || entry.database_id !== identity.id)
		throw new Error('Manifest shard tidak cocok dengan konfigurasi canonical');
	if (options.mode === 'capture') await capture(options, identity, entry);
	else await verify(options, bytes);
}

const isCli =
	process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isCli) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
