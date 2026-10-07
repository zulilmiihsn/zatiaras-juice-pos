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

async function loginAsOwner(page: Page) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(test.info().title));
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

async function openCashSheet(page: Page) {
	await page.goto('/pos');
	const product = page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ });
	await expect(product).toBeVisible({ timeout: 60000 });
	await product.click();
	await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: /^Bayar Rp/ }).click();
	await expect(page).toHaveURL(/\/pos\/bayar$/);
	await page.getByLabel('Nama Pelanggan').fill('UAT Sheet Enter');
	await page.getByRole('button', { name: 'Tunai', exact: true }).click();
	const confirm = page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi' });
	const title = page.getByText('Pembayaran Tunai', { exact: true });
	for (let attempt = 0; attempt < 3 && (await title.count()) === 0; attempt++) {
		await confirm.click();
		await title.waitFor({ timeout: 20000 }).catch(() => undefined);
	}
	await expect(title).toBeVisible({ timeout: 15000 });
	const sheet = page.getByRole('dialog', { name: 'Pembayaran Tunai' });
	await expect(sheet).toBeVisible({ timeout: 15000 });
	return sheet;
}

// AUD-025: Enter di input kasir tak boleh buang sheet; nilai utuh.
test('enter in cash input keeps sheet and value', async ({ page }) => {
	await loginAsOwner(page);
	const sheet = await openCashSheet(page);
	const cashInput = sheet.getByPlaceholder('0');
	await cashInput.focus();
	await cashInput.pressSequentially('50000', { delay: 30 });
	await page.keyboard.press('Enter');
	await page.waitForTimeout(500);
	await expect(sheet).toBeVisible();
	expect(await cashInput.inputValue()).toBe('50.000');

	// Tombol tetap aktif (aktivasi button utuh): Uang Pas mengisi nominal.
	await page.getByRole('button', { name: /^Uang Pas/ }).click();
	expect(await cashInput.inputValue()).not.toBe('');

	// Escape batalkan + fokus aman (sheet tutup, halaman bayar utuh).
	await cashInput.focus();
	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden({ timeout: 10000 });
	await expect(page).toHaveURL(/\/pos\/bayar$/);
});
