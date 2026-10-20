import { expect, test, type Page, type Request } from '@playwright/test';
import { gotoHydrated } from './helpers';

// Halaman Pengaturan Pemilik > Keamanan setelah dipecah ke store +
// kartu. Mock jaringan; tidak ada kredensial atau PIN nyata yang diubah.
async function mockSettingsSession(page: Page, role: 'pemilik' | 'kasir' = 'pemilik') {
	const writes: Array<{ method: string; url: string; body: unknown }> = [];
	await page.clock.setFixedTime(new Date('2026-10-20T04:00:00.000Z'));
	const expiresAt = Date.parse('2026-10-20T05:00:00.000Z');
	await page.addInitScript(
		({ role, expiresAt }) => {
			localStorage.setItem('selectedBranch', 'samarinda');
			localStorage.setItem(
				'zatiaras_session',
				JSON.stringify({
					isAuthenticated: true,
					user: { id: 'u', username: 'pengaturanuji', role, branch: 'samarinda' },
					expiresAt
				})
			);
		},
		{ role, expiresAt }
	);
	await page.route('**/api/**', async (route) => {
		const request: Request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
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
						user: { id: 'u', username: 'pengaturanuji', role, branch: 'samarinda' },
						expiresAt
					}
				: path === '/api/csrf'
					? { success: true, token: 'test-token' }
					: path === '/api/pengaturan'
						? [{ id: 'cfg-1', pinConfigured: true, halaman_terkunci: ['catat'] }]
						: (path === '/api/buku-kas' || path === '/api/transaksi-kasir') &&
							  url.searchParams.get('pagination') === 'cursor'
							? { data: [], nextCursor: null, hasMore: false }
							: [];
		await route.fulfill({ json: data });
	});
	return writes;
}

function expectOnlyNotificationRegistration(
	writes: Awaited<ReturnType<typeof mockSettingsSession>>
) {
	// Layout mendaftarkan perangkat notifikasi saat mount; navigasi tidak boleh memutasi pengaturan.
	for (const write of writes) {
		expect(new URL(write.url).pathname).toBe('/api/antrean/notifikasi/perangkat');
		expect(write.method).toBe('POST');
	}
}

for (const viewport of [
	{ name: 'desktop', width: 1440, height: 900, columns: 4 },
	{ name: 'tablet', width: 820, height: 1180, columns: 2 },
	{ name: 'mobile', width: 390, height: 844, columns: 1 },
	{ name: 'small mobile', width: 320, height: 740, columns: 1 }
]) {
	test(`settings keep four balanced menus and owner access (${viewport.name})`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		const writes = await mockSettingsSession(page);
		await gotoHydrated(page, '/pengaturan', 'h2:text-is("Pemilik Kios")');
		const manageBusiness = page.getByRole('link', { name: 'Kelola usaha', exact: true });
		await expect(manageBusiness).toBeVisible();
		await expect(manageBusiness).toHaveAttribute('href', '/pengaturan/pemilik');

		const menus = page.getByRole('navigation', { name: 'Menu pengaturan', exact: true });
		const items = menus.getByRole('button');
		await expect(items).toHaveCount(4);
		await expect(items).toHaveText([
			/Antrean.*Notifikasi/,
			/Draft Struk.*Thermal/,
			/Riwayat.*Hari Ini/,
			/Install PWA.*App Offline/
		]);
		await expect(menus.getByRole('link', { name: 'Kelola usaha' })).toHaveCount(0);
		await expect(menus.getByRole('button', { name: /^Install PWA/ })).toBeEnabled();
		const bounds = await items.evaluateAll((elements) =>
			elements.map((element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			})
		);
		expect(new Set(bounds.map(({ x }) => Math.round(x))).size).toBe(viewport.columns);
		expect(new Set(bounds.map(({ y }) => Math.round(y))).size).toBe(4 / viewport.columns);
		for (const item of bounds) {
			expect(Math.abs(item.width - bounds[0].width)).toBeLessThan(1);
			expect(Math.abs(item.height - bounds[0].height)).toBeLessThan(1);
			expect(item.height).toBeGreaterThanOrEqual(44);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({
			path: test.info().outputPath(`settings-${viewport.name.replaceAll(' ', '-')}.png`),
			fullPage: true
		});

		await manageBusiness.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/pengaturan\/pemilik$/);
		expectOnlyNotificationRegistration(writes);
	});
}

test('cashier settings preserve menu actions without owner access', async ({ page }) => {
	const writes = await mockSettingsSession(page, 'kasir');
	await gotoHydrated(page, '/pengaturan', 'h2:text-is("Kasir Kios")');
	await expect(page.getByRole('heading', { name: 'Kasir Kios', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Kelola usaha', exact: true })).toHaveCount(0);
	const menus = page.getByRole('navigation', { name: 'Menu pengaturan', exact: true });
	await expect(menus.getByRole('button')).toHaveCount(4);
	const install = menus.getByRole('button', { name: /^Install PWA/ });
	await expect(install).toBeEnabled();
	await page.locator('pwa-install').evaluate((element) => {
		Object.defineProperty(element, 'showDialog', {
			value: () => element.setAttribute('data-install-requested', 'true'),
			configurable: true
		});
	});
	await install.click();
	await expect(page.locator('pwa-install')).toHaveAttribute('data-install-requested', 'true');

	await page.getByRole('button', { name: 'Logout', exact: true }).click();
	const logout = page.getByRole('dialog', { name: 'Konfirmasi Logout', exact: true });
	await expect(logout).toBeVisible();
	await logout.getByRole('button', { name: 'Batal', exact: true }).click();
	await expect(logout).toBeHidden();
	expectOnlyNotificationRegistration(writes);

	for (const [menu, path] of [
		['Antrean', '/pengaturan/antrean'],
		['Draft Struk', '/pengaturan/printer'],
		['Riwayat', '/pengaturan/riwayat']
	]) {
		await gotoHydrated(page, '/pengaturan', 'h2:text-is("Kasir Kios")');
		await expect(page.getByRole('heading', { name: 'Kasir Kios', exact: true })).toBeVisible();
		await page
			.getByRole('navigation', { name: 'Menu pengaturan', exact: true })
			.getByRole('button', { name: new RegExp(`^${menu}`) })
			.click();
		await expect(page).toHaveURL(new RegExp(`${path}$`));
	}
	expectOnlyNotificationRegistration(writes);
});

test('security settings render, validate PIN locally, and save locked pages once', async ({
	page
}) => {
	const writes = await mockSettingsSession(page);
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
