import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	stat,
	writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = 'wrangler.pages.jsonc';
export const EXPECTED_BINDINGS = Object.freeze([
	'DB_SAMARINDA_GROUP',
	'DB_BALIKPAPAN_GROUP',
	'DB_BERAU_GROUP'
]);
export const BACKUP_ENV_KEYS = Object.freeze(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
const OS_ENV_KEYS = Object.freeze([
	'PATH',
	'PATHEXT',
	'SystemRoot',
	'TEMP',
	'TMP',
	'USERPROFILE',
	'APPDATA',
	'LOCALAPPDATA'
]);
const MAX_CHILD_OUTPUT = 1024 * 1024;
const SQL_PREFIX = /^\s*(?:--|PRAGMA\b|CREATE\s+TABLE\b|INSERT\s+INTO\b|BEGIN\s+TRANSACTION\b)/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODULE_FILE = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(MODULE_FILE), '..');
export const WORKSPACE_ROOT = resolve(REPO_ROOT, '..');

function normalizeForCompare(value) {
	const normalized = resolve(value).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInsideOrEqual(candidate, parent) {
	const childValue = normalizeForCompare(candidate);
	const parentValue = normalizeForCompare(parent);
	return childValue === parentValue || childValue.startsWith(`${parentValue}${sep}`);
}

export function stripJsonc(input) {
	return input
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '')
		.replace(/,\s*([}\]])/g, '$1');
}

export function parseArgs(argv) {
	const parsed = { outputDir: null, envFile: null, verifyManifest: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (index === 0 && arg === '--') continue;
		if (!['--output-dir', '--env-file', '--verify-manifest'].includes(arg)) {
			throw new Error(`Argumen tidak diizinkan: ${arg}`);
		}
		const value = argv[index + 1];
		if (!value || value.startsWith('--')) throw new Error(`Nilai ${arg} wajib diisi`);
		index += 1;
		if (arg === '--output-dir') parsed.outputDir = value;
		if (arg === '--env-file') parsed.envFile = value;
		if (arg === '--verify-manifest') parsed.verifyManifest = value;
	}
	if (parsed.verifyManifest && (parsed.outputDir || parsed.envFile)) {
		throw new Error('--verify-manifest tidak dapat digabung dengan argumen backup');
	}
	if (!parsed.verifyManifest && !parsed.outputDir) {
		throw new Error('--output-dir absolut di luar repository/workspace wajib diisi');
	}
	return parsed;
}

