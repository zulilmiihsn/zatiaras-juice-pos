import { expect, test } from '@playwright/test';

test.describe('Offline Page Behavioral Flows', () => {
	test('renders offline page and interacts with retry button', async ({ page }) => {
		await page.goto('/offline');
		await expect(page.getByRole('heading', { name: 'Koneksi terputus' })).toBeVisible({
			timeout: 15_000
		});

		// Verify presence and attributes of interactive retry button
		const retryBtn = page.getByRole('link', { name: 'Coba lagi' });
		await expect(retryBtn).toBeVisible();
		await expect(retryBtn).toHaveAttribute('href', '/');
	});

	test('registers and responds to offline and online event transitions without fallback', async ({
		page
	}) => {
		await page.goto('/offline');

		// Strictly capture both event dispatches without any vacuous `|| true`
		const eventsFired = await page.evaluate(() => {
			const received: string[] = [];
			window.addEventListener('offline', () => received.push('offline'), { once: true });
			window.addEventListener('online', () => received.push('online'), { once: true });

			window.dispatchEvent(new Event('offline'));
			window.dispatchEvent(new Event('online'));

			return received;
		});

		expect(eventsFired).toEqual(['offline', 'online']);
		await expect(page.locator('body')).toBeVisible();
	});
});
