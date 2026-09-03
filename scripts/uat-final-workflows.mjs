import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';

const baseUrl = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const localTarget =
	baseUrl.startsWith('http://127.0.0.1') || baseUrl.startsWith('http://localhost');
const localEnvPassword =
	!process.env.UAT_PASSWORD && localTarget && existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: undefined;
const password = process.env.UAT_PASSWORD || localEnvPassword;
const pin =
	process.env.UAT_PIN ||
	(() => {
		let generated = '';
		do {
			generated = String(randomInt(1000, 10_000));
		} while (['0000', '1111', '1234', '4321'].includes(generated));
		return generated;
	})();

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

async function payload(response) {
	return response.json().catch(() => null);
}

async function assertOk(response, label) {
	const body = await payload(response);
	assert(response.ok, `${label}: ${response.status} ${JSON.stringify(body)}`);
	return body;
}

async function login(username, currentPassword = password) {
	const loginResponse = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: currentPassword, branch })
	});
	const loginPayload = await assertOk(loginResponse, `Login ${username}`);
	assert(loginPayload?.success, `Login ${username} tidak sukses`);
	const sidCookie = cookiePair(getSetCookies(loginResponse.headers), 'zatiaras_sid');

	const csrfResponse = await fetch(`${baseUrl}/api/csrf`, {
		headers: { Cookie: sidCookie }
	});
	const csrfPayload = await assertOk(csrfResponse, `CSRF ${username}`);
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

