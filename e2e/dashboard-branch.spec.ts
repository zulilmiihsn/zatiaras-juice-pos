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

// Label header ikut cabang sesi terautentikasi, semua cabang + alias.
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

// Tak ada campuran — sesi berau tak boleh tulis Samarinda.
test('berau session never shows Samarinda label', async ({ page }) => {
	await loginBranch(page, 'berau', 'owner-e2e');
	await expect(page.getByText('Berau', { exact: true }).first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByText('Samarinda', { exact: true })).toHaveCount(0);
	await page.reload();
	await expect(page.getByText('Berau', { exact: true }).first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByText('Samarinda', { exact: true })).toHaveCount(0);
});

test('cashier dashboard loads without a configured PIN', async ({ page }) => {
	const failures: string[] = [];
	page.on('response', (response) => {
		if (new URL(response.url()).pathname.startsWith('/api/dashboard/') && !response.ok()) {
			failures.push(`${new URL(response.url()).pathname}: ${response.status()}`);
		}
	});
	const weekly = page.waitForResponse(
		(response) => new URL(response.url()).pathname === '/api/dashboard/weekly'
	);
	await loginBranch(page, 'samarinda', 'kasir');
	expect((await weekly).ok()).toBe(true);
	await expect(page.getByRole('dialog', { name: 'Akses Terkunci' })).toHaveCount(0);
	await expect(page.getByText('Gagal memuat data dashboard')).toHaveCount(0);
	expect(failures).toEqual([]);
});

test('cashier dashboard recovers after PIN unlock and a later failed refresh', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	let unlocked = false;
	let unavailable = false;
	let denied = 0;
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/api/pengaturan?*', (route) =>
		route.fulfill({
			json: [
				{
					id: 'dashboard-pin-fixture',
					pinConfigured: true,
					halaman_terkunci: ['beranda']
				}
			]
		})
	);
	await page.route('**/api/pin/verify', async (route) => {
		const body = route.request().postDataJSON();
		expect(body).toEqual({ pin: '2580', page: 'beranda' });
		unlocked = true;
		await route.fulfill({ json: { ok: true } });
	});
	await page.route('**/api/dashboard/**', async (route) => {
		if (!unlocked || unavailable) {
			denied++;
			await route.fulfill({
				status: unlocked ? 503 : 403,
				json: { message: unlocked ? 'Indisponibel' : 'PIN_REQUIRED' }
			});
			return;
		}
		const path = new URL(route.request().url()).pathname;
		const summary = [
			{
				tanggal_penjualan: '2026-10-23',
				jumlah_item: 4,
				jumlah_transaksi: 2,
				penjualan_kotor: 42000,
				total_hpp: 12000,
				penjualan_tunai: 42000,
				penjualan_nontunai: 0
			}
		];
		await route.fulfill({
			json: path.endsWith('/stats')
				? { summary }
				: path.endsWith('/best-sellers')
					? [{ produk_id: 'pin-menu', nama_produk: 'Jus Jambu Uji PIN', total_qty: 4 }]
					: path.endsWith('/weekly')
						? summary
						: []
		});
	});
	await loginBranch(page, 'samarinda', 'kasir');
	await expect(page.getByRole('dialog', { name: 'Akses Terkunci' })).toBeVisible();
	await expect.poll(() => denied).toBeGreaterThan(0);
	await expect(page.getByText('Gagal memuat data dashboard').first()).toBeAttached();
	await page.keyboard.type('2580');
	await expect(page.getByRole('dialog', { name: 'Akses Terkunci' })).toHaveCount(0);
	await expect(page.getByText('Rp 42.000', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('Gagal memuat data dashboard')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Jus Jambu Uji PIN' }).last()).toBeVisible();

	async function refresh() {
		await page.evaluate(async () => {
			const cachePath = '/src/lib/utils/cacheOrchestrator.ts';
			const busPath = '/src/lib/utils/refreshBus.ts';
			const { cacheOrchestrator } = await import(/* @vite-ignore */ cachePath);
			const { refreshBus } = await import(/* @vite-ignore */ busPath);
			await cacheOrchestrator.invalidateDashboardCaches();
			refreshBus.emit('dashboard');
		});
	}
	unavailable = true;
	await refresh();
	await expect(page.getByText('Gagal memuat data dashboard').first()).toBeVisible();
	await expect(page.getByText('Rp 42.000', { exact: true }).first()).toBeVisible();
	unavailable = false;
	await refresh();
	await expect(page.getByText('Gagal memuat data dashboard')).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'Jus Jambu Uji PIN' }).last()).toBeVisible();
	expect(errors).toEqual([]);
	await page.screenshot({ path: test.info().outputPath('cashier-dashboard-recovered.png') });
});
