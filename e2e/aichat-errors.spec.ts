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

// AUD-037: kontrak negatif rute tetap — auth, validasi, dan kode klien sah.
// Tanpa provider key, kegagalan upstream non-stream 500 generik (aman).
test('aichat negative contracts stay stable', async ({ page }) => {
	const anonymous = await csrfPost(page, '/api/aichat', { text: 'halo' });
	expect(anonymous.status()).toBe(401);

	await loginAsOwner(page, test.info().title);

	const empty = await csrfPost(page, '/api/aichat?action=analyze', { text: '' });
	expect(empty.status()).toBe(400);
	expect(((await empty.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');

	const long = await csrfPost(page, '/api/aichat?action=analyze', { text: 'x'.repeat(2001) });
	expect(long.status()).toBe(400);
	expect(((await long.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');

	const chatEmpty = await csrfPost(page, '/api/aichat', { question: '' });
	expect(chatEmpty.status()).toBe(400);
	expect(((await chatEmpty.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');
});
