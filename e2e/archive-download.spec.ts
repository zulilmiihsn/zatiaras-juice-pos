import { expect, test, type Page } from '@playwright/test';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { csrfMutate, ownerUsernameForTest } from './helpers';

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
	type SessionRow = { id?: string; is_active?: boolean | number };
	const rows = (
		Array.isArray(body) ? body : ((body as { data?: SessionRow[] })?.data ?? [])
	) as SessionRow[];
	const active = rows.find((row) => row.is_active === true || row.is_active === 1);
	if (!active?.id) return;
	const patched = await csrfMutate(page, 'PATCH', '/api/sesi-toko', {
		payload: { waktu_tutup: new Date().toISOString(), is_active: false },
		where: { id: active.id }
	});
	expect(patched.ok(), 'Close only the actual active fixture session').toBe(true);
}

// Tanam baris lama langsung via API agar eligible arsip.
async function seedOldRow(page: Page, id: string, nominal: number) {
	const res = await csrfMutate(page, 'POST', '/api/buku-kas', {
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
	expect(
		res.ok(),
		`seed ${id} status=${res.status()} body=${(await res.text()).slice(0, 200)}`
	).toBe(true);
}

// AUD-040: arsip -> unduh otomatis -> unduh ulang byte-identik (retry
// sesudah respons hilang). Gagal unduh berlabel gagal, bukan selesai.
test('archive retry download returns identical bytes', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	await closeOpenSession(page);
	await seedOldRow(page, 'dl-seed-1', 12000);
	await openArchiveConfirm(page);
	const auto = page.waitForEvent('download', { timeout: 120000 });
	const committed = page.waitForResponse(
		(response) => response.url().endsWith('/api/archive') && response.request().method() === 'POST'
	);
	const nativeDownload = page.waitForResponse((response) =>
		response.url().includes('/api/archive/download?')
	);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	const metadata = (await (await committed).json()) as Record<string, unknown>;
	expect(Object.hasOwn(metadata, 'content')).toBe(false);
	expect((await nativeDownload).status()).toBe(200);
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
	let initialDownloadAttempts = 0;
	await page.route('**/api/archive/download?*', (route) => {
		initialDownloadAttempts++;
		return route.abort();
	});
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).toBeVisible({
		timeout: 120000
	});
	await expect(page.getByText(/Unduhan arsip gagal/).first()).toBeVisible({ timeout: 30000 });
	expect(initialDownloadAttempts).toBe(1);
	await expect(page.getByText(/baris.*berhasil diarsipkan/).first()).not.toContainText('diunduh');
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	await expect.poll(() => initialDownloadAttempts).toBe(2);
	await expect(page.getByText('Unduhan selesai.')).toHaveCount(0);
	await page.unroute('**/api/archive/download?*');
	// HTTP 200 is not completion: the actual UI consumer must fail when the streamed body fails.
	await page.evaluate(() => {
		const original = window.fetch;
		let failOnce = true;
		window.fetch = async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (failOnce && url.includes('/api/archive/download?')) {
				failOnce = false;
				// Disabled is set before awaited CSRF/headers; hold this response to expose that race.
				await new Promise<void>((resolve) => {
					window.addEventListener('zatiaras-test-r2-headers-release', () => resolve(), {
						once: true
					});
					document.documentElement.dataset.archiveTailPhase = 'headers-held';
				});
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('{"partial":'));
							window.addEventListener(
								'zatiaras-test-r2-tail-failure',
								() => {
									document.documentElement.dataset.archiveTailPhase = 'errored';
									controller.error(new Error('Synthetic R2 stream failure'));
								},
								{ once: true }
							);
							document.documentElement.dataset.archiveTailPhase = 'stream-ready';
						}
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			}
			return original.call(window, input, init);
		};
	});
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	await expect(page.getByRole('button', { name: 'Mengunduh…' })).toBeDisabled();
	await expect
		.poll(() => page.evaluate(() => document.documentElement.dataset.archiveTailPhase), {
			timeout: 10000
		})
		.toBe('headers-held');
	await expect(page.getByText('Unduhan selesai.')).toHaveCount(0);
	await page.evaluate(() => window.dispatchEvent(new Event('zatiaras-test-r2-headers-release')));
	await expect
		.poll(() => page.evaluate(() => document.documentElement.dataset.archiveTailPhase), {
			timeout: 10000
		})
		.toBe('stream-ready');
	await page.evaluate(() => window.dispatchEvent(new Event('zatiaras-test-r2-tail-failure')));
	await expect(page.getByText(/Unduhan arsip gagal/).first()).toBeVisible();
	await expect(page.getByText('Unduhan selesai.')).toHaveCount(0);
	const recovered = page.waitForEvent('download', { timeout: 60000 });
	await page.getByRole('button', { name: /Unduh/ }).first().click();
	const recoveredBytes = await readDownload(await recovered);
	expect(JSON.parse(recoveredBytes).meta.branch).toBe('samarinda');
	await expect(page.getByText('Unduhan selesai.')).toBeVisible();
});

