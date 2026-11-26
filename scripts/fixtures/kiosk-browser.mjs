import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { chromium, expect } from '@playwright/test';

async function startBrowserOrigin(resolveBackend) {
	const { Server } = await import('../../.svelte-kit/output/server/index.js');
	const { manifest } = await import('../../.svelte-kit/cloudflare-tmp/manifest.js');
	const assets = resolve('.svelte-kit/cloudflare');
	const createApp = async () => {
		const app = new Server(manifest);
		await app.init({ env: {}, read: (path) => readFile(resolve(assets, path)) });
		return app;
	};
	const respond = await resolveBackend(createApp);
	const errors = [];
	const server = createServer(async (incoming, outgoing) => {
		try {
			const base = `http://localhost:${server.address().port}`;
			const request = await getRequest({ base, request: incoming });
			const path = new URL(request.url).pathname;
			const asset = resolve(assets, '.' + path);
			if (path.startsWith('/_app/') && asset.startsWith(assets + sep)) {
				const mime = path.endsWith('.js')
					? 'text/javascript'
					: path.endsWith('.css')
						? 'text/css'
						: 'application/octet-stream';
				return await setResponse(
					outgoing,
					new Response(await readFile(asset), { headers: { 'content-type': mime } })
				);
			}
			await setResponse(outgoing, await respond(request));
		} catch (error) {
			errors.push(error);
			outgoing.writeHead(500).end();
		}
	});
	server.listen(0, 'localhost');
	await once(server, 'listening');
	return {
		origin: `http://localhost:${server.address().port}`,
		errors,
		stop: () =>
			new Promise((resolveClose) => {
				server.close(resolveClose);
				server.closeAllConnections();
			})
	};
}

function backendOptions(branch, db, bridge, quota) {
	return {
		getClientAddress: () => '127.0.0.1',
		platform: {
			env: {
				KIOSK_PRODUCTION_PILOT: branch,
				REALTIME_HUB: {
					idFromName: (name) => name,
					get: (name) => ({
						fetch: async (req) => {
							const path = new URL(req.url).pathname;
							if (path === '/rate-limit') return Response.json({ allowed: true });
							if (name !== `cashier:${branch}`) return new Response(null, { status: 404 });
							return bridge(path, await req.json());
						}
					})
				},
				[`DB_${branch.toUpperCase()}_GROUP`]: !quota
					? db
					: {
							prepare: (sql) => {
								if (quota === 'read' || quota === 'both' || !/^\s*SELECT\b/i.test(sql))
									throw new Error(
										`D1_ERROR: daily ${quota === 'both' ? 'read' : quota} limit exceeded`
									);
								return db.prepare(sql);
							}
						}
			}
		}
	};
}

async function loginFromBrowser(page, origin, { branch, username, password }) {
	await page.goto(origin + '/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
	await page.getByLabel('Pilih Cabang').selectOption(branch);
	await page.getByPlaceholder('Masukkan username').fill(username);
	await page.getByPlaceholder('Masukkan password').fill(password);
	const loginResponse = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/veriflogin' &&
			response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok(), `${branch}: login HTTP ${response.status()}`).toBe(true);
}

