import { expect, test, type Page } from '@playwright/test';
import { ownerUsernameForTest } from './helpers';

async function login(page: Page, username: string) {
	const password = process.env.UAT_PASSWORD;
	if (!password) throw new Error('UAT_PASSWORD dari runner terisolasi wajib tersedia');
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(username);
	await page.getByPlaceholder('Masukkan password').fill(password);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
}

async function api<T>(page: Page, path: string, method: string, body?: unknown): Promise<T> {
	return page.evaluate(
		async ({ path, method, body }) => {
			const token = (await (await fetch('/api/csrf')).json()).token;
			const response = await fetch(path, {
				method,
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			if (!response.ok) throw new Error(`${method} ${path} gagal: ${response.status}`);
			return (await response.json()) as T;
		},
		{ path, method, body }
	);
}

test('Kulakan satu perintah mencatat stok, kas, dan HPP sekaligus', async ({ page }) => {
	const username = ownerUsernameForTest(test.info().title);
	await login(page, username);
	const name = `Gula Kulakan E2E ${Date.now() % 100000}`;

	// Siapkan bahan lewat API (tulis asli, bukan mock).
	const created = await api<{ data: { id: string }[] }>(page, '/api/bahan', 'POST', {
		branch: 'samarinda',
		payload: {
			nama: name,
			satuan: 'gram',
			tipe_satuan: 'berat',
			isi_per_kemasan: 1000,
			satuan_beli: 'kg',
			kategori: 'Bahan Baku',
			stok_saat_ini: 0,
			yield_persen: 100
		}
	});
	const bahanId = created.data[0].id;

	// Jalankan alur UI kulakan: Masuk -> 1 kg -> catat kas 20000 -> simpan.
	await page.goto('/stok', { waitUntil: 'domcontentloaded' });
	await page.getByPlaceholder('Cari buah, gula, susu, cup...').fill(name);
	const card = page.locator('h3', { hasText: name });
	await expect(card).toBeVisible({ timeout: 30_000 });
	// Tata letak mobile + desktop sama-sama render; pilih yang terlihat.
	await page.locator('button:visible', { hasText: 'Masuk' }).first().click();
	await expect(page.getByRole('heading', { name: 'Catat Kulakan / Masuk' })).toBeVisible();
	await page.locator('#mutasi-amount').fill('1');
	await page.locator('#stok-mutasi-form select').selectOption('kg');
	await page.getByRole('switch', { name: 'Catat pengeluaran uang kas' }).click();
	await page.locator('#kas-nominal').fill('20000');
	// fetchWithCsrfRetry dapat menjawab 403 sekali lalu mengulang dengan token
	// baru; tunggu respons sukses agar retry transparan tidak dinilai gagal.
	const purchase = page.waitForResponse(
		(res) =>
			res.url().endsWith('/api/bahan/purchase') && res.request().method() === 'POST' && res.ok(),
		{ timeout: 30_000 }
	);
	// Tombol simpan di footer dialog (terhubung via form=).
	await page.getByRole('dialog').getByRole('button', { name: 'Simpan Perubahan' }).click();
	const result = await purchase;
	expect(result.ok()).toBe(true);
	expect(((await result.json()) as { duplicate?: boolean }).duplicate ?? false).toBe(false);

	// Readback: stok + mutasi + kas + HPP konsisten dari server.
	const bahan = await api<{ id: string; stok_saat_ini: number; biaya_per_satuan: number }[]>(
		page,
		`/api/bahan?branch=samarinda`,
		'GET'
	);
	const row = bahan.find((b) => b.id === bahanId);
	expect(row?.stok_saat_ini).toBe(1000);
	expect(row?.biaya_per_satuan).toBe(20);
	const mutasi = await api<
		{ bahan_id: string; delta_jumlah: number; operation_key: string | null }[]
	>(page, `/api/bahan-mutasi?branch=samarinda&bahan_id=${bahanId}&limit=10`, 'GET');
	expect(mutasi.filter((m) => m.bahan_id === bahanId && m.delta_jumlah === 1000)).toHaveLength(1);
	expect(mutasi[0].operation_key).toBeTruthy();

	// Preset "Kulakan Terakhir": 1000 gram tersimpan tampil/diisi 1 kg, bukan 1000 kg.
	await page.locator('button:visible', { hasText: 'Masuk' }).first().click();
	await expect(page.getByRole('heading', { name: 'Catat Kulakan / Masuk' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Kulakan Terakhir \(1 kg\)/ })).toBeVisible();
	await page.getByRole('button', { name: /Kulakan Terakhir \(1 kg\)/ }).click();
	await expect(page.locator('#mutasi-amount')).toHaveValue('1');
	const second = page.waitForResponse(
		(res) =>
			res.url().endsWith('/api/bahan/purchase') && res.request().method() === 'POST' && res.ok(),
		{ timeout: 30_000 }
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Simpan Perubahan' }).click();
	expect((await second).ok()).toBe(true);
	const bahanAfter = await api<{ id: string; stok_saat_ini: number }[]>(
		page,
		`/api/bahan?branch=samarinda`,
		'GET'
	);
	expect(bahanAfter.find((b) => b.id === bahanId)?.stok_saat_ini).toBe(2000);

	// Edit metadata bahan tanpa menyentuh saldo: stok tetap 2000 (AUD-009).
	await page.locator('button:visible', { hasText: 'Ubah' }).first().click();
	await expect(page.getByRole('heading', { name: 'Edit Bahan Baku' })).toBeVisible();
	const editSaved = page.waitForResponse(
		(res) => res.url().includes('/api/bahan') && res.request().method() === 'PATCH' && res.ok(),
		{ timeout: 30_000 }
	);
	await page.getByRole('dialog').getByRole('button', { name: 'Simpan Perubahan' }).click();
	expect((await editSaved).ok()).toBe(true);
	const bahanEdit = await api<{ id: string; stok_saat_ini: number }[]>(
		page,
		`/api/bahan?branch=samarinda`,
		'GET'
	);
	expect(bahanEdit.find((b) => b.id === bahanId)?.stok_saat_ini).toBe(2000);

	// Bersih-bersih: hapus bahan uji (mutasi/kas terisolasi per run).
	await api(page, `/api/bahan?branch=samarinda&id=${bahanId}`, 'DELETE');
});