async function nearestExistingAncestor(targetPath, fs = {}) {
	const pathLstat = fs.lstat ?? lstat;
	let cursor = resolve(targetPath);
	const suffix = [];
	while (true) {
		try {
			await pathLstat(cursor);
			return { ancestor: cursor, suffix: suffix.reverse() };
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw new Error('Tidak menemukan ancestor tujuan yang ada');
			suffix.push(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
			cursor = parent;
		}
	}
}

export async function canonicalizeExternalPath(
	targetPath,
	{ repoRoot = REPO_ROOT, workspaceRoot = WORKSPACE_ROOT, mustExist = false, fs = {} } = {}
) {
	if (!targetPath || !isAbsolute(targetPath)) {
		throw new Error('Tujuan wajib berupa path absolut');
	}
	const pathRealpath = fs.realpath ?? realpath;
	const pathLstat = fs.lstat ?? lstat;
	const absolute = resolve(targetPath);
	const { ancestor, suffix } = await nearestExistingAncestor(absolute, fs);
	const canonicalAncestor = await pathRealpath(ancestor);
	const canonicalCandidate = resolve(canonicalAncestor, ...suffix);
	for (const forbidden of [repoRoot, workspaceRoot]) {
		const canonicalForbidden = await pathRealpath(forbidden).catch(() => resolve(forbidden));
		if (isInsideOrEqual(canonicalCandidate, canonicalForbidden)) {
			throw new Error('Tujuan harus berada di luar repository dan workspace');
		}
	}
	if (mustExist) {
		const targetStat = await pathLstat(absolute);
		if (targetStat.isSymbolicLink?.()) {
			const resolvedTarget = await pathRealpath(absolute);
			for (const forbidden of [repoRoot, workspaceRoot]) {
				const canonicalForbidden = await pathRealpath(forbidden).catch(() => resolve(forbidden));
				if (isInsideOrEqual(resolvedTarget, canonicalForbidden)) {
					throw new Error('Tujuan symlink/junction mengarah ke workspace');
				}
			}
		}
		const resolvedTarget = await pathRealpath(absolute);
		for (const forbidden of [repoRoot, workspaceRoot]) {
			const canonicalForbidden = await pathRealpath(forbidden).catch(() => resolve(forbidden));
			if (isInsideOrEqual(resolvedTarget, canonicalForbidden)) {
				throw new Error('Tujuan ter-resolve ke dalam repository/workspace');
			}
		}
		return resolvedTarget;
	}
	return canonicalCandidate;
}

export function validateD1Config(configOrText) {
	const config =
		typeof configOrText === 'string' ? JSON.parse(stripJsonc(configOrText)) : configOrText;
	const databases = config?.d1_databases;
	if (!Array.isArray(databases) || databases.length !== 3) {
		throw new Error('Konfigurasi wajib memiliki tepat tiga D1 production shard');
	}
	const bindings = databases.map((entry) => String(entry?.binding ?? ''));
	if (
		new Set(bindings).size !== EXPECTED_BINDINGS.length ||
		!EXPECTED_BINDINGS.every((binding) => bindings.includes(binding))
	) {
		throw new Error('Set binding D1 tidak cocok dengan tiga binding production');
	}
	const names = databases.map((entry) => String(entry?.database_name ?? '').trim());
	const ids = databases.map((entry) => String(entry?.database_id ?? '').trim());
	if (names.some((name) => !name) || new Set(names).size !== 3) {
		throw new Error('Nama D1 wajib ada dan unik');
	}
	if (ids.some((id) => !UUID_PATTERN.test(id)) || new Set(ids).size !== 3) {
		throw new Error('Database ID D1 wajib berupa UUID unik');
	}
	return databases.map((entry) => ({
		binding: String(entry.binding),
		name: String(entry.database_name),
		id: String(entry.database_id)
	}));
}

export async function loadAllowlistedEnv(envFile, keys, { processEnv = process.env } = {}) {
	const allowed = new Set(keys);
	const values = {};
	for (const key of keys) {
		if (typeof processEnv[key] === 'string' && processEnv[key]) values[key] = processEnv[key];
	}
	if (!envFile) return values;
	const text = await readFile(resolve(envFile), 'utf8');
	const seen = new Set();
	for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
		if (!match) throw new Error(`Baris env tidak valid: ${index + 1}`);
		const [, key, rawValue] = match;
		if (!allowed.has(key)) continue;
		if (seen.has(key)) throw new Error(`Duplikat env key: ${key}`);
		seen.add(key);
		let value = rawValue.trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (!value) throw new Error(`Env key kosong: ${key}`);
		values[key] = value;
	}
	return values;
}

export function redactValues(value, secrets) {
	let output = String(value ?? '');
	for (const secret of Object.values(secrets ?? {})) {
		if (typeof secret === 'string' && secret) output = output.split(secret).join('[REDACTED]');
	}
	return output;
}

export function buildBackupChildEnv(secrets, processEnv = process.env) {
	const childEnv = {};
	for (const key of OS_ENV_KEYS) {
		if (typeof processEnv[key] === 'string' && processEnv[key]) childEnv[key] = processEnv[key];
	}
	for (const key of BACKUP_ENV_KEYS) {
		if (typeof secrets[key] === 'string' && secrets[key]) childEnv[key] = secrets[key];
	}
	return childEnv;
}

