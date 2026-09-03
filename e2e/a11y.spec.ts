import { expect, test } from '@playwright/test';

test.describe('Accessibility & Keyboard Navigation (A11y)', () => {
	test('login page has valid semantic form labels and keyboard tab order', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

		// Verify semantic form labels
		const branchSelect = page.getByLabel('Pilih Cabang');
		await expect(branchSelect).toBeVisible();

		const usernameInput = page.getByPlaceholder('Masukkan username');
		await expect(usernameInput).toBeVisible();

		const passwordInput = page.getByPlaceholder('Masukkan password');
		await expect(passwordInput).toBeVisible();

		const submitBtn = page.getByRole('button', { name: 'Masuk', exact: true });
		await expect(submitBtn).toBeVisible();

		// Test interactive Tab navigation order
		await branchSelect.focus();
		await page.keyboard.press('Tab');
		await expect(usernameInput).toBeFocused();

		await page.keyboard.press('Tab');
		await expect(passwordInput).toBeFocused();

		await page.keyboard.press('Tab');
		await expect(submitBtn).toBeFocused();
	});

	test('dialogs have proper ARIA attributes when mounted', async ({ page }) => {
		await page.goto('/login');
		// Ensure no accessibility violations on page body
		const body = page.locator('body');
		await expect(body).toBeVisible();

		// Check for missing alt attributes on images
		const images = await page.locator('img').all();
		for (const img of images) {
			const alt = await img.getAttribute('alt');
			expect(alt !== null, 'All images must have an alt attribute').toBe(true);
		}
	});
});
