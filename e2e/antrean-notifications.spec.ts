import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { ownerUsernameForTest } from './helpers';

async function login(
	page: Page,
	branch = 'samarinda',
	username = ownerUsernameForTest(test.info().title)
) {
	const password = process.env.UAT_PASSWORD;
	if (!password) throw new Error('UAT_PASSWORD dari runner terisolasi wajib tersedia');
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.getByLabel('Pilih Cabang').selectOption(branch);
	await page.getByPlaceholder('Masukkan username').fill(username);
	await page.getByPlaceholder('Masukkan password').fill(password);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await page.goto('/pengaturan/antrean', { waitUntil: 'domcontentloaded' });
	await expect(
		page.getByText('Notifikasi dalam aplikasi siap untuk cabang sesi ini.', { exact: true })
	).toBeVisible({ timeout: 30_000 });
}
async function device(
	browser: Browser,
	baseURL: string | undefined
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({ baseURL });
	if (!baseURL) throw new Error('baseURL dari runner terisolasi wajib tersedia');
	// Remote fonts/images are not an authentication or notification readiness dependency.
	const origin = new URL(baseURL).origin;
	await context.route('**/*', async (route) => {
		if (new URL(route.request().url()).origin === origin) await route.continue();
		else await route.abort();
	});
	await context.addInitScript(() => {
		const observed = window as typeof window & { antreanChimeStarts: number };
		observed.antreanChimeStarts = 0;
		const create = AudioContext.prototype.createOscillator;
		AudioContext.prototype.createOscillator = function () {
			const oscillator = create.call(this);
			const start = oscillator.start.bind(oscillator);
			oscillator.start = (when?: number) => {
				if (
					[659.25, 783.99, 987.77].some(
						(frequency) => Math.abs(oscillator.frequency.value - frequency) < 0.1
					)
				)
					observed.antreanChimeStarts++;
				start(when);
			};
			return oscillator;
		};
	});
	const page = await context.newPage();
	await login(page);
	return { context, page };
}
async function local(page: Page) {
	return page.evaluate(async () => {
		// The browser must load the actual Vite module; a Node static import cannot access browser IndexedDB.
		const path = '/src/lib/utils/orderNotificationLocal.ts';
		const module = await import(/* @vite-ignore */ path);
		return module.readNotificationContext();
	});
}
async function chimeStarts(page: Page): Promise<number> {
	return page.evaluate(
		() => (window as typeof window & { antreanChimeStarts: number }).antreanChimeStarts
	);
}
async function wake(page: Page) {
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function checkout(
	page: Page,
	customer: string,
	offline = false
): Promise<{ orderId: string; transactionId: string }> {
	await page.goto('/pos', { waitUntil: 'domcontentloaded' });
	await page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ }).click();
	await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: 'Sedikit Gula', exact: true }).click();
	await page.getByRole('button', { name: 'Tanpa Es', exact: true }).click();
	await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();
	const cart = page.getByRole('button', { name: /^Buka keranjang/ });
	if (await cart.isVisible()) {
		await cart.click();
		await page.getByRole('button', { name: /^Lanjut ke Pembayaran/ }).click();
	} else await page.getByRole('button', { name: /^Bayar Rp/ }).click();
	await page.getByLabel('Nama Pelanggan').fill(customer);
	await page.getByRole('button', { name: 'Tunai', exact: true }).click();
	await page.getByRole('button', { name: 'Konfirmasi & Proses Transaksi', exact: true }).click();
	await page.getByPlaceholder('0', { exact: true }).fill('12000');
	if (offline) await page.context().setOffline(true);
	const response = offline
		? null
		: page.waitForResponse(
				(res) => res.url().endsWith('/api/pos/transaction') && res.request().method() === 'POST'
			);
	await page.getByRole('button', { name: 'Selesai', exact: true }).click();
	await expect(
		page.getByText(offline ? 'Transaksi Tersimpan' : 'Transaksi Berhasil!', { exact: true })
	).toBeVisible();
	if (!response) return { orderId: '', transactionId: '' };
	const result = await response;
	expect(result.ok()).toBe(true);
	const payload = (await result.json()).data;
	return {
		orderId: payload.buku_kas_id as string,
		transactionId: payload.transaction_id as string
	};
}
async function cleanup(page: Page, ids: string[]) {
	for (const id of ids) {
		const status = await page.evaluate(async (transactionId) => {
			const token = (await (await fetch('/api/csrf')).json()).token;
			return (
				await fetch(`/api/transaksi-kasir?transaction_id=${encodeURIComponent(transactionId)}`, {
					method: 'DELETE',
					headers: { 'X-CSRF-Token': token }
				})
			).status;
		}, id);
		expect(status).toBe(200);
	}
}

