import { expect, test, type Page, type Request } from '@playwright/test';
import { gotoHydrated } from './helpers';

// AUD-053: halaman Pengaturan Pemilik > Keamanan setelah dipecah ke store +
// kartu. Mock jaringan; tidak ada kredensial atau PIN nyata yang diubah.
async function mockOwner(page: Page) {
	const writes: Array<{ method: string; url: string; body: unknown }> = [];
	await page.addInitScript(() => {
		localStorage.setItem('selectedBranch', 'samarinda');
		localStorage.setItem(
			'zatiaras_session',
			JSON.stringify({
				isAuthenticated: true,
				user: { id: 'u', username: 'pemilikuji', role: 'pemilik', branch: 'samarinda' },
				expiresAt: Date.now() + 3600000
			})
		);
	});
	await page.route('**/api/**', async (route) => {
		const request: Request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() !== 'GET') {
			writes.push({ method: request.method(), url: request.url(), body: request.postDataJSON() });
			await route.fulfill({ json: { ok: true } });
			return;
		}
		const data =
			path === '/api/session'
				? {
						success: true,
						authenticated: true,
						user: { id: 'u', username: 'pemilikuji', role: 'pemilik' },
						expiresAt: Date.now() + 3600000
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: path === '/api/pengaturan'
						? [{ id: 'cfg-1', pinConfigured: true, halaman_terkunci: ['catat'] }]
						: [];
		await route.fulfill({ json: data });
	});
	return writes;
}

test('security settings render, validate PIN locally, and save locked pages once', async ({
	page
}) => {
	const writes = await mockOwner(page);
	await gotoHydrated(page, '/pengaturan/pemilik/gantikeamanan', 'text=Kredensial Akun');

	// Field PIN lama hanya muncul setelah mount() memuat pengaturan: penanda hidrasi.
	await expect(page.getByPlaceholder('PIN lama (4 angka)')).toBeVisible({ timeout: 15000 });

	// Kredensial: tab Kasir menampilkan form kasir; kembali ke Pemilik.
	await page.getByText('Akun Kasir', { exact: true }).click();
	await expect(page.getByPlaceholder('Masukkan password kasir saat ini')).toBeVisible();
	await page.getByText('Akun Pemilik', { exact: true }).click();
	await expect(page.getByPlaceholder('Masukkan password saat ini')).toBeVisible();

	// PIN: konfirmasi tidak cocok ditolak di klien tanpa request.
	await page.getByPlaceholder('PIN lama (4 angka)').fill('2580');
	await page.getByPlaceholder('PIN baru (4 angka)').fill('1357');
	await page.getByPlaceholder('Ulangi PIN (4 angka)').fill('1358');
	await page.getByPlaceholder('Ulangi PIN (4 angka)').press('Enter');
	await expect(page.getByText('Konfirmasi PIN tidak cocok.')).toBeVisible();
	expect(writes.filter((w) => w.url.includes('/api/pin'))).toHaveLength(0);

	// Halaman terkunci: status awal dari server dikirim ulang tepat sekali.
	await page.getByRole('button', { name: 'Simpan Pengaturan Halaman' }).click();
	await expect.poll(() => writes.filter((w) => w.url.includes('/api/pengaturan')).length).toBe(1);
	expect(JSON.stringify(writes.find((w) => w.url.includes('/api/pengaturan'))?.body)).toContain(
		'"halaman_terkunci":["catat"]'
	);
	await expect(page.getByText('Pengaturan halaman terkunci berhasil disimpan!')).toBeVisible();
});
