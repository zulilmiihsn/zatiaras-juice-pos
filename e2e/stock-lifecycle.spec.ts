import { expect, test, type Page } from '@playwright/test';
import { gotoHydrated } from './helpers';

const CLEAN_BAHAN = {
	id: 'b-bersih',
	nama: 'Gula Bersih',
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
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/bahan' || path.startsWith('/api/bahan/')) {
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
					: [];
		await route.fulfill({ json: data });
	});
}

async function installBahanCounter(page: Page): Promise<{ calls: () => number }> {
	let calls = 0;
	await page.route('**/api/bahan?*', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fulfill({ json: { ok: true } });
			return;
		}
		calls += 1;
		await route.fulfill({ json: [CLEAN_BAHAN] });
	});
	return { calls: () => calls };
}

async function installBahanHold(page: Page): Promise<{ release: () => void; calls: () => number }> {
	let calls = 0;
	let held = false;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/bahan?*', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fulfill({ json: { ok: true } });
			return;
		}
		calls += 1;
		if (!held) {
			held = true;
			await gate;
		}
		await route.fulfill({ json: [CLEAN_BAHAN] });
	});
	return { release, calls: () => calls };
}

async function dispatchSale(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.dispatchEvent(new CustomEvent('penjualan-berhasil'));
	});
}

// Navigasi SPA via tautan navbar (tanpa muat ulang dokumen)
// agar destroy komponen benar-benar diuji, bukan dokumen baru.
async function spaGoBeranda(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'Beranda' }).first().click();
	await expect(page).toHaveURL(/\/$/);
	await page.waitForTimeout(1000);
}

async function spaGoStok(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'Stok' }).first().click();
	await expect(page).toHaveURL(/\/stok/);
	await expect(page.getByText('Gula Bersih').first()).toBeVisible({ timeout: 15000 });
	await page.waitForTimeout(500);
}

// AUD-022: halaman mati tak boleh bereaksi; mount ulang tak gandakan request.
test('destroyed stock page ignores events and remount stays single', async ({ page }) => {
	await mockSession(page);
	const { calls } = await installBahanCounter(page);
	await gotoHydrated(page, '/stok', 'text=Stok');
	await expect(page.getByText('Gula Bersih').first()).toBeVisible({ timeout: 15000 });

	// Pergi SPA: event sesudah destroy tak boleh fetch (listener yatim).
	await spaGoBeranda(page);
	const settled = calls();
	await dispatchSale(page);
	await page.waitForTimeout(800);
	expect(calls()).toBe(settled);

	// Mount ulang: satu load awal per siklus.
	await spaGoStok(page);
	const afterFirst = calls();
	await spaGoBeranda(page);
	await spaGoStok(page);
	const afterSecond = calls();
	expect(afterSecond).toBe(afterFirst + 1);

	// Satu event = satu fetch, bukan ganda sisa mount lama.
	const beforeEvent = calls();
	await dispatchSale(page);
	await expect.poll(() => calls()).toBe(beforeEvent + 1);
	await page.waitForTimeout(800);
	expect(calls()).toBe(beforeEvent + 1);
});

// AUD-022: pergi saat load pending -> resolving tak daftarkan subscription.
test('leaving during pending load registers nothing', async ({ page }) => {
	await mockSession(page);
	const { release, calls } = await installBahanHold(page);
	await page.goto('/stok');
	await expect.poll(() => calls()).toBe(1);

	await spaGoBeranda(page);
	release();
	await page.waitForTimeout(800);
	expect(calls()).toBe(1);

	// Event sesudah destroy tak memanggil handler lama.
	await dispatchSale(page);
	await page.waitForTimeout(800);
	expect(calls()).toBe(1);
});
