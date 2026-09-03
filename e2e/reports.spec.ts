import { expect, test } from '@playwright/test';
import { utcToWita, witaToUtc, getTodayWita, addDaysYmd } from '../src/lib/utils/dateTime';

test.describe('Reports & Financial Dashboard Behavioral Flows', () => {
	test('financial reports route requires authentication', async ({ page }) => {
		await page.goto('/laporan');
		await expect(page).toHaveURL(/\/login/);
	});

	test('validates real app dateTime.ts WITA timezone conversion functions', () => {
		// 1. Late night UTC (17:00:00Z on Aug 1st) translates to 01:00:00 WITA on Aug 2nd (+8 hours)
		const utcInput = '2026-08-01T17:00:00.000Z';
		const witaDate = utcToWita(utcInput);
		expect(witaDate.getDate()).toBe(2);
		expect(witaDate.getHours()).toBe(1);

		// 2. WITA local to UTC conversion
		const witaInput = '2026-08-02T01:00:00';
		const utcConverted = witaToUtc(witaInput);
		expect(utcConverted.toISOString()).toBe('2026-08-01T17:00:00.000Z');

		// 3. getTodayWita format check (YYYY-MM-DD)
		const todayWita = getTodayWita();
		expect(todayWita).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		// 4. addDaysYmd date arithmetic
		expect(addDaysYmd('2026-08-01', 5)).toBe('2026-08-06');
	});
});
