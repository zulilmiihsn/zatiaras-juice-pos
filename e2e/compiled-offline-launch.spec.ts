import { expect, test } from '@playwright/test';
import { ownerUsernameForTest } from './helpers';

test('compiled offline launch precaches cashier shells before visiting them', async ({
	page,
	context
}) => {
	await page.goto('/login');
	await expect
		.poll(
			() =>
				page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
			{ timeout: 30_000 }
		)
		.toBe('activated');
	const shells = await page.evaluate(async () => {
		const urls = (
			await Promise.all(
				(await caches.keys())
					.filter((k) => k.includes('precache'))
					.map(async (k) =>
						(await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)
					)
			)
		).flat();
		return urls;
	});
	for (const path of ['/pos', '/pos/bayar', '/antrean', '/offline']) expect(shells).toContain(path);
	expect(shells.some((path) => path.startsWith('/api/'))).toBe(false);
	await page.close();
	await context.setOffline(true);
	const reopened = await context.newPage();
	const response = await reopened.goto('/', { waitUntil: 'commit' });
	expect(new URL(response!.url()).pathname).toBe('/pos');
	expect(response!.fromServiceWorker()).toBe(true);
	// Menyimpan tampilan tidak memberikan sesi pada perangkat yang belum login.
	await expect(reopened).toHaveURL(/\/login\?reason=offline_session_expired/);
	await reopened.goto('/laporan', { waitUntil: 'commit' });
	await expect(reopened.getByRole('heading', { name: 'Koneksi terputus' })).toBeVisible();
});

test('compiled offline launch records cash and syncs after reopening from the app entry', async ({
	page,
	context
}) => {
	const password = process.env.UAT_PASSWORD;
	if (!password) throw new Error('Fixture akun uji tidak tersedia');
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 30_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(test.info().title));
	await page.getByPlaceholder('Masukkan password').fill(password);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect
		.poll(
			() =>
				page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
			{ timeout: 30_000 }
		)
		.toBe('activated');
	await page.goto('/pos');
	const menu = (tab: typeof page) =>
		tab.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ });
	await expect(menu(page)).toBeVisible({ timeout: 30_000 });
	const reopened = await context.newPage();
	await page.close();
	await context.setOffline(true);
	await reopened.goto('/');
	await expect(reopened).toHaveURL(/\/pos$/);
	await menu(reopened).click();
	await reopened.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await reopened.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();
	await reopened.getByRole('button', { name: /^Bayar Rp/ }).click();
	await expect(reopened).toHaveURL(/\/pos\/bayar$/);
	await reopened.getByLabel('Nama Pelanggan').fill('UAT buka POS offline');
	await reopened.getByRole('button', { name: 'Tunai', exact: true }).click();
	await reopened.getByRole('button', { name: 'Konfirmasi & Proses Transaksi' }).click();
	const cashInput = reopened.getByPlaceholder('0', { exact: true });
	await expect(reopened.getByText('Mode Offline Aktif')).toBeVisible();
	await expect(cashInput).toBeVisible();
	await cashInput.fill('12000');
	await reopened.getByRole('button', { name: 'Selesai', exact: true }).click();
	await expect(
		reopened.getByText('Tersimpan di perangkat dan menunggu sinkronisasi.')
	).toBeVisible();
	const synced = reopened.waitForResponse(
		(response) => response.url().endsWith('/api/pos/transaction') && response.ok()
	);
	await context.setOffline(false);
	const response = await synced;
	const result = await response.json();
	expect(result.data).toMatchObject({ total_amount: 10000 });
	const replay = await reopened.evaluate(async (body) => {
		const { token } = await (await fetch('/api/csrf')).json();
		return (
			await fetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
				body
			})
		).json();
	}, response.request().postData());
	expect(replay.idempotent).toBe(true);
	expect(replay.data.transaction_id).toBe(result.data.transaction_id);
});
