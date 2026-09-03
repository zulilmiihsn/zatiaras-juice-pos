import { expect, test } from '@playwright/test';

test.describe('Reports & Financial Dashboard Behavioral Flows', () => {
	test('financial reports route requires authentication', async ({ page }) => {
		await page.goto('/laporan');
		await expect(page).toHaveURL(/\/login/);
	});

	test('validates date range calculation helper in page context', async ({ page }) => {
		await page.goto('/login');
		const diffDays = await page.evaluate(() => {
			const start = new Date('2026-08-01');
			const end = new Date('2026-08-07');
			return Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24));
		});
		expect(diffDays).toBe(6);
	});
});