test('Antrean checkout alerts same branch recipients, not origin, and visible queue only silences its own profile', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL),
		b = await device(browser, baseURL),
		c = await device(browser, baseURL);
	const ids: string[] = [];
	const orders: string[] = [];
	try {
		await b.page.getByRole('button', { name: 'Tes suara', exact: true }).click();
		await c.page.getByRole('button', { name: 'Tes suara', exact: true }).click();
		const bNotes = await chimeStarts(b.page),
			cNotes = await chimeStarts(c.page);
		const request = a.page.waitForRequest(
			(req) => req.url().endsWith('/api/pos/transaction') && req.method() === 'POST'
		);
		const first = await checkout(a.page, 'Notifikasi pertama');
		ids.push(first.transactionId);
		orders.push(first.orderId);
		const input = (await request).postDataJSON() as Record<string, unknown>;
		// Two genuine concurrent D1 checkouts exercise a coalesced realtime wake-up; no checkout endpoint mock.
		const rapid = await a.page.evaluate(async (body) => {
			const csrf = (await (await fetch('/api/csrf')).json()).token;
			return Promise.all(
				[1, 2].map(async (index) => {
					const response = await fetch('/api/pos/transaction', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
						body: JSON.stringify({
							...body,
							idempotency_key: crypto.randomUUID(),
							nama_pelanggan: `Notifikasi cepat ${index}`
						})
					});
					if (!response.ok) throw new Error(`Checkout nyata gagal: ${response.status}`);
					return (await response.json()).data as { transaction_id: string; buku_kas_id: string };
				})
			);
		}, input);
		for (const order of rapid) {
			ids.push(order.transaction_id);
			orders.push(order.buku_kas_id);
		}
		await wake(b.page);
		await wake(c.page);
		await wake(a.page);
		await expect
			.poll(async () =>
				(await local(b.page))?.events.map((event: { order_id: string }) => event.order_id).sort()
			)
			.toEqual([...orders].sort());
		await expect
			.poll(async () =>
				(await local(c.page))?.events.map((event: { order_id: string }) => event.order_id).sort()
			)
			.toEqual([...orders].sort());
		expect((await local(a.page))?.events).toEqual([]);
		await expect(
			b.page.getByRole('complementary', { name: 'Notifikasi pesanan baru' })
		).toBeVisible();
		await expect
			.poll(() => chimeStarts(b.page), { timeout: 15_000 })
			.toBeGreaterThanOrEqual(bNotes + 3);
		await expect
			.poll(() => chimeStarts(c.page), { timeout: 15_000 })
			.toBeGreaterThanOrEqual(cNotes + 3);
		const tab = await b.context.newPage();
		await tab.goto('/antrean', { waitUntil: 'domcontentloaded' });
		await expect.poll(async () => (await local(b.page))?.events).toEqual([]);
		await expect
			.poll(async () =>
				(await local(c.page))?.events.map((event: { order_id: string }) => event.order_id).sort()
			)
			.toEqual([...orders].sort());
		await expect(
			b.page.getByRole('complementary', { name: 'Notifikasi pesanan baru' })
		).toHaveCount(0);
		const bSeenNotes = await chimeStarts(b.page),
			cUnseenNotes = await chimeStarts(c.page);
		await expect
			.poll(() => chimeStarts(c.page), { timeout: 15_000 })
			.toBeGreaterThanOrEqual(cUnseenNotes + 3);
		expect(await chimeStarts(b.page)).toBe(bSeenNotes);
		const card = tab.locator('article', { hasText: 'Notifikasi pertama' });
		await expect(card).toBeVisible();
		await card.getByRole('button', { name: /tandai selesai/i }).click();
		await tab.getByRole('tab', { name: 'Selesai', exact: true }).click();
		await tab
			.locator('article', { hasText: 'Notifikasi pertama' })
			.getByRole('button', { name: /buka lagi/i })
			.click();
		await wake(c.page);
		expect(
			(await local(c.page))?.events.map((event: { order_id: string }) => event.order_id).sort()
		).toEqual([...orders].sort());
		expect(
			new Set((await local(c.page))?.events.map((event: { event_id: string }) => event.event_id))
				.size
		).toBe(3);
	} finally {
		await cleanup(a.page, ids);
		await a.context.close();
		await b.context.close();
		await c.context.close();
	}
});