export function createRtkRunner({ spawn = spawnSync } = {}) {
	return async (args, { cwd = REPO_ROOT, env = {}, secrets = {} } = {}) => {
		if (args[0] !== 'pnpm' || args[1] !== 'exec' || args[2] !== 'wrangler' || args[3] !== 'd1') {
			throw new Error('Child command ditolak oleh allowlist RTK/Wrangler');
		}
		const operation = args[4];
		const allowed =
			operation === 'info'
				? !args.some((arg) => ['--remote', '--command', '--file'].includes(arg))
				: operation === 'export' &&
					args.includes('--remote') &&
					args.includes('--skip-confirmation') &&
					args.includes('--output');
		if (
			!allowed ||
			args.some((arg) => ['migrations', 'restore', 'delete', '--command'].includes(arg))
		) {
			throw new Error('Operasi D1 ditolak oleh allowlist backup');
		}
		const result = spawn('rtk', args, {
			cwd,
			env,
			shell: false,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			maxBuffer: MAX_CHILD_OUTPUT,
			windowsHide: true
		});
		const stdout = redactValues(result.stdout, secrets);
		const stderr = redactValues(result.stderr, secrets);
		if (result.error) throw new Error(redactValues(result.error.message, secrets));
		if (result.status !== 0) {
			throw new Error(`RTK/Wrangler gagal (${result.status}): ${stderr.slice(0, 500)}`);
		}
		return { stdout, stderr, status: result.status };
	};
}

function findInfoObject(value) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findInfoObject(item);
			if (found) return found;
		}
		return null;
	}
	if (!value || typeof value !== 'object') return null;
	const name = value.name ?? value.database_name;
	const id = value.uuid ?? value.id ?? value.database_id;
	const version = value.version ?? 'production';
	if (name && id) return { name: String(name), id: String(id), version: String(version) };
	for (const child of Object.values(value)) {
		const found = findInfoObject(child);
		if (found) return found;
	}
	return null;
}

export function parseAndVerifyInfo(stdout, expected) {
	let parsed;
	try {
		parsed = JSON.parse(String(stdout).trim());
	} catch {
		throw new Error('Output d1 info bukan JSON valid');
	}
	const info = findInfoObject(parsed);
	if (!info) throw new Error('Identitas D1 tidak ditemukan pada d1 info');
	if (info.name !== expected.name || info.id !== expected.id || info.version !== 'production') {
		throw new Error(`Identitas D1 ${expected.binding} tidak cocok dengan production config`);
	}
	return info;
}

async function hashFile(path, fs = {}) {
	const pathReadFile = fs.readFile ?? readFile;
	const contents = await pathReadFile(path);
	return createHash('sha256').update(contents).digest('hex');
}

async function fsyncFile(path, fs = {}) {
	const pathOpen = fs.open ?? open;
	const handle = await pathOpen(path, 'r+');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function atomicWriteJson(path, value, fs = {}) {
	const pathWriteFile = fs.writeFile ?? writeFile;
	const pathRename = fs.rename ?? rename;
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await pathWriteFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: 'utf8',
		mode: 0o600,
		flag: 'wx'
	});
	await fsyncFile(tempPath, fs);
	await pathRename(tempPath, path);
	await fsyncFile(path, fs);
	const pathReadFile = fs.readFile ?? readFile;
	const readback = JSON.parse(await pathReadFile(path, 'utf8'));
	if (JSON.stringify(readback) !== JSON.stringify(value))
		throw new Error('Readback manifest tidak cocok');
	return readback;
}

async function verifySqlFile(path, fs = {}) {
	const pathStat = fs.stat ?? stat;
	const pathReadFile = fs.readFile ?? readFile;
	const info = await pathStat(path);
	if (!info.isFile() || info.size <= 0)
		throw new Error('Export SQL wajib berupa file reguler nonempty');
	const prefix = (await pathReadFile(path, 'utf8')).slice(0, 4096);
	if (!SQL_PREFIX.test(prefix)) throw new Error('Export tidak dikenali sebagai SQL D1');
	return { bytes: info.size, sha256: await hashFile(path, fs) };
}

