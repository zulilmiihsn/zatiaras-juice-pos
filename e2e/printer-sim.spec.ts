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
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
}

async function openSimulator(page: Page, title: string) {
	await loginAsOwner(page, title);
	await page.goto('/dev/printer-sim');
	await expect(page.getByRole('button', { name: 'Cetak struk contoh' })).toBeEnabled({
		timeout: 60_000
	});
}

async function printAndWait(page: Page) {
	await page.getByRole('button', { name: 'Cetak struk contoh' }).click();
	const chooser = page.getByRole('dialog');
	if (await chooser.isVisible({ timeout: 3_000 }).catch(() => false)) {
		const device = chooser.getByRole('button', { name: /MTP-II/ });
		if (await device.count()) await device.click();
		else await chooser.getByRole('button', { name: 'Batal' }).click();
	}
	const checks = page.getByTestId('checks');
	// Finished when the tear-bar check is in, or the app reported its own failure and nothing waits.
	await expect
		.poll(
			async () => {
				const text = await checks.innerText();
				const waiting = await checks.locator('[data-level="wait"]').count();
				return text.includes('gigi sobek') || (text.includes('App:') && waiting === 0);
			},
			{ timeout: 240_000, intervals: [1_000] }
		)
		.toBe(true);
	return checks;
}

test.describe('MTP-II simulator', () => {
	test.setTimeout(300_000);

	const methods: Array<{ name: string; setup: (page: Page) => Promise<void> }> = [
		{
			name: 'bluetooth',
			setup: (page) => page.getByLabel('Bluetooth (Web Bluetooth/BLE)').check()
		},
		{ name: 'usb', setup: (page) => page.getByLabel('USB (WebUSB)').check() },
		{
			name: 'intent-rawbt',
			setup: async (page) => {
				await page.getByLabel('Aplikasi Android').check();
				await page.locator('select').first().selectOption('rawbt');
			}
		},
		{
			name: 'intent-print-intent',
			setup: async (page) => {
				await page.getByLabel('Aplikasi Android').check();
				await page.locator('select').first().selectOption('print-intent');
			}
		},
		{ name: 'server', setup: (page) => page.getByLabel('Server Lokal (PC)').check() }
	];

	for (const method of methods) {
		test(`prints a matching receipt via ${method.name}`, async ({ page }, info) => {
			await openSimulator(page, info.title);
			await method.setup(page);
			const checks = await printAndWait(page);
			await page.screenshot({
				path: `test-results/printer-sim-${method.name}.png`,
				fullPage: true
			});
			console.log(`[${method.name}]\n${await checks.innerText()}`);
			await expect(checks.locator('[data-level="fail"]')).toHaveCount(0);
			await expect(checks).toContainText('sama titik demi titik');
		});
	}

	test('classic-only printer never appears in the Web Bluetooth chooser', async ({
		page
	}, info) => {
		await openSimulator(page, info.title);
		await page.getByLabel('Bluetooth (Web Bluetooth/BLE)').check();
		await page.getByLabel('Profil Bluetooth MTP-II').selectOption('spp-only');
		const checks = await printAndWait(page);
		await expect(checks).toContainText('User cancelled the requestDevice() chooser.');
	});

	test('an 80 mm setting is reported as wider than the head', async ({ page }, info) => {
		await openSimulator(page, info.title);
		await page.getByLabel('USB (WebUSB)').check();
		await page.getByLabel('Ukuran kertas di Pengaturan app').selectOption('80mm');
		const checks = await printAndWait(page);
		await expect(checks).toContainText('lebih lebar dari kepala 384 dot');
	});
});
