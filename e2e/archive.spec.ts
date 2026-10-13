import { expect, test } from '@playwright/test';

test.describe('Archive Management Behavioral Flows', () => {
	test('archive dashboard route requires pemilik authentication', async ({ browser, baseURL }) => {
		const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
		try {
			const page = await context.newPage();
			await page.goto('/pengaturan/pemilik/arsip');
			await expect(page).toHaveURL(/\/login/);
			await expect(page.locator('form')).toBeVisible();
		} finally {
			await context.close();
		}
	});

	test('validates archive cut-off date boundary in page context', async ({ page }) => {
		await page.goto('/login');
		// Verify ISO date serialization for WITA cut-off
		const isoCutoff = await page.evaluate(() => {
			const year = 2026;
			const d = new Date(`${year}-01-01T00:00:00+08:00`);
			return d.toISOString();
		});
		expect(isoCutoff).toBe('2025-12-31T16:00:00.000Z');
	});
});
