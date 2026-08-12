import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import {
	canonicalizeExternalPath,
	CONFIG_FILE,
	loadAllowlistedEnv,
	parseAndVerifyInfo,
	REPO_ROOT,
	validateD1Config,
	WORKSPACE_ROOT
} from './d1-backup.mjs';
import { runUat } from './uat-live-realtime.mjs';

const MODULE_FILE = fileURLToPath(import.meta.url);
const ENV_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'];
const OS_ENV_KEYS = [
	'PATH',
	'PATHEXT',
	'SystemRoot',
	'TEMP',
	'TMP',
	'USERPROFILE',
	'APPDATA',
	'LOCALAPPDATA'
];
const GROUPS = [
	{
		binding: 'DB_SAMARINDA_GROUP',
		branches: ['samarinda', 'samarinda2']
	},
	{
		binding: 'DB_BALIKPAPAN_GROUP',
		branches: ['balikpapan', 'balikpapan2']
	},
	{
		binding: 'DB_BERAU_GROUP',
		branches: ['berau']
	}
];
const ROLES = ['kasir', 'pemilik'];

function parseArgs(argv) {
	const options = {
		live: false,
		envFile: null,
		outputDir: null,
		baseUrl: null,
		uatBranch: null,
		journalDir: null
	};
	const valued = new Set([
		'--env-file',
		'--output-dir',
		'--base-url',
		'--uat-branch',
		'--journal-dir'
	]);
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--' && index === 0) continue;
		if (arg === '--live') options.live = true;
		else if (valued.has(arg)) {
			const value = argv[index + 1];
			if (!value || value.startsWith('--')) throw new Error(`Nilai ${arg} wajib diisi`);
			index += 1;
			if (arg === '--env-file') options.envFile = value;
			if (arg === '--output-dir') options.outputDir = value;
			if (arg === '--base-url') options.baseUrl = value;
			if (arg === '--uat-branch') options.uatBranch = value;
			if (arg === '--journal-dir') options.journalDir = value;
		} else throw new Error(`Argumen tidak diizinkan: ${arg}`);
	}
	if (!options.live) throw new Error('Rotasi production memerlukan --live');
	if (!options.outputDir) throw new Error('--output-dir absolut di luar workspace wajib diisi');
	if (options.uatBranch && !GROUPS.some((group) => group.branches.includes(options.uatBranch))) {
		throw new Error('--uat-branch tidak termasuk allowlist');
	}
	if (options.uatBranch && (!options.baseUrl || !options.journalDir)) {
		throw new Error('--uat-branch memerlukan --base-url dan --journal-dir');
	}
	if (options.baseUrl && new URL(options.baseUrl).protocol !== 'https:') {
		throw new Error('--base-url production wajib HTTPS');
	}
	return options;
}

function childEnv(secrets, processEnv = process.env) {
	const env = {};
	for (const key of OS_ENV_KEYS) {
		if (typeof processEnv[key] === 'string' && processEnv[key]) env[key] = processEnv[key];
	}
	for (const key of ENV_KEYS) {
		if (typeof secrets[key] === 'string' && secrets[key]) env[key] = secrets[key];
	}
	return env;
}

function strongPassword() {
	return `Z7a!${randomBytes(21).toString('base64url')}`;
}

function sqlLiteral(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function runWranglerExecute(databaseName, sqlFile, env) {
	const result = spawnSync(
		'rtk',
		[
			'pnpm',
			'exec',
			'wrangler',
			'd1',
			'execute',
			databaseName,
			'--remote',
			'--config',
			'wrangler.pages.jsonc',
			'--file',
			sqlFile
		],
		{
			cwd: REPO_ROOT,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			maxBuffer: 1024 * 1024
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`Rotasi D1 gagal untuk ${databaseName}: exit ${result.status}`);
	}
}

function verifyWranglerDatabase(database, env) {
	const result = spawnSync(
		'rtk',
		['pnpm', 'exec', 'wrangler', 'd1', 'info', database.name, '--config', CONFIG_FILE, '--json'],
		{
			cwd: REPO_ROOT,
			env,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			maxBuffer: 1024 * 1024
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Verifikasi D1 gagal untuk ${database.name}`);
	parseAndVerifyInfo(result.stdout, database);
}

function getSetCookies(headers) {
	if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
	const cookie = headers.get('set-cookie');
	return cookie ? [cookie] : [];
}

function cookiePair(cookies, name) {
	const cookie = cookies.find((item) => item.startsWith(`${name}=`));
	return cookie ? cookie.split(';')[0] : '';
}

async function validateLogin(baseUrl, credential) {
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`);
	if (!csrfResponse.ok) throw new Error(`Validasi CSRF gagal untuk ${credential.branch}`);
	const csrf = await csrfResponse.json();
	const csrfCookie = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
	if (typeof csrf?.token !== 'string' || !csrfCookie) throw new Error('Respons CSRF tidak valid');
	const loginResponse = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-CSRF-Token': csrf.token,
			Cookie: csrfCookie
		},
		body: JSON.stringify({
			branch: credential.branch,
			username: credential.username,
			password: credential.password
		})
	});
	const payload = await loginResponse.json().catch(() => null);
	if (!loginResponse.ok || !payload?.success || payload?.user?.role !== credential.role) {
		throw new Error(`Validasi login gagal untuk ${credential.branch}/${credential.role}`);
	}
	const sid = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');
	if (!sid) throw new Error(`Session validasi tidak tersedia untuk ${credential.branch}`);
	const logoutResponse = await fetch(`${baseUrl}/api/logout`, {
		method: 'POST',
		headers: {
			Cookie: `${csrfCookie}; ${sid}`,
			'X-CSRF-Token': csrf.token
		}
	});
	if (!logoutResponse.ok) throw new Error(`Logout validasi gagal untuk ${credential.branch}`);
}