test('Antrean sound preference persists across tabs and devices remain independent at mobile widths', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL),
		b = await device(browser, baseURL);
	try {
		await a.page.setViewportSize({ width: 320, height: 740 });
		const sound = a.page.getByRole('switch', { name: 'Suara pesanan baru' });
		await sound.uncheck();
		await a.page.reload({ waitUntil: 'domcontentloaded' });
		await expect(sound).not.toBeChecked();
		const tab = await a.context.newPage();
		await tab.goto('/pengaturan/antrean', { waitUntil: 'domcontentloaded' });
		await expect(tab.getByRole('switch', { name: 'Suara pesanan baru' })).not.toBeChecked();
		await expect(b.page.getByRole('switch', { name: 'Suara pesanan baru' })).toBeChecked();
		await a.page.setViewportSize({ width: 390, height: 844 });
		expect(
			await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await a.page.getByRole('button', { name: 'Tes suara', exact: true }).click();
		await expect(a.page.getByText('Audio siap di tab ini.', { exact: true })).toBeVisible();
	} finally {
		await a.context.close();
		await b.context.close();
	}
});

test('Antrean atomic push receipt deduplicates, preserves newer unseen on old ack, and rejects wrong scope and origin', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL);
	try {
		const proof = await a.page.evaluate(async () => {
			// Load the actual browser persistence boundary, not a Node/memory imitation.
			const path = '/src/lib/utils/orderNotificationLocal.ts';
			const module = await import(/* @vite-ignore */ path);
			const context = await module.readNotificationContext();
			const make = (sequence: number) => ({
				version: 1,
				type: 'order_created',
				branch: context.branch,
				user_id: context.user_id,
				device_id: context.device_id,
				sequence,
				event_id: `synthetic-${sequence}`,
				order_id: `synthetic-order-${sequence}`,
				origin_device_id: null,
				sound_enabled: true
			});
			const base = context.read_cursor + 1;
			const first = await module.consumeOrderNotificationPush(make(base));
			const duplicate = await module.consumeOrderNotificationPush(make(base));
			await module.consumeOrderNotificationPush(make(base + 1));
			await module.acknowledgeNotificationSeen(context.context_id, base);
			const remaining = await module.readNotificationContext();
			const wrong = await module.consumeOrderNotificationPush({
				...make(base + 2),
				branch: 'wrong-branch'
			});
			const own = await module.consumeOrderNotificationPush({
				...make(base + 3),
				origin_device_id: context.device_id
			});
			return {
				first: first.accepted,
				duplicate: duplicate.accepted,
				wrong: wrong.accepted,
				own: own.accepted,
				remaining: remaining.events.map((event: { sequence: number }) => event.sequence),
				read: remaining.read_cursor,
				originalRead: context.read_cursor,
				expected: base + 1
			};
		});
		expect(proof).toEqual({
			first: true,
			duplicate: false,
			wrong: false,
			own: false,
			remaining: [proof.expected],
			read: proof.originalRead,
			originalRead: proof.originalRead,
			expected: proof.expected
		});
	} finally {
		await a.context.close();
	}
});

test('Antrean hidden queue does not see an event, expiry clears it, and blocked audio readiness is honest', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL),
		b = await device(browser, baseURL);
	const ids: string[] = [];
	try {
		await b.page.goto('/antrean', { waitUntil: 'domcontentloaded' });
		// Controlled background lifecycle: keep the actual page mounted while visibility is hidden.
		await b.page.evaluate(() => {
			Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		const order = await checkout(a.page, 'Pesanan saat antrean tersembunyi');
		ids.push(order.transactionId);
		await wake(b.page);
		await expect
			.poll(async () =>
				(await local(b.page))?.events.map((event: { order_id: string }) => event.order_id)
			)
			.toContain(order.orderId);
		const before = await local(b.page);
		await b.page.evaluate(() => {
			const raw = JSON.parse(localStorage.getItem('zatiaras_session')!);
			raw.expiresAt = 1;
			localStorage.setItem('zatiaras_session', JSON.stringify(raw));
			window.dispatchEvent(new Event('storage'));
		});
		await expect.poll(async () => (await local(b.page)) === null).toBe(true);
		expect(before.events[0].order_id).toBe(order.orderId);
		const blocked = await b.context.newPage();
		await blocked.addInitScript(() => {
			const NativeAudioContext = AudioContext;
			window.AudioContext = class extends NativeAudioContext {
				constructor(options?: AudioContextOptions) {
					super(options);
					void this.suspend();
				}
				resume() {
					return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
				}
			};
		});
		await blocked.goto('/pengaturan/antrean', { waitUntil: 'domcontentloaded' });
		await blocked.getByRole('button', { name: 'Tes suara', exact: true }).click();
		await expect(
			blocked.getByText('Suara belum siap. Tekan Tes suara untuk mengizinkan audio browser.', {
				exact: true
			})
		).toBeVisible();
	} finally {
		await cleanup(a.page, ids);
		await a.context.close();
		await b.context.close();
	}
});

