import { existsSync, readFileSync } from 'node:fs';

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

const pages = [
	'/login',
	'/offline',
	'/',
	'/pos',
	'/pos/bayar',
	'/catat',
	'/laporan',
	'/pengaturan',
	'/pengaturan/pemilik',
	'/pengaturan/pemilik/arsip',
	'/pengaturan/pemilik/gantikeamanan',
	'/pengaturan/pemilik/manajemenmenu',
	'/pengaturan/pemilik/riwayat',
	'/pengaturan/printer',
	'/pengaturan/riwayat'
];

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
	const response = await fetch(`${baseUrl}/api/veriflogin`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password, branch })
	});
	const payload = await response.json().catch(() => null);
	assert(response.ok && payload?.success, `Login gagal: ${response.status}`);
	return cookiePair(getSetCookies(response.headers), 'zatiaras_sid');
}

function verifyCsp(path, response, html) {
	const csp = response.headers.get('content-security-policy') || '';
	const scriptDirective = csp
		.split(';')
		.map((value) => value.trim())
		.find((value) => value.startsWith('script-src '));
	assert(scriptDirective, `${path}: script-src hilang`);
	assert(!scriptDirective.includes("'unsafe-inline'"), `${path}: script-src masih unsafe-inline`);

	const nonceMatch = scriptDirective.match(/'nonce-([^']+)'/);
	assert(nonceMatch, `${path}: nonce CSP hilang`);
	const expectedNonce = nonceMatch[1];
	const inlineScripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)).filter(
		(match) => match[2].trim().length > 0
	);
	assert(inlineScripts.length > 0, `${path}: inline bootstrap script tidak ditemukan`);

	for (const [, attributes] of inlineScripts) {
		const nonce = attributes.match(/\bnonce="([^"]+)"/i)?.[1];
		assert(nonce === expectedNonce, `${path}: inline script tanpa nonce response yang benar`);
	}

	assert(!html.includes('%sveltekit.nonce%'), `${path}: placeholder nonce belum diganti`);
	return { nonce: true, inlineScripts: inlineScripts.length };
}

const sidCookie = await login();
const results = [];

for (const path of pages) {
	const response = await fetch(`${baseUrl}${path}`, {
		headers: { Cookie: sidCookie },
		redirect: 'manual'
	});
	assert(response.status === 200, `${path}: HTTP ${response.status}`);
	const html = await response.text();
	const csp = verifyCsp(path, response, html);
	results.push({ path, status: response.status, ...csp });
}

console.log(JSON.stringify({ ok: true, pages: results }));
