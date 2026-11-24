import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import bcrypt from 'bcryptjs';
import { buildBranchStagingConfigs } from './branch-account-staging-config.mjs';

if (
	process.env.GITHUB_ACTIONS !== 'true' ||
	process.env.GITHUB_REF !== 'refs/heads/release/branch-account-staging' ||
	!process.env.RUNNER_TEMP
)
	throw new Error('Smoke hanya boleh dijalankan oleh workflow staging lintas akun');

const marker = join(process.env.RUNNER_TEMP, 'zpos-restore-berau');
const configs = buildBranchStagingConfigs({
	...JSON.parse(process.env.BRANCH_STAGING_INVENTORY ?? '{}'),
	main: 'unused',
	storageMain: 'unused',
	publicAssets: 'unused'
});
const { samarinda, berau } = configs.backends;
const [db] = samarinda.d1_databases;
assert.equal(samarinda.name, 'zpos-samarinda-staging');
assert.equal(berau.name, 'zpos-berau-staging');
assert.equal(configs.gateway.name, 'zpos-gateway-staging');
assert.ok(!(await readFile('wrangler.pages.jsonc', 'utf8')).includes(db.database_id));
const gateway = configs.gateway.vars.BRANCH_PUBLIC_ORIGIN;

async function cloudflare(branch, path, body) {
	const token = process.env[`BRANCH_CF_TOKEN_${branch.toUpperCase()}`];
	assert.ok(token, `Token ${branch} tidak tersedia`);
	const account = configs.backends[branch].account_id;
	const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
		method: body ? 'POST' : 'GET',
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body && JSON.stringify(body),
		signal: AbortSignal.timeout(12_000)
	});
	const data = await response.json();
	if (!response.ok || !data.success)
		throw new Error(
			`${branch}: Cloudflare HTTP ${response.status}; kode ${data.errors?.map((e) => e.code).join(',') ?? '-'}`
		);
	return data.result;
}

const databasePath = `d1/database/${db.database_id}`;
async function query(sql, params = []) {
	const [result] = await cloudflare('samarinda', `${databasePath}/query`, { sql, params });
	assert.equal(result.success, true, 'Query smoke gagal');
	return result.results;
}

const subdomainPath = `workers/scripts/${berau.name}/subdomain`;
const getBerau = () => cloudflare('berau', subdomainPath);
const setBerau = (enabled) =>
	cloudflare('berau', subdomainPath, { enabled, previews_enabled: false });

