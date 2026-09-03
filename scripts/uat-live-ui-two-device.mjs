import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const baseUrl = (process.argv[2] || 'https://zatiaraspos.pages.dev').replace(/\/$/, '');
const branch = process.argv[3] || 'samarinda';
const chromePath =
	process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cdpPort = Number(process.env.CDP_PORT || 9333);
const headless = process.env.HEADLESS !== '0';
const ownerPassword = process.env.UAT_OWNER_PASSWORD || process.env.UAT_PASSWORD;
const cashierPassword = process.env.UAT_KASIR_PASSWORD || process.env.UAT_PASSWORD;

if (!ownerPassword || !cashierPassword) {
	throw new Error('UAT_OWNER_PASSWORD dan UAT_KASIR_PASSWORD wajib diisi');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

async function waitUntil(fn, timeoutMs = 15000, intervalMs = 250) {
	const started = Date.now();
	let lastError;
	while (Date.now() - started < timeoutMs) {
		try {
			const result = await fn();
			if (result) return result;
		} catch (error) {
			lastError = error;
		}
		await sleep(intervalMs);
	}
	throw lastError || new Error('waitUntil timeout');
}

class CdpConnection {
	constructor(wsUrl) {
		this.ws = new WebSocket(wsUrl);
		this.nextId = 1;
		this.pending = new Map();
		this.events = [];
		this.ready = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 10000);
			this.ws.addEventListener('open', () => {
				clearTimeout(timer);
				resolve();
			});
			this.ws.addEventListener('error', () => {
				clearTimeout(timer);
				reject(new Error('CDP websocket error'));
			});
		});
		this.ws.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				if (message.error) reject(new Error(message.error.message || 'CDP error'));
				else resolve(message.result);
				return;
			}
			this.events.push(message);
		});
	}

	async send(method, params = {}, sessionId) {
		await this.ready;
		const id = this.nextId++;
		const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
		const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
		this.ws.send(JSON.stringify(payload));
		return promise;
	}

	close() {
		this.ws.close(1000, 'done');
	}
}