function protectWithDpapi(plaintext, env) {
	if (process.platform !== 'win32')
		throw new Error('Handoff terenkripsi saat ini wajib Windows DPAPI');
	const script =
		'$plain=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString $plain -AsPlainText -Force; ConvertFrom-SecureString $secure';
	const result = spawnSync('rtk', ['powershell', '-NoProfile', '-Command', script], {
		input: plaintext,
		env,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
		maxBuffer: 1024 * 1024
	});
	if (result.error) throw result.error;
	if (result.status !== 0 || !result.stdout.trim()) throw new Error('Enkripsi DPAPI gagal');
	return result.stdout.trim();
}

export async function rotateProductionCredentials(options, processEnv = process.env) {
	const secrets = await loadAllowlistedEnv(options.envFile, ENV_KEYS, { processEnv });
	for (const key of ENV_KEYS) if (!secrets[key]) throw new Error(`${key} wajib diisi`);
	const outputDir = await canonicalizeExternalPath(options.outputDir, {
		repoRoot: REPO_ROOT,
		workspaceRoot: WORKSPACE_ROOT
	});
	await mkdir(outputDir, { recursive: true, mode: 0o700 });
	await chmod(outputDir, 0o700).catch(() => undefined);
	const databases = validateD1Config(await readFile(resolve(REPO_ROOT, CONFIG_FILE), 'utf8'));
	const credentials = [];
	for (const group of GROUPS) {
		for (const branch of group.branches) {
			for (const role of ROLES) {
				credentials.push({
					branch,
					role,
					username: role,
					password: strongPassword(),
					binding: group.binding
				});
			}
		}
	}
	if (new Set(credentials.map((item) => item.password)).size !== credentials.length) {
		throw new Error('Generator menghasilkan password duplikat');
	}
	for (const credential of credentials) {
		credential.passwordHash = await bcrypt.hash(credential.password, 12);
	}
	if (new Set(credentials.map((item) => item.passwordHash)).size !== credentials.length) {
		throw new Error('Hash kredensial tidak unik');
	}
	const handoff = {
		created_at: new Date().toISOString(),
		purpose: 'ZatiarasPOS production application credentials',
		accounts: credentials.map(({ branch, role, username, password }) => ({
			branch,
			role,
			username,
			password
		}))
	};
	const encrypted = protectWithDpapi(JSON.stringify(handoff), childEnv({}, processEnv));
	const handoffPath = join(outputDir, `credentials-${Date.now()}.dpapi`);
	await writeFile(handoffPath, `${encrypted}\n`, { mode: 0o600, flag: 'wx' });

	const tempDir = await mkdtemp(join(outputDir, 'rotation-sql-'));
	await chmod(tempDir, 0o700).catch(() => undefined);
	try {
		for (const group of GROUPS) {
			const database = databases.find((item) => item.binding === group.binding);
			if (!database) throw new Error(`Database ${group.binding} tidak ditemukan`);
			verifyWranglerDatabase(database, childEnv(secrets, processEnv));
			const groupCredentials = credentials.filter((item) => item.binding === group.binding);
			const statements = groupCredentials.map(
				(item) =>
					`UPDATE profil SET password = ${sqlLiteral(item.passwordHash)}, updated_at = ${sqlLiteral(new Date().toISOString())} WHERE cabang_id = ${sqlLiteral(item.branch)} AND role = ${sqlLiteral(item.role)} AND username = ${sqlLiteral(item.username)};`
			);
			statements.push('DELETE FROM auth_sessions;');
			const sqlFile = join(tempDir, `${group.binding}.sql`);
			await writeFile(sqlFile, `${statements.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
			runWranglerExecute(database.name, sqlFile, childEnv(secrets, processEnv));
		}

		for (const credential of credentials) {
			await validateLogin(options.baseUrl, credential);
		}

		if (options.uatBranch) {
			const cashier = credentials.find(
				(item) => item.branch === options.uatBranch && item.role === 'kasir'
			);
			const owner = credentials.find(
				(item) => item.branch === options.uatBranch && item.role === 'pemilik'
			);
			await runUat(
				{
					live: true,
					baseUrl: options.baseUrl,
					branch: options.uatBranch,
					envFile: null,
					journalDir: options.journalDir,
					cleanupOnly: false
				},
				{
					processEnv: {
						...processEnv,
						...secrets,
						UAT_KASIR_USERNAME: cashier.username,
						UAT_KASIR_PASSWORD: cashier.password,
						UAT_OWNER_USERNAME: owner.username,
						UAT_OWNER_PASSWORD: owner.password
					}
				}
			);
		}

		return {
			handoffPath,
			accountCount: credentials.length,
			uniquePasswordCount: new Set(credentials.map((item) => item.password)).size,
			uatBranch: options.uatBranch
		};
	} finally {
		const safeTemp = await canonicalizeExternalPath(tempDir, {
			repoRoot: REPO_ROOT,
			workspaceRoot: WORKSPACE_ROOT,
			mustExist: true
		}).catch(() => null);
		if (safeTemp && safeTemp.startsWith(outputDir)) {
			await rm(safeTemp, { recursive: true, force: true });
		}
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (!options.baseUrl) throw new Error('--base-url wajib diisi untuk validasi seluruh akun');
	const result = await rotateProductionCredentials(options);
	console.log(
		`PASS rotasi ${result.accountCount} akun; password unik ${result.uniquePasswordCount}; handoff ${result.handoffPath}`
	);
}

if (resolve(process.argv[1] || '') === resolve(MODULE_FILE)) {
	main().catch((error) => {
		console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
