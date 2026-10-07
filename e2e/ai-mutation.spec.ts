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
		{ type: 'pemasukan', amount: 75001, deskripsi: 'Setoran modal mutasi', confidence: 0.95 }
	],
	confidence: 0.9,
	recommendations: [
		{
			id: 'rec-ok-modal',
			action: 'create_transaction',
			title: 'Catat setoran modal',
			deskripsi: 'Setoran modal mutasi Rp75.001',
			data: { type: 'pemasukan', amount: 75001, deskripsi: 'Setoran modal mutasi' },
			priority: 'high'
		},
		{
			id: 'rec-evil-action',
			action: 'delete_branch',
			title: 'Hapus cabang',
			deskripsi: 'Hapus semua data cabang',
			data: { branch: 'berau' },
			priority: 'high'
		},
		{
			id: 'rec-neg-amount',
			action: 'create_transaction',
			title: 'Catat minus',
			deskripsi: 'Minus Rp5.000',
			data: { type: 'pengeluaran', amount: -5000, deskripsi: 'Minus' },
			priority: 'medium'
		},
		{
			id: 'rec-foreign-update',
			action: 'update_transaction',
			title: 'Koreksi target asing',
			deskripsi: 'Ubah target asing',
			data: {
				id: 'bk-tidak-ada-di-cabang-ini',
				type: 'pengeluaran',
				amount: 1000,
				deskripsi: 'Koreksi target asing',
				category: 'beban_usaha'
			},
			priority: 'medium'
		},
		{
			id: 'rec-mismatch',
			action: 'create_transaction',
			title: 'Catat 10rb',
			deskripsi: 'Dana titipan jelas',
			data: {
				type: 'pemasukan',
				amount: 99999999,
				deskripsi: 'Dana titipan jelas',
				category: 'pendapatan_usaha'
			},
			priority: 'medium'
		}
	]
};

// AUD-033: mutasi sembunyi diblokir; valid terapkan sekali; consent tampilkan
// nilai tervalidasi (bukan teks model).
test('malicious recommendations cannot mutate, valid applies once', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await page.route('**/api/aichat?action=analyze', async (route) => {
		await route.fulfill({ json: MOCK_ANALYSIS });
	});

	await page.getByLabel('Buka AI Assistant').click();
	const chatbox = page.locator('textarea');
	await expect(chatbox).toBeVisible({ timeout: 15000 });
	await chatbox.fill('setor modal dan lain-lain');
	await page.keyboard.press('Enter');
	await expect(page.getByText('Catat setoran modal', { exact: true })).toBeVisible({
		timeout: 30000
	});

	// Aksi asing + amount negatif gugur di parse (tak tampil di consent).
	await expect(page.getByText('Hapus cabang', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Catat minus', { exact: true })).toHaveCount(0);
	// Consent tampilkan nominal tervalidasi, bukan judul model.
	await expect(page.getByText('Rp 99.999.999', { exact: false }).first()).toBeVisible();
	await expect(page.getByText('Target bk-tidak…', { exact: false }).first()).toBeVisible();

	const terapkan = page.getByRole('button', { name: 'Terapkan Rekomendasi' });
	await terapkan.scrollIntoViewIfNeeded();
	await terapkan.evaluate((el: HTMLElement) => el.click());
	await expect(page.getByText(/gagal diterapkan/).first()).toBeVisible({ timeout: 45000 });

	// Valid terapkan tepat sekali sebagai Lainnya; mismatch ikut sebagai usaha;
	// target asing + rec gugur tak menulis apa pun.
	// Nominal/deskripsi unik per spec (ai-category memakai 75000 di DB server bersama).
	const ledgerModal = await page.request.get(
		`/api/buku-kas?search=${encodeURIComponent('Setoran modal mutasi')}`
	);
	expect(ledgerModal.ok()).toBe(true);
	const modalRows = (await ledgerModal.json()) as Array<{ jenis?: string; nominal?: number }>;
	expect(modalRows.filter((row) => row.nominal === 75001).length).toBe(1);
	expect(modalRows.find((row) => row.nominal === 75001)?.jenis).toBe('lainnya');

	const ledgerMismatch = await page.request.get(
		`/api/buku-kas?search=${encodeURIComponent('Dana titipan jelas')}`
	);
	const mismatchRows = (await ledgerMismatch.json()) as Array<{ nominal?: number }>;
	expect(mismatchRows.filter((row) => row.nominal === 99999999).length).toBe(1);

	const ledgerForeign = await page.request.get(
		`/api/buku-kas?search=${encodeURIComponent('Koreksi target asing')}`
	);
	expect(((await ledgerForeign.json()) as Array<unknown>).length).toBe(0);
});