function sqlValue(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function executeLocalD1(sql) {
	const sqlFile = join(tmpdir(), `zatiaras-uat-${randomUUID()}.sql`);
	writeFileSync(sqlFile, `${sql};\n`, 'utf8');
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
			`D1 lokal gagal: ${String(result.error?.message || result.stderr || result.stdout || '').trim()}`
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
			// Wrangler lokal dapat me-restart Miniflare setelah D1 ditulis langsung.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error('Server lokal tidak pulih setelah perubahan D1');
}

if (localTarget) {
	executeLocalD1(
		`UPDATE pengaturan SET pin = NULL, pin_hash = NULL WHERE cabang_id = ${sqlValue(branch)}`
	);
	await waitForServer();
}

const verified = [];
const ownerAuth = await login('pemilik');
const cashierAuth = await login('kasir');
verified.push('login-pemilik-kasir');

await assertOk(
	await writeJson('/api/pin', ownerAuth, 'PATCH', {
		currentPin: process.env.UAT_CURRENT_PIN || '',
		newPin: pin
	}),
	'Konfigurasi PIN server'
);

const cashierSettings = await assertOk(
	await request(`/api/pengaturan?branch=${encodeURIComponent(branch)}`, cashierAuth),
	'Pengaturan kasir'
);
const ownerSettings = await assertOk(
	await request(`/api/pengaturan?branch=${encodeURIComponent(branch)}`, ownerAuth),
	'Pengaturan pemilik'
);
assert(!Object.hasOwn(cashierSettings[0] || {}, 'pin'), 'PIN masih bocor ke response kasir');
assert(!Object.hasOwn(cashierSettings[0] || {}, 'pin_hash'), 'Hash PIN bocor ke response kasir');
assert(!Object.hasOwn(ownerSettings[0] || {}, 'pin'), 'PIN masih bocor ke response pemilik');
assert(!Object.hasOwn(ownerSettings[0] || {}, 'pin_hash'), 'Hash PIN bocor ke response pemilik');
assert(cashierSettings[0]?.pinConfigured === true, 'Status konfigurasi PIN tidak tersedia');

const reportPath = `/api/reports/aggregate?branch=${encodeURIComponent(branch)}&start_date=2026-01-01&end_date=2026-12-31`;
const lockedReport = await request(reportPath, cashierAuth);
assert(lockedReport.status === 403, `Laporan tanpa PIN harus 403, dapat ${lockedReport.status}`);
const dashboardPath = `/api/dashboard/stats?branch=${encodeURIComponent(branch)}&start=2026-01-01T00%3A00%3A00.000Z&end=2026-12-31T23%3A59%3A59.999Z`;
const lockedDashboard = await request(dashboardPath, cashierAuth);
assert(
	lockedDashboard.status === 403,
	`Dashboard tanpa PIN harus 403, dapat ${lockedDashboard.status}`
);
const ledgerPath = `/api/buku-kas?branch=${encodeURIComponent(branch)}&limit=1`;
const lockedLedger = await request(ledgerPath, cashierAuth);
assert(lockedLedger.status === 403, `Buku kas tanpa PIN harus 403, dapat ${lockedLedger.status}`);

const wrongPin = await writeJson('/api/pin/verify', cashierAuth, 'POST', {
	pin: pin === '0000' ? '9999' : '0000',
	page: 'laporan'
});
assert(wrongPin.status === 403, `PIN salah harus 403, dapat ${wrongPin.status}`);
await assertOk(
	await writeJson('/api/pin/verify', cashierAuth, 'POST', { pin, page: 'laporan' }),
	'Verifikasi PIN laporan'
);
await assertOk(await request(reportPath, cashierAuth), 'Laporan setelah PIN');
await assertOk(
	await writeJson('/api/pin/verify', cashierAuth, 'POST', { pin, page: 'beranda' }),
	'Verifikasi PIN beranda'
);
await assertOk(await request(dashboardPath, cashierAuth), 'Dashboard setelah PIN');
await assertOk(
	await writeJson('/api/pin/verify', cashierAuth, 'POST', { pin, page: 'catat' }),
	'Verifikasi PIN catat'
);
await assertOk(await request(ledgerPath, cashierAuth), 'Buku kas setelah PIN');

const oversizedCheckout = await writeJson('/api/pos/quote', ownerAuth, 'POST', {
	items: Array.from({ length: 101 }, (_, index) => ({
		nama_kustom: `Item UAT ${index + 1}`,
		custom_price: 1000,
		jumlah: 1
	}))
});
assert(
	oversizedCheckout.status === 400,
	`Checkout 101 item harus 400, dapat ${oversizedCheckout.status}`
);

const privateArchive = await fetch(
	`${baseUrl}/api/upload?key=${encodeURIComponent('arsip/samarinda/arsip-rahasia.json')}`
);
assert(
	privateArchive.status === 404,
	`Arsip via proxy upload harus 404, dapat ${privateArchive.status}`
);
verified.push('server-pin-report-lock-r2-boundary');

const securityUserId = `uat-final-security-${randomUUID()}`;
const securityUsername = `uatsec${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const securityPassword = `Tmp${randomUUID().replaceAll('-', '').slice(0, 12)}Aa1`;
const securityNewPassword = `New${randomUUID().replaceAll('-', '').slice(0, 12)}Bb2`;
const securityHash = await bcrypt.hash(securityPassword, 10);
executeLocalD1(
	`INSERT INTO profil (id, cabang_id, role, username, password, nama_lengkap) VALUES (` +
		[securityUserId, branch, 'kasir', securityUsername, securityHash, 'UAT Final Security']
			.map(sqlValue)
			.join(', ') +
		')'
);
await waitForServer();
try {
	const securityChangeResponse = await writeJson('/api/gantikeamanan', ownerAuth, 'POST', {
		usernameLama: securityUsername,
		usernameBaru: securityUsername,
		passwordLama: securityPassword,
		passwordBaru: securityNewPassword,
		branch,
		targetRole: 'kasir'
	});
	const securityChangePayload = await payload(securityChangeResponse);
	if (securityChangeResponse.status === 429) {
		assert(
			securityChangePayload?.code === 'RATE_LIMITED',
			`Ganti keamanan 429 tanpa kode RATE_LIMITED: ${JSON.stringify(securityChangePayload)}`
		);
		verified.push('credential-change-rate-limit-enforced');
	} else {
		assert(
			securityChangeResponse.ok,
			`Ganti keamanan: ${securityChangeResponse.status} ${JSON.stringify(securityChangePayload)}`
		);
		await login(securityUsername, securityNewPassword);
		verified.push('credential-change');
	}
} finally {
	executeLocalD1(
		`DELETE FROM auth_sessions WHERE cabang_id = ${sqlValue(branch)} AND user_id = ${sqlValue(securityUserId)}; ` +
			`DELETE FROM profil WHERE cabang_id = ${sqlValue(branch)} AND id = ${sqlValue(securityUserId)}`
	);
	await waitForServer();
}

const productId = `uat-final-stock-${randomUUID()}`;
let transactionId = null;
try {
	const reportBeforeCheckout = await assertOk(
		await request(reportPath, ownerAuth),
		'Laporan sebelum checkout'
	);
	await assertOk(
		await writeJson('/api/produk', ownerAuth, 'POST', {
			payload: {
				id: productId,
				nama: 'UAT Final Stock',
				harga: 10_000,
				stok: 10,
				lacak_stok: true,
				lacak_bahan: false
			}
		}),
		'Buat produk stok'
	);
	const checkoutItems = [{ product_id: productId, jumlah: 2, add_on_ids: [] }];
	const checkoutQuote = await assertOk(
		await writeJson('/api/pos/quote', ownerAuth, 'POST', { items: checkoutItems }),
		'Quote stok'
	);
	const checkout = await assertOk(
		await writeJson('/api/pos/transaction', ownerAuth, 'POST', {
			idempotency_key: `uat-final-${randomUUID()}`,
			nama_pelanggan: 'UAT Final',
			metode_bayar: 'tunai',
			cash_received: 20_000,
			items: checkoutItems,
			mode: 'online',
			quote_token: checkoutQuote.quote_token
		}),
		'Checkout stok'
	);
	transactionId = checkout?.data?.transaction_id;
	assert(transactionId, 'Checkout stok tidak mengembalikan transaction_id');

	const reportAfterCheckout = await assertOk(
		await request(reportPath, ownerAuth),
		'Laporan setelah checkout'
	);
	assert(
		reportAfterCheckout.summary?.pendapatan ===
			Number(reportBeforeCheckout.summary?.pendapatan || 0) + 20_000,
		'Ringkasan pendapatan tidak bertambah setelah checkout'
	);

	const directLedgerDelete = await request(
		`/api/buku-kas?transaction_id=${encodeURIComponent(transactionId)}`,
		ownerAuth,
		{ method: 'DELETE' }
	);
	assert(
		directLedgerDelete.status === 409,
		`Hapus ledger POS langsung harus 409, dapat ${directLedgerDelete.status}`
	);

	const afterCheckout = await assertOk(
		await request(`/api/produk?branch=${encodeURIComponent(branch)}`, ownerAuth),
		'Baca stok setelah checkout'
	);
	assert(
		afterCheckout.find((item) => item.id === productId)?.stok === 8,
		'Stok tidak berkurang setelah checkout'
	);

	await assertOk(
		await request(
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(transactionId)}`,
			ownerAuth,
			{
				method: 'DELETE'
			}
		),
		'Void transaksi'
	);
	transactionId = null;

	const afterVoid = await assertOk(
		await request(`/api/produk?branch=${encodeURIComponent(branch)}`, ownerAuth),
		'Baca stok setelah void'
	);
	assert(
		afterVoid.find((item) => item.id === productId)?.stok === 10,
		'Stok tidak kembali setelah void'
	);
	const reportAfterVoid = await assertOk(
		await request(reportPath, ownerAuth),
		'Laporan setelah void'
	);
	assert(
		reportAfterVoid.summary?.pendapatan === reportBeforeCheckout.summary?.pendapatan,
		'Ringkasan pendapatan tidak kembali setelah void'
	);
	verified.push('checkout-void-stock-restore-pos-ledger-guard');
} finally {
	if (transactionId) {
		await request(
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(transactionId)}`,
			ownerAuth,
			{
				method: 'DELETE'
			}
		).catch(() => undefined);
	}
	await request(`/api/produk?id=${encodeURIComponent(productId)}`, ownerAuth, {
		method: 'DELETE'
	}).catch(() => undefined);
}

const aiResponse = await writeJson('/api/aichat', ownerAuth, 'POST', {
	question: 'Jawab singkat: apakah sistem aktif?',
	branch
});
const aiPayload = await payload(aiResponse);
if (aiResponse.ok) {
	assert(
		aiPayload?.success && typeof aiPayload.answer === 'string',
		'AI chat tidak mengembalikan jawaban'
	);
	verified.push('ai-chat');
} else {
	assert(
		aiResponse.status === 500 && ['SERVICE_UNAVAILABLE', 'SERVER_ERROR'].includes(aiPayload?.code),
		`AI chat gagal di luar kondisi konfigurasi: ${aiResponse.status} ${JSON.stringify(aiPayload)}`
	);
	verified.push('ai-chat-route-config-blocked');
}

console.log(JSON.stringify({ ok: true, verified }));