function exactManifestEntries(manifest) {
	if (!manifest || manifest.schema !== 'zatiaraspos-d1-backup-v1') {
		throw new Error('Schema manifest tidak dikenali');
	}
	if (!Array.isArray(manifest.shards) || manifest.shards.length !== 3) {
		throw new Error('Manifest wajib memiliki tepat tiga shard');
	}
	const bindings = manifest.shards.map((entry) => entry.binding);
	if (
		new Set(bindings).size !== 3 ||
		!EXPECTED_BINDINGS.every((binding) => bindings.includes(binding))
	) {
		throw new Error('Set shard manifest tidak cocok');
	}
	const files = manifest.shards.map((entry) => entry.file);
	if (new Set(files).size !== 3) throw new Error('Nama file manifest harus unik');
	return manifest.shards;
}

export async function verifyManifest(
	manifestPath,
	{ repoRoot = REPO_ROOT, workspaceRoot = WORKSPACE_ROOT, configText, fs = {} } = {}
) {
	const canonicalManifest = await canonicalizeExternalPath(manifestPath, {
		repoRoot,
		workspaceRoot,
		mustExist: true,
		fs
	});
	const pathReadFile = fs.readFile ?? readFile;
	const manifest = JSON.parse(await pathReadFile(canonicalManifest, 'utf8'));
	const shards = exactManifestEntries(manifest);
	const configured = validateD1Config(
		configText ?? (await pathReadFile(resolve(repoRoot, CONFIG_FILE), 'utf8'))
	);
	const byBinding = new Map(configured.map((entry) => [entry.binding, entry]));
	for (const entry of shards) {
		const expected = byBinding.get(entry.binding);
		if (
			!expected ||
			entry.name !== expected.name ||
			entry.database_id !== expected.id ||
			entry.version !== 'production' ||
			typeof entry.file !== 'string' ||
			entry.file !== entry.file.replaceAll('\\', '/') ||
			entry.file.includes('/') ||
			entry.file.includes('..') ||
			!entry.file.endsWith('.sql') ||
			!Number.isSafeInteger(entry.bytes) ||
			entry.bytes <= 0 ||
			!/^[0-9a-f]{64}$/.test(entry.sha256)
		) {
			throw new Error(`Entry manifest tidak valid: ${entry.binding}`);
		}
		const sqlPath = join(dirname(canonicalManifest), entry.file);
		const verified = await verifySqlFile(sqlPath, fs);
		if (verified.bytes !== entry.bytes || verified.sha256 !== entry.sha256) {
			throw new Error(`Hash/readback shard tidak cocok: ${entry.binding}`);
		}
	}
	return { manifestPath: canonicalManifest, shardCount: 3, verified: true };
}

