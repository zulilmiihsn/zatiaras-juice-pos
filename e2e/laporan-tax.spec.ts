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

async function installAggregateCounter(page: Page): Promise<{ calls: () => number }> {
	let calls = 0;
	await page.route('**/api/reports/aggregate?*', async (route) => {
		calls += 1;
		await route.continue();
	});
	return { calls: () => calls };
}

async function applyFilterType(page: Page, typeName: string): Promise<void> {
	await page.getByLabel('Filter laporan').click();
	await page.getByRole('button', { name: typeName, exact: true }).click();
	await page.getByRole('button', { name: 'Terapkan', exact: true }).click();
	// Tunggu sheet filter tertutup = apply selesai diproses.
	await expect(page.getByRole('button', { name: 'Terapkan', exact: true })).toBeHidden({
		timeout: 15000
	});
}

async function fireTaxEvent(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.dispatchEvent(new CustomEvent('zatiara:tax_settings_updated'));
	});
}

// AUD-028: sesudah ganti filter berkali-kali, satu event pajak = satu refresh.
// Kunci perilaku (lolos di lama via runtuh timer, wajib tetap 1 di baru).
test('one tax event triggers one logical refresh', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await page.goto('/laporan');
	await expect(page).toHaveURL(/\/laporan/);
	await page.waitForTimeout(2000);
	const { calls } = await installAggregateCounter(page);

	await applyFilterType(page, 'Mingguan');
	await applyFilterType(page, 'Bulanan');
	await applyFilterType(page, 'Harian');
	const settled = calls();
	await fireTaxEvent(page);
	await expect.poll(() => calls(), { timeout: 10000 }).toBeGreaterThan(settled);
	await page.waitForTimeout(2500);
	expect(calls()).toBe(settled + 1);
});

// AUD-028: state mati tak reload saat event pajak datang.
test('destroyed report ignores tax events', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await page.goto('/laporan');
	await expect(page).toHaveURL(/\/laporan/);
	await page.waitForTimeout(2000);
	const { calls } = await installAggregateCounter(page);

	await page.getByRole('link', { name: 'Beranda' }).first().click();
	await expect(page).toHaveURL(/\/$/);
	await page.waitForTimeout(1000);
	const settled = calls();
	await fireTaxEvent(page);
	await page.waitForTimeout(2500);
	expect(calls()).toBe(settled);
});
