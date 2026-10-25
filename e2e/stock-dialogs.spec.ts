import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function mockSession(page: Page, rows: (typeof ROW_BAHAN)[] = [ROW_BAHAN]) {
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
		await route.fulfill({ json: rows });
	});
}

async function dialogHasFocus(page: Page, labelledby: string): Promise<boolean> {
	return page.evaluate((id) => {
		const heading = document.getElementById(id);
		const dialog = heading?.closest('[role="dialog"]');
		return !!dialog && dialog.contains(document.activeElement);
	}, labelledby);
}

// Dialog Tambah Bahan bernama + keyboard penuh.
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

// Dialog Mutasi keyboard + preview + Escape dari input.
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

// Dialog Hapus Batal/konfirmasi via keyboard.
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

async function captureBahanWrites(page: Page): Promise<Array<{ method: string; url: string }>> {
	const writes: Array<{ method: string; url: string }> = [];
	await page.route(
		(url) => url.pathname === '/api/bahan',
		async (route) => {
			if (route.request().method() === 'GET') {
				await route.fallback();
				return;
			}
			writes.push({ method: route.request().method(), url: route.request().url() });
			await route.fulfill({ json: { ok: true } });
		}
	);
	return writes;
}

// Dialog Tambah Bahan dikirim penuh via keyboard (Enter dari input).
test('bahan dialog submits from keyboard and restores focus', async ({ page }) => {
	await mockSession(page);
	const writes = await captureBahanWrites(page);
	await gotoHydrated(page, '/stok', 'text=Gula Uji');
	const trigger = page.getByRole('button', { name: 'Tambah Bahan' });
	await trigger.focus();
	await page.keyboard.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Tambah Bahan Baku' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect.poll(() => dialogHasFocus(page, 'stok-bahan-title'), { timeout: 10000 }).toBe(true);
	await page.locator('#modal-bahan-nama').focus();
	await page.keyboard.type('Gula Enter');
	await page.keyboard.press('Enter');

	await expect(dialog).toBeHidden({ timeout: 10000 });
	expect(writes.length).toBe(1);
	await expect
		.poll(() =>
			page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '')
		)
		.toContain('Tambah Bahan');
});

// Konfirmasi hapus via keyboard mengirim tepat satu penghapusan.
test('delete dialog confirms from keyboard', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await mockSession(page);
	const writes = await captureBahanWrites(page);
	await gotoHydrated(page, '/stok', 'text=Gula Uji');
	await page.getByLabel('Hapus bahan').first().focus();
	await page.keyboard.press('Enter');

	const dialog = page.getByRole('dialog', { name: 'Hapus Bahan Ini?' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect.poll(() => dialogHasFocus(page, 'stok-hapus-title'), { timeout: 10000 }).toBe(true);
	const confirm = dialog.getByRole('button', { name: 'Ya, Hapus' });
	for (let i = 0; i < 4 && !(await confirm.evaluate((el) => el === document.activeElement)); i++)
		await page.keyboard.press('Tab');
	await expect(confirm).toBeFocused();
	await page.keyboard.press('Enter');

	await expect(dialog).toBeHidden({ timeout: 10000 });
	expect(writes.length).toBe(1);
	expect(writes[0].url).toContain('b-uji');
});

// Peringatan stok menipis: bisa digeser untuk ditutup, tombol di dalamnya tetap bekerja.
const ROW_BAHAN_MENIPIS = { ...ROW_BAHAN, id: 'b-menipis', nama: 'Susu Uji', stok_saat_ini: 5 };

async function drag(page: Page, target: Locator, deltaX: number, deltaY: number) {
	const box = await target.boundingBox();
	if (!box) throw new Error('Elemen yang diseret tidak punya kotak layout');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
	await page.mouse.up();
}

test.describe('low stock alert banner swipe', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await mockSession(page, [ROW_BAHAN_MENIPIS]);
		await gotoHydrated(page, '/stok', 'text=Susu Uji');
	});

	const banner = (page: Page) => page.getByRole('region', { name: /Peringatan Stok Menipis/ });

	for (const [arah, deltaX, deltaY] of [
		['atas', 0, -60],
		['kiri', -100, 0],
		['kanan', 100, 0]
	] as const) {
		test(`closes when swiped ${arah}`, async ({ page }) => {
			await expect(banner(page)).toBeVisible();
			await drag(page, banner(page).getByText('Stok Menipis', { exact: true }), deltaX, deltaY);
			await expect(banner(page)).toHaveCount(0);
		});
	}

	test('springs back when the swipe is too short and ignores a swipe down', async ({ page }) => {
		await expect(banner(page)).toBeVisible();
		const title = banner(page).getByText('Stok Menipis', { exact: true });
		await drag(page, title, 0, -10);
		await drag(page, title, 0, 80);
		await expect(banner(page)).toBeVisible();
		await expect(banner(page)).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
	});

	test('does not close from a drag that starts on its action button', async ({ page }) => {
		const action = banner(page).getByRole('button', { name: /Lihat/ });
		await expect(action).toBeVisible();
		await drag(page, action, 0, -60);
		await expect(banner(page)).toBeVisible();
	});
});
