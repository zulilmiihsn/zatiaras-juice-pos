import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { ownerUsernameForTest } from './helpers';

function readUatPassword(): string {
	if (process.env.UAT_PASSWORD) return process.env.UAT_PASSWORD;
	if (!existsSync('.env')) throw new Error('UAT_PASSWORD tidak tersedia');
	const password = readFileSync('.env', 'utf8')
		.split(/\r?\n/)
		.find((line) => line.startsWith('UAT_PASSWORD='))
		?.slice('UAT_PASSWORD='.length)
		.trim();
	if (!password) throw new Error('UAT_PASSWORD tidak tersedia');
	return password;
}

async function loginAsOwner(page: Page) {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption('samarinda');
	await page.getByPlaceholder('Masukkan username').fill(ownerUsernameForTest(test.info().title));
	await page.getByPlaceholder('Masukkan password').fill(readUatPassword());
	const loginResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/veriflogin') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const response = await loginResponse;
	expect(response.ok(), `Login UI gagal: ${response.status()} ${await response.text()}`).toBe(true);
	await expect(page).toHaveURL(/\/$/);
}

async function cleanupTransaction(page: Page, transactionId: string) {
	const result = await page.evaluate(async (id) => {
		const csrfResponse = await fetch('/api/csrf');
		const csrf = (await csrfResponse.json()) as { token?: string };
		if (!csrfResponse.ok || !csrf.token) return { ok: false, status: csrfResponse.status };
		const response = await fetch(`/api/transaksi-kasir?transaction_id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
			headers: { 'X-CSRF-Token': csrf.token }
		});
		return { ok: response.ok, status: response.status };
	}, transactionId);
	expect(result.ok, `Cleanup transaksi gagal: ${result.status}`).toBe(true);
}

test('offline QRIS checkout queues noncash and replays idempotently', async ({ page, context }) => {
	await loginAsOwner(page);
	let transactionId = '';
	try {
		await page.goto('/pos');
		const product = page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ });
		await expect(product).toBeVisible({ timeout: 60_000 });
		await product.click();
		await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: /^Bayar Rp/ }).click();
		await expect(page).toHaveURL(/\/pos\/bayar$/);
		await page.getByLabel('Nama Pelanggan').fill('UAT QRIS Offline');
		await context.setOffline(true);
		await expect(page.getByRole('button', { name: 'QRIS', exact: true })).toBeEnabled();
		await page.getByRole('button', { name: 'QRIS', exact: true }).click();
		await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi' }).click();
		await expect(page.getByRole('dialog', { name: 'Periksa Pembayaran QRIS' })).toBeVisible();
		await page.getByRole('button', { name: 'Sudah Diperiksa' }).click();
		await expect(page.getByText('Tersimpan di perangkat dan menunggu sinkronisasi.')).toBeVisible();
		const queued = await page.evaluate(async () => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			return (await offline.getPendingTransactions()).find(
				(entry: { request?: { nama_pelanggan?: string } }) =>
					entry.request?.nama_pelanggan === 'UAT QRIS Offline'
			);
		});
		expect(queued?.request).toMatchObject({
			metode_bayar: 'non-tunai',
			mode: 'offline_replay',
			cash_received: 10000
		});
		expect(queued?.request?.idempotency_key).toBeTruthy();
		const responsePromise = page.waitForResponse(
			(response) =>
				response.url().endsWith('/api/pos/transaction') && response.request().method() === 'POST',
			{ timeout: 60_000 }
		);
		await context.setOffline(false);
		const response = await responsePromise;
		expect(response.ok(), await response.text()).toBe(true);
		const result = await response.json();
		transactionId = result.data?.transaction_id || '';
		expect(transactionId).toBeTruthy();
		expect(result.data?.receipt?.metode_bayar).toBe('non-tunai');
		const replay = await page.evaluate(async (request) => {
			const csrf = await (await fetch('/api/csrf')).json();
			const response = await fetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
				body: JSON.stringify(request)
			});
			return { status: response.status, body: await response.json() };
		}, queued.request);
		expect(replay.status).toBe(200);
		expect(replay.body.data?.transaction_id).toBe(transactionId);
		const invalidTokenStatus = await page.evaluate(async (request) => {
			const csrf = await (await fetch('/api/csrf')).json();
			const invalid = structuredClone(request);
			invalid.idempotency_key = crypto.randomUUID();
			invalid.items[0].product_price_token = 'invalid';
			const response = await fetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
				body: JSON.stringify(invalid)
			});
			return response.status;
		}, queued.request);
		expect(invalidTokenStatus).toBe(400);
	} finally {
		await context.setOffline(false);
		if (transactionId) await cleanupTransaction(page, transactionId);
	}
});

test('lost checkout response preserves the committed sale and replays the same intent once', async ({
	page
}) => {
	await loginAsOwner(page);
	let transactionId = '';
	try {
		await page.goto('/pos');
		const product = page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ });
		await expect(product).toBeVisible({ timeout: 60_000 });
		await product.click();
		await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();
		await page.getByRole('button', { name: /^Bayar Rp/ }).click();
		await expect(page).toHaveURL(/\/pos\/bayar$/);
		await page.getByLabel('Nama Pelanggan').fill('UAT respons terputus');
		await page.getByRole('button', { name: 'Tunai', exact: true }).click();
		await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi' }).click();
		await page.getByPlaceholder('0', { exact: true }).fill('12000');

		let requestBody = '';
		await page.route('**/api/pos/transaction', async (route) => {
			requestBody = route.request().postData() || '';
			const response = await route.fetch();
			expect(response.ok()).toBe(true);
			const payload = await response.json();
			transactionId = payload.data?.transaction_id || '';
			await route.abort('failed');
		});
		await page.getByRole('button', { name: 'Selesai', exact: true }).click();
		await expect(page.getByText('Tersimpan di perangkat dan menunggu sinkronisasi.')).toBeVisible();
		expect(transactionId).toBeTruthy();
		const queued = await page.evaluate(async () => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			return (await offline.getPendingTransactions()).find(
				(entry: { request?: { nama_pelanggan?: string } }) =>
					entry.request?.nama_pelanggan === 'UAT respons terputus'
			);
		});
		expect(queued?.request?.idempotency_key).toBe(JSON.parse(requestBody).idempotency_key);
		await page.unroute('**/api/pos/transaction');
		const replay = await page.evaluate(async (body) => {
			const csrf = await (await fetch('/api/csrf')).json();
			const response = await fetch('/api/pos/transaction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.token },
				body
			});
			return { status: response.status, body: await response.json() };
		}, requestBody);
		expect(replay.status).toBe(200);
		expect(replay.body.data?.transaction_id).toBe(transactionId);
		expect(replay.body.idempotent).toBe(true);
	} finally {
		await page.unroute('**/api/pos/transaction');
		if (transactionId) await cleanupTransaction(page, transactionId);
		await page.evaluate(async () => {
			const path = '/src/lib/utils/offline.ts';
			const offline = await import(/* @vite-ignore */ path);
			const pending = await offline.getPendingTransactions();
			for (const entry of pending) {
				if (entry.request?.nama_pelanggan === 'UAT respons terputus') {
					await offline.removePendingTransaction(entry.queue_id);
				}
			}
		});
	}
});

test('POS header fills the catalog column and the cart is a side column flush to the right edge', async ({
	page
}) => {
	await loginAsOwner(page);
	await page.goto('/pos');
	await expect(page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ })).toBeVisible({
		timeout: 60_000
	});
	const header = page.getByRole('main', { name: 'Kasir POS' }).locator('.page-header');
	for (const viewport of [
		// headerX = lebar sidebar, headerWidth = viewport - sidebar - keranjang samping.
		{ name: 'desktop', width: 1920, height: 1080, headerX: 208, headerWidth: 1362 },
		{ name: 'laptop', width: 1280, height: 800, headerX: 208, headerWidth: 722 },
		{ name: 'tablet', width: 820, height: 1180, headerX: 76, headerWidth: 464 },
		{ name: 'mobile', width: 390, height: 844, headerX: 0, headerWidth: 390 }
	]) {
		await page.setViewportSize(viewport);
		await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
		const headerBounds = await header.boundingBox();
		expect(headerBounds).not.toBeNull();
		expect(headerBounds!.x).toBe(viewport.headerX);
		expect(headerBounds!.width).toBe(viewport.headerWidth);
		await expect(header).toHaveCSS('border-top-left-radius', '0px');
		await expect(header).toHaveCSS('border-top-right-radius', '0px');
		await expect(header).toHaveCSS('border-bottom-left-radius', '40px');
		await expect(header).toHaveCSS('border-bottom-right-radius', '40px');
		await expect(page.getByPlaceholder('Cari menu jus buah, topping...')).toBeVisible();
		if (viewport.width >= 768) {
			const searchBounds = await page
				.getByPlaceholder('Cari menu jus buah, topping...')
				.boundingBox();
			const cart = page.getByRole('complementary', { name: 'Panel Pesanan Kasir' });
			await expect(cart).toBeVisible();
			const cartBounds = await cart.boundingBox();
			expect(searchBounds).not.toBeNull();
			expect(cartBounds).not.toBeNull();
			expect(searchBounds!.x + searchBounds!.width).toBeLessThanOrEqual(cartBounds!.x);
			// Menempel: header berakhir tepat di tepi keranjang, keranjang menempel ke tepi kanan dan atas layar.
			expect(headerBounds!.x + headerBounds!.width).toBe(cartBounds!.x);
			expect(cartBounds!.x + cartBounds!.width).toBe(viewport.width);
			expect(cartBounds!.y).toBe(0);
			expect(cartBounds!.height).toBe(viewport.height);
		}
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({ path: test.info().outputPath(`pos-header-${viewport.name}.png`) });
	}
});

for (const viewport of [
	{ name: 'desktop', width: 1280, height: 800 },
	{ name: 'mobile', width: 390, height: 844 }
]) {
	test(`owner completes authoritative cash checkout and reports receipt errors through POS UI (${viewport.name})`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		await loginAsOwner(page);
		let transactionId = '';
		try {
			await page.goto('/pos');
			const product = page.getByRole('button', {
				name: /(?:Pilih|Tambah) Es Teh UAT/
			});
			// First POS load compiles the catalog route in dev mode; allow the same cold-start budget as login.
			await expect(product).toBeVisible({ timeout: 60_000 });
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
			await page.screenshot({
				path: test.info().outputPath(`pos-${viewport.name}.png`),
				fullPage: true
			});
			await product.click();
			await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
			await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();

			const openCart = page.getByRole('button', { name: /^Buka keranjang/ });
			if (await openCart.isVisible({ timeout: 2000 }).catch(() => false)) {
				await openCart.click();
				await page.getByRole('button', { name: /^Lanjut ke Pembayaran/ }).click();
			} else {
				const bayarButton = page.getByRole('button', { name: /^Bayar Rp/ });
				await bayarButton.click();
			}

			await expect(page).toHaveURL(/\/pos\/bayar$/);
			await page.getByLabel('Nama Pelanggan').fill('UAT Browser POS');
			await page.getByRole('button', { name: 'Tunai', exact: true }).click();
			await page
				.getByRole('button', { name: 'Konfirmasi & Proses Transaksi', exact: true })
				.click();

			await expect(page.getByText('Pembayaran Tunai', { exact: true })).toBeVisible();
			const cashInput = page.getByPlaceholder('0', { exact: true });
			await cashInput.fill('12000');
			await expect(cashInput).toHaveValue('12.000');
			await page.getByRole('button', { name: 'C', exact: true }).click();
			await page.getByRole('button', { name: '+ Rp 10.000', exact: true }).click();
			await expect(cashInput).toHaveValue('10.000');
			await cashInput.fill('12000');
			await expect(cashInput).toHaveValue('12.000');
			if (viewport.name === 'desktop') {
				await page.evaluate(async () => {
					const path = '/src/lib/utils/cacheOrchestrator.ts';
					const { cacheOrchestrator } = await import(/* @vite-ignore */ path);
					const original = cacheOrchestrator.invalidateCacheOnChange;
					Object.assign(window, {
						checkoutCacheCalls: 0,
						restoreCheckoutCache: () => (cacheOrchestrator.invalidateCacheOnChange = original)
					});
					cacheOrchestrator.invalidateCacheOnChange = () => {
						(window as unknown as { checkoutCacheCalls: number }).checkoutCacheCalls++;
						return new Promise(() => {});
					};
				});
			}
			let releaseCheckout!: () => void;
			const checkoutGate = new Promise<void>((resolve) => (releaseCheckout = resolve));
			let checkoutRequests = 0;
			await page.route('**/api/pos/transaction', async (route) => {
				if (route.request().method() === 'POST') {
					checkoutRequests++;
					await checkoutGate;
				}
				await route.continue();
			});
			const checkoutResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith('/api/pos/transaction') && response.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'Selesai', exact: true }).click();
			try {
				const processing = page.getByRole('button', { name: 'Memproses…', exact: true });
				await expect(processing).toBeDisabled();
				await processing.evaluate((button: HTMLButtonElement) => button.click());
				await expect.poll(() => checkoutRequests).toBe(1);
				await expect(
					page.getByText('Transaksi masih diproses. Jangan tutup halaman atau buat transaksi baru.')
				).toBeVisible({ timeout: 12_000 });
			} finally {
				releaseCheckout();
			}
			const response = await checkoutResponse;
			expect(response.ok()).toBe(true);
			const payload = (await response.json()) as {
				data?: {
					transaction_id?: string;
					total_amount?: number;
					receipt?: {
						total_amount?: number;
						cash_received?: number;
						change?: number;
						items?: Array<{ nama?: string }>;
					};
				};
			};
			transactionId = payload.data?.transaction_id || '';
			expect(transactionId).not.toBe('');
			expect(payload.data?.total_amount).toBe(10_000);
			expect(payload.data?.receipt?.total_amount).toBe(10_000);
			expect(payload.data?.receipt?.cash_received).toBe(12_000);
			expect(payload.data?.receipt?.change).toBe(2_000);
			expect(payload.data?.receipt?.items?.[0]?.nama).toBe('Es Teh UAT (Jumbo)');
			await expect(page.getByText('Transaksi Berhasil!', { exact: true })).toBeVisible();
			if (viewport.name === 'desktop') {
				const cacheCalls = await page.evaluate(() => {
					const state = window as unknown as {
						checkoutCacheCalls: number;
						restoreCheckoutCache: () => void;
					};
					state.restoreCheckoutCache();
					return state.checkoutCacheCalls;
				});
				expect(cacheCalls).toBe(4);
			}
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
			await page.screenshot({
				path: test.info().outputPath(`receipt-${viewport.name}.png`),
				fullPage: true
			});
			await expect(page.getByText('Rp 10.000', { exact: true }).first()).toBeVisible();
			const printButton = page.getByRole('button', { name: 'Cetak Struk', exact: true });
			await printButton.click();
			await expect(
				page.getByText('Metode Aplikasi Android membutuhkan perangkat Android', { exact: false })
			).toBeVisible();
			await expect(printButton).toBeEnabled();

			let historyDetailRequests = 0;
			let currentSettingsRequests = 0;
			page.on('request', (request) => {
				if (request.url().includes('/api/transaksi-kasir?')) historyDetailRequests++;
				if (request.url().includes('/api/pengaturan')) currentSettingsRequests++;
			});
			await page.goto('/pengaturan/pemilik/riwayat');
			const historyCard = page.getByRole('button', { name: /Penjualan Es Teh UAT/ });
			await expect(historyCard).toBeVisible({ timeout: 30_000 });
			const settingsRequestsBeforePrint = currentSettingsRequests;
			await historyCard.click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await page
				.getByRole('button', { name: 'Cetak Struk', exact: true })
				.click({ noWaitAfter: true });
			// Sengaja tidur: jendela "tidak ada yang terjadi", tak ada sinyal DOM untuk ditunggu.
			await page.waitForTimeout(500);
			expect(historyDetailRequests).toBe(
				0,
				'snapshot reprint must not query current transaction details'
			);
			expect(currentSettingsRequests).toBe(
				settingsRequestsBeforePrint,
				'history reprint must not fetch additional receipt settings'
			);
		} finally {
			if (transactionId) await cleanupTransaction(page, transactionId);
		}
	});
}

test('pending queue detail stays synchronized and owner can export then remove', async ({
	page,
	context
}) => {
	await loginAsOwner(page);
	await context.setOffline(true);
	await page.evaluate(async () => {
		const now = new Date().toISOString();
		const entry = {
			queue_id: 'e2e-offline-queue',
			type: 'pos_transaction',
			status: 'failed',
			created_at: now,
			updated_at: now,
			attempt_count: 2,
			next_attempt_at: Number.MAX_SAFE_INTEGER,
			last_error: 'Sesi toko transaksi offline tidak valid',
			failure_kind: 'conflict',
			request: {
				idempotency_key: 'e2e-offline-checkout',
				metode_bayar: 'tunai',
				cash_received: 10_000,
				mode: 'offline_replay'
			},
			summary: {
				transaction_code: 'JUS-E2E-OFFLINE',
				total_amount: 10_000,
				jumlah_item: 1,
				created_at: now
			}
		};
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('zatiaras-pending-transactions-v2');
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains('pending-transactions')) {
					request.result.createObjectStore('pending-transactions');
				}
			};
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				const transaction = request.result.transaction('pending-transactions', 'readwrite');
				transaction.objectStore('pending-transactions').put([entry], 'pending_transactions');
				transaction.oncomplete = () => {
					request.result.close();
					resolve();
				};
				transaction.onerror = () => reject(transaction.error);
			};
		});
		window.dispatchEvent(new CustomEvent('pending-changed'));
	});

	await expect(page.getByTestId('pending-transaction-banner')).toContainText(
		'1 transaksi belum tersinkron'
	);
	await page.getByRole('button', { name: 'Detail', exact: true }).click();
	await expect(page.getByTestId('pending-transaction-sheet')).toContainText('JUS-E2E-OFFLINE');
	await expect(page.getByTestId('pending-transaction-sheet')).toContainText(
		'Sesi toko transaksi offline tidak valid'
	);

	const downloadPromise = page.waitForEvent('download');
	await page
		.getByTestId('pending-transaction-item')
		.getByRole('button', { name: 'Export', exact: true })
		.click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toContain('JUS-E2E-OFFLINE');

	await page
		.getByTestId('pending-transaction-item')
		.getByRole('button', { name: 'Hapus lokal', exact: true })
		.click();
	const confirmation = page.getByTestId('pending-removal-confirmation');
	await expect(confirmation).toBeVisible();
	await confirmation.getByRole('button', { name: 'Hapus lokal', exact: true }).click();
	await expect(page.getByTestId('pending-transaction-banner')).toBeHidden();
	await context.setOffline(false);
});

test('search and category bar stay pinned while scrolling the catalog', async ({ page }) => {
	await loginAsOwner(page);
	await page.setViewportSize({ width: 1280, height: 500 });
	await page.goto('/pos');
	const search = page.getByPlaceholder('Cari menu jus buah, topping...');
	await expect(search).toBeVisible({ timeout: 60_000 });
	const semua = page.getByRole('button', { name: 'Semua', exact: true });
	await expect(semua).toBeVisible();
	await expect(page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ })).toBeVisible({
		timeout: 60_000
	});

	await page.evaluate(() => {
		// Instant: abaikan scroll-behavior smooth agar posisi sinkron terbaca.
		document.documentElement.scrollTo({
			top: document.documentElement.scrollHeight,
			behavior: 'instant' as ScrollBehavior
		});
	});
	await page.waitForFunction(() => document.documentElement.scrollTop > 50, null, {
		timeout: 10_000
	});
	const scrolled = await page.evaluate(() => document.documentElement.scrollTop);
	// Dokumen benar-benar tergulir; bar sticky harus nempel di viewport.
	expect(scrolled).toBeGreaterThan(50);

	await expect(search).toBeVisible({ timeout: 15_000 });
	await expect(semua).toBeVisible({ timeout: 15_000 });
	const searchBox = await search.boundingBox();
	const semuaBox = await semua.boundingBox();
	expect(searchBox).not.toBeNull();
	expect(semuaBox).not.toBeNull();
	expect(searchBox!.y).toBeGreaterThanOrEqual(0);
	expect(searchBox!.y).toBeLessThan(220);
	expect(semuaBox!.y).toBeGreaterThanOrEqual(0);
	expect(semuaBox!.y).toBeLessThan(320);
});
