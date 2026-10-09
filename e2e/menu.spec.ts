import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { ownerUsernameForTest } from './helpers';

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
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(test.info().title));
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

test.describe('Menu Management Behavioral Flows', () => {
	test('menu route protects unauthorized access and enforces security boundary', async ({
		page
	}) => {
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		// Must protect endpoint from unauthenticated access
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByLabel('Pilih Cabang')).toBeVisible();
	});

	test('login page contains required branches in selector', async ({ page }) => {
		await page.goto('/login');
		const branchSelect = page.getByLabel('Pilih Cabang');
		await expect(branchSelect).toBeVisible();

		// Check options
		const options = await branchSelect.locator('option').allTextContents();
		expect(options.some((opt) => /samarinda/i.test(opt))).toBe(true);
		expect(options.some((opt) => /balikpapan/i.test(opt))).toBe(true);
	});

	test('delete dialog opens with correct copy and cancel closes without deleting', async ({
		page
	}) => {
		await loginAsOwner(page);
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		const deleteButton = page.getByRole('button', { name: 'Hapus Menu', exact: true }).first();
		await expect(deleteButton).toBeVisible({ timeout: 60_000 });
		await deleteButton.click();
		await expect(page.getByRole('heading', { name: 'Hapus Menu?' })).toBeVisible();
		await expect(page.getByText('Menu yang dihapus tidak dapat dikembalikan')).toBeVisible();
		await page.getByRole('button', { name: 'Batal', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Hapus Menu?' })).toBeHidden();
	});

	test('kategori form creates then deletes without leftovers', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		// Tunggu hidrasi + tab Menu default terisi agar klik tab tak hilang pre-hidrasi.
		await expect(page.getByRole('button', { name: 'Tambah Menu' })).toBeVisible({
			timeout: 60_000
		});
		// Hidrasi halaman berat tertinggal dari paint SSR: klik tab bisa hilang
		// sebelum listener Svelte terpasang. Ulangi sampai efek terlihat.
		const tambahKategori = page
			.getByRole('button', { name: 'Tambah Kategori', exact: true })
			.first();
		let switched = false;
		for (let attempt = 0; attempt < 30 && !switched; attempt += 1) {
			await page.getByRole('button', { name: 'Kategori', exact: true }).click({ timeout: 15_000 });
			await page.waitForTimeout(2000);
			switched = await tambahKategori.isVisible();
		}
		expect(switched).toBe(true);
		await tambahKategori.click();
		await expect(page.getByRole('heading', { name: 'Tambah Kategori' })).toBeVisible();

		const name = `Kat UAT ${Date.now() % 100000}`;
		await page.getByLabel('Nama Kategori').fill(name);
		await page.getByRole('button', { name: 'Simpan Kategori', exact: true }).click();
		const card = page.locator('div[role="button"]', { hasText: name });
		await expect(card).toBeVisible({ timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Tambah Kategori' })).toBeHidden();

		await card.getByRole('button', { name: 'Hapus Kategori', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Hapus Kategori?' })).toBeVisible();
		await page.getByRole('button', { name: 'Hapus', exact: true }).click();
		await expect(card).toBeHidden({ timeout: 60_000 });
	});

	test('ekstra form creates then deletes without leftovers', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		await expect(page.getByRole('button', { name: 'Tambah Menu' })).toBeVisible({
			timeout: 60_000
		});
		const tambahEkstra = page.getByRole('button', { name: 'Tambah Tambahan', exact: true }).first();
		let switched = false;
		for (let attempt = 0; attempt < 30 && !switched; attempt += 1) {
			await page.getByRole('button', { name: 'Tambahan', exact: true }).click({ timeout: 15_000 });
			await page.waitForTimeout(2000);
			switched = await tambahEkstra.isVisible();
		}
		expect(switched).toBe(true);
		await tambahEkstra.click();
		await expect(page.getByRole('heading', { name: 'Tambah Tambahan' })).toBeVisible();

		const name = `Eks UAT ${Date.now() % 100000}`;
		await page.getByLabel('Nama Tambahan').fill(name);
		await page.getByLabel('Harga Tambahan').fill('3000');
		await page.getByRole('button', { name: 'Simpan Tambahan', exact: true }).click();
		const card = page.locator('div[role="button"]', { hasText: name });
		await expect(card).toBeVisible({ timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Tambah Tambahan' })).toBeHidden();

		await card.getByRole('button', { name: 'Hapus Tambahan', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Hapus Ekstra?' })).toBeVisible();
		await page.getByRole('button', { name: 'Hapus', exact: true }).click();
		await expect(card).toBeHidden({ timeout: 60_000 });
	});

	test('menu form creates then deletes without leftovers', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		const tambahMenu = page.getByRole('button', { name: 'Tambah Menu', exact: true }).first();
		await expect(tambahMenu).toBeVisible({ timeout: 60_000 });
		// Klik bisa hilang pre-hidrasi seperti tab: ulangi sampai modal terbuka.
		const tambahHeading = page.getByRole('heading', { name: 'Tambah Menu Baru' });
		let opened = false;
		for (let attempt = 0; attempt < 30 && !opened; attempt += 1) {
			await tambahMenu.click({ timeout: 15_000 });
			await page.waitForTimeout(2000);
			opened = await tambahHeading.isVisible();
		}
		expect(opened).toBe(true);

		const name = `Menu UAT ${Date.now() % 100000}`;
		await page.getByLabel('Nama Menu').fill(name);
		await page.getByLabel('Harga Reguler').fill('12000');
		await page.getByRole('button', { name: 'Simpan Menu', exact: true }).click();
		const card = page.locator('div[role="button"]', { hasText: name });
		await expect(card).toBeVisible({ timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Tambah Menu Baru' })).toBeHidden();

		await card.getByRole('button', { name: 'Hapus Menu', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Hapus Menu?' })).toBeVisible();
		await page.getByRole('button', { name: 'Hapus', exact: true }).click();
		await expect(card).toBeHidden({ timeout: 60_000 });
	});

	test('bahan form creates then deletes without leftovers', async ({ page }) => {
		await loginAsOwner(page);
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		await expect(page.getByRole('button', { name: 'Tambah Menu' })).toBeVisible({
			timeout: 60_000
		});
		const tambahBahan = page.getByRole('button', { name: 'Tambah Bahan', exact: true }).first();
		let switched = false;
		for (let attempt = 0; attempt < 30 && !switched; attempt += 1) {
			await page.getByRole('button', { name: 'Bahan', exact: true }).click({ timeout: 15_000 });
			await page.waitForTimeout(2000);
			switched = await tambahBahan.isVisible();
		}
		expect(switched).toBe(true);
		await tambahBahan.click();
		await expect(page.getByRole('heading', { name: 'Tambah Bahan Baku' })).toBeVisible();

		const name = `Bahan UAT ${Date.now() % 100000}`;
		await page.getByLabel('Nama Bahan').fill(name);
		await page.getByRole('button', { name: 'Simpan Bahan', exact: true }).click();
		const card = page.locator('div[role="button"]', { hasText: name });
		await expect(card).toBeVisible({ timeout: 60_000 });
		await expect(page.getByRole('heading', { name: 'Tambah Bahan Baku' })).toBeHidden();

		await card.getByRole('button', { name: 'Ubah Stok Bahan', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Ubah Stok Bahan' })).toBeVisible();
		await page.getByLabel('Jumlah Perubahan').fill('2');
		await page.getByRole('button', { name: 'Simpan', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Ubah Stok Bahan' })).toBeHidden();

		await card.getByRole('button', { name: 'Hapus Bahan Baku', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Hapus Bahan?' })).toBeVisible();
		await page.getByRole('button', { name: 'Hapus', exact: true }).click();
		await expect(card).toBeHidden({ timeout: 60_000 });
	});
});
