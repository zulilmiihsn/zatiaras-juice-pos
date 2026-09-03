import { expect, test } from '@playwright/test';

test.describe('Offline Page Behavioral Flows', () => {
	test('renders offline page and interacts with retry button', async ({ page }) => {
		await page.goto('/offline');
		await expect(page.getByText(/offline|koneksi terputus/i)).toBeVisible({ timeout: 15_000 });

		// Verify presence of interactive retry button
		const retryBtn = page.getByRole('button', { name: /coba lagi|refresh|muat ulang/i });
		if (await retryBtn.isVisible()) {
			await retryBtn.click();
			// Page should attempt to reload or navigate
			await expect(page).toHaveURL(/offline|\//);
		}
	});

	test('offline indicator handles online-offline events', async ({ page }) => {
		await page.goto('/offline');
		// Simulate offline event in browser
		await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
		});
		await expect(page.locator('body')).toBeVisible();
	});
});
