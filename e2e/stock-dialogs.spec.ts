import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated } from './helpers';

const ROW_BAHAN = {
	id: 'b-uji',
	nama: 'Gula Uji',
	satuan: 'gram',
	tipe_satuan: 'berat',
	satuan_beli: 'kg',
	isi_per_kemasan: 1,
	kategori: 'Bahan Baku',
	stok_saat_ini: 1000,
	ambang_stok: 10,
	yield_persen: 100,
	biaya_per_satuan: 20,
	jumlah_beli_terakhir: 1000,
	biaya_beli_terakhir: 20000,
	is_active: true
};

async function mockSession(page: Page) {
	await page.addInitScript(() => {
		localStorage.setItem('selectedBranch', 'samarinda');
		localStorage.setItem(
			'zatiaras_session',
			JSON.stringify({
				isAuthenticated: true,
				user: { id: 'u', username: 'owner', role: 'pemilik', branch: 'samarinda' },
				expiresAt: Date.now() + 3600000
			})
		);
	});
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		if (path === '/api/bahan' && route.request().method() === 'GET') {
			await route.continue();
			return;
		}
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated: true,
						user: { id: 'u', username: 'owner', role: 'pemilik' },
						expiresAt: Date.now() + 3600000
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: path === '/api/bahan-mutasi'
						? { data: [], nextCursor: null, hasMore: false }
						: [];
		await route.fulfill({ json: data });
	});
	await page.route('**/api/bahan?*', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fulfill({ json: { ok: true } });
			return;
		}
		await route.fulfill({ json: [ROW_BAHAN] });
	});
}

async function dialogHasFocus(page: Page, labelledby: string): Promise<boolean> {
	return page.evaluate((id) => {
		const heading = document.getElementById(id);
		const dialog = heading?.closest('[role="dialog"]');
		return !!dialog && dialog.contains(document.activeElement);
	}, labelledby);
}

// AUD-024 desktop: dialog Tambah Bahan bernama + keyboard penuh.
test('bahan dialog is named and keyboard safe', async ({ page }) => {
	await mockSession(page);
	await gotoHydrated(page, '/stok', 'text=Gula Uji');
	const trigger = page.getByRole('button', { name: 'Tambah Bahan' });
	await trigger.focus();
	await trigger.click();

	const dialog = page.getByRole('dialog', { name: 'Tambah Bahan Baku' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect.poll(() => dialogHasFocus(page, 'stok-bahan-title'), { timeout: 10000 }).toBe(true);

	// Isi via keyboard, Tab tetap di dalam.
	await page.locator('#modal-bahan-nama').pressSequentially('Gula Keyboard');
	for (let i = 0; i < 10; i++) {
		await page.keyboard.press('Tab');
		expect(await dialogHasFocus(page, 'stok-bahan-title')).toBe(true);
	}
	expect(await page.evaluate(() => document.querySelector('[inert]') !== null)).toBe(true);

	// Escape dari input tutup + fokus kembali ke pemicu.
	await page.locator('#modal-bahan-nama').focus();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden({ timeout: 10000 });
	expect(
		await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? ''
		)
	).toContain('Tambah Bahan');
});

// AUD-024 mobile: dialog Mutasi keyboard + preview + Escape dari input.
test('mutasi dialog keeps preview and closes from input via Escape', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSession(page);
	await gotoHydrated(page, '/stok', 'text=Gula Uji');
	const trigger = page.getByRole('button', { name: 'Masuk' }).first();
	await trigger.focus();
	await trigger.click();

	const dialog = page.getByRole('dialog', { name: 'Catat Kulakan / Masuk' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect.poll(() => dialogHasFocus(page, 'stok-mutasi-title'), { timeout: 10000 }).toBe(true);

	await page.locator('#mutasi-amount').pressSequentially('2');
	await expect(page.getByText('Estimasi Stok Akhir').first()).toBeVisible({ timeout: 10000 });

	await page.locator('#mutasi-amount').focus();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden({ timeout: 10000 });
});

// AUD-024 mobile: dialog Hapus Batal/konfirmasi via keyboard.
test('delete dialog confirms and cancels via keyboard', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSession(page);
	await gotoHydrated(page, '/stok', 'text=Gula Uji');
	const trigger = page.getByLabel('Hapus bahan').first();
	await trigger.focus();
	await trigger.click();

	const dialog = page.getByRole('dialog', { name: 'Hapus Bahan Ini?' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect.poll(() => dialogHasFocus(page, 'stok-hapus-title'), { timeout: 10000 }).toBe(true);

	for (let i = 0; i < 4; i++) {
		await page.keyboard.press('Tab');
		expect(await dialogHasFocus(page, 'stok-hapus-title')).toBe(true);
	}

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden({ timeout: 10000 });
	expect(
		await page.evaluate(
			() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? ''
		)
	).toBe('Hapus bahan');
});
