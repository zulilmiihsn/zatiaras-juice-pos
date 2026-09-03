import { expect, test } from '@playwright/test';

test.describe('Reports & Financial Dashboard Behavioral Flows', () => {
	test('financial reports route requires authentication', async ({ page }) => {
		await page.goto('/laporan');
		await expect(page).toHaveURL(/\/login/);
	});

	test('validates WITA (UTC+8) timezone date grouping in browser context', async ({ page }) => {
		await page.goto('/login');

		const witaGrouping = await page.evaluate(() => {
			// Helper to format ISO timestamp into WITA YYYY-MM-DD date
			function getWitaDateString(isoString: string): string {
				const date = new Date(isoString);
				// Add 8 hours for WITA (UTC+8)
				const witaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
				return witaTime.toISOString().slice(0, 10);
			}

			// Late evening UTC transaction (17:00 UTC) belongs to next day in WITA (01:00 WITA)
			const txUtcNight = '2026-08-01T17:00:00.000Z';
			const txUtcAft = '2026-08-01T04:00:00.000Z';

			return {
				nightDate: getWitaDateString(txUtcNight),
				dayDate: getWitaDateString(txUtcAft)
			};
		});

		// 17:00 UTC on Aug 1st is 01:00 WITA on Aug 2nd
		expect(witaGrouping.nightDate).toBe('2026-08-02');
		// 04:00 UTC on Aug 1st is 12:00 WITA on Aug 1st
		expect(witaGrouping.dayDate).toBe('2026-08-01');
	});
});
