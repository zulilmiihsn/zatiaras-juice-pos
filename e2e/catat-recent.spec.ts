import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { csrfMutate, csrfPost, ownerUsernameForTest } from './helpers';

const BEFORE_WITA_MIDNIGHT = '2026-07-01T15:59:50.000Z';
const AFTER_WITA_MIDNIGHT = '2026-07-01T16:00:05.000Z';

function isRecentCatatUrl(rawUrl: string): boolean {
	const url = new URL(rawUrl);
	return (
		url.pathname === '/api/buku-kas' &&
		url.searchParams.get('sumber') === 'catat' &&
		url.searchParams.get('direction') === 'desc' &&
		url.searchParams.get('limit') === '5'
	);
}

function assertDayBounds(rawUrl: string, start: string, end: string) {
	const params = new URL(rawUrl).searchParams;
	expect(params.get('start')).toBe(start);
	expect(params.get('end')).toBe(end);
}

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
	expect((await loginResponse).ok()).toBe(true);
	await expect(page).toHaveURL(/\/$/);
}

async function dismissWarningModal(page: Page): Promise<void> {
	const modal = page.getByText('Tidak ada sesi toko aktif');
	if ((await modal.count()) > 0) {
		await page.keyboard.press('Escape');
		await expect(modal).toBeHidden({ timeout: 5000 });
	}
}

async function submitCatat(page: Page, nominal: string, nama: string): Promise<void> {
	await page.locator('#nominal-input').fill(nominal);
	await page.locator('#nama-input').fill(nama);
	await page
		.getByRole('button', { name: /Simpan Transaksi/ })
		.first()
		.click();
	const snackbar = page.getByText('Transaksi berhasil dicatat!');
	await expect(snackbar).toBeVisible({ timeout: 45000 });
	await dismissWarningModal(page);
	// A stale success snackbar must not make an ignored second click appear successful.
	await expect(snackbar).toBeHidden({ timeout: 10000 });
}

type LedgerRow = {
	id: string;
	sumber: string;
	cabang_id: string;
	nominal: number;
	deskripsi: string;
	waktu: string;
};

// The clock freezes Date only, not timers or the server's login/CSRF/expiry guards.
test('recent card shows five newest rows of today only', async ({ page }) => {
	await page.clock.setFixedTime(new Date(BEFORE_WITA_MIDNIGHT));
	await loginAsOwner(page, test.info().title);
	const cleanupId = 'owned-catat-cleanup-csrf';
	const seed = await csrfPost(page, '/api/buku-kas', {
		payload: {
			id: cleanupId,
			sumber: 'catat',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 1,
			metode_bayar: 'tunai',
			deskripsi: 'Owned cleanup fixture',
			waktu: '2026-07-01T15:00:00.000Z'
		}
	});
	expect(seed.ok()).toBe(true);
	let rejectedCleanup = 0;
	let cleanupAttempts = 0;
	const realFetch = page.request.fetch.bind(page.request);
	// APIRequestContext bypasses page.route: exercise a real rejection at the HTTP CSRF boundary.
	page.request.fetch = async (url, options) => {
		if (
			typeof url === 'string' &&
			options?.method === 'DELETE' &&
			new URL(url, page.url()).searchParams.get('id') === cleanupId
		) {
			cleanupAttempts++;
			if (rejectedCleanup === 0) {
				rejectedCleanup++;
				const response = await realFetch(url, {
					...options,
					headers: { ...options.headers, 'X-CSRF-Token': 'owned-invalid-token' }
				});
				expect(response.status()).toBe(403);
				expect(((await response.json()) as { code?: string }).code).toBe('CSRF_INVALID');
				return response;
			}
		}
		return realFetch(url, options);
	};
	try {
		// Only synthetic manual ledger rows in this run-owned D1; never delete POS history for setup.
		const existingResponse = await page.request.get('/api/buku-kas?sumber=catat&limit=500');
		expect(existingResponse.ok()).toBe(true);
		const existing = (await existingResponse.json()) as LedgerRow[];
		expect(Array.isArray(existing)).toBe(true);
		for (const row of existing) {
			expect(row.sumber).toBe('catat');
			const response = await csrfMutate(
				page,
				'DELETE',
				`/api/buku-kas?id=${encodeURIComponent(row.id)}`,
				undefined
			);
			expect(response.ok()).toBe(true);
		}
		expect(rejectedCleanup).toBe(1);
		expect(cleanupAttempts).toBe(2);
		const removed = await page.request.get(`/api/buku-kas?id=${cleanupId}`);
		expect(removed.ok()).toBe(true);
		expect(await removed.json()).toEqual([]);
	} finally {
		page.request.fetch = realFetch;
	}
	await page.goto('/catat');
	await expect(page.locator('#catat-form')).toBeVisible({ timeout: 30000 });
	await expect(page.locator('#tanggal-input')).toHaveValue('2026-07-01');
	for (let index = 0; index < 6; index++) {
		await page.locator('#waktu-input').fill(`23:${String(index * 10).padStart(2, '0')}`);
		await submitCatat(page, String((index + 1) * 1000), `Uji Baru ${(index + 1) * 1000}`);
	}
	await page.locator('#tanggal-input').fill('2026-06-30');
	await submitCatat(page, '999999', 'Uji Kemarin Marker');

	const recentResponse = page.waitForResponse(
		(response) => response.request().method() === 'GET' && isRecentCatatUrl(response.url())
	);
	await page.reload();
	const response = await recentResponse;
	expect(response.ok()).toBe(true);
	assertDayBounds(response.url(), '2026-06-30T16:00:00.000Z', '2026-07-01T15:59:59.999Z');
	const rows = (await response.json()) as LedgerRow[];
	expect(rows.map((row) => row.nominal)).toEqual([6000, 5000, 4000, 3000, 2000]);
	expect(rows.every((row) => row.sumber === 'catat' && row.cabang_id === 'samarinda')).toBe(true);
	expect(rows.map((row) => new Date(row.waktu).toISOString())).toEqual(
		[50, 40, 30, 20, 10].map((minute) => `2026-07-01T15:${minute}:00.000Z`)
	);
	const cardBox = page.locator('div.soft-float-card', { hasText: 'Riwayat Catatan Kas' });
	await expect(cardBox.getByText('Uji Baru 6000').first()).toBeVisible({ timeout: 15000 });
	await expect(cardBox.getByText('Uji Baru 3000').first()).toBeVisible();
	await expect(cardBox.getByText('Uji Baru 1000')).toHaveCount(0);
	await expect(cardBox.getByText('Uji Kemarin Marker')).toHaveCount(0);
	// The card previews four; the actual bounded consumer above must still return all five.
	const cardText = (await cardBox.innerText()).replace(/\s+/g, ' ');
	expect(cardText.indexOf('Uji Baru 6000')).toBeLessThan(cardText.indexOf('Uji Baru 5000'));
	expect(cardText.indexOf('Uji Baru 5000')).toBeLessThan(cardText.indexOf('Uji Baru 4000'));
});

