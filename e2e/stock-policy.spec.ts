import { test, expect, type Page } from '@playwright/test';
import { gotoHydrated } from './helpers';

type PolicyMode = 'tracked' | 'ignored';

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
		await page.getByRole('button', { name: 'Buka hitung fisik' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.locator('#recon-title')).toBeVisible();
		await expect(dialog.getByText('0/2', { exact: true })).toBeVisible();
		await expect(dialog.getByLabel('Cari item rekonsiliasi')).toBeVisible();
		await expect(dialog.getByText('Bahan baku • 1')).toBeVisible();
		await expect(dialog.getByText('Produk • 1')).toBeVisible();
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
