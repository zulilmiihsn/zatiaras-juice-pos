import { expect, test } from '@playwright/test';

test.describe('Offline Page & Fallback Flows', () => {
	test('renders offline page when offline route is visited', async ({ page }) => {
		await page.goto('/offline');
		await expect(page.getByText(/offline|koneksi terputus/i)).toBeVisible({ timeout: 15_000 });
	});
});