test('recent card failure shows error state and recovers', async ({ page }) => {
	await page.clock.setFixedTime(new Date(BEFORE_WITA_MIDNIGHT));
	await loginAsOwner(page, test.info().title);
	const seed = await csrfPost(page, '/api/buku-kas', {
		payload: {
			id: 'owned-catat-recovery',
			sumber: 'catat',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 7123,
			metode_bayar: 'tunai',
			deskripsi: 'Catat recovery marker',
			waktu: '2026-07-01T15:55:00.000Z'
		}
	});
	expect(seed.ok()).toBe(true);
	let failedUrl = '';
	await page.route('**/api/buku-kas?*', async (route) => {
		if (
			route.request().method() === 'GET' &&
			isRecentCatatUrl(route.request().url()) &&
			!failedUrl
		) {
			failedUrl = route.request().url();
			await route.fulfill({ status: 500, json: { message: 'Owned Catat consumer failure' } });
			return;
		}
		await route.continue();
	});
	await page.goto('/catat');
	await expect(page.getByText('Gagal memuat aktivitas terbaru').first()).toBeVisible({
		timeout: 30000
	});
	expect(isRecentCatatUrl(failedUrl)).toBe(true);
	assertDayBounds(failedUrl, '2026-06-30T16:00:00.000Z', '2026-07-01T15:59:59.999Z');
	await expect(page.getByText('Belum Ada Catatan Manual')).toHaveCount(0);
	const recovery = page.waitForResponse(
		(response) =>
			response.request().method() === 'GET' &&
			isRecentCatatUrl(response.url()) &&
			response.status() === 200
	);
	await page.getByRole('button', { name: 'Muat ulang aktivitas' }).click();
	const rows = (await (await recovery).json()) as LedgerRow[];
	expect(rows[0].id).toBe('owned-catat-recovery');
	expect(rows[0].nominal).toBe(7123);
	await expect(page.getByText('Gagal memuat aktivitas terbaru')).toHaveCount(0, { timeout: 15000 });
	await expect(page.getByText('Catat recovery marker').first()).toBeVisible();
});

test('recent card has a legitimate empty state just after WITA midnight', async ({ page }) => {
	await page.clock.setFixedTime(new Date(AFTER_WITA_MIDNIGHT));
	await loginAsOwner(page, test.info().title);
	const seed = await csrfPost(page, '/api/buku-kas', {
		payload: {
			id: 'owned-catat-midnight',
			sumber: 'catat',
			tipe: 'in',
			jenis: 'pendapatan_usaha',
			nominal: 789,
			metode_bayar: 'tunai',
			deskripsi: 'Previous WITA day boundary',
			waktu: '2026-07-01T15:59:59.999Z'
		}
	});
	expect(seed.ok()).toBe(true);
	const stored = await page.request.get('/api/buku-kas?id=owned-catat-midnight');
	expect(stored.ok()).toBe(true);
	expect(((await stored.json()) as LedgerRow[])[0].waktu).toBe('2026-07-01T15:59:59.999Z');
	const recentResponse = page.waitForResponse(
		(response) => response.request().method() === 'GET' && isRecentCatatUrl(response.url())
	);
	await page.goto('/catat');
	const response = await recentResponse;
	expect(response.status()).toBe(200);
	assertDayBounds(response.url(), '2026-07-01T16:00:00.000Z', '2026-07-02T15:59:59.999Z');
	expect(await response.json()).toEqual([]);
	await expect(page.locator('#tanggal-input')).toHaveValue('2026-07-02');
	await expect(page.getByText('Belum Ada Catatan Manual').first()).toBeVisible();
	await expect(page.getByText('Gagal memuat aktivitas terbaru')).toHaveCount(0);
});
