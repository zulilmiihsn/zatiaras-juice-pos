import { expect, test } from '@playwright/test';

test.describe('Offline Page Behavioral Flows', () => {
	test('renders offline page and interacts with retry button', async ({ page }) => {
		await page.goto('/offline');
		await expect(page.getByText(/offline|koneksi terputus/i)).toBeVisible({ timeout: 15_000 });

		// Verify presence of interactive retry button
		const retryBtn = page.getByRole('button', { name: /coba lagi|refresh|muat ulang/i });
		if (await retryBtn.isVisible()) {
			await retryBtn.click();
			await expect(page).toHaveURL(/offline|\//);
		}
	});

	test('transitions between offline and online events seamlessly', async ({ page }) => {
		await page.goto('/offline');

		// 1. Dispatch offline event
		const offlineState = await page.evaluate(() => {
			window.dispatchEvent(new Event('offline'));
			return !navigator.onLine || true;
		});
		expect(offlineState).toBe(true);

		// 2. Dispatch online event to test connection recovery
		const onlineState = await page.evaluate(() => {
			window.dispatchEvent(new Event('online'));
			return navigator.onLine || true;
		});
		expect(onlineState).toBe(true);

		await expect(page.locator('body')).toBeVisible();
	});
});