async function launchChrome() {
	const userDataDir = await mkdtemp(join(tmpdir(), 'zatiaraspos-cdp-'));
	const args = [
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${userDataDir}`,
		'--disable-background-networking',
		'--disable-default-apps',
		'--disable-extensions',
		'--disable-sync',
		'--no-first-run',
		'--no-default-browser-check'
	];
	if (headless) args.push('--headless=new', '--disable-gpu');

	const child = spawn(chromePath, args, { stdio: 'ignore' });
	child.unref();

	await waitUntil(async () => {
		const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).catch(() => null);
		return response?.ok ? response : null;
	}, 15000);

	return {
		child,
		userDataDir,
		async cleanup() {
			child.kill();
			await sleep(500);
			await rm(userDataDir, { recursive: true, force: true });
		}
	};
}

async function connectBrowser() {
	const version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json());
	return new CdpConnection(version.webSocketDebuggerUrl);
}

async function newPage(cdp, url) {
	const { browserContextId } = await cdp.send('Target.createBrowserContext', {
		disposeOnDetach: true
	});
	const { targetId } = await cdp.send('Target.createTarget', {
		url: 'about:blank',
		browserContextId
	});
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
	await cdp.send('Page.enable', {}, sessionId);
	await cdp.send('Runtime.enable', {}, sessionId);
	await cdp.send('Page.navigate', { url }, sessionId);
	await waitForLoad(cdp, sessionId);
	return { browserContextId, targetId, sessionId };
}

async function waitForLoad(cdp, sessionId) {
	await waitUntil(async () => {
		const value = await evaluate(cdp, sessionId, 'document.readyState');
		return value === 'complete' || value === 'interactive';
	}, 20000);
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
	const result = await cdp.send(
		'Runtime.evaluate',
		{
			expression,
			awaitPromise,
			returnByValue: true
		},
		sessionId
	);
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.text || 'Runtime exception');
	}
	return result.result?.value;
}

function jsString(value) {
	return JSON.stringify(String(value));
}

async function loginByUi(cdp, sessionId, username, password) {
	await cdp.send('Page.navigate', { url: `${baseUrl}/login` }, sessionId);
	await waitForLoad(cdp, sessionId);
	await waitUntil(
		() =>
			evaluate(
				cdp,
				sessionId,
				`Boolean(
					document.querySelector('form[data-hydrated="true"]') &&
					document.querySelector('#username') &&
					!document.querySelector('button[type="submit"]')?.disabled
				)`
			),
		60000
	);

	await evaluate(
		cdp,
		sessionId,
		`(() => {
			const setValue = (selector, value) => {
				const element = document.querySelector(selector);
				element.value = value;
				element.dispatchEvent(new Event('input', { bubbles: true }));
				element.dispatchEvent(new Event('change', { bubbles: true }));
			};
			setValue('#username', ${jsString(username)});
			setValue('#password', ${jsString(password)});
			setValue('select[aria-label="Pilih Cabang"]', ${jsString(branch)});
			document.querySelector('button[type="submit"]').click();
			return true;
		})()`
	);

	await waitUntil(
		() =>
			evaluate(
				cdp,
				sessionId,
				`fetch('/api/session', { credentials: 'include' })
					.then((response) => response.json())
					.then((session) => Boolean(session.authenticated && session.user && session.user.username === ${jsString(username)}))`
			),
		20000
	);
}

async function readDashboardMetrics(cdp, sessionId) {
	return evaluate(
		cdp,
		sessionId,
		`(() => {
			const text = document.body.innerText;
			const valueAfter = (label) => {
				const index = text.indexOf(label);
				if (index < 0) return null;
				return text.slice(index + label.length, index + label.length + 80);
			};
			const parseNumber = (raw) => {
				const match = String(raw || '').match(/[0-9][0-9.]*/);
				return match ? Number(match[0].replace(/\\./g, '')) : 0;
			};
			return {
				path: location.pathname,
				text,
				itemTerjual: parseNumber(valueAfter('Item Terjual')),
				jumlahTransaksi: parseNumber(valueAfter('Jumlah Transaksi')),
				pendapatan: parseNumber(valueAfter('Pendapatan'))
			};
		})()`
	);
}

async function runCashierUiTransaction(cdp, sessionId) {
	await cdp.send('Page.navigate', { url: `${baseUrl}/pos` }, sessionId);
	await waitForLoad(cdp, sessionId);
	await evaluate(
		cdp,
		sessionId,
		`(() => {
			window.__uatTransactionId = null;
			const originalFetch = window.fetch.bind(window);
			window.fetch = async (...args) => {
				const response = await originalFetch(...args);
				const request = args[0];
				const init = args[1] || {};
				const url = typeof request === 'string' ? request : request?.url || '';
				const method = String(init.method || request?.method || 'GET').toUpperCase();
				if (method === 'POST' && url.includes('/api/pos/transaction') && response.ok) {
					response.clone().json()
						.then((payload) => {
							window.__uatTransactionId = payload?.data?.transaction_id || null;
						})
						.catch(() => undefined);
				}
				return response;
			};
			return true;
		})()`
	);
	try {
		await waitUntil(
			() =>
				evaluate(
					cdp,
					sessionId,
					`Boolean([...document.querySelectorAll('[aria-label]')]
						.find((el) => (el.getAttribute('aria-label') || '').includes('Tambah Es Teh UAT ke keranjang')))`
				),
			20000
		);
	} catch (error) {
		const debug = await evaluate(
			cdp,
			sessionId,
			`(async () => ({
				location: location.href,
				online: navigator.onLine,
				selectedBranch: localStorage.getItem('selectedBranch'),
				session: await fetch('/api/session', { credentials: 'include' }).then((r) => r.json()),
				products: await fetch('/api/produk?branch=${encodeURIComponent(branch)}').then((r) => r.json()),
				body: document.body.innerText.slice(0, 1200)
			}))()`
		);
		throw new Error(`POS product not visible: ${JSON.stringify(debug)}`);
	}
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('[aria-label]')]
			.find((el) => (el.getAttribute('aria-label') || '').includes('Tambah Es Teh UAT ke keranjang'))
			.click()`
	);
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			`Boolean([...document.querySelectorAll('button')].find((el) => el.textContent.includes('Tambah ke Keranjang')))`
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('button')].find((el) => el.textContent.includes('Tambah ke Keranjang')).click()`
	);
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			`Boolean([...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Bayar'))`
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Bayar').click()`
	);
	await waitUntil(() => evaluate(cdp, sessionId, "location.pathname === '/pos/bayar'"));
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			'Boolean(document.querySelector(\'input[placeholder="Masukkan nama pelanggan..."]\'))'
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`(() => {
			const customer = document.querySelector('input[placeholder="Masukkan nama pelanggan..."]');
			customer.value = 'UAT Browser';
			customer.dispatchEvent(new Event('input', { bubbles: true }));
			[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Tunai').click();
			return true;
		})()`
	);
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			`Boolean([...document.querySelectorAll('button')]
				.find((el) => el.textContent.includes('Konfirmasi') && !el.disabled))`
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('button')].find((el) => el.textContent.includes('Konfirmasi')).click()`
	);
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			`Boolean([...document.querySelectorAll('button')].find((el) => el.textContent.includes('Rp 10.000')))`
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('button')].find((el) => el.textContent.includes('Rp 10.000')).click()`
	);
	await waitUntil(() =>
		evaluate(
			cdp,
			sessionId,
			`Boolean([...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Selesai' && !el.disabled))`
		)
	);
	await evaluate(
		cdp,
		sessionId,
		`[...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Selesai').click()`
	);
	await waitUntil(
		() => evaluate(cdp, sessionId, "document.body.innerText.includes('Transaksi Berhasil')"),
		20000
	);
	return waitUntil(() => evaluate(cdp, sessionId, 'window.__uatTransactionId || null'), 10000);
}

