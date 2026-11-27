import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';
import { compareArchiveVersion } from './archive-object-version.mjs';

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
const bucket = storage.r2_buckets[0].bucket_name;
assert.equal(bucket, 'zpos-shared-assets-staging');
const storageToken = process.env.BRANCH_CF_TOKEN_SAMARINDA;
assert.ok(storageToken);
const objectsUrl = `https://api.cloudflare.com/client/v4/accounts/${storage.account_id}/r2/buckets/${bucket}/objects`;
function stagingObjects(suffix, method = 'GET') {
	return fetch(objectsUrl + suffix, {
		method,
		headers: { authorization: `Bearer ${storageToken}` },
		redirect: 'error',
		signal: AbortSignal.timeout(12_000)
	});
}
async function stagingArchiveMetadata(key) {
	assert.match(key, /^arsip\/(samarinda|balikpapan|berau)\//);
	const response = await stagingObjects(`?${new URLSearchParams({ prefix: key, per_page: '10' })}`);
	const data = await response.json();
	assert.ok(
		response.ok && data.success && Array.isArray(data.result) && !data.result_info?.is_truncated,
		'Metadata arsip staging belum terverifikasi'
	);
	const actual = data.result.filter((object) => object.key === key);
	assert.ok(actual.length <= 1);
	if (!actual.length) return null;
	const { size, etag, last_modified: lastModified } = actual[0];
	assert.ok(
		Number.isSafeInteger(size) &&
			size > 0 &&
			typeof etag === 'string' &&
			etag &&
			typeof lastModified === 'string' &&
			Number.isFinite(Date.parse(lastModified))
	);
	return { key, size, etag, lastModified };
}

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

async function smokeArchiveCreateOnly() {
	const master = process.env.BRANCH_STAGING_KEY;
	assert.ok(master && master.length >= 32, 'Kunci relay staging tidak tersedia');
	assert.equal(storage.name, 'zpos-storage-staging');
	const relay = new URL(origin);
	assert.match(relay.hostname, /^zpos-gateway-staging\.[a-z0-9-]+\.workers\.dev$/);
	relay.hostname = relay.hostname.replace(/^zpos-gateway-staging\./, 'zpos-storage-staging.');
	relay.pathname = '/object';
	const id = randomUUID();
	const key = `arsip/samarinda/2020/arsip-samarinda-sebelum-2020-${id.slice(0, 8)}.json`;
	relay.searchParams.set('key', key);
	const secret = createHmac('sha256', master).update('storage:samarinda').digest('hex');
	const content = (version) => JSON.stringify({ fixture: id, version });
	async function send(method, body) {
		const response = await fetch(relay, {
			method,
			body,
			headers: { 'x-storage-secret': secret, 'content-type': 'application/json' },
			redirect: 'error',
			signal: AbortSignal.timeout(12_000)
		});
		return { status: response.status, body: await response.text() };
	}
	assert.equal(await stagingArchiveMetadata(key), null);
	try {
		const first = await Promise.allSettled([send('PUT', content(1)), send('PUT', content(2))]);
		const statuses = first.map((result) =>
			result.status === 'fulfilled' ? result.value.status : 0
		);
		assert.deepEqual([...statuses].sort(), [204, 412]);
		const winner = content(statuses.indexOf(204) + 1);
		const before = await stagingArchiveMetadata(key);
		assert.ok(before);
		const [overwrite, deletion] = await Promise.all([send('PUT', content(3)), send('DELETE')]);
		assert.equal(overwrite.status, 412);
		assert.equal(deletion.status, 403);
		assert.deepEqual(await send('GET'), { status: 200, body: winner });
		assert.deepEqual(await stagingArchiveMetadata(key), before);
		console.log(
			'R2 staging: satu pembuat menang; overwrite dan hapus ditolak; byte dan metadata tetap.'
		);
	} finally {
		if (await stagingArchiveMetadata(key)) {
			const target = `/${encodeURIComponent(key)}`;
			const readback = await stagingObjects(target);
			assert.ok(
				readback.ok && [content(1), content(2), content(3)].includes(await readback.text()),
				'Cleanup menolak objek yang bukan fixture'
			);
			const cleanup = await stagingObjects(target, 'DELETE');
			await cleanup.body?.cancel();
			assert.ok(cleanup.ok);
		}
		assert.equal(await stagingArchiveMetadata(key), null);
	}
}

await smokeArchiveCreateOnly();

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
		const downloadPath = `/api/archive/download?${new URLSearchParams({ job_id: result.job_id })}`;
		const download = await owner(downloadPath);
		assert.equal(download.status, 200);
		const bytes = Buffer.from(await download.arrayBuffer());
		assert.equal(
			createHash('sha256').update(bytes).digest('hex'),
			download.headers.get('x-archive-sha256')
		);
		assert.equal(JSON.parse(bytes.toString('utf8')).buku_kas[0]?.id, id);
		const captured = await stagingArchiveMetadata(result.key);
		assert.ok(captured && captured.size === bytes.length);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const reader = {
			metadata: stagingArchiveMetadata,
			async read(key, size) {
				assert.equal(key, result.key);
				assert.equal(size, bytes.length);
				const response = await owner(downloadPath);
				if (response.status === 404) return null;
				assert.equal(response.status, 200);
				return new Uint8Array(await response.arrayBuffer());
			}
		};
		assert.equal(await compareArchiveVersion({ ...captured, sha256 }, reader), 'matched');
		assert.equal(
			await compareArchiveVersion({ ...captured, sha256: '0'.repeat(64) }, reader),
			'changed'
		);
		console.log(
			`${branch}: salinan cocok dengan versi dan byte objek R2 staging; checksum yang berbeda ditolak`
		);
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
