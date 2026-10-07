import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
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
	await expect(page).toHaveURL(/\/$/);
}

async function dismissWarningModal(page: Page): Promise<void> {
	const modal = page.getByText('Tidak ada sesi toko aktif');
	if ((await modal.count()) > 0) {
		await page.keyboard.press('Escape');
		await expect(modal)
			.toBeHidden({ timeout: 5000 })
			.catch(() => undefined);
	}
}

async function submitCatat(page: Page, nominal: string, nama: string): Promise<void> {
	await page.locator('#nominal-input').fill(nominal);
	await page.locator('#nama-input').fill(nama);
	const submit = page.getByRole('button', { name: /Simpan Transaksi/ }).first();
	await submit.click();
	// Kompilasi dingin dev bisa lambat pada simpan pertama.
	const snackbar = page.getByText('Transaksi berhasil dicatat!');
	await expect(snackbar).toBeVisible({ timeout: 45000 });
	await dismissWarningModal(page);
	// Serialkan: snackbar hilang = simpan selesai + isSubmitting false.
	// Tanpa ini klik berikut diam-diam diabaikan + snackbar basi lolos asersi.
	await expect(snackbar).toBeHidden({ timeout: 10000 });
}

async function submitCatatAt(
	page: Page,
	timeHm: string,
	nominal: string,
	nama: string
): Promise<void> {
	await page.locator('#waktu-input').fill(timeHm);
	await submitCatat(page, nominal, nama);
}

// AUD-027: enam baris hari ini (menit beda) + satu kemarin = lima terbaru hari ini.
test('recent card shows five newest rows of today only', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await page.goto('/catat');
	await expect(page.locator('#catat-form')).toBeVisible({ timeout: 30000 });
	// Tunggu init klien (default tanggal terisi = hidrasi + state jalan).
	await expect
		.poll(() => page.locator('#tanggal-input').inputValue(), { timeout: 30000 })
		.not.toBe('');

	// Menit eksplisit berbeda agar urutan terbaru deterministik
	// (tie-break id UUID tak mencerminkan resensi dalam semenit).
	// Selalu dari jam WITA, bukan zona perangkat/Node.
	const witaNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Makassar' }));
	const nowMin = witaNow.getHours() * 60 + witaNow.getMinutes();
	const minutes = nowMin >= 40 ? [30, 24, 18, 12, 6, 1].map((d) => nowMin - d) : [1, 2, 3, 4, 5, 6];
	const hm = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	const nominals = [1000, 2000, 3000, 4000, 5000, 6000];
	for (let i = 0; i < 6; i++) {
		await submitCatatAt(page, hm(minutes[i]), String(nominals[i]), `Uji Baru ${nominals[i]}`);
	}

	// Satu baris kemarin via tanggal eksplisit (turun dari hari WITA kini).
	const todayYmd = await page.locator('#tanggal-input').inputValue();
	const [yy, mm, dd] = todayYmd.split('-').map(Number);
	const yDate = new Date(Date.UTC(yy, mm - 1, dd - 1));
	const pad = (v: number) => String(v).padStart(2, '0');
	const ymd = `${yDate.getUTCFullYear()}-${pad(yDate.getUTCMonth() + 1)}-${pad(yDate.getUTCDate())}`;
	await page.locator('#tanggal-input').fill(ymd);
	await submitCatat(page, '999999', 'Uji Kemarin Marker');

	await page.reload();
	const card = page.getByText('Riwayat Catatan Kas');
	await expect(card).toBeVisible({ timeout: 30000 });
	const cardBox = page.locator('div.soft-float-card', { hasText: 'Riwayat Catatan Kas' });
	await expect(cardBox.getByText('Uji Baru 6000').first()).toBeVisible({ timeout: 15000 });
	await expect(cardBox.getByText('Uji Baru 3000').first()).toBeVisible();
	await expect(cardBox.getByText('Uji Baru 1000')).toHaveCount(0);
	await expect(cardBox.getByText('Uji Kemarin Marker')).toHaveCount(0);
	// Urutan terbaru dulu (UI tampil 4 dari 5 hasil query).
	const cardText = (await cardBox.innerText()).replace(/\s+/g, ' ');
	expect(cardText.indexOf('Uji Baru 6000')).toBeLessThan(cardText.indexOf('Uji Baru 5000'));
	expect(cardText.indexOf('Uji Baru 5000')).toBeLessThan(cardText.indexOf('Uji Baru 4000'));
});

// AUD-027: gagal query tampil sebagai error, bukan kosong valid + pulih via retry.
test('recent card failure shows error state and recovers', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	let failOnce = true;
	await page.route('**/api/buku-kas?*', async (route) => {
		if (route.request().method() === 'GET' && failOnce) {
			failOnce = false;
			await route.fulfill({ status: 500, json: { message: 'boom' } });
			return;
		}
		await route.continue();
	});
	await page.goto('/catat');
	await expect(page.getByText('Gagal memuat aktivitas terbaru').first()).toBeVisible({
		timeout: 30000
	});
	expect(await page.getByText('Belum Ada Catatan Manual').count()).toBe(0);

	await page.getByRole('button', { name: 'Muat ulang aktivitas' }).click();
	await expect(page.getByText('Gagal memuat aktivitas terbaru')).toHaveCount(0, { timeout: 15000 });
});
