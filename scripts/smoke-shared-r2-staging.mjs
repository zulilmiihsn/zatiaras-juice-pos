import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REF, 'refs/heads/release/branch-account-staging');
const { gateway, backends, storage } = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
assert.ok(storage, 'R2 bersama staging belum dikonfigurasi');
assert.equal(gateway.name, 'zpos-gateway-staging');
const origin = gateway.vars.BRANCH_PUBLIC_ORIGIN;
const production = await readFile('wrangler.pages.jsonc', 'utf8');
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
	'base64'
);
const day = new Date(Date.UTC(2020, 0, 1 + randomInt(0, 366))).toISOString().slice(0, 10);

function d1Client(branch, config) {
	const [db] = config.d1_databases;
	assert.equal(db.database_name, `zpos-${branch}-staging`);
	assert.ok(!production.includes(db.database_id));
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token ${branch} tidak tersedia`);
	const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${db.database_id}`;
	const call = async (suffix, body) => {
		const response = await fetch(endpoint + suffix, {
			method: body ? 'POST' : 'GET',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: body && JSON.stringify(body),
			signal: AbortSignal.timeout(12_000)
		});
		const result = await response.json();
		if (!response.ok || !result.success)
			throw Error(
				`${branch}: D1 HTTP ${response.status}; kode ${result.errors?.map((x) => x.code).join(',') || '-'}`
			);
		return result.result;
	};
	return {
		async assertIdentity() {
			const target = await call('');
			assert.equal(target.name, db.database_name);
			assert.equal(target.uuid, db.database_id);
		},
		async query(sql, params) {
			const [result] = await call('/query', { sql, params });
			assert.equal(result.success, true);
			return result.results;
		}
	};
}

function browser() {
	const cookies = new Map();
	return async (path, init = {}) => {
		const headers = new Headers(init.headers);
		if (init.method) headers.set('origin', origin);
		headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
		const response = await fetch(origin + path, {
			...init,
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(15_000)
		});
		for (const value of response.headers.getSetCookie()) {
			const pair = value.split(';', 1)[0];
			const i = pair.indexOf('=');
			cookies.set(pair.slice(0, i), pair.slice(i + 1));
		}
		return response;
	};
}

let previousJob;
for (const [branch, config] of Object.entries(backends)) {
	const db = d1Client(branch, config);
	await db.assertIdentity();
	const [before] = await db.query(
		`SELECT (SELECT COUNT(*) FROM buku_kas WHERE cabang_id=? AND date(datetime(waktu, '+8 hours'))=?) AS rows,
		(SELECT COUNT(*) FROM sesi_toko WHERE cabang_id=? AND is_active=1) AS shifts,
		(SELECT COUNT(*) FROM archive_jobs WHERE cabang_id=? AND json_valid(counts) AND json_extract(counts, '$.range.from')=?) AS jobs`,
		[branch, day, branch, branch, day]
	);
	assert.ok(
		before.rows === 0 && before.shifts === 0 && before.jobs === 0,
		`${branch}: rentang sintetis atau shift tidak aman`
	);
	const id = `r2-smoke-${randomUUID()}`;
	const password = randomBytes(24).toString('hex');
	const owner = browser();
	const csrf = async () => {
		const response = await owner('/api/csrf');
		assert.equal(response.status, 200);
		return (await response.json()).token;
	};
	let key, token;
	try {
		await db.query('INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,?,?,?)', [
			id,
			branch,
			id,
			await bcrypt.hash(password, 10),
			'pemilik'
		]);
		const login = await owner('/api/veriflogin', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-csrf-token': await csrf() },
			body: JSON.stringify({ branch, username: id, password })
		});
		assert.equal(login.status, 200, `${branch}: login smoke gagal`);
		await login.body?.cancel();
		token = await csrf();
		const form = new FormData();
		form.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
		const upload = await owner('/api/upload', {
			method: 'POST',
			headers: { 'x-csrf-token': token },
			body: form
		});
		assert.equal(upload.status, 200, `${branch}: upload smoke gagal`);
		({ key } = await upload.json());
		assert.match(key, new RegExp(`^produk/${branch}/[0-9a-f-]+\\.png$`));
		const image = await browser()(`/api/upload?${new URLSearchParams({ key })}`);
		assert.equal(image.status, 200);
		assert.equal(image.headers.get('content-type'), 'image/png');
		assert.ok(Buffer.from(await image.arrayBuffer()).equals(png));

		await db.query(
			"INSERT INTO buku_kas(id,cabang_id,waktu,sumber,tipe,nominal,jenis) VALUES(?,?,?,'manual','pemasukan',3000,'usaha')",
			[id, branch, `${day}T02:00:00Z`]
		);
		const archive = await owner('/api/archive', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-csrf-token': token },
			body: JSON.stringify({ from: day, through: day })
		});
		assert.equal(archive.status, 200, `${branch}: arsip smoke gagal`);
		const result = await archive.json();
		assert.equal(result.count, 1);
		assert.match(result.key, new RegExp(`^arsip/${branch}/`));
		assert.ok(result.job_id);
		const download = await owner(
			`/api/archive/download?${new URLSearchParams({ job_id: result.job_id })}`
		);
		assert.equal(download.status, 200);
		const bytes = Buffer.from(await download.arrayBuffer());
		assert.equal(
			createHash('sha256').update(bytes).digest('hex'),
			download.headers.get('x-archive-sha256')
		);
		assert.equal(JSON.parse(bytes.toString('utf8')).buku_kas[0]?.id, id);
		assert.deepEqual(
			await db.query('SELECT id FROM buku_kas WHERE cabang_id=? AND id=?', [branch, id]),
			[]
		);
		if (previousJob) {
			const foreign = await owner(
				`/api/archive/download?${new URLSearchParams({ job_id: previousJob })}`
			);
			assert.equal(foreign.status, 404);
			await foreign.body?.cancel();
		}
		previousJob = result.job_id;
		console.log(`${branch}: gambar publik, arsip dan hash readback R2 bersama lulus`);
	} finally {
		try {
			if (token && typeof key === 'string' && key.startsWith(`produk/${branch}/`)) {
				const cleanup = await owner('/api/upload', {
					method: 'DELETE',
					headers: { 'content-type': 'application/json', 'x-csrf-token': token },
					body: JSON.stringify({ key })
				});
				assert.equal(cleanup.status, 200, `${branch}: bersihkan gambar sintetis gagal`);
				await cleanup.body?.cancel();
			}
		} finally {
			await db.query('DELETE FROM profil WHERE cabang_id=? AND id=? AND username=?', [
				branch,
				id,
				id
			]);
		}
	}
}
