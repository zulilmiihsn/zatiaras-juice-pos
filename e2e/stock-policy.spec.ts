import { test, expect, type Page } from '@playwright/test';
import { gotoHydrated } from './helpers';

type PolicyMode = 'tracked' | 'ignored';

const draftJob = {
	id: 'job-1',
	status: 'draft',
	expected_policy_revision: 1,
	items: [{ entity_type: 'bahan', entity_id: 'b-gula', counted_quantity: null }]
};

async function mockOwnerSession(page: Page) {
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
		if (path === '/api/session') {
			await route.fulfill({
				json: {
					success: true,
					authenticated: true,
					user: { id: 'u', username: 'owner', role: 'pemilik' },
					expiresAt: Date.now() + 3600000
				}
			});
			return;
		}
		if (path === '/api/csrf') {
			await route.fulfill({ json: { success: true, token: 'test-token' } });
			return;
		}
		await route.fulfill({ json: [] });
	});
}

function mockStockPolicy(
	page: Page,
	state: { mode: PolicyMode; revision: number },
	onPut?: (body: Record<string, unknown>) => void
) {
	return page.route('**/api/pengaturan/stok', async (route) => {
		if (route.request().method() === 'PUT') {
			const body = route.request().postDataJSON() as {
				expected_revision: number;
				mode: PolicyMode;
			} & Record<string, unknown>;
			onPut?.(body);
			state.mode = body.mode;
			state.revision += 1;
			await route.fulfill({
				json: {
					ok: true,
					data: {
						mode: state.mode,
						revision: state.revision,
						disabled_at: state.mode === 'ignored' ? new Date().toISOString() : null,
						reconciled_at: null,
						updated_at: new Date().toISOString()
					}
				}
			});
			return;
		}
		await route.fulfill({
			json: {
				ok: true,
				data: {
					can_manage_policy: true,
					mode: state.mode,
					revision: state.revision,
					disabled_at: null,
					reconciled_at: null,
					updated_at: new Date().toISOString()
				}
			}
		});
	});
}

