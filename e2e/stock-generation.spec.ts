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
const MARKER_BAHAN = { ...CLEAN_BAHAN, id: 'b-stale', nama: 'STALE-MARKER-XYZ' };
const OLD_BAHAN = { ...CLEAN_BAHAN, id: 'b-lama', nama: 'Gula Lama' };

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
		// /api/bahan dilayani handler khusus di bawah (teruskan agar tak tertelan).
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

type BahanGate = {
	holdNext: () => void;
	release: (mode: 'marker' | 'error') => void;
};

async function installBahanGate(page: Page): Promise<{ gate: BahanGate; calls: () => number }> {
	let calls = 0;
	let holdArmed = false;
	let held = false;
	let release!: (mode: 'marker' | 'error') => void;
	const gatePromise = new Promise<'marker' | 'error'>((resolve) => {
		release = resolve;
	});
	await page.route('**/api/bahan?*', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fulfill({ json: { ok: true } });
			return;
		}
		calls += 1;
		if (holdArmed && !held) {
			held = true;
			const mode = await gatePromise;
			if (mode === 'error') {
				await route.fulfill({ status: 500, json: { message: 'boom' } });
				return;
			}
			await route.fulfill({ json: [MARKER_BAHAN] });
			return;
		}
		const rows = calls <= 1 ? [OLD_BAHAN] : [CLEAN_BAHAN];
		await route.fulfill({ json: rows });
	});
	return { gate: { holdNext: () => (holdArmed = true), release }, calls: () => calls };
}

async function refreshViaSaleEvent(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.dispatchEvent(new CustomEvent('penjualan-berhasil'));
	});
}

async function doubleRefresh(page: Page, calls: () => number): Promise<void> {
	// Dua refresh berurutan: pertama tertahan, kedua cepat.
	// Tunggu fetch lambat berangkat dulu agar urutan pasti.
	const before = calls();
	await refreshViaSaleEvent(page);
	await expect.poll(() => calls()).toBe(before + 1);
	await refreshViaSaleEvent(page);
}

// AUD-021: load lama yang selesai belakangan tak boleh menimpa load baru.
test('stale stock load cannot overwrite newer data', async ({ page }) => {
	await mockSession(page);
	const { gate, calls } = await installBahanGate(page);
	await gotoHydrated(page, '/stok', 'text=Gula Lama');
	await expect(page.getByText('Gula Lama').first()).toBeVisible({ timeout: 15000 });

	gate.holdNext();
	await doubleRefresh(page, calls);
	await expect(page.getByText('Gula Bersih').first()).toBeVisible({ timeout: 15000 });

	gate.release('marker');
	await page.waitForTimeout(1000);
	await expect(page.getByText('STALE-MARKER-XYZ')).toHaveCount(0);
	await expect(page.getByText('Gula Bersih').first()).toBeVisible();
	await expect(page.getByText('Gagal memuat data stok bahan')).toHaveCount(0);
	expect(calls()).toBeGreaterThanOrEqual(3);
});

// AUD-021: failure basi tak boleh tampilkan error untuk view baru.
test('stale stock failure cannot raise error for newer view', async ({ page }) => {
	await mockSession(page);
	const { gate, calls } = await installBahanGate(page);
	await gotoHydrated(page, '/stok', 'text=Gula Lama');
	await expect(page.getByText('Gula Lama').first()).toBeVisible({ timeout: 15000 });

	gate.holdNext();
	await doubleRefresh(page, calls);
	await expect(page.getByText('Gula Bersih').first()).toBeVisible({ timeout: 15000 });

	gate.release('error');
	// Tunggu aktif kemunculan toast: lolos hanya bila tak pernah muncul.
	// (toHaveCount(0) lolos instan sebelum toast telat tiba.)
	const toastSeen = await page
		.getByText('Gagal memuat data stok bahan')
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	expect(toastSeen).toBe(false);
	await expect(page.getByText('Gula Bersih').first()).toBeVisible();
	expect(calls()).toBeGreaterThanOrEqual(3);
});
