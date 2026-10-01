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

interface UatOrder {
	transactionId: string;
	orderLabel: string;
	customer: string;
}

/** Checkout tunai 1 Es Teh UAT jumbo + gula/es non-normal; kembalikan identitasnya. */
async function checkoutUatOrder(page: Page, customer: string): Promise<UatOrder> {
	await page.goto('/pos');
	const product = page.getByRole('button', {
		name: /(?:Pilih|Tambah) Es Teh UAT/
	});
	await expect(product).toBeVisible({ timeout: 60_000 });
	await product.click();
	await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: 'Sedikit Gula', exact: true }).click();
	await page.getByRole('button', { name: 'Tanpa Es', exact: true }).click();
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
	const transactionId = payload.data?.transaction_id || '';
	expect(transactionId).not.toBe('');
	await expect(page.getByText('Transaksi Berhasil!', { exact: true })).toBeVisible();
	const orderChip = page.getByLabel(/^Nomor pesanan \d+$/);
	await expect(orderChip).toBeVisible();
	const orderLabel = (await orderChip.textContent())?.trim() ?? '';
	expect(orderLabel).toMatch(/^\d{3,}$/);
	return { transactionId, orderLabel, customer };
}

test('owner checkout appears in Antrean with Indonesian labels', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		// Masuk Antrean dari modal sukses.
		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await expect(
			card.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(card.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(card.getByText('Hari ini', { exact: true })).toBeVisible();
		await expect(card.getByText('Es Teh UAT', { exact: false })).toBeVisible();
		await expect(card.getByText('Sedikit Gula', { exact: true })).toBeVisible();
		await expect(card.getByText('Tanpa Es', { exact: true })).toBeVisible();
		await expect(card.getByText('less', { exact: true })).toHaveCount(0);
		await expect(card.getByText('no', { exact: true })).toHaveCount(0);
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

test('completed order moves to Selesai and can be reopened', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });

		// Tandai selesai lalu pastikan pindah ke tab Selesai.
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const doneCard = page.locator('article', { hasText: customer });
		await expect(doneCard).toBeVisible({ timeout: 30_000 });
		await expect(
			doneCard.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(doneCard.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(doneCard.getByText('Total Rp10.000')).toBeVisible();
		await expect(doneCard.getByText('Es Teh UAT', { exact: false })).toHaveCount(0);
		await doneCard.getByRole('button', { name: /lihat detail pesanan/i }).click();
		const detail = page.getByRole('dialog');
		await expect(detail).toBeVisible();
		await expect(detail.getByText('Es Teh UAT', { exact: false })).toBeVisible();
		await expect(
			detail.getByLabel(`Nomor pesanan ${order.orderLabel}`, { exact: true })
		).toBeVisible();
		await expect(detail.getByText(order.orderLabel, { exact: true })).toBeVisible();
		await expect(detail.getByText('Sedikit Gula', { exact: true })).toBeVisible();
		await expect(detail.getByText('Tanpa Es', { exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(detail).toHaveCount(0);
		await expect(doneCard).toBeVisible();

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

test('queue search filters by name and number', async ({ page }) => {
	await loginAsOwner(page);
	const customer = `UAT Antrean ${Date.now().toString().slice(-6)}`;
	let transactionId = '';
	try {
		const order = await checkoutUatOrder(page, customer);
		transactionId = order.transactionId;

		await page.getByRole('button', { name: 'Lihat Antrean', exact: true }).click();
		await expect(page).toHaveURL(/\/antrean/);
		const card = page.locator('article', { hasText: customer });
		await expect(card).toBeVisible({ timeout: 30_000 });
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await expect(card).toHaveCount(0, { timeout: 30_000 });
		await page.getByRole('tab', { name: 'Selesai', exact: true }).click();
		const doneCard = page.locator('article', { hasText: customer });
		await expect(doneCard).toBeVisible({ timeout: 30_000 });

		// Cari nama: daftar tersaring; bersihkan; kata tak cocok; hapus; cari nomor; Escape.
		await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
		const searchBox = page.getByPlaceholder('Cari nama atau nomor pesanan...');
		await expect(searchBox).toBeVisible();
		await searchBox.fill(customer);
		await expect(page.getByText('1 pesanan cocok')).toBeVisible();
		await expect(doneCard).toBeVisible();
		await page.getByRole('button', { name: 'Bersihkan pencarian', exact: true }).click();
		await expect(searchBox).toHaveValue('');
		await expect(doneCard).toBeVisible();
		await searchBox.fill('zzz-tidak-ada');
		await expect(page.getByRole('search').getByText('Tidak ada yang cocok')).toBeVisible();
		await expect(page.getByText('Tidak ada pesanan dengan nama')).toBeVisible();
		await expect(doneCard).toHaveCount(0);
		await page.getByRole('button', { name: 'Hapus pencarian', exact: true }).click();
		await expect(searchBox).toHaveCount(0);
		await expect(doneCard).toBeVisible();
		await page.getByRole('button', { name: 'Cari pesanan', exact: true }).click();
		await searchBox.fill(order.orderLabel.replace(/\D/g, ''));
		await expect(doneCard).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(searchBox).toHaveCount(0);
		await expect(doneCard).toBeVisible();
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});