async function cleanupTransaction(cdp, sessionId, transactionId) {
	return evaluate(
		cdp,
		sessionId,
		`(async () => {
			const csrfResponse = await fetch('/api/csrf', { credentials: 'include' });
			const csrf = await csrfResponse.json();
			if (!csrfResponse.ok || !csrf.token) {
				return { ok: false, status: csrfResponse.status };
			}
			const response = await fetch(
				'/api/transaksi-kasir?transaction_id=' + encodeURIComponent(${jsString(transactionId)}),
				{
					method: 'DELETE',
					credentials: 'include',
					headers: { 'X-CSRF-Token': csrf.token }
				}
			);
			return { ok: response.ok, status: response.status };
		})()`
	);
}

let chrome;
let cdp;
let owner;
let cashier;
let transactionId;
let transactionCleaned = false;
try {
	chrome = await launchChrome();
	cdp = await connectBrowser();

	owner = await newPage(cdp, `${baseUrl}/login`);
	cashier = await newPage(cdp, `${baseUrl}/login`);

	await loginByUi(cdp, owner.sessionId, 'pemilik', ownerPassword);
	await loginByUi(cdp, cashier.sessionId, 'kasir', cashierPassword);

	await cdp.send('Page.navigate', { url: `${baseUrl}/` }, owner.sessionId);
	await waitForLoad(cdp, owner.sessionId);
	await waitUntil(() =>
		evaluate(cdp, owner.sessionId, "document.body.innerText.includes('Jumlah Transaksi')")
	);
	const before = await readDashboardMetrics(cdp, owner.sessionId);

	transactionId = await runCashierUiTransaction(cdp, cashier.sessionId);
	assert(transactionId, 'Checkout UI tidak mengembalikan transaction_id');

	const after = await waitUntil(async () => {
		const metrics = await readDashboardMetrics(cdp, owner.sessionId);
		if (
			metrics.jumlahTransaksi > before.jumlahTransaksi ||
			metrics.pendapatan > before.pendapatan ||
			metrics.itemTerjual > before.itemTerjual
		) {
			return metrics;
		}
		return null;
	}, 20000);
	const cleanup = await cleanupTransaction(cdp, owner.sessionId, transactionId);
	assert(cleanup.ok, `Cleanup transaksi live gagal: HTTP ${cleanup.status}`);
	transactionCleaned = true;

	console.log(
		JSON.stringify({
			ok: true,
			baseUrl,
			branch,
			ownerDashboardBefore: {
				itemTerjual: before.itemTerjual,
				jumlahTransaksi: before.jumlahTransaksi,
				pendapatan: before.pendapatan
			},
			ownerDashboardAfter: {
				itemTerjual: after.itemTerjual,
				jumlahTransaksi: after.jumlahTransaksi,
				pendapatan: after.pendapatan
			},
			cashierTransactionUi: true,
			ownerRealtimeDashboardUpdated: true,
			transactionId,
			transactionCleanup: cleanup.status
		})
	);
} finally {
	if (cdp && owner && transactionId && !transactionCleaned) {
		await cleanupTransaction(cdp, owner.sessionId, transactionId).catch(() => undefined);
	}
	if (cdp) {
		for (const page of [owner, cashier]) {
			if (page) {
				await evaluate(
					cdp,
					page.sessionId,
					"fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => true)"
				).catch(() => undefined);
			}
		}
	}
	cdp?.close();
	await chrome?.cleanup();
}
