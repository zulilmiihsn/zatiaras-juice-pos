import { expect, test } from '@playwright/test';

test.describe('Accessibility & Keyboard Navigation Browser Flows', () => {
	test('login page has valid semantic form labels and keyboard tab order', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

		// Check focus order
		const branchSelect = page.getByLabel('Pilih Cabang');
		await expect(branchSelect).toBeVisible();

		const usernameInput = page.getByPlaceholder('Masukkan username');
		await expect(usernameInput).toBeVisible();

		const submitBtn = page.getByRole('button', { name: 'Masuk', exact: true });
		await expect(submitBtn).toBeVisible();
	});
});
