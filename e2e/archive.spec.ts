import { expect, test } from '@playwright/test';

test.describe('Archive Management Browser Flows', () => {
	test('archive dashboard route requires pemilik authentication', async ({ page }) => {
		await page.goto('/pengaturan/pemilik/arsip');
		await expect(page).toHaveURL(/\/login/);
	});
});