test('Antrean own offline checkout replay uses persistent profile origin and only alerts another profile', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL),
		b = await device(browser, baseURL);
	const ids: string[] = [];
	try {
		const identity = (await local(a.page)).device_id;
		await checkout(a.page, 'Notifikasi checkout offline', true);
		await a.context.setOffline(false);
		await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect
			.poll(async () => {
				await wake(b.page);
				return (await local(b.page))?.events.map((event: { order_id: string }) => event.order_id);
			})
			.toHaveLength(1);
		const orderId = (await local(b.page)).events[0].order_id;
		await wake(a.page);
		expect((await local(a.page)).device_id).toBe(identity);
		expect((await local(a.page)).events).toEqual([]);
		const data = await a.page.evaluate(
			async () => (await (await fetch('/api/antrean?state=pending&limit=100')).json()).data
		);
		const rows = data.items.filter((row: { buku_kas_id: string }) => row.buku_kas_id === orderId);
		expect(rows).toHaveLength(1);
		ids.push(rows[0].transaction_id);
	} finally {
		await a.context.setOffline(false);
		await cleanup(a.page, ids);
		await a.context.close();
		await b.context.close();
	}
});

test('Antrean relogin clears old user events while preserving profile identity and starts without historical noise', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL),
		b = await device(browser, baseURL);
	const ids: string[] = [];
	let releaseValidation: (() => void) | undefined;
	try {
		const before = await local(b.page);
		const order = await checkout(a.page, 'Notifikasi sebelum ganti akun');
		ids.push(order.transactionId);
		await wake(b.page);
		await expect
			.poll(async () =>
				(await local(b.page))?.events.map((event: { order_id: string }) => event.order_id)
			)
			.toContain(order.orderId);
		const oldUsername = ownerUsernameForTest(test.info().title);
		const newUsername = oldUsername === 'pemilik-e2e-2' ? 'pemilik-e2e-1' : 'pemilik-e2e-2';
		await b.page.goto('/pengaturan', { waitUntil: 'domcontentloaded' });
		const validationGate = new Promise<void>((resolve) => {
			releaseValidation = resolve;
		});
		let capturedValidation!: () => void;
		const validationCaptured = new Promise<void>((resolve) => {
			capturedValidation = resolve;
		});
		await b.page.route('**/api/session', async (route) => {
			if (route.request().headers()['x-e2e-session-race'] !== 'held') {
				await route.continue();
				return;
			}
			const response = await route.fetch();
			expect((await response.json()).authenticated).toBe(true);
			capturedValidation();
			await validationGate;
			await route.fulfill({ response });
		});
		await b.page.evaluate(async () => {
			const path = '/src/lib/utils/authGuard.ts';
			const guard = await import(/* @vite-ignore */ path);
			const observed = window as typeof window & { staleAuthValidation: Promise<boolean> };
			const originalFetch = window.fetch;
			window.fetch = (input, init) =>
				originalFetch(input, {
					...init,
					headers: { ...init?.headers, 'X-E2E-Session-Race': 'held' }
				});
			observed.staleAuthValidation = guard.requireAuth();
			window.fetch = originalFetch;
		});
		await validationCaptured;
		await b.page.getByRole('button', { name: 'Logout', exact: true }).click();
		await b.page
			.getByRole('dialog', { name: 'Konfirmasi Logout' })
			.getByRole('button', { name: 'Keluar', exact: true })
			.click();
		await expect(b.page).toHaveURL(/\/login$/);
		expect((await local(b.page)) === null).toBe(true);
		releaseValidation!();
		expect(
			await b.page.evaluate(
				async () =>
					await (window as typeof window & { staleAuthValidation: Promise<boolean> })
						.staleAuthValidation
			)
		).toBe(false);
		expect(await b.page.evaluate(() => localStorage.getItem('zatiaras_session') === null)).toBe(
			true
		);
		expect((await local(b.page)) === null).toBe(true);
		await login(b.page, 'samarinda', newUsername);
		const rebound = await local(b.page);
		expect(rebound.device_id).toBe(before.device_id);
		expect(rebound.device_token === before.device_token).toBe(true);
		expect(rebound.user_id).not.toBe(before.user_id);
		expect(rebound.context_id).not.toBe(before.context_id);
		expect(rebound.events).toEqual([]);
		await b.page.reload({ waitUntil: 'domcontentloaded' });
		await expect(
			b.page.getByText('Notifikasi dalam aplikasi siap untuk cabang sesi ini.', { exact: true })
		).toBeVisible();
		expect((await local(b.page)).events).toEqual([]);
	} finally {
		releaseValidation?.();
		await cleanup(a.page, ids);
		await a.context.close();
		await b.context.close();
	}
});
