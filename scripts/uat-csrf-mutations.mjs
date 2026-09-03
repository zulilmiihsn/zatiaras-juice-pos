import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const username = process.env.UAT_USERNAME || 'pemilik';
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

async function readPayload(response) {
	return response.json().catch(() => null);
}

async function assertOk(response, label) {
	const payload = await readPayload(response);
	assert(response.ok, `${label}: ${response.status} ${JSON.stringify(payload)}`);
	return payload;
}

async function loginWithoutCsrf() {
	const response = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password, branch })
	});
	const payload = await assertOk(response, 'Login tanpa CSRF');
	assert(payload?.success, 'Login tidak mengembalikan success');
	return cookiePair(getSetCookies(response.headers), 'zatiaras_sid');
}

async function createAuth() {
	const sidCookie = await loginWithoutCsrf();
	const csrfResponse = await fetch(`${baseUrl}/api/csrf`, {
		headers: { Cookie: sidCookie }
	});
	const csrfPayload = await assertOk(csrfResponse, 'CSRF');
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

const auth = await createAuth();
const ids = {
	category: `uat-csrf-kategori-${randomUUID()}`,
	product: `uat-csrf-produk-${randomUUID()}`,
	ingredient: `uat-csrf-bahan-${randomUUID()}`,
	income: `uat-csrf-income-${randomUUID()}`,
	expense: `uat-csrf-expense-${randomUUID()}`,
	aiRecommendation: `uat-csrf-ai-${randomUUID()}`,
	storeSession: `uat-csrf-session-${randomUUID()}`
};
let checkoutTransactionId = null;
const verified = [];

try {
	const missingToken = await fetch(`${baseUrl}/api/cache-metrics`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Cookie: auth.cookie
		},
		body: JSON.stringify({})
	});
	assert(
		missingToken.status === 403,
		`Mutation tanpa CSRF harus 403, dapat ${missingToken.status}`
	);
	verified.push('missing-token-403');

	const wrongToken = await fetch(`${baseUrl}/api/cache-metrics`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-CSRF-Token': '0'.repeat(auth.csrfToken.length),
			Cookie: auth.cookie
		},
		body: JSON.stringify({})
	});
	assert(wrongToken.status === 403, `Mutation token salah harus 403, dapat ${wrongToken.status}`);
	verified.push('wrong-token-403');

	await assertOk(
		await writeJson('/api/kategori', auth, 'POST', {
			payload: { id: ids.category, nama: 'UAT CSRF Kategori' }
		}),
		'Buat kategori'
	);
	await assertOk(
		await writeJson('/api/kategori', auth, 'PATCH', {
			where: { id: ids.category },
			payload: { nama: 'UAT CSRF Kategori Edit' }
		}),
		'Edit kategori'
	);
	verified.push('edit-category');

	await assertOk(
		await writeJson('/api/produk', auth, 'POST', {
			payload: {
				id: ids.product,
				nama: 'UAT CSRF Menu',
				harga: 12_000,
				kategori_id: ids.category
			}
		}),
		'Buat menu'
	);
	await assertOk(
		await writeJson('/api/produk', auth, 'PATCH', {
			where: { id: ids.product },
			payload: { nama: 'UAT CSRF Menu Edit', harga: 13_000 }
		}),
		'Edit menu'
	);
	verified.push('edit-menu');

	await assertOk(
		await writeJson('/api/bahan', auth, 'POST', {
			payload: {
				id: ids.ingredient,
				nama: 'UAT CSRF Bahan',
				satuan: 'gram',
				stok_saat_ini: 100,
				biaya_per_satuan: 10
			}
		}),
		'Buat bahan'
	);
	await assertOk(
		await writeJson('/api/bahan', auth, 'PATCH', {
			where: { id: ids.ingredient },
			payload: { stok_saat_ini: 125, biaya_per_satuan: 12 }
		}),
		'Edit bahan'
	);
	verified.push('edit-ingredient');

	for (const [id, tipe, nominal, label] of [
		[ids.income, 'in', 20_000, 'income'],
		[ids.expense, 'out', 7_500, 'expense']
	]) {
		await assertOk(
			await writeJson('/api/buku-kas', auth, 'POST', {
				payload: {
					id,
					tipe,
					nominal,
					deskripsi: `UAT CSRF ${label}`,
					jenis: 'uat',
					sumber: 'catat',
					waktu: new Date().toISOString(),
					metode_bayar: 'tunai',
					transaction_id: id
				}
			}),
			`Catat ${label}`
		);
		verified.push(label);
	}

	await assertOk(
		await writeJson('/api/buku-kas', auth, 'POST', {
			payload: {
				id: ids.aiRecommendation,
				tipe: 'out',
				nominal: 5_000,
				deskripsi: 'UAT CSRF AI recommendation apply',
				jenis: 'beban_usaha',
				sumber: 'catat',
				waktu: new Date().toISOString(),
				metode_bayar: 'tunai',
				transaction_id: ids.aiRecommendation
			}
		}),
		'Terapkan rekomendasi AI'
	);
	verified.push('ai-recommendation');

	await assertOk(
		await writeJson('/api/sesi-toko', auth, 'POST', {
			payload: {
				id: ids.storeSession,
				kas_awal: 100_000,
				waktu_buka: new Date().toISOString(),
				is_active: true
			}
		}),
		'Buka toko'
	);
	await assertOk(
		await writeJson('/api/sesi-toko', auth, 'PATCH', {
			where: { id: ids.storeSession },
			payload: { waktu_tutup: new Date().toISOString(), is_active: false }
		}),
		'Tutup toko'
	);
	verified.push('open-close-store');

	const checkoutItems = [
		{
			product_id: null,
			nama_kustom: 'UAT CSRF Custom',
			custom_price: 15_000,
			jumlah: 1,
			add_on_ids: []
		}
	];
	const checkoutQuote = await assertOk(
		await writeJson('/api/pos/quote', auth, 'POST', { items: checkoutItems }),
		'Quote checkout'
	);
	const checkoutPayload = await assertOk(
		await writeJson('/api/pos/transaction', auth, 'POST', {
			idempotency_key: `uat-csrf-checkout-${randomUUID()}`,
			nama_pelanggan: 'UAT CSRF',
			metode_bayar: 'tunai',
			cash_received: 15_000,
			items: checkoutItems,
			mode: 'online',
			quote_token: checkoutQuote.quote_token
		}),
		'Checkout'
	);
	checkoutTransactionId = checkoutPayload?.data?.transaction_id;
	assert(checkoutTransactionId, 'Checkout tidak mengembalikan transaction_id');
	await assertOk(
		await request(
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(checkoutTransactionId)}`,
			auth,
			{ method: 'DELETE' }
		),
		'Hapus transaksi'
	);
	checkoutTransactionId = null;
	verified.push('checkout-delete');
} finally {
	if (checkoutTransactionId) {
		await request(
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(checkoutTransactionId)}`,
			auth,
			{ method: 'DELETE' }
		).catch(() => undefined);
	}
	for (const id of [ids.income, ids.expense, ids.aiRecommendation]) {
		await request(`/api/buku-kas?id=${encodeURIComponent(id)}`, auth, {
			method: 'DELETE'
		}).catch(() => undefined);
	}
	await request(`/api/produk?id=${encodeURIComponent(ids.product)}`, auth, {
		method: 'DELETE'
	}).catch(() => undefined);
	await request(`/api/kategori?id=${encodeURIComponent(ids.category)}`, auth, {
		method: 'DELETE'
	}).catch(() => undefined);
	await request(`/api/bahan?id=${encodeURIComponent(ids.ingredient)}`, auth, {
		method: 'DELETE'
	}).catch(() => undefined);
}

console.log(JSON.stringify({ ok: true, verified }));