function browser() {
	const cookies = new Map();
	return async (path, init = {}) => {
		const headers = new Headers(init.headers);
		if (init.method) headers.set('origin', gateway);
		headers.set('cookie', [...cookies].map(([key, value]) => `${key}=${value}`).join('; '));
		const response = await fetch(gateway + path, {
			...init,
			headers,
			redirect: 'manual',
			signal: AbortSignal.timeout(12_000)
		});
		for (const header of response.headers.getSetCookie()) {
			const pair = header.split(';', 1)[0];
			const i = pair.indexOf('=');
			cookies.set(pair.slice(0, i), pair.slice(i + 1));
		}
		return response;
	};
}
async function login(call, branch, username, password) {
	const csrf = await call('/api/csrf');
	assert.equal(csrf.status, 200);
	const { token } = await csrf.json();
	return call('/api/veriflogin', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-csrf-token': token },
		body: JSON.stringify({ branch, username, password })
	});
}
async function probeBerau() {
	const response = await login(browser(), 'berau', `smoke-${randomUUID()}`, 'invalid');
	const result = await response.text();
	return {
		status: response.status,
		healthy: response.status === 401 && result.includes('INVALID_CREDENTIALS')
	};
}
async function restoreBerau() {
	try {
		await readFile(marker);
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	await setBerau(true);
	for (let n = 0; n < 3; n++) {
		await sleep(4000);
		if ((await getBerau()).enabled === true && (await probeBerau()).healthy) {
			await rm(marker);
			console.log('Berau staging aktif dan autentikasi merespons kembali');
			return;
		}
	}
	throw new Error('Pemulihan Berau belum terverifikasi');
}

async function smoke() {
	const identity = await cloudflare('samarinda', databasePath);
	assert.equal(identity.name, 'zpos-samarinda-staging');
	assert.equal(identity.uuid, db.database_id);
	assert.equal(
		(
			await query('SELECT COUNT(*) AS n FROM sesi_toko WHERE cabang_id=? AND is_active=1', [
				'samarinda'
			])
		)[0].n,
		0
	);
	const [product] = await query(
		'SELECT id,harga,stok FROM produk WHERE cabang_id=? AND nama=? AND is_active=1 AND lacak_stok=1',
		['samarinda', 'Jus Uji']
	);
	assert.ok(product?.stok > 0, 'Stok sintetis tidak tersedia');
	const id = `smoke-${randomUUID()}`;
	const password = randomBytes(24).toString('hex');
	await query('INSERT INTO profil (id,cabang_id,username,password,role) VALUES(?,?,?,?,?)', [
		id,
		'samarinda',
		id,
		await bcrypt.hash(password, 10),
		'kasir'
	]);
	const call = browser();
	const session = await login(call, 'samarinda', id, password);
	assert.equal(session.status, 200, 'Login Samarinda gagal; Berau tidak diubah');
	assert.equal((await session.json()).scope, 'operasional');
	const original = await getBerau();
	assert.equal(original.enabled, true);
	assert.equal(original.previews_enabled, false);
	assert.equal((await probeBerau()).healthy, true);
	const action = async (name, fields, expected) => {
		const result = await call(`/operasional?/${name}`, {
			method: 'POST',
			body: new URLSearchParams(fields)
		});
		assert.equal(result.status, 200, `Aksi ${name} gagal`);
		assert.ok((await result.text()).includes(expected), `Aksi ${name} tidak terkonfirmasi`);
	};
	await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
	try {
		await setBerau(false);
		await sleep(5000);
		const down = await probeBerau();
		assert.ok([404, 502, 503].includes(down.status), 'Gangguan Berau belum terkonfirmasi');
		console.log(`Akses Berau staging gagal sebagaimana disimulasikan (HTTP ${down.status})`);
		await action('open', { id, openingCash: '100000' }, 'Pembukaan shift terkonfirmasi');
		try {
			const sale = {
				id: `${id}-sale`,
				shiftId: id,
				productId: product.id,
				qty: '1',
				unitPrice: String(product.harga),
				portion: 'reguler',
				payment: 'tunai',
				cash: String(product.harga)
			};
			await action('sale', sale, 'receiptId');
			await action('sale', sale, 'receiptId');
		} finally {
			await action('close', { id, confirm: 'yes' }, 'Shift ditutup');
		}
		assert.ok(
			[404, 502, 503].includes((await probeBerau()).status),
			'Gangguan tidak bertahan selama transaksi'
		);
	} finally {
		await restoreBerau();
	}
	const deadline = Date.now() + 45_000;
	let closed;
	do {
		await sleep(3000);
		[closed] = await query('SELECT is_active FROM sesi_toko WHERE cabang_id=? AND id=?', [
			'samarinda',
			id
		]);
	} while (closed?.is_active !== 0 && Date.now() < deadline);
	assert.equal(closed?.is_active, 0);
	const [ledger] = await query(
		'SELECT COUNT(*) AS n,SUM(nominal) AS total FROM buku_kas WHERE cabang_id=? AND id_sesi_toko=?',
		['samarinda', id]
	);
	assert.deepEqual(ledger, { n: 1, total: product.harga });
	const [inventory] = await query('SELECT stok FROM produk WHERE cabang_id=? AND id=?', [
		'samarinda',
		product.id
	]);
	assert.equal(inventory.stok, product.stok - 1);
	console.log(
		'Samarinda: penjualan, struk, retry tanpa duplikasi, tutup shift, dan stok terverifikasi'
	);
}

if (process.argv.includes('--restore')) await restoreBerau();
else await smoke();
