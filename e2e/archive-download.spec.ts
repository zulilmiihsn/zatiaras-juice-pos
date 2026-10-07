import { expect, test, type Page } from '@playwright/test';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { ownerUsernameForTest } from './helpers';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	const password = existsSync('.env')
		? readFileSync('.env', 'utf8')
				.split(/\r?\n/)
				.find((line) => line.startsWith('UAT_PASSWORD='))
				?.slice('UAT_PASSWORD='.length)
				.trim()
		: '';
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

async function loginAsOwner(page: Page, title: string) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(title));
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok()).toBe(true);
	await expect(page).toHaveURL(/\/$/, { timeout: 60_000 });
}

async function readDownload(download: import('@playwright/test').Download): Promise<string> {
	const path = await download.path();
	if (!path) throw new Error('jalur unduhan hilang');
	return fs.readFile(path, 'utf8');
}

async function csrfPost(page: Page, path: string, data: unknown) {
	const csrf = (await (await page.request.get('/api/csrf')).json()) as { token?: string };
	return page.request.post(path, {
		data,
		headers: csrf.token ? { 'X-CSRF-Token': csrf.token } : {}
	});
}

// Klik Svelte hanya sah sesudah hidrasi; klik SSR buta = no-op.
// Helper ini klik ulang sampai dialog konfirmasi benar muncul.
async function openArchiveConfirm(page: Page) {
	await page.goto('/pengaturan/pemilik/arsip');
	await expect(page.getByRole('button', { name: 'Mulai Arsipkan' })).toBeVisible({
		timeout: 60_000
	});
	for (let attempt = 0; attempt < 3; attempt++) {
		await page.getByRole('button', { name: 'Mulai Arsipkan' }).click();
		if (
			await page
				.getByText(/Yakin arsipkan transaksi/)
				.waitFor({ timeout: 10_000 })
				.then(() => true)
				.catch(() => false)
		)
			return;
	}
	await expect(page.getByText(/Yakin arsipkan transaksi/)).toBeVisible({ timeout: 10_000 });
}

// Tutup sesi toko seed agar prekondisi arsip lolos.
async function closeOpenSession(page: Page) {
	const list = await page.request.get('/api/sesi-toko?is_active=1');
	console.log(`PROBE sesi-list status=${list.status()}`);
	if (!list.ok()) return;
	const body = (await list.json()) as unknown;
	console.log(`PROBE sesi-list body=${JSON.stringify(body).slice(0, 200)}`);
	const rows = body as Array<{ id?: string }>;
	const active = Array.isArray(rows)
		? rows[0]
		: (rows as unknown as { data?: Array<{ id?: string }> })?.data?.[0];
	if (!active?.id) return;
	const csrf = (await (await page.request.get('/api/csrf')).json()) as { token?: string };
	const patched = await page.request.patch('/api/sesi-toko', {
		data: {
			payload: { waktu_tutup: new Date().toISOString(), is_active: false },
			where: { id: active.id }
		},
		headers: csrf.token ? { 'X-CSRF-Token': csrf.token } : {}
	});
	console.log(
		`PROBE sesi-patch status=${patched.status()} body=${(await patched.text()).slice(0, 200)}`
	);
}

// Tanam baris lama langsung via API agar eligible arsip.
async function seedOldRow(page: Page, id: string, nominal: number) {
	const res = await csrfPost(page, '/api/buku-kas', {
		payload: {
			id,
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal,
			jumlah: 1,
			waktu: '2024-06-01T02:00:00.000Z',
			sumber: 'catat',
			deskripsi: `Arsip fixture ${id}`,
			metode_bayar: 'tunai'
		}
	});
	expect(res.ok(), `seed ${id} status=${res.status()} body=${(await res.text()).slice(0, 200)}`).toBe(true);
}

// AUD-040: arsip -> unduh otomatis -> unduh ulang byte-identik (retry
// sesudah respons hilang). Gagal unduh berlabel gagal, bukan selesai.
test('archive retry download returns identical bytes', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await closeOpenSession(page);
	await seedOldRow(page, 'dl-seed-1', 12000);
	await openArchiveConfirm(page);
	const auto = page.waitForEvent('download', { timeout: 120000 });
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).toBeVisible({
		timeout: 120000
	});
	const firstBytes = await readDownload(await auto);

	const retryWait = page.waitForEvent('download', { timeout: 60000 });
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	const retryBytes = await readDownload(await retryWait);
	expect(retryBytes).toBe(firstBytes);
	expect(JSON.parse(retryBytes).meta.schema_version).toBe(3);
});

// Respons hilang (reload) -> arsip ulang tahun sama -> resumed + tetap bisa unduh.
test('lost response recovers via resumed download', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await closeOpenSession(page);
	await seedOldRow(page, 'dl-seed-2', 13000);
	await openArchiveConfirm(page);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).toBeVisible({
		timeout: 120000
	});

	await page.reload();
	await openArchiveConfirm(page);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).toBeVisible({
		timeout: 120000
	});
	const retry = page.waitForEvent('download', { timeout: 60000 });
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	const retryBytes = await readDownload(await retry);
	expect(JSON.parse(retryBytes).meta.branch).toBe('samarinda');
});

// Unduhan gagal = status gagal, bukan label selesai.
test('failed download is labeled failed, not downloaded', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await closeOpenSession(page);
	await seedOldRow(page, 'dl-seed-3', 14000);
	await openArchiveConfirm(page);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).toBeVisible({
		timeout: 120000
	});
	await page.route('**/api/archive/download?*', (route) => route.abort());
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	await expect(page.getByText(/Unduhan arsip gagal/).first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByText('Unduhan selesai.')).toHaveCount(0);
});
