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

function witaNow(): { date: string; time: string } {
	const now = new Date();
	const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' }).format(now);
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Asia/Makassar',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).format(now);
	return { date, time };
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

async function expectWitaDefaults(page: Page) {
	await page.goto('/catat');
	const dateInput = page.locator('#tanggal-input');
	const timeInput = page.locator('#waktu-input');
	await expect(dateInput).toBeVisible({ timeout: 30000 });
	// Tunggu init klien mengisi default (SSR render kosong dulu).
	await expect.poll(() => dateInput.inputValue(), { timeout: 30000 }).not.toBe('');
	const expected = witaNow();
	expect(await dateInput.inputValue()).toBe(expected.date);
	// Toleransi 2 menit antara hitung ekspektasi dan render.
	const actual = await timeInput.inputValue();
	const toMin = (hm: string) => {
		const [h, m] = hm.split(':').map(Number);
		return h * 60 + m;
	};
	expect(Math.abs(toMin(actual) - toMin(expected.time))).toBeLessThanOrEqual(2);
}

// AUD-026: default Catat ikut WITA walau zona perangkat asing.
test.describe('catat defaults on UTC-11 device', () => {
	test.use({ timezoneId: 'Pacific/Midway' });

	test('defaults match WITA on UTC-11 device', async ({ page }) => {
		await loginAsOwner(page, test.info().title);
		await expectWitaDefaults(page);
	});
});

test.describe('catat defaults on WIB device', () => {
	test.use({ timezoneId: 'Asia/Jakarta' });

	test('defaults match WITA on WIB device', async ({ page }) => {
		await loginAsOwner(page, test.info().title);
		await expectWitaDefaults(page);
	});
});
