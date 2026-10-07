import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { ownerUsernameForTest } from './helpers';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	const password = existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: '';
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

async function loginAsOwner(page: Page, title: string) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(title));
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok()).toBe(true);
	await expect(page).toHaveURL(/\/$/);
}

async function csrfPost(page: Page, path: string, data: unknown) {
	const csrf = (await (await page.request.get('/api/csrf')).json()) as { token?: string };
	return page.request.post(path, {
		data,
		headers: csrf.token ? { 'X-CSRF-Token': csrf.token } : {}
	});
}

// AUD-035: kontrak HTTP tanpa provider key — anonim ditolak, kasir ditolak,
// pemilik tanpa key dapat 503 yang jujur (bukan gantung/timeout mentah).
test('hpp parse auth and safe-failure contracts hold', async ({ page, browser }) => {
	// Token CSRF sahih tapi tanpa sesi = 401 auth (bukan tembus).
	const anonymous = await csrfPost(page, '/api/hpp/parse', { text: 'beli gula 2 kg' });
	expect(anonymous.status()).toBe(401);

	// Konteks terisolasi agar cookie kasir tak campur sesi pemilik.
	const kasirContext = await browser.newContext();
	const kasirPage = await kasirContext.newPage();
	await kasirPage.goto('/login');
	await expect(kasirPage.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await kasirPage.getByLabel('Pilih Cabang').selectOption('samarinda');
	await kasirPage.getByPlaceholder('Masukkan username').fill('kasir');
	await kasirPage.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const kasirLogin = kasirPage.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await kasirPage.getByRole('button', { name: 'Masuk', exact: true }).click();
	expect((await kasirLogin).ok()).toBe(true);
	await expect(kasirPage).toHaveURL(/\/$/, { timeout: 30000 });
	const kasirCsrf = (await (await kasirPage.request.get('/api/csrf')).json()) as {
		token?: string;
	};
	const forbidden = await kasirPage.request.post('/api/hpp/parse', {
		data: { text: 'x' },
		headers: kasirCsrf.token ? { 'X-CSRF-Token': kasirCsrf.token } : {}
	});
	expect(forbidden.status()).toBe(403);
	await kasirContext.close();

	await loginAsOwner(page, test.info().title);
	// Tanpa key (503) atau upstream sandbox gagal (502): kontrak aman sama —
	// pesan Indonesia, tanpa bocor key. Pesan 502 eksak membuktikan mapping.
	const noKey = await csrfPost(page, '/api/hpp/parse', { text: 'beli gula 2 kg' });
	expect([503, 502, 422]).toContain(noKey.status());
	const body = (await noKey.json()) as { code?: string; message?: string };
	if (noKey.status() === 502) {
		expect(body.message).toBe(
			'AI gagal membaca cerita belanja. Coba tulis lebih jelas atau input manual.'
		);
	} else {
		expect(typeof body.message === 'string' && body.message.length > 0).toBe(true);
	}
	expect(JSON.stringify(body).includes('OPENROUTER_API_KEY')).toBe(false);
});

// AUD-035: bukti wiring rute — rentetan cepat menyentuh 429 SEBELUM upstream.
// Tanpa limit rute (kode lama), semua 502 tanpa satu pun 429.
test('hpp parse rate limit rejects burst before upstream', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	const statuses: number[] = [];
	for (let i = 0; i < 21; i++) {
		const res = await csrfPost(page, '/api/hpp/parse', { text: `belanja uji ${i}` });
		statuses.push(res.status());
		if (statuses.filter((s) => s === 429).length >= 1) break;
	}
	expect(statuses).toContain(429);
});
