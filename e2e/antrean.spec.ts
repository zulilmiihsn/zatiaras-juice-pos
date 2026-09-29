import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	if (!existsSync('.env')) throw new Error('UAT_PASSWORD tidak tersedia');
	const password = readFileSync('.env', 'utf8')
		.split(/\r?\n/)
		.find((line) => line.startsWith('UAT_PASSWORD='))
		?.slice('UAT_PASSWORD='.length)
		.trim();
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

async function loginAsOwner(page: Page) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill('pemilik');
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok(), `Login UI gagal: ${response.status()} ${await response.text()}`).toBe(true);
	await expect(page).toHaveURL(/\/{1}$/);
}

async function cleanupTransaction(page: Page, transactionId: string) {
	const result = await page.evaluate(async (id) => {
		const csrfResponse = await fetch('/api/csrf');
		const csrf = (await csrfResponse.json()) as { token?: string };
		if (!csrfResponse.ok || !csrf.token) return { ok: false, status: csrfResponse.status };
		const response = await fetch(`/api/transaksi-kasir?transaction_id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { 'X-CSRF-Token': csrf.token }
		});
		return { ok: response.ok, status: response.status };
	}, transactionId);
	expect(result.ok, `Cleanup transaksi gagal: ${result.status}`).toBe(true);
}

test('owner checkout appears in Antrean and can be completed then reopened', async ({ page }) => {
	await loginAsOwner(page);
	let transactionId = '';
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	try {
		await page.goto('/pos');
		const product = page.getByRole('button', {
			name: /(?:Pilih|Tambah) Es Teh UAT/
		});
		await expect(product).toBeVisible({ timeout: 60_000 });
		await product.click();
		await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();

		const openCart = page.getByRole('button', { name: /^Buka keranjang/ });
		if (await openCart.isVisible({ timeout: 2000 }).catch(() => false)) {
			await openCart.click();
			await page.getByRole('button', { name: /^Lanjut ke Pembayaran/ }).click();
		} else {
			await page.getByRole('button', { name: /^Bayar Rp/ }).click();
		}

		await expect(page).toHaveURL(/\/pos\/bayar$/);
		await page.getByLabel('Nama Pelanggan').fill(customer);
		await page.getByRole('button', { name: 'Tunai', exact: true }).click();
		await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi', exact: true }).click();
		await expect(page.getByText('Pembayaran Tunai', { exact: true })).toBeVisible();
		await page.getByPlaceholder('0', { exact: true }).fill('12000');
		const checkoutResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/pos/transaction') && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Selesai', exact: true }).click();
		const response = await checkoutResponse;
		expect(response.ok()).toBe(true);
		const payload = (await response.json()) as {
			data?: { transaction_id?: string };
		};
		transactionId = payload.data?.transaction_id || '';
		expect(transactionId).not.toBe('');
		await expect(page.getByText('Transaksi Berhasil!', { exact: true })).toBeVisible();
		const orderLabel = await page
			.getByText(/^No\. Pesanan: [A-F0-9]{6}-[A-F0-9]{6}$/)
			.textContent();
		expect(orderLabel).toBeTruthy();

		// Masuk Antrean dari modal sukses.
		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(card.getByText(orderLabel!)).toBeVisible();
		await expect(card.getByText('Hari ini', { exact: true })).toBeVisible();
		await expect(card.getByText('Es Teh UAT', { exact: false })).toBeVisible();

		// Tandai selesai lalu pastikan pindah ke tab Selesai.
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const doneCard = page.locator('article', { hasText: customer });
		await expect(doneCard).toBeVisible({ timeout: 30_000 });
		await expect(doneCard.getByText(orderLabel!)).toBeVisible();
		await expect(doneCard.getByText('Total Rp10.000')).toBeVisible();
		await expect(doneCard.getByText('Es Teh UAT', { exact: false })).toHaveCount(0);
		await doneCard.getByRole('button', { name: /lihat detail pesanan/i }).click();
		const detail = page.getByRole('dialog');
		await expect(detail).toBeVisible();
		await expect(detail.getByText('Es Teh UAT', { exact: false })).toBeVisible();
		await expect(detail.getByText(orderLabel!)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(detail).toHaveCount(0);
		await expect(doneCard.getByRole('button', { name: /lihat detail pesanan/i })).toBeFocused();

		// Buka lagi lalu pastikan kembali ke tab Belum selesai, tahan reload.
		await doneCard.getByRole('button', { name: /buka lagi/i }).click();
		await page.getByRole('tab', { name: /^Belum selesai/ }).click();
		await expect(page.locator('article', { hasText: customer })).toBeVisible({
			timeout: 30_000
		});
		await page.reload();
		await expect(page.locator('article', { hasText: customer })).toBeVisible({
			timeout: 30_000
		});
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});
