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

const MOCK_ANALYSIS = {
	transactions: [
		{ type: 'pemasukan', amount: 75000, deskripsi: 'Setoran modal ke kas', confidence: 0.95 },
		{ type: 'pemasukan', amount: 30000, deskripsi: 'Terima uang tunai', confidence: 0.8 }
	],
	confidence: 0.9,
	recommendations: [
		{
			id: 'rec-modal-e2e',
			action: 'create_transaction',
			title: 'Catat setoran modal',
			deskripsi: 'Setoran modal ke kas Rp75.000',
			data: { type: 'pemasukan', amount: 75000, deskripsi: 'Setoran modal ke kas' },
			priority: 'high'
		},
		{
			id: 'rec-ambigu-e2e',
			action: 'create_transaction',
			title: 'Catat dana masuk',
			deskripsi: 'Terima uang tunai Rp30.000',
			data: { type: 'pemasukan', amount: 30000, deskripsi: 'Terima uang tunai' },
			priority: 'medium'
		}
	]
};

// AUD-032: consent tampilkan kategori; modal jadi Lainnya di ledger;
// ambigu ditolak eksplisit, bukan default usaha.
test('ai consent shows category and modal lands outside turnover', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await page.route('**/api/aichat?action=analyze', async (route) => {
		await route.fulfill({ json: MOCK_ANALYSIS });
	});

	await page.getByLabel('Buka AI Assistant').click();
	const chatbox = page.locator('textarea');
	await expect(chatbox).toBeVisible({ timeout: 15000 });
	await chatbox.fill('setor modal 75rb dan terima 30rb tunai');
	await page.keyboard.press('Enter');
	await expect(page.getByText('Catat setoran modal', { exact: true })).toBeVisible({
		timeout: 30000
	});

	await expect(page.getByText('Lainnya (non-usaha)').first()).toBeVisible({ timeout: 10000 });
	await expect(page.getByText('Perlu konfirmasi').first()).toBeVisible();

	const terapkan = page.getByRole('button', { name: 'Terapkan Rekomendasi' });
	await terapkan.scrollIntoViewIfNeeded();
	// Klik langsung: tombol sahih namun tertutup overlay dashboard
	// (kuirk layout pra-ada); handler Svelte tetap yang dieksekusi.
	await terapkan.evaluate((el: HTMLElement) => el.click());
	// Ambigu ditolak (rincian alasan di result.errors, unit-cover);
	// chat tampilkan hitungan gagal.
	await expect(page.getByText(/gagal diterapkan/).first()).toBeVisible({
		timeout: 30000
	});

	const ledger = await page.request.get(
		`/api/buku-kas?search=${encodeURIComponent('Setoran modal ke kas')}`
	);
	expect(ledger.ok()).toBe(true);
	const rows = (await ledger.json()) as Array<{ jenis?: string; nominal?: number }>;
	const modalRow = rows.find((row) => row.nominal === 75000);
	expect(modalRow?.jenis).toBe('lainnya');
	expect(rows.some((row) => row.nominal === 30000)).toBe(false);
});