test.describe('Stock Monitoring Toggle', () => {
	test('tracked mode shows Aktif and an enabled toggle', async ({ page }) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'tracked', revision: 0 });
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await expect(page.getByText('Aktif', { exact: true }).first()).toBeVisible();
		const toggle = page.getByRole('switch', { name: 'Nonaktifkan monitoring stok' });
		await expect(toggle).toBeVisible();
		await expect(toggle).toBeEnabled();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
	});

	test('toggle opens a modal dialog that Escape closes', async ({ page }) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'tracked', revision: 0 });
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Nonaktifkan monitoring stok' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Nonaktifkan monitoring stok?')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('confirm disable calls PUT and shows Nonaktif with reconciliation entry', async ({
		page
	}) => {
		await mockOwnerSession(page);
		let putBody: Record<string, unknown> | null = null;
		await mockStockPolicy(page, { mode: 'tracked', revision: 3 }, (body) => {
			putBody = body;
		});
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Nonaktifkan monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, nonaktifkan', exact: true }).click();
		await expect(page.getByText('Nonaktif', { exact: true }).first()).toBeVisible({
			timeout: 10000
		});
		expect(putBody).toMatchObject({ mode: 'ignored', expected_revision: 3 });
		await expect(page.getByText('Aktifkan kembali monitoring stok')).toBeVisible();
	});

	test('enable toggle opens a confirmation modal first', async ({ page }) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await expect(page.getByText('Nonaktif', { exact: true }).first()).toBeVisible();
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Aktifkan kembali monitoring stok?')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
	});

	test('reconciliation opens in a modal with counted progress', async ({ page }) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await page.route('**/api/pengaturan/stok/reconciliation/active', async (route) => {
			await route.fulfill({
				json: {
					ok: true,
					data: {
						job: {
							id: 'job-1',
							cabang_id: 'samarinda',
							expected_policy_revision: 1,
							status: 'draft',
							inventory_fingerprint: 'fp',
							created_by: 'owner',
							created_at: new Date().toISOString(),
							finalized_at: null,
							items: [
								{
									job_id: 'job-1',
									cabang_id: 'samarinda',
									entity_type: 'bahan',
									entity_id: 'b-gula',
									counted_quantity: null
								},
								{
									job_id: 'job-1',
									cabang_id: 'samarinda',
									entity_type: 'produk',
									entity_id: 'p-teh',
									counted_quantity: null
								}
							]
						}
					}
				}
			});
		});
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('#recon-title')).toBeVisible();
		await expect(dialog.getByText('0/2', { exact: true })).toBeVisible();
		await expect(dialog.getByLabel('Cari item rekonsiliasi')).toBeVisible();
		await expect(dialog.getByText('Bahan baku • 1')).toBeVisible();
		await expect(dialog.getByText('Produk • 1')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Semua' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Bahan baku' })).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Simpan progres' })).toBeVisible();
	});

	test('reconciliation displays multiple ingredient categories without crashing', async ({
		page
	}) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await page.route('**/api/bahan?*', (route) =>
			route.fulfill({
				json: [
					{ id: 'b-gula', nama: 'Gula', kategori: 'Bahan kering' },
					{ id: 'b-susu', nama: 'Susu', kategori: 'Bahan cair' }
				]
			})
		);
		await page.route('**/api/pengaturan/stok/reconciliation/active', (route) =>
			route.fulfill({
				json: {
					ok: true,
					data: {
						job: {
							...draftJob,
							items: [
								...draftJob.items,
								{ entity_type: 'bahan', entity_id: 'b-susu', counted_quantity: null }
							]
						}
					}
				}
			})
		);
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi' }).click();
		const dialog = page.getByRole('dialog', { name: 'Hitung fisik stok' });
		await expect(dialog.getByText('Bahan cair • 1')).toBeVisible();
		await expect(dialog.getByText('Bahan kering • 1')).toBeVisible();
		expect(pageErrors).toEqual([]);
	});

	test('reconciliation footer stays inside modal below scrolling items on mobile', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 640 });
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await page.route('**/api/pengaturan/stok/reconciliation/active', (route) =>
			route.fulfill({
				json: {
					ok: true,
					data: {
						job: {
							...draftJob,
							items: Array.from({ length: 30 }, (_, index) => ({
								entity_type: 'bahan',
								entity_id: `b-${index}`,
								counted_quantity: null
							}))
						}
					}
				}
			})
		);
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi' }).click();
		const dialog = page.getByRole('dialog', { name: 'Hitung fisik stok' });
		const scroll = dialog.locator('.overflow-y-auto');
		const actions = dialog.getByRole('button', { name: 'Simpan progres' }).locator('..');
		const [dialogBox, scrollBox, actionsBox] = await Promise.all([
			dialog.boundingBox(),
			scroll.boundingBox(),
			actions.boundingBox()
		]);
		if (!dialogBox || !scrollBox || !actionsBox) throw new Error('Modal stok tidak terlihat');
		expect(actionsBox.y).toBeGreaterThanOrEqual(scrollBox.y + scrollBox.height - 1);
		expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(
			dialogBox.y + dialogBox.height + 1
		);
		const saveBox = await dialog.getByRole('button', { name: 'Simpan progres' }).boundingBox();
		const finalizeBox = await dialog
			.getByRole('button', { name: 'Finalisasi & aktifkan' })
			.boundingBox();
		expect(saveBox?.height).toBeGreaterThanOrEqual(44);
		expect(finalizeBox?.height).toBeGreaterThanOrEqual(44);
		await scroll.evaluate((element) => (element.scrollTop = element.scrollHeight));
		const lastInput = await dialog.locator('#recon-bahan-b-29').boundingBox();
		if (!lastInput) throw new Error('Item terakhir tidak terlihat');
		expect(lastInput.y + lastInput.height).toBeLessThanOrEqual(actionsBox.y + 1);
	});

	test('new reconciliation opens count modal without waiting for catalog metadata', async ({
		page
	}) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await page.route('**/api/pengaturan/stok/reconciliation/active', (route) =>
			route.fulfill({ json: { ok: true, data: { job: null } } })
		);
		let creates = 0;
		await page.route('**/api/pengaturan/stok/reconciliation', (route) => {
			creates++;
			return route.fulfill({ json: { ok: true, data: draftJob } });
		});
		let releaseIngredients!: () => void;
		const ingredientsPending = new Promise<void>((resolve) => {
			releaseIngredients = resolve;
		});
		try {
			await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
			let metadataRequests = 0;
			await page.route('**/api/bahan?*', async (route) => {
				metadataRequests++;
				await ingredientsPending;
				await route.fulfill({ json: [] });
			});
			await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
			await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi' }).click();
			await expect.poll(() => metadataRequests).toBeGreaterThan(0);
			await expect(
				page.getByRole('dialog', { name: 'Aktifkan kembali monitoring stok?' })
			).toBeHidden();
			await expect(page.getByRole('dialog', { name: 'Hitung fisik stok' })).toBeVisible();
			expect(creates).toBe(1);
		} finally {
			releaseIngredients();
		}
	});

	test('existing draft opens after create conflict when initial lookup misses it', async ({
		page
	}) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		let lookups = 0;
		let creates = 0;
		let lookupsAfterCreate = 0;
		await page.route('**/api/pengaturan/stok/reconciliation/active', (route) => {
			lookups++;
			if (creates > 0) lookupsAfterCreate++;
			return route.fulfill({ json: { ok: true, data: { job: creates === 0 ? null : draftJob } } });
		});
		await page.route('**/api/pengaturan/stok/reconciliation', (route) => {
			creates++;
			return route.fulfill({ status: 409, json: { message: 'Rekonsiliasi sudah ada' } });
		});
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi' }).click();
		await expect(
			page.getByRole('dialog', { name: 'Aktifkan kembali monitoring stok?' })
		).toBeHidden();
		await expect(page.getByRole('dialog', { name: 'Hitung fisik stok' })).toBeVisible();
		expect(creates).toBe(1);
		expect(lookups).toBeGreaterThanOrEqual(2);
		expect(lookupsAfterCreate).toBe(1);
	});

	test('create conflict without an active draft keeps confirmation and shows error', async ({
		page
	}) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await page.route('**/api/pengaturan/stok/reconciliation/active', (route) =>
			route.fulfill({ json: { ok: true, data: { job: null } } })
		);
		await page.route('**/api/pengaturan/stok/reconciliation', (route) =>
			route.fulfill({ status: 409, json: { message: 'Inventaris berubah; muat ulang' } })
		);
		await gotoHydrated(page, '/pengaturan/pemilik/stok', 'text=Monitoring Stok');
		await page.getByRole('switch', { name: 'Aktifkan kembali monitoring stok' }).click();
		await page.getByRole('button', { name: 'Ya, mulai rekonsiliasi' }).click();
		const dialog = page.getByRole('dialog', { name: 'Aktifkan kembali monitoring stok?' });
		await expect(dialog.getByText('Inventaris berubah; muat ulang')).toBeVisible();
		await expect(dialog.getByRole('button', { name: 'Ya, mulai rekonsiliasi' })).toBeEnabled();
		await expect(page.getByRole('dialog', { name: 'Hitung fisik stok' })).toHaveCount(0);
	});

	test('ignored mode hides Stok from bottom navigation', async ({ page }) => {
		await mockOwnerSession(page);
		await mockStockPolicy(page, { mode: 'ignored', revision: 1 });
		await gotoHydrated(page, '/', 'text=Buka Kasir');
		const stokNav = page.getByRole('link', { name: 'Stok' });
		await expect(stokNav).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Kasir', exact: true })).toBeVisible();
	});
});
