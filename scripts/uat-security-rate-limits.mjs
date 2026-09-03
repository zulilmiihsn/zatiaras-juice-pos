import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const localTarget =
	baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost');
const username = process.env.UAT_USERNAME || 'pemilik';
const localEnvPassword =
	!process.env.UAT_PASSWORD && localTarget && existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: undefined;
const password = process.env.UAT_PASSWORD || localEnvPassword;

if (!localTarget && process.env.ALLOW_REMOTE_UAT !== '1') {
	throw new Error('UAT rate-limit hanya boleh ke localhost kecuali ALLOW_REMOTE_UAT=1');
}
if (!password) {
	throw new Error('UAT_PASSWORD wajib diisi melalui environment');
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
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

function sqlValue(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function resetLocalSecurityRateLimits() {
	const sqlFile = join(tmpdir(), `zatiaras-rate-limit-reset-${randomUUID()}.sql`);
	writeFileSync(
		sqlFile,
		`DELETE FROM rate_limits
		 WHERE cabang_id = ${sqlValue(branch)}
		   AND (identifier LIKE 'security:%' OR identifier LIKE 'aichat:user:%');\n`,
		'utf8'
	);
	try {
		const result = spawnSync(
			'npx',
			[
				'wrangler',
				'd1',
				'execute',
				'DB_SAMARINDA_GROUP',
				'--local',
				'--config=wrangler.pages.jsonc',
				`--file=${sqlFile}`,
				'--yes'
			],
			{ encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' }
		);
		assert(
			result.status === 0,
			`Reset rate limit D1 lokal gagal: ${String(
				result.error?.message || result.stderr || result.stdout || ''
			).trim()}`
		);
	} finally {
		rmSync(sqlFile, { force: true });
	}
}

async function waitForServer() {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		try {
			const response = await fetch(`${baseUrl}/login`);
			if (response.ok) return;
		} catch {
			// Miniflare dapat restart setelah D1 lokal ditulis langsung.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('Server lokal tidak pulih setelah reset rate limit');
}

async function login() {
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`);
	assert(csrfResponse.ok, `CSRF gagal: ${csrfResponse.status}`);
	const csrfPayload = await csrfResponse.json();
	const csrfCookie = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
	assert(csrfPayload.token && csrfCookie, 'CSRF token/cookie tidak tersedia');

	const loginResponse = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-CSRF-Token': csrfPayload.token,
			Cookie: csrfCookie
		},
		body: JSON.stringify({ username, password, branch })
	});
	const loginPayload = await loginResponse.json().catch(() => null);
	assert(
		loginResponse.ok && loginPayload?.success,
		`Login gagal: ${loginResponse.status} ${JSON.stringify(loginPayload)}`
	);

	const sidCookie = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');
	assert(sidCookie, 'Session cookie tidak tersedia');
	return {
		csrfToken: csrfPayload.token,
		cookie: `${csrfCookie}; ${sidCookie}`
	};
}

async function post(path, auth, body) {
	const response = await fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-CSRF-Token': auth.csrfToken,
			Cookie: auth.cookie
		},
		body: JSON.stringify(body)
	});
	return {
		status: response.status,
		payload: await response.json().catch(() => null)
	};
}

async function verifySecurityLimit(auth) {
	const statuses = [];
	const missingUsername = `uat-rate-limit-missing-${Date.now()}`;
	for (let index = 0; index < 4; index += 1) {
		const result = await post('/api/gantikeamanan', auth, {
			usernameLama: missingUsername,
			usernameBaru: 'uat-rate-limit-unused',
			passwordLama: 'TidakDipakai123',
			passwordBaru: 'ValidTidakDipakai123',
			branch,
			targetRole: 'pemilik'
		});
		statuses.push(result.status);
	}
	assert(
		statuses.slice(0, 3).every((status) => status === 404),
		`Ganti keamanan sebelum limit harus 404, dapat ${statuses.join(',')}`
	);
	assert(statuses[3] === 429, `Ganti keamanan request ke-4 harus 429, dapat ${statuses[3]}`);
	return statuses;
}

async function verifyAiLimit(auth) {
	const statuses = [];
	for (let index = 0; index < 31; index += 1) {
		const result = await post('/api/aichat?action=analyze', auth, {});
		statuses.push(result.status);
	}
	assert(
		statuses.slice(0, 30).every((status) => status === 400),
		`AI chat sebelum limit harus 400, dapat ${statuses.join(',')}`
	);
	assert(statuses[30] === 429, `AI chat request ke-31 harus 429, dapat ${statuses[30]}`);
	return statuses;
}

if (localTarget) {
	resetLocalSecurityRateLimits();
	await waitForServer();
}

const auth = await login();
const securityStatuses = await verifySecurityLimit(auth);
const aiStatuses = await verifyAiLimit(auth);

console.log(
	JSON.stringify({
		ok: true,
		baseUrl,
		branch,
		gantikeamanan: securityStatuses,
		aichat: {
			preLimitStatus: aiStatuses[0],
			limitedStatus: aiStatuses.at(-1),
			requests: aiStatuses.length
		}
	})
);
