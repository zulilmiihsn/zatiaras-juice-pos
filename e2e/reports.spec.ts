import { expect, test } from '@playwright/test';

test.describe('Reports & Financial Dashboard Browser Flows', () => {
	test('financial reports route requires authentication', async ({ page }) => {
		await page.goto('/laporan');
		await expect(page).toHaveURL(/\/login/);
	});
});
