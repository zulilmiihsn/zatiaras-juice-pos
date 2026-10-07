import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

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

async function loginBranch(page: Page, branch: string, username: string) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption(branch);
	await page.getByPlaceholder('Masukkan username').fill(username);
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

// AUD-029: label header ikut cabang sesi terautentikasi, semua cabang + alias.
for (const [branch, username, label] of [
	['samarinda', 'pemilik', 'Samarinda'],
	['berau', 'owner-e2e', 'Berau'],
	['balikpapan', 'owner-e2e', 'Balikpapan'],
	['samarinda2', 'owner-e2e', 'Samarinda 2'],
	['balikpapan2', 'owner-e2e', 'Balikpapan 2']
] as const) {
	test(`header shows ${label} for ${branch} session`, async ({ page }) => {
		await loginBranch(page, branch, username);
		await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 30000 });
	});
}

// AUD-029: tak ada campuran — sesi berau tak boleh tulis Samarinda.
test('berau session never shows Samarinda label', async ({ page }) => {
	await loginBranch(page, 'berau', 'owner-e2e');
	await expect(page.getByText('Berau', { exact: true }).first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByText('Samarinda', { exact: true })).toHaveCount(0);
	await page.reload();
	await expect(page.getByText('Berau', { exact: true }).first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByText('Samarinda', { exact: true })).toHaveCount(0);
});