export async function exerciseKioskBrowser({
	db,
	branch,
	quota,
	bridge,
	password,
	username,
	rollback = false
}) {
	let outage = false;
	const { origin, errors, stop } = await startBrowserOrigin(async (createApp) => {
		const app = await createApp();
		return (request) =>
			app.respond(request, backendOptions(branch, db, bridge, outage ? quota : null));
	});
	let browser;
	try {
		browser = await chromium.launch();
		if (rollback) {
			const page = await browser.newPage({ serviceWorkers: 'block' });
			await page.goto(origin + '/login');
			await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
			await page.getByLabel('Pilih Cabang').selectOption(branch);
			await page.getByPlaceholder('Masukkan username').fill(username);
			await page.getByPlaceholder('Masukkan password').fill(password);
			await page.getByRole('button', { name: 'Masuk', exact: true }).click();
			await expect(page).toHaveURL(origin + '/');
			await page.goto(origin + '/pengaturan');
			await expect(page.getByRole('region', { name: 'Mode cadangan kasir' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Daftarkan HP ini' })).toHaveCount(0);
			await page.getByText('Pengaturan mode cadangan', { exact: true }).click();
			await page.getByText('Pemeliharaan', { exact: true }).click();
			await expect(page.getByRole('button', { name: 'Kembali ke kasir lama' })).toHaveCount(0);
			const csrf = await page.request.get(origin + '/api/csrf');
			expect(csrf.ok()).toBe(true);
			const response = await page.request.patch(origin + '/api/perangkat-kasir', {
				headers: { origin, 'x-csrf-token': (await csrf.json()).token },
				data: { confirm: `rollback-${branch}-production` }
			});
			expect(response.ok(), `${branch}: ${await response.text()} ${errors.join('; ')}`).toBe(true);
			return;
		}
		const login = async (page) => {
			await loginFromBrowser(page, origin, { branch, username, password });
			await expect(page).toHaveURL(/\/operasional$/);
		};
		const pages = await Promise.all(
			[0, 1].map(async () => {
				const context = await browser.newContext({ serviceWorkers: 'block' });
				await context.addInitScript(() => {
					window.print = () => document.body.setAttribute('data-print-called', 'true');
				});
				const page = await context.newPage();
				await login(page);
				const cookie = (await context.cookies()).find(
					({ name }) => name === `zatiaras_kiosk_${branch}`
				);
				expect(cookie?.httpOnly).toBe(true);
				await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
				await page.getByRole('button', { name: 'Keluar', exact: true }).click();
				await expect(page).toHaveURL(/\/login$/);
				return page;
			})
		);
		outage = true;
		await Promise.all(pages.map(login));
		await pages[0].getByLabel(/Modal awal/).fill('100000');
		await pages[0].getByLabel('PIN toko').fill('9876');
		const opened = pages[0].waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/operasional'
		);
		expect(
			await pages[0]
				.locator('form')
				.first()
				.evaluate((form) => ({ valid: form.checkValidity(), action: form.action }))
		).toEqual({ valid: true, action: origin + '/operasional?/open' });
		await pages[0].getByRole('button', { name: 'Buka Toko', exact: true }).click();
		const openResponse = await opened;
		expect(
			openResponse.ok(),
			`Open status ${openResponse.status()} ${errors.map((error) => String(error)).join('; ')}`
		).toBe(true);
		await expect(pages[0].getByText(/Kios sudah buka/)).toBeVisible();
		await pages[1].reload();
		const orderNumbers = await Promise.all(
			pages.map(async (page) => {
				await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
				await page.getByLabel('Produk 1').selectOption('juice');
				await page.getByLabel(/Uang diterima/).fill('12000');
				await page.getByRole('button', { name: 'Catat Pembayaran' }).click();
				const receipt = page.getByRole('region', { name: 'Struk kios' });
				await expect(receipt).toContainText('Kembalian: Rp2.000');
				await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
				await receipt.getByRole('button', { name: 'Cetak Struk' }).click();
				await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
				return (await receipt.getByText(/Nomor pesanan:/).textContent()).trim();
			})
		);
		expect(new Set(orderNumbers).size).toBe(2);
		await pages[1].getByRole('checkbox', { name: /menutup shift/ }).check();
		await pages[1].getByLabel('PIN toko').fill('9876');
		await pages[1].getByRole('button', { name: 'Tutup Toko', exact: true }).click();
		await expect(pages[1].getByText(/Shift ditutup/)).toBeVisible();
		expect(errors).toEqual([]);
	} finally {
		try {
			await browser?.close();
		} finally {
			await stop();
		}
	}
}

// Test-only gateway. No account, remote target, or production routing decisions.
export async function exerciseBranchOrigin({ backends, password, username, setQuota, verify }) {
	const secret = randomBytes(32);
	const signedRoute = (branch) =>
		branch + '.' + createHmac('sha256', secret).update(branch).digest('base64url');
	const unavailable = 'samarinda';
	const healthy = ['balikpapan', 'berau'];
	let quota = null;
	const { origin, errors, stop } = await startBrowserOrigin(async (createApp) => {
		const publicApp = await createApp();
		const apps = new Map();
		for (const branch of backends.keys()) apps.set(branch, await createApp());
		return async (request) => {
			const { pathname } = new URL(request.url);
			const login = request.method === 'POST' && pathname === '/api/veriflogin';
			if (request.method === 'GET' && ['/login', '/api/csrf'].includes(pathname))
				return publicApp.respond(request, { getClientAddress: () => '127.0.0.1' });
			const route = request.headers.get('cookie')?.match(/(?:^|;\s*)fixture_route=([^;]+)/)?.[1];
			const branch = login
				? (
						await request
							.clone()
							.json()
							.catch(() => null)
					)?.branch
				: route?.split('.')[0];
			const app = apps.get(branch);
			if (!app || (!login && route !== signedRoute(branch)))
				return new Response(null, { status: login ? 400 : 401 });
			const { db, bridge } = backends.get(branch);
			const result = await app.respond(
				request,
				backendOptions(branch, db, bridge, branch === unavailable ? quota : null)
			);
			if (!login || !result.ok || (await result.clone().json()).success !== true) return result;
			const response = new Response(result.body, result);
			response.headers.append(
				'Set-Cookie',
				'fixture_route=' + signedRoute(branch) + '; Path=/; HttpOnly; SameSite=Strict'
			);
			return response;
		};
	});

	let browser;
	try {
		browser = await chromium.launch();
		for (const fault of ['read', 'write', 'both']) {
			console.log(`branch-origin: injecting ${fault} quota failure in Samarinda`);
			quota = fault;
			await setQuota(unavailable, fault);
			const cold = await browser.newContext({ serviceWorkers: 'block' });
			try {
				const csrf = await cold.request.get(origin + '/api/csrf', { timeout: 8000 });
				const headers = { origin, 'x-csrf-token': (await csrf.json()).token };
				const auth = (branch) =>
					cold.request.post(origin + '/api/veriflogin', {
						headers,
						timeout: 10000,
						data: { branch, username, password }
					});
				expect((await auth('invalid')).status()).toBe(400);
				expect((await auth(unavailable)).status()).toBe(503);
				expect((await cold.cookies()).some(({ name }) => name === 'fixture_route')).toBe(false);
				await cold.addCookies([
					{ name: 'fixture_route', value: 'balikpapan.invalid', url: origin }
				]);
				expect((await cold.request.get(origin + '/operasional')).status()).toBe(401);
			} finally {
				await cold.close();
			}
			await Promise.all(
				healthy.map(async (branch) => {
					const context = await browser.newContext({ serviceWorkers: 'block' });
					try {
						await context.addInitScript(() => {
							window.print = () => document.body.setAttribute('data-print-called', 'true');
						});
						const page = await context.newPage();
						await loginFromBrowser(page, origin, { branch, username, password });
						await expect(page).toHaveURL(origin + '/operasional');
						await expect(
							page.getByText(
								'kasir berhasil masuk untuk cabang ' + branch + ' dengan HP terdaftar.'
							)
						).toBeVisible();
						await page.getByLabel(/Modal awal/).fill('100000');
						await page.getByLabel('PIN toko').fill('9876');
						await page.getByRole('button', { name: 'Buka Toko', exact: true }).click();
						await expect(page.getByText(/Kios sudah buka/)).toBeVisible();
						await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
						await page.getByLabel('Produk 1').selectOption('juice');
						await page.getByLabel(/Uang diterima/).fill('10000');
						await page.getByRole('button', { name: 'Catat Pembayaran' }).click();
						const receipt = page.getByRole('region', { name: 'Struk kios' });
						await expect(receipt).toContainText('Total: Rp10.000');
						await expect(page.locator('main[data-hydrated="true"]')).toBeVisible();
						await receipt.getByRole('button', { name: 'Cetak Struk' }).click();
						await expect(page.locator('body')).toHaveAttribute('data-print-called', 'true');
						await page.getByRole('checkbox', { name: /menutup shift/ }).check();
						await page.getByLabel('PIN toko').fill('9876');
						await page.getByRole('button', { name: 'Tutup Toko', exact: true }).click();
						await expect(page.getByText(/Shift ditutup/)).toBeVisible();
					} finally {
						await context.close();
					}
				})
			);
			await verify(healthy);
			console.log(`branch-origin: verified healthy branches with Samarinda ${fault} quota failure`);
		}
		expect(errors).toEqual([]);
	} finally {
		try {
			await browser?.close();
		} finally {
			await stop();
		}
	}
}
