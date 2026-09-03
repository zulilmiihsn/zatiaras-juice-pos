import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const username = process.env.UAT_USERNAME || 'pemilik';
const productId = process.env.LOAD_PRODUCT_ID || 'uat-produk-es-teh';
const localEnvPassword =
	!process.env.UAT_PASSWORD &&
	(baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost')) &&
	existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: undefined;
const password = process.env.UAT_PASSWORD || localEnvPassword;

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

async function login() {
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`);
	assert(csrfResponse.ok, `CSRF gagal: ${csrfResponse.status}`);
	const csrfPayload = await csrfResponse.json();
	const csrfCookie = cookiePair(getSetCookies(csrfResponse.headers), 'zatiaras_csrf');
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
	assert(loginResponse.ok && loginPayload?.success, `Login gagal: ${loginResponse.status}`);
	const sidCookie = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');
	return { csrfToken: csrfPayload.token, cookie: `${csrfCookie}; ${sidCookie}` };
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

const auth = await login();
const items = [
	{
		product_id: productId,
		jumlah: 2,
		add_on_ids: [],
		gula: 'normal',
		es: 'sedikit',
		catatan: 'UAT H-KISS-6'
	},
	{
		product_id: null,
		nama_kustom: 'Item Custom UAT',
		custom_price: 5_000,
		jumlah: 1,
		add_on_ids: []
	}
];
const quoteResponse = await request('/api/pos/quote', auth, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ items })
});
const quotePayload = await quoteResponse.json().catch(() => null);
assert(quoteResponse.ok && quotePayload?.quote_token, `Quote gagal: ${quoteResponse.status}`);
const checkoutResponse = await request('/api/pos/transaction', auth, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({
		idempotency_key: `uat-financials-${randomUUID()}`,
		nama_pelanggan: 'UAT H-KISS-6',
		metode_bayar: 'tunai',
		cash_received: 30_000,
		items,
		mode: 'online',
		quote_token: quotePayload.quote_token
	})
});
const checkoutPayload = await checkoutResponse.json().catch(() => null);
assert(
	checkoutResponse.ok,
	`Checkout gagal: ${checkoutResponse.status} ${JSON.stringify(checkoutPayload)}`
);
assert(checkoutPayload?.data?.total_amount === 25_000, 'Total checkout berubah');
assert(checkoutPayload?.data?.total_qty === 3, 'Jumlah item checkout berubah');

const transactionId = checkoutPayload.data.transaction_id;
const rowsResponse = await request(
	`/api/transaksi-kasir?branch=${encodeURIComponent(branch)}&transaction_id=${encodeURIComponent(transactionId)}`,
	auth
);
const rows = await rowsResponse.json();
assert(
	rowsResponse.ok && Array.isArray(rows) && rows.length === 2,
	'Detail transaksi tidak lengkap'
);

const product = rows.find((row) => row.produk_id === productId);
const custom = rows.find((row) => row.produk_id === null);
assert(product?.jumlah === 2, 'Qty produk berubah');
assert(product?.harga === 10_000 && product?.nominal === 20_000, 'Nominal produk berubah');
assert(product?.harga_dasar === 10_000 && product?.total_tambahan === 0, 'Snapshot harga berubah');
assert(product?.gula === 'normal' && product?.es === 'sedikit', 'Detail pesanan berubah');
assert(custom?.jumlah === 1, 'Qty item custom berubah');
assert(custom?.harga === 5_000 && custom?.nominal === 5_000, 'Nominal item custom berubah');

const voidResponse = await request(
	`/api/transaksi-kasir?transaction_id=${encodeURIComponent(transactionId)}`,
	auth,
	{ method: 'DELETE' }
);
assert(voidResponse.ok, `Cleanup transaksi gagal: ${voidResponse.status}`);

console.log(
	JSON.stringify({
		ok: true,
		transactionId,
		totalAmount: checkoutPayload.data.total_amount,
		totalQty: checkoutPayload.data.total_qty,
		rows: rows.length,
		cleanup: voidResponse.status
	})
);
