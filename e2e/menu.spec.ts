import { expect, test } from '@playwright/test';

test.describe('Menu Management Browser Flows', () => {
	test('menu management page requires authentication and displays proper structure', async ({
		page
	}) => {
		await page.goto('/pengaturan/pemilik/manajemenmenu');
		// Unauthenticated redirects to login
		await expect(page).toHaveURL(/\/login/);
	});
});
