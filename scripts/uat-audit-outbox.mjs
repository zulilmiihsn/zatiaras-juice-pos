import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const localTarget =
	baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost');
const localPassword =
	localTarget && existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: undefined;
const password = process.env.UAT_PASSWORD || localPassword;

if (!localTarget) throw new Error('UAT audit outbox hanya boleh ke localhost');
if (!password) throw new Error('UAT_PASSWORD wajib diisi melalui environment');

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function sqlValue(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function runD1(args) {
	const result = spawnSync(
		'pnpm',
		[
			'exec',
			'wrangler',
			'd1',
			'execute',
			'DB_SAMARINDA_GROUP',
			'--local',
			'--config=wrangler.pages.jsonc',
			...args
		],
		{ encoding: 'utf8', shell: process.platform === 'win32' }
	);
	assert(result.status === 0, `D1 lokal gagal: ${String(result.stderr || result.stdout).trim()}`);
	return result.stdout;
}

function executeSql(sql) {
	const sqlFile = join(tmpdir(), `zatiaras-audit-${randomUUID()}.sql`);
	writeFileSync(sqlFile, `${sql};\n`, 'utf8');
	try {
		runD1([`--file=${sqlFile}`, '--yes']);
	} finally {
		rmSync(sqlFile, { force: true });
	}
}

function querySql(sql) {
	const output = runD1(['--command', sql, '--json']);
	const parsed = JSON.parse(output);
	const result = Array.isArray(parsed) ? parsed[0] : parsed;
	return result?.results || result?.result?.[0]?.results || [];
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

async function login() {
	const response = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'pemilik', password, branch })
	});
	const payload = await response.json().catch(() => null);
	assert(response.ok && payload?.success, `Login gagal: ${response.status}`);
	const sid = cookiePair(getSetCookies(response.headers), 'zatiaras_sid');
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`, { headers: { Cookie: sid } });
	const csrfPayload = await csrfResponse.json().catch(() => null);
	assert(csrfResponse.ok && csrfPayload?.token, `CSRF gagal: ${csrfResponse.status}`);
	const csrf = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
	return { csrfToken: csrfPayload.token, cookie: `${sid}; ${csrf}` };
}

async function main() {
	const auth = await login();
	const categoryId = `uat-audit-outbox-${randomUUID()}`;
	const backupTable = `audit_logs_uat_${randomUUID().replaceAll('-', '')}`;
	let renamed = false;
	try {
		executeSql(`DELETE FROM audit_log_outbox WHERE cabang_id = ${sqlValue(branch)}`);
		executeSql(`ALTER TABLE audit_logs RENAME TO ${backupTable}`);
		renamed = true;

		const mutation = await fetch(`${baseUrl}/api/kategori`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-CSRF-Token': auth.csrfToken,
				Cookie: auth.cookie
			},
			body: JSON.stringify({ payload: { id: categoryId, nama: 'UAT Audit Outbox' } })
		});
		assert(mutation.ok, `Mutasi UAT gagal: ${mutation.status}`);

		const pending = querySql(
			`SELECT id, cabang_id, payload FROM audit_log_outbox WHERE cabang_id = ${sqlValue(branch)} AND payload LIKE '%${categoryId}%' LIMIT 1`
		);
		assert(pending.length === 1, 'Audit event tidak masuk outbox saat audit_logs unavailable');

		executeSql(`ALTER TABLE ${backupTable} RENAME TO audit_logs`);
		renamed = false;
		executeSql(
			`INSERT OR IGNORE INTO audit_logs (id, cabang_id, actor_user_id, actor_username, actor_role, action, entity_type, entity_id, transaction_id, amount, metadata, ip_hash, created_at)
		 SELECT id, cabang_id,
		 json_extract(payload, '$.session.userId'), json_extract(payload, '$.session.username'), json_extract(payload, '$.session.role'),
		 json_extract(payload, '$.action'), json_extract(payload, '$.entityType'), json_extract(payload, '$.entityId'), json_extract(payload, '$.transactionId'),
		 json_extract(payload, '$.amount'), json_extract(payload, '$.metadata'), json_extract(payload, '$.ipHash'), created_at
		 FROM audit_log_outbox WHERE cabang_id = ${sqlValue(branch)} AND payload LIKE '%${categoryId}%'
		; DELETE FROM audit_log_outbox WHERE cabang_id = ${sqlValue(branch)} AND payload LIKE '%${categoryId}%'`
		);

		const restored = querySql(
			`SELECT id FROM audit_logs WHERE cabang_id = ${sqlValue(branch)} AND entity_id = ${sqlValue(categoryId)} LIMIT 1`
		);
		assert(restored.length === 1, 'Audit event tidak berhasil dipulihkan dari outbox');
		console.log('audit-outbox UAT passed: durable failure capture and recovery');
	} finally {
		if (renamed) executeSql(`ALTER TABLE ${backupTable} RENAME TO audit_logs`);
		executeSql(
			`DELETE FROM kategori WHERE cabang_id = ${sqlValue(branch)} AND id = ${sqlValue(categoryId)}`
		);
		executeSql(
			`DELETE FROM audit_logs WHERE cabang_id = ${sqlValue(branch)} AND entity_id = ${sqlValue(categoryId)}`
		);
	}
}

await main();
