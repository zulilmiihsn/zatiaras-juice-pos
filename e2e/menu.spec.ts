import { expect, test } from '@playwright/test';

test.describe('Menu Management Behavioral Flows', () => {
	test('menu route protects unauthorized access and enforces security boundary', async ({
		page
	}) => {
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		// Must protect endpoint from unauthenticated access
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByLabel('Pilih Cabang')).toBeVisible();
	});

	test('login page contains required branches in selector', async ({ page }) => {
		await page.goto('/login');
		const branchSelect = page.getByLabel('Pilih Cabang');
		await expect(branchSelect).toBeVisible();

		// Check options
		const options = await branchSelect.locator('option').allTextContents();
		expect(options.some((opt) => /samarinda/i.test(opt))).toBe(true);
		expect(options.some((opt) => /balikpapan/i.test(opt))).toBe(true);
	});
});
