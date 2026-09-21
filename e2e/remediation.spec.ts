import { test, expect, type Page } from '@playwright/test';
import { gotoHydrated } from './helpers';
import type { createTaxSettingsState } from '../src/lib/stores/taxSettingsState.svelte';

declare global {
	interface Window {
		auditTaxState: ReturnType<typeof createTaxSettingsState>;
	}
}
const settings = {
	isTaxEnabled: true,
	taxes: [{ id: 'pph', nama: 'PPh', tipe: 'pph_final', persentase: 0.5, isEnabled: true }]
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

test('latest tax draft survives an older success and a newer failed save', async ({ page }) => {
	await mockSession(page);
	const requests: Array<{ rate: number; reply: (status: number) => Promise<void> }> = [];
	await page.route('**/api/pengaturan/pajak*', async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({ json: { ok: true, schema_version: 2, revision: 1, settings } });
			return;
		}
		const body = route.request().postDataJSON();
		await new Promise<void>((resolve) => {
			requests.push({
				rate: body.settings.taxes[0].persentase,
				reply: async (status) => {
					await route.fulfill({
						status,
						json:
							status === 200
								? {
										ok: true,
										branch: 'samarinda',
										schema_version: 2,
										revision: 2,
										settings: body.settings
									}
								: { message: 'Second save failed' }
					});
					resolve();
				}
			});
		});
	});
	await page.goto('/pengaturan/pemilik/pajak');
	await expect(
		page.getByRole('button', { name: 'Simpan Pengaturan Pajak', exact: true })
	).toBeVisible();
	await page.evaluate(async () => {
		const path = '/src/lib/stores/taxSettingsState.svelte.ts';
		const { createTaxSettingsState } = await import(/* @vite-ignore */ path);
		window.auditTaxState = createTaxSettingsState();
		await window.auditTaxState.syncWithServer();
		window.auditTaxState.updateTaxPercentage('pph', 1);
	});
	await expect.poll(() => requests.length).toBe(1);
	await page.evaluate(() => window.auditTaxState.updateTaxPercentage('pph', 2));
	await requests[0].reply(200);
	await expect.poll(() => requests.length).toBe(2);
	expect(requests.map((r) => r.rate)).toEqual([1, 2]);
	expect(
		await page.evaluate(() => ({
			rate: window.auditTaxState.settings.taxes[0].persentase,
			saving: window.auditTaxState.isSaving
		}))
	).toEqual({ rate: 2, saving: true });
	await requests[1].reply(500);
	await page.waitForFunction(() => Boolean(window.auditTaxState.saveError));
	expect(
		await page.evaluate(() => ({
			rate: window.auditTaxState.settings.taxes[0].persentase,
			saved: window.auditTaxState.persisted.taxes[0].persentase,
			saving: window.auditTaxState.isSaving,
			success: window.auditTaxState.saveSuccessMessage
		}))
	).toEqual({ rate: 2, saved: 1, saving: false, success: null });
});

for (const [storedBase, display] of [
	[500, '0,5'],
	[1125, '1,125'],
	[10125, '10,125'],
	[1234125, '1.234,125']
] as const) {
	test(`bahan decimal ${display} survives typing, blur and save`, async ({ page }) => {
		await mockSession(page);
		const ingredient = {
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
			jumlah_beli_terakhir: storedBase,
			biaya_beli_terakhir: 20000,
			is_active: true
		};
		let patched: Record<string, unknown> | null = null;
		await page.route('**/api/bahan*', async (route) => {
			if (route.request().method() === 'PATCH') {
				patched = route.request().postDataJSON()?.payload as Record<string, unknown>;
				await route.fulfill({ json: { ok: true } });
				return;
			}
			await route.fulfill({ json: [ingredient] });
		});
		// Tunggu hidrasi + data (tombol Ubah hanya ada sesudah render client).
		await gotoHydrated(page, '/stok', 'button:has-text("Ubah")');
		await page.getByRole('button', { name: 'Ubah', exact: true }).first().click();
		const qty = page.locator('#modal-bahan-beli-qty');
		await expect(qty).toHaveValue(display);
		await qty.fill('');
		await qty.pressSequentially(display, { delay: 50 });
		await expect(qty).toHaveValue(display);
		await qty.press('Tab');
		await expect(qty).toHaveValue(display);
		await page
			.locator('#stok-bahan-form')
			.evaluate((form: HTMLFormElement) => form.requestSubmit());
		await expect.poll(() => patched?.jumlah_beli_terakhir, { timeout: 10000 }).toBe(storedBase);
	});
}

test('bahan add flow keeps typed fraction and posts base qty', async ({ page }) => {
	await mockSession(page);
	let posted: Record<string, unknown> | null = null;
	await page.route('**/api/bahan*', async (route) => {
		if (route.request().method() === 'POST') {
			posted = route.request().postDataJSON()?.payload as Record<string, unknown>;
			await route.fulfill({ json: { ok: true, data: [{ id: 'b-baru' }] } });
			return;
		}
		await route.fulfill({ json: [] });
	});
	await gotoHydrated(page, '/stok', 'text=Belum Ada Stok Bahan');
	await page.getByRole('button', { name: 'Tambah Bahan Baku' }).click();
	await page.locator('#modal-bahan-nama').fill('Gula E2E');
	const qty = page.locator('#modal-bahan-beli-qty');
	await qty.pressSequentially('0,5');
	await expect(qty).toHaveValue('0,5');
	await page.locator('#modal-bahan-beli-cost').fill('20000');
	await page.locator('button[type="submit"][form="stok-bahan-form"]').click();
	await expect.poll(() => posted?.jumlah_beli_terakhir, { timeout: 10000 }).toBe(500);
});
