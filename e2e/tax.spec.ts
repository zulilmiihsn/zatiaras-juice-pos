import { expect, test } from '@playwright/test';

test.describe('Tax Settings Browser Flows', () => {
	test('tax settings route requires pemilik authentication', async ({ page }) => {
		await page.goto('/pengaturan/pemilik/pajak');
		await expect(page).toHaveURL(/\/login/);
	});
});
