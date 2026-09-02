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
	await expect(page).toHaveURL(/\/$/);
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

test('owner completes authoritative cash checkout through POS UI', async ({ page }) => {
	await loginAsOwner(page);
	let transactionId = '';
	try {
		await page.goto('/pos');
		const product = page.getByRole('button', {
			name: /(?:Pilih|Tambah) Es Teh UAT/
		});
		// First POS load compiles the catalog route in dev mode; allow the same cold-start budget as login.
		await expect(product).toBeVisible({ timeout: 60_000 });
		await product.click();
		await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();

		const openCart = page.getByRole('button', { name: /^Buka keranjang/ });
		if (await openCart.isVisible({ timeout: 2000 }).catch(() => false)) {
			await openCart.click();
			await page.getByRole('button', { name: /^Lanjut ke Pembayaran/ }).click();
		} else {
			const bayarButton = page.getByRole('button', { name: /^Bayar Rp/ });
			await bayarButton.click();
		}

		await expect(page).toHaveURL(/\/pos\/bayar$/);
		await page.getByLabel('Nama Pelanggan').fill('UAT Browser POS');
		await page.getByRole('button', { name: 'Tunai', exact: true }).click();
		await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi', exact: true }).click();

		await expect(page.getByText('Pembayaran Tunai', { exact: true })).toBeVisible();
		const cashInput = page.getByPlaceholder('0', { exact: true });
		await cashInput.fill('12000');
		await expect(cashInput).toHaveValue('12.000');
		await page.getByRole('button', { name: 'C', exact: true }).click();
		await page.getByRole('button', { name: 'Rp 10.000', exact: true }).click();
		await expect(cashInput).toHaveValue('10.000');
		const checkoutResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/pos/transaction') && response.request().method() === 'POST'
		);
		await page.getByRole('button', { name: 'Selesai', exact: true }).click();
		const response = await checkoutResponse;
		expect(response.ok()).toBe(true);
		const payload = (await response.json()) as {
			data?: {
				transaction_id?: string;
				total_amount?: number;
				receipt?: { total_amount?: number };
			};
		};
		transactionId = payload.data?.transaction_id || '';
		expect(transactionId).not.toBe('');
		expect(payload.data?.total_amount).toBe(10_000);
		expect(payload.data?.receipt?.total_amount).toBe(10_000);
		await expect(page.getByText('Transaksi Berhasil!', { exact: true })).toBeVisible();
		await expect(page.getByText('Rp 10.000', { exact: true }).first()).toBeVisible();
	} finally {
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

test('pending queue detail stays synchronized and owner can export then remove', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await context.setOffline(true);
	await page.evaluate(async () => {
		const now = new Date().toISOString();
		const entry = {
			queue_id: 'e2e-offline-queue',
			type: 'pos_transaction',
			status: 'failed',
			created_at: now,
			updated_at: now,
			attempt_count: 2,
			next_attempt_at: Number.MAX_SAFE_INTEGER,
			last_error: 'Sesi toko transaksi offline tidak valid',
			failure_kind: 'conflict',
			request: {
				idempotency_key: 'e2e-offline-checkout',
				metode_bayar: 'tunai',
				cash_received: 10_000,
				mode: 'offline_replay'
			},
			summary: {
				transaction_code: 'JUS-E2E-OFFLINE',
				total_amount: 10_000,
				jumlah_item: 1,
				created_at: now
			}
		};
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('zatiaras-pending-transactions-v2');
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains('pending-transactions')) {
					request.result.createObjectStore('pending-transactions');
				}
			};
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const transaction = request.result.transaction('pending-transactions', 'readwrite');
				transaction.objectStore('pending-transactions').put([entry], 'pending_transactions');
				transaction.oncomplete = () => {
					request.result.close();
					resolve();
				};
				transaction.onerror = () => reject(transaction.error);
			};
		});
		window.dispatchEvent(new CustomEvent('pending-changed'));
	});

	await expect(page.getByTestId('pending-transaction-banner')).toContainText(
		'1 transaksi belum tersinkron'
	);
	await page.getByRole('button', { name: 'Detail', exact: true }).click();
	await expect(page.getByTestId('pending-transaction-sheet')).toContainText('JUS-E2E-OFFLINE');
	await expect(page.getByTestId('pending-transaction-sheet')).toContainText(
		'Sesi toko transaksi offline tidak valid'
	);

	const downloadPromise = page.waitForEvent('download');
	await page
		.getByTestId('pending-transaction-item')
		.getByRole('button', { name: 'Export', exact: true })
		.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toContain('JUS-E2E-OFFLINE');

	await page
		.getByTestId('pending-transaction-item')
		.getByRole('button', { name: 'Hapus lokal', exact: true })
		.click();
	const confirmation = page.getByTestId('pending-removal-confirmation');
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Hapus lokal', exact: true }).click();
	await expect(page.getByTestId('pending-transaction-banner')).toBeHidden();
	await context.setOffline(false);
});