// AUD-057: arsip setahun butuh beberapa panggilan; halaman melanjutkan sendiri
// sampai selesai dan mengunduh tiap bagian (respons server dimock, tanpa mutasi).
test('archive auto-continues partial calls and downloads every part', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	const responses = [
		{
			ok: true,
			partial: true,
			count: 2000,
			remaining: 1500,
			parts: [
				{ jobId: 'j1', filename: 'a1.json' },
				{ jobId: 'j2', filename: 'a2.json' }
			],
			message: 'lanjut'
		},
		{
			ok: true,
			partial: true,
			count: 1000,
			remaining: 500,
			parts: [{ jobId: 'j3', filename: 'a3.json' }],
			message: 'lanjut'
		},
		{
			ok: true,
			count: 500,
			parts: [{ jobId: 'j4', filename: 'a4.json' }],
			key: 'k4',
			filename: 'a4.json',
			job_id: 'j4'
		}
	];
	let calls = 0;
	await page.route('**/api/archive', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		await route.fulfill({ json: responses[Math.min(calls++, responses.length - 1)] });
	});
	const downloaded: string[] = [];
	await page.route('**/api/archive/download?*', async (route) => {
		const jobId = new URL(route.request().url()).searchParams.get('job_id') ?? '';
		downloaded.push(jobId);
		await route.fulfill({ body: JSON.stringify({ job: jobId }), contentType: 'application/json' });
	});
	await openArchiveConfirm(page);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText('3500 baris', { exact: false })).toBeVisible({ timeout: 60_000 });
	expect(calls).toBe(3);
	expect(downloaded).toEqual(['j1', 'j2', 'j3', 'j4']);
	await expect(page.getByText('(4 bagian, dikirim ke unduhan browser)')).toBeVisible();
});

// AUD-057: error di tengah loop tetap melaporkan bagian yang sudah terarsip.
test('archive mid-loop failure keeps archived parts visible', async ({ page }) => {
	await loginAsOwner(page, test.info().title);
	let calls = 0;
	await page.route('**/api/archive', async (route) => {
		if (route.request().method() !== 'POST') return route.fallback();
		calls++;
		if (calls === 1)
			return route.fulfill({
				json: {
					ok: true,
					partial: true,
					count: 2000,
					remaining: 900,
					parts: [
						{ jobId: 'm1', filename: 'm1.json' },
						{ jobId: 'm2', filename: 'm2.json' }
					]
				}
			});
		return route.fulfill({ status: 409, json: { message: 'Lease arsip sedang dipakai.' } });
	});
	await page.route('**/api/archive/download?*', (route) =>
		route.fulfill({ body: '{}', contentType: 'application/json' })
	);
	await openArchiveConfirm(page);
	await page.getByRole('button', { name: 'Ya, Lanjutkan' }).click();
	await expect(page.getByText('2000 baris', { exact: false })).toBeVisible({ timeout: 60_000 });
	await expect(
		page.getByRole('alert').filter({ hasText: 'Lease arsip sedang dipakai.' })
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Unduh m2.json' })).toBeVisible();
	expect(calls).toBe(2);
});
