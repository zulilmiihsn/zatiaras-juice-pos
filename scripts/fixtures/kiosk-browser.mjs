import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { getRequest, setResponse } from '@sveltejs/kit/node';
import { chromium, expect } from '@playwright/test';

export async function exerciseKioskBrowser({
	db,
	branch,
	quota,
	bridge,
	password,
	username,
	rollback = false
}) {
	const { Server } = await import('../../.svelte-kit/output/server/index.js');
	const { manifest } = await import('../../.svelte-kit/cloudflare-tmp/manifest.js');
	const assets = resolve('.svelte-kit/cloudflare');
	const app = new Server(manifest);
	await app.init({ env: {}, read: (path) => readFile(resolve(assets, path)) });
	const errors = [];
	let outage = false;
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
			const response = await app.respond(request, {
				getClientAddress: () => '127.0.0.1',
				platform: {
					env: {
						KIOSK_PRODUCTION_PILOT: 'samarinda,balikpapan,berau',
						REALTIME_HUB: {
							idFromName: (name) => name,
							get: () => ({
								fetch: async (req) => {
									const path = new URL(req.url).pathname;
									if (path === '/rate-limit') return Response.json({ allowed: true });
									return bridge(path, await req.json());
								}
							})
						},
						[`DB_${branch.toUpperCase()}_GROUP`]: !outage
							? db
							: {
									prepare: (sql) => {
										if (quota === 'read' || !/^\s*SELECT\b/i.test(sql))
											throw new Error(`D1_ERROR: daily ${quota} limit exceeded`);
										return db.prepare(sql);
									}
								}
					}
				}
			});
			await setResponse(outgoing, response);
		} catch (error) {
			errors.push(error);
			outgoing.writeHead(500).end();
		}
	});
	server.listen(0, 'localhost');
	await once(server, 'listening');
	const origin = `http://localhost:${server.address().port}`;
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
			const action = page.getByRole('button', {
				name: 'Kembali ke kasir lama',
				exact: true
			});
			await expect(action).toBeDisabled();
			await page.getByRole('checkbox', { name: /Saya ingin kembali ke kasir lama/ }).check();
			await expect(action).toBeEnabled();
			const rollbackResponse = page.waitForResponse(
				(response) =>
					response.request().method() === 'PATCH' &&
					new URL(response.url()).pathname === '/api/perangkat-kasir'
			);
			await action.click();
			const response = await rollbackResponse;
			expect(response.ok(), `${branch}: ${await response.text()} ${errors.join('; ')}`).toBe(true);
			await expect(
				page.getByText(/Kasir lama .* sudah bisa digunakan kembali\./, {
					exact: true
				})
			).toBeVisible();
			return;
		}
		const login = async (page) => {
			await page.goto(origin + '/login');
			await expect(page.locator('form[data-hydrated="true"]')).toBeVisible();
			await page.getByLabel('Pilih Cabang').selectOption(branch);
			await page.getByPlaceholder('Masukkan username').fill(username);
			await page.getByPlaceholder('Masukkan password').fill(password);
			await page.getByRole('button', { name: 'Masuk', exact: true }).click();
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
			await new Promise((resolveClose) => server.close(resolveClose));
		}
	}
}
