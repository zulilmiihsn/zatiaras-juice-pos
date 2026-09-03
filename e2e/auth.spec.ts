import { expect, test } from '@playwright/test';

test.describe('Authentication Browser Flows', () => {
	test('redirects unauthenticated user to /login', async ({ page }) => {
		await page.goto('/pengaturan/pemilik/pajak');
		await expect(page).toHaveURL(/\/login/);
	});

	test('shows error message on invalid credentials', async ({ page }) => {
		await page.goto('/login');
		await expect(page.locator('form')).toBeVisible({ timeout: 30_000 });

		const submitBtn = page.getByRole('button', { name: 'Masuk', exact: true });
		await expect(submitBtn).toBeEnabled({ timeout: 15_000 });

		await page.getByPlaceholder('Masukkan username').fill('unknown_user');
		await page.getByPlaceholder('Masukkan password').fill('wrong_password_123');
		await submitBtn.click();

		await expect(page.getByText(/Gagal|salah|tidak ditemukan|tidak valid/i).first()).toBeVisible({
			timeout: 15_000
		});
	});
});
