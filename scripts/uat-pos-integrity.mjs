import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const productId = process.env.LOAD_PRODUCT_ID || 'uat-produk-es-teh';
const localTarget =
	baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost');
const localPassword =
	!process.env.UAT_PASSWORD && localTarget && existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: undefined;
const password = process.env.UAT_PASSWORD || localPassword;

if (!localTarget && process.env.ALLOW_REMOTE_UAT !== '1') {
	throw new Error('UAT mutasi hanya boleh ke localhost kecuali ALLOW_REMOTE_UAT=1');
}
if (!password) throw new Error('UAT_PASSWORD wajib diisi melalui environment');

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

async function readPayload(response) {
	return response.json().catch(() => null);
}

async function login() {
	const loginResponse = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'pemilik', password, branch })
	});
	const loginPayload = await readPayload(loginResponse);
	assert(loginResponse.ok && loginPayload?.success, `Login gagal: ${loginResponse.status}`);
	const sidCookie = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`, { headers: { Cookie: sidCookie } });
	const csrfPayload = await readPayload(csrfResponse);
	assert(csrfResponse.ok && csrfPayload?.token, `CSRF gagal: ${csrfResponse.status}`);
	const csrfCookie = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
	return {
		csrfToken: csrfPayload.token,
		cookie: `${sidCookie}; ${csrfCookie}`
	};
}

async function request(path, auth, init = {}) {
	return fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			...(init.headers || {}),
			'X-CSRF-Token': auth.csrfToken,
			Cookie: auth.cookie
		}
	});
}

async function writeJson(path, auth, method, body) {
	return request(path, auth, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}

const auth = await login();
const catalogResponse = await request('/api/pos/catalog', auth);
const catalog = await readPayload(catalogResponse);
assert(catalogResponse.ok && catalog?.version === 2, `Katalog gagal: ${catalogResponse.status}`);
const product = catalog.products.find((item) => item.id === productId);
assert(product?.price_token, `Produk UAT ${productId} atau token harga tidak ditemukan`);

const originalPrice = Number(product.harga);
const changedPrice = originalPrice + 1_111;
const idempotencyKey = `uat-offline-integrity-${randomUUID()}`;
let transactionId = null;

try {
	await writeJson('/api/produk', auth, 'PATCH', {
		where: { id: productId },
		payload: { harga: changedPrice }
	}).then(async (response) => {
		assert(
			response.ok,
			`Ubah harga gagal: ${response.status} ${JSON.stringify(await readPayload(response))}`
		);
	});

	const requestBody = {
		idempotency_key: idempotencyKey,
		nama_pelanggan: 'UAT Offline Integrity',
		metode_bayar: 'tunai',
		cash_received: originalPrice,
		items: [
			{
				product_id: productId,
				jumlah: 1,
				add_on_ids: [],
				product_price_token: product.price_token,
				add_on_price_tokens: []
			}
		],
		mode: 'offline_replay',
		queued_at: Date.parse(catalog.fetched_at),
		store_session_id: null
	};
	const firstResponse = await writeJson('/api/pos/transaction', auth, 'POST', requestBody);
	const first = await readPayload(firstResponse);
	assert(firstResponse.ok, `Replay gagal: ${firstResponse.status} ${JSON.stringify(first)}`);
	assert(
		first.data?.total_amount === originalPrice,
		'Replay memakai harga baru, bukan harga saat jual'
	);
	assert(first.data?.receipt?.total_amount === originalPrice, 'Total struk replay berubah');
	transactionId = first.data?.transaction_id;
	assert(transactionId, 'Replay tidak mengembalikan transaction_id');

	const duplicateResponse = await writeJson('/api/pos/transaction', auth, 'POST', requestBody);
	const duplicate = await readPayload(duplicateResponse);
	assert(
		duplicateResponse.ok && duplicate?.idempotent === true,
		'Replay duplikat tidak idempotent'
	);
	assert(
		duplicate.data?.transaction_id === transactionId,
		'Replay duplikat membuat transaksi baru'
	);

	const tamperedRequest = {
		...requestBody,
		idempotency_key: `uat-offline-tamper-${randomUUID()}`,
		items: [
			{
				...requestBody.items[0],
				product_price_token: `${product.price_token.slice(0, -1)}x`
			}
		]
	};
	const tamperedResponse = await writeJson('/api/pos/transaction', auth, 'POST', tamperedRequest);
	assert(
		[400, 409].includes(tamperedResponse.status),
		`Token rusak harus ditolak, dapat ${tamperedResponse.status}`
	);

	const rowsResponse = await request(
		`/api/transaksi-kasir?branch=${encodeURIComponent(branch)}&transaction_id=${encodeURIComponent(transactionId)}`,
		auth
	);
	const rows = await readPayload(rowsResponse);
	assert(rowsResponse.ok && rows?.[0]?.nominal === originalPrice, 'Nominal detail replay berubah');

	console.log(
		JSON.stringify({
			ok: true,
			transactionId,
			originalPrice,
			currentPriceDuringReplay: changedPrice,
			recordedPrice: first.data.total_amount,
			idempotent: duplicate.idempotent,
			tamperedStatus: tamperedResponse.status
		})
	);
} finally {
	if (transactionId) {
		await request(
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(transactionId)}`,
			auth,
			{ method: 'DELETE' }
		).catch(() => undefined);
	}
	await writeJson('/api/produk', auth, 'PATCH', {
		where: { id: productId },
		payload: { harga: originalPrice }
	}).catch(() => undefined);
}