export async function runBackup({
	outputDir,
	envFile,
	repoRoot = REPO_ROOT,
	workspaceRoot = WORKSPACE_ROOT,
	configText,
	runner = createRtkRunner(),
	processEnv = process.env,
	now = () => new Date(),
	uuid = () => randomUUID(),
	fs = {}
}) {
	const pathMkdir = fs.mkdir ?? mkdir;
	const pathRealpath = fs.realpath ?? realpath;
	const pathChmod = fs.chmod ?? chmod;
	const pathWriteFile = fs.writeFile ?? writeFile;
	const pathReadFile = fs.readFile ?? readFile;
	const canonicalTarget = await canonicalizeExternalPath(outputDir, {
		repoRoot,
		workspaceRoot,
		fs
	});
	const config = validateD1Config(
		configText ?? (await pathReadFile(resolve(repoRoot, CONFIG_FILE), 'utf8'))
	);
	const secrets = await loadAllowlistedEnv(envFile, BACKUP_ENV_KEYS, { processEnv });
	const childEnv = buildBackupChildEnv(secrets, processEnv);
	const safeTimestamp = now().toISOString().replace(/[:.]/g, '-');
	const runDir = join(canonicalTarget, `backup-${safeTimestamp}-${uuid()}`);
	let runCreated = false;
	try {
		await pathMkdir(canonicalTarget, { recursive: true, mode: 0o700 });
		const resolvedTarget = await pathRealpath(canonicalTarget);
		await canonicalizeExternalPath(resolvedTarget, {
			repoRoot,
			workspaceRoot,
			mustExist: true,
			fs
		});
		await pathChmod(canonicalTarget, 0o700).catch(() => undefined);
		await pathMkdir(runDir, { recursive: false, mode: 0o700 });
		runCreated = true;
		await pathChmod(runDir, 0o700).catch(() => undefined);
		const shards = [];
		for (const database of config) {
			const infoArgs = [
				'pnpm',
				'exec',
				'wrangler',
				'd1',
				'info',
				database.name,
				'--config',
				CONFIG_FILE,
				'--json'
			];
			const infoResult = await runner(infoArgs, { cwd: repoRoot, env: childEnv, secrets });
			const identity = parseAndVerifyInfo(infoResult.stdout, database);
			const file = `${database.binding.toLowerCase()}.sql`;
			const outputPath = join(runDir, file);
			await runner(
				[
					'pnpm',
					'exec',
					'wrangler',
					'd1',
					'export',
					database.name,
					'--config',
					CONFIG_FILE,
					'--remote',
					'--skip-confirmation',
					'--output',
					outputPath
				],
				{ cwd: repoRoot, env: childEnv, secrets }
			);
			const verified = await verifySqlFile(outputPath, fs);
			shards.push({
				binding: database.binding,
				name: database.name,
				database_id: database.id,
				version: identity.version,
				file,
				bytes: verified.bytes,
				sha256: verified.sha256,
				exported_at: now().toISOString()
			});
		}
		const manifest = {
			schema: 'zatiaraspos-d1-backup-v1',
			created_at: now().toISOString(),
			shards
		};
		exactManifestEntries(manifest);
		const manifestPath = join(runDir, 'manifest.sha256.json');
		await atomicWriteJson(manifestPath, manifest, fs);
		await verifyManifest(manifestPath, {
			repoRoot,
			workspaceRoot,
			configText: configText ?? (await pathReadFile(resolve(repoRoot, CONFIG_FILE), 'utf8')),
			fs
		});
		const completePath = join(runDir, 'COMPLETE');
		await pathWriteFile(completePath, 'verified\n', { mode: 0o600, flag: 'wx' });
		await fsyncFile(completePath, fs);
		return { runDir, manifestPath, shardCount: 3 };
	} catch (error) {
		if (runCreated) {
			const failed = {
				status: 'FAILED',
				failed_at: now().toISOString(),
				error: redactValues(error instanceof Error ? error.message : String(error), secrets).slice(
					0,
					500
				)
			};
			await atomicWriteJson(join(runDir, 'FAILED.json'), failed, fs).catch(() => undefined);
		}
		throw new Error(redactValues(error instanceof Error ? error.message : String(error), secrets));
	}
}

export async function main(argv = process.argv.slice(2)) {
	const args = parseArgs(argv);
	if (args.verifyManifest) {
		const result = await verifyManifest(args.verifyManifest);
		console.log(`PASS manifest verified: ${result.manifestPath} (${result.shardCount} shards)`);
		return;
	}
	const result = await runBackup({ outputDir: args.outputDir, envFile: args.envFile });
	console.log(`PASS backup complete: ${result.manifestPath} (${result.shardCount} shards)`);
}

const isCli =
	process.argv[1] &&
	normalizeForCompare(fileURLToPath(new URL(import.meta.url))) ===
		normalizeForCompare(resolve(process.argv[1]));
if (isCli) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
