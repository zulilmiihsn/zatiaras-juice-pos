import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { csrfMutate, gotoHydrated, ownerUsernameForTest } from './helpers';

async function waitForNotificationSettings(page: Page) {
	await expect(
		page.getByText('Notifikasi dalam aplikasi siap untuk cabang sesi ini.', { exact: true })
	).toBeVisible({ timeout: 30_000 });
}

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
	// Separate server authentication from navigation: cold module loading must not consume the auth deadline.
	const authenticated = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/veriflogin' &&
			response.request().method() === 'POST',
		{ timeout: 30_000 }
	);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	expect((await authenticated).status()).toBe(200);
	await expect(page).toHaveURL(/\/$/);
	await page.goto('/pengaturan/antrean', { waitUntil: 'domcontentloaded' });
	await waitForNotificationSettings(page);
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
	try {
		const page = await context.newPage();
		await login(page);
		return { context, page };
	} catch (error) {
		await Promise.allSettled([context.close()]); // Keep the original startup/auth assertion if teardown also fails.
		throw error;
	}
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
): Promise<{
	orderId: string;
	transactionId: string;
	requestBody: Record<string, unknown> | null;
}> {
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
				(res) => res.url().endsWith('/api/pos/transaction') && res.request().method() === 'POST',
				// Timeout eksplisit agar kegagalan menunjuk tahap checkout,
				// bukan habis sebagai timeout 120s tanpa lokasi.
				{ timeout: 30_000 }
			);
	await page.getByRole('button', { name: 'Selesai', exact: true }).click();
	await expect(
		page.getByText(offline ? 'Transaksi Tersimpan' : 'Transaksi Berhasil!', { exact: true })
	).toBeVisible();
	if (!response) return { orderId: '', transactionId: '', requestBody: null };
	const result = await response;
	expect(result.ok()).toBe(true);
	const payload = (await result.json()).data;
	return {
		orderId: payload.buku_kas_id as string,
		transactionId: payload.transaction_id as string,
		requestBody: result.request().postDataJSON() as Record<string, unknown>
	};
}
async function cleanup(page: Page, ids: string[]) {
	for (const id of ids) {
		const response = await csrfMutate(
			page,
			'DELETE',
			`/api/transaksi-kasir?transaction_id=${encodeURIComponent(id)}`,
			undefined
		);
		expect(response.status()).toBe(200);
	}
}

test('Antrean settings matches the settings shell, adapts to mobile, and keeps device details optional', async ({
	browser,
	baseURL
}, testInfo) => {
	const { context, page } = await device(browser, baseURL);
	try {
		await gotoHydrated(page, '/pengaturan', 'h2:text-is("Pemilik Kios")');
		const referenceHeader = await page.locator('.page-header').evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				background: style.backgroundImage,
				radius: style.borderBottomLeftRadius
			};
		});
		await page.getByRole('link', { name: /^Antrean Notifikasi$/ }).click();
		await expect(page.getByRole('heading', { name: 'Pengaturan Antrean', level: 1 })).toBeVisible();
		const header = page.locator('.page-header');
		expect(
			await header.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					background: style.backgroundImage,
					radius: style.borderBottomLeftRadius
				};
			})
		).toEqual(referenceHeader);

		const sound = page.getByRole('region', { name: 'Suara perangkat ini' });
		const push = page.getByRole('region', { name: 'Notifikasi saat aplikasi tertutup' });
		for (const width of [320, 390, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			const headerBox = (await header.boundingBox())!;
			expect(headerBox.x).toBe(0);
			expect(headerBox.width).toBe(width);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
			const soundBox = (await sound.boundingBox())!;
			const pushBox = (await push.boundingBox())!;
			if (width < 768) {
				expect(pushBox.x).toBe(soundBox.x);
				expect(pushBox.y).toBeGreaterThanOrEqual(soundBox.y + soundBox.height);
			} else {
				expect(pushBox.x).toBeGreaterThan(soundBox.x + soundBox.width);
				expect(pushBox.y).toBe(soundBox.y);
			}
			await page.screenshot({
				path: testInfo.outputPath(`antrean-settings-${width}.png`),
				fullPage: true
			});
		}

		await expect(page.getByText('Service worker', { exact: true })).toBeHidden();
		await page.getByText('Detail perangkat', { exact: true }).click();
		await expect(page.getByText('Service worker', { exact: true })).toBeVisible();
		await page.getByRole('link', { name: 'Kembali ke Pengaturan', exact: true }).click();
		await expect(page).toHaveURL(/\/pengaturan$/);
		await expect(page.getByText('Pemilik Kios', { exact: true })).toBeVisible();
		const ownerAccess = page.getByRole('link', { name: 'Kelola usaha', exact: true });
		await expect(ownerAccess).toBeVisible();
		await expect(ownerAccess).toHaveAttribute('href', '/pengaturan/pemilik');
		const theme = await page.evaluate(() => {
			const reference = document.createElement('span');
			document.body.append(reference);
			try {
				reference.className = 'btn-brand-primary';
				const buttonBackground = getComputedStyle(reference).backgroundImage;
				const colors: Record<string, string> = {};
				for (const color of ['pink', 'emerald', 'amber']) {
					reference.style.color = `var(--color-${color}-600)`;
					colors[color] = getComputedStyle(reference).color;
				}
				return { buttonBackground, colors };
			} finally {
				reference.remove();
			}
		});
		await expect(ownerAccess).toHaveCSS('background-image', theme.buttonBackground);
		const menus = page.getByRole('navigation', { name: 'Menu pengaturan', exact: true });
		await expect(menus.getByRole('link')).toHaveCount(3);
		await expect(menus.getByRole('button')).toHaveCount(1);
		for (const [role, name, color] of [
			['link', /^Antrean /, 'pink'],
			['link', /^Draft Struk /, 'emerald'],
			['link', /^Riwayat /, 'amber'],
			['button', /^Install PWA /, 'pink']
		] as const) {
			const icon = menus.getByRole(role, { name }).locator(':scope > span').first();
			await expect(icon).toHaveCSS('color', theme.colors[color]);
		}
		const antreanCard = menus.getByRole('link', { name: /^Antrean / });
		const printerCard = menus.getByRole('link', { name: /^Draft Struk / });
		for (const width of [320, 390, 1280]) {
			await page.setViewportSize({ width, height: 900 });
			const [antreanBox, printerBox] = await Promise.all([
				antreanCard.boundingBox(),
				printerCard.boundingBox()
			]);
			expect(antreanBox).not.toBeNull();
			expect(printerBox).not.toBeNull();
			if (width < 768) {
				expect(printerBox!.x).toBe(antreanBox!.x);
				expect(printerBox!.width).toBe(antreanBox!.width);
				expect(printerBox!.y).toBeGreaterThanOrEqual(antreanBox!.y + antreanBox!.height);
			} else {
				expect(printerBox!.x).toBeGreaterThan(antreanBox!.x + antreanBox!.width);
				expect(Math.abs(printerBox!.y - antreanBox!.y)).toBeLessThanOrEqual(1);
			}
			await expect(ownerAccess).toBeVisible();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`pengaturan-${width}.png`),
				fullPage: true
			});
		}
	} finally {
		await context.close();
	}
});

test('Antrean checkout alerts same branch recipients, not origin, and visible queue only silences its own profile', async ({
	browser,
	baseURL
}) => {
	const clients: Awaited<ReturnType<typeof device>>[] = [];
	try {
		for (let index = 0; index < 3; index++) clients.push(await device(browser, baseURL));
	} catch (error) {
		await Promise.allSettled(clients.map((client) => client.context.close()));
		throw error;
	}
	const [a, b, c] = clients;
	const ids: string[] = [];
	const orders: string[] = [];
	let primaryFailure: unknown;
	let hasFailure = false;
	try {
		await b.page.getByRole('button', { name: 'Tes suara', exact: true }).click();
		await c.page.getByRole('button', { name: 'Tes suara', exact: true }).click();
		const bNotes = await chimeStarts(b.page),
			cNotes = await chimeStarts(c.page);
		const first = await checkout(a.page, 'Notifikasi pertama');
		ids.push(first.transactionId);
		orders.push(first.orderId);
		const input = first.requestBody;
		if (!input) throw new Error('Request checkout online tidak ditemukan');
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
			.getByRole('button', { name: /buka kembali/i })
			.click();
		await wake(c.page);
		expect(
			(await local(c.page))?.events.map((event: { order_id: string }) => event.order_id).sort()
		).toEqual([...orders].sort());
		expect(
			new Set((await local(c.page))?.events.map((event: { event_id: string }) => event.event_id))
				.size
		).toBe(3);
	} catch (error) {
		hasFailure = true;
		primaryFailure = error;
	} finally {
		const cleaned = await Promise.allSettled([cleanup(a.page, ids)]);
		const closed = await Promise.allSettled(clients.map((client) => client.context.close()));
		// Failed teardown must fail a passing test, but cannot mask the original behavioral assertion.
		if (!hasFailure) {
			const teardownFailure = [...cleaned, ...closed].find(
				(result) => result.status === 'rejected'
			);
			if (teardownFailure?.status === 'rejected') {
				hasFailure = true;
				primaryFailure = teardownFailure.reason;
			}
		}
	}
	if (hasFailure) throw primaryFailure;
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
		await waitForNotificationSettings(a.page);
		await expect(sound).not.toBeChecked();
		const tab = await a.context.newPage();
		await tab.goto('/pengaturan/antrean', { waitUntil: 'domcontentloaded' });
		await waitForNotificationSettings(tab);
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

// Preferensi suara milik profil browser; reload saat verifikasi sesi
// notifikasi gagal tidak boleh menampilkan default "aktif".
test('Antrean sound switch keeps the stored preference when notification session check fails after reload', async ({
	browser,
	baseURL
}) => {
	const a = await device(browser, baseURL);
	try {
		const sound = a.page.getByRole('switch', { name: 'Suara pesanan baru' });
		await sound.uncheck();
		await expect
			.poll(() =>
				a.page.evaluate(async () => {
					const path = '/src/lib/utils/orderNotificationLocal.ts';
					const module = await import(/* @vite-ignore */ path);
					return module.readNotificationSound();
				})
			)
			.toBe(false);
		// Guard halaman tetap memakai /api/session asli; hanya pemeriksaan sesi milik
		// layanan notifikasi (dikenali dari stack modul dev yang tidak di-bundle) gagal.
		await a.page.addInitScript(() => {
			const original = window.fetch.bind(window);
			const observed = window as typeof window & { notificationSessionFailures: number };
			observed.notificationSessionFailures = 0;
			window.fetch = (input, init) => {
				const url =
					typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
				if (
					new URL(url, location.href).pathname === '/api/session' &&
					new Error().stack?.includes('orderNotificationService')
				) {
					observed.notificationSessionFailures++;
					return Promise.resolve(new Response('', { status: 503 }));
				}
				return original(input, init);
			};
		});
		await a.page.reload({ waitUntil: 'domcontentloaded' });
		await expect(a.page.getByText('Sesi notifikasi belum dapat diperiksa.')).toBeVisible();
		expect(
			await a.page.evaluate(
				() =>
					(window as typeof window & { notificationSessionFailures: number })
						.notificationSessionFailures
			)
		).toBeGreaterThan(0);
		await expect(sound).toBeEnabled();
		await expect(sound).not.toBeChecked();

		// Baris preferensi rusak: kontrol tetap bisa dipakai dan menimpa baris itu.
		await a.page.evaluate(
			() =>
				new Promise<void>((resolve, reject) => {
					const open = indexedDB.open('zatiaras-antrean-notifications-v1');
					open.onerror = () => reject(open.error);
					open.onsuccess = () => {
						const tx = open.result.transaction('notifications', 'readwrite');
						tx.objectStore('notifications').put(
							{ enabled: 'yes', revision: 'x' },
							'sound-preference'
						);
						tx.oncomplete = () => resolve();
						tx.onerror = () => reject(tx.error);
					};
				})
		);
		await a.page.reload({ waitUntil: 'domcontentloaded' });
		await expect(
			a.page.getByText(
				'Pilihan suara perangkat ini tidak dapat dibaca. Pilih ulang untuk menyimpannya.'
			)
		).toBeVisible();
		await expect(sound).toBeEnabled();
		await expect(sound).not.toBeChecked();
		await sound.check();
		await expect
			.poll(() =>
				a.page.evaluate(async () => {
					const path = '/src/lib/utils/orderNotificationLocal.ts';
					const module = await import(/* @vite-ignore */ path);
					return module.readNotificationSound();
				})
			)
			.toBe(true);
		await expect(sound).toBeChecked();
	} finally {
		await a.context.close();
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

type NotificationDevice = Awaited<ReturnType<typeof device>>;
// Cold Vite/auth bootstrap is fixture setup, not the relogin behavior's unchanged 120s deadline.
const reloginTest = test.extend<{
	devices: { a: NotificationDevice; b: NotificationDevice; ids: string[] };
}>({
	devices: [
		async ({ browser, baseURL }, use) => {
			const a = await device(browser, baseURL);
			let b: NotificationDevice | undefined;
			const ids: string[] = [];
			try {
				b = await device(browser, baseURL);
				await use({ a, b, ids });
			} finally {
				try {
					await cleanup(a.page, ids);
				} finally {
					try {
						await b?.context.close();
					} finally {
						await a.context.close();
					}
				}
			}
		},
		{ timeout: 120_000 }
	]
});

reloginTest(
	'Antrean relogin clears old user events while preserving profile identity and starts without historical noise',
	async ({ devices }) => {
		const { a, b, ids } = devices;
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
			// Hidrasi harus selesai sebelum menahan sesi; klik SSR tidak menjalankan handler logout.
			await gotoHydrated(b.page, '/pengaturan', 'h2:text-is("Pemilik Kios")');
			// Pemulihan banner dan aktivasi audio mengubah tinggi halaman; selesaikan setup sebelum race sesi.
			const notificationBanner = b.page.getByRole('complementary', {
				name: 'Notifikasi pesanan baru'
			});
			await expect(notificationBanner).toBeVisible();
			const activateAudio = notificationBanner.getByRole('button', {
				name: 'Aktifkan suara',
				exact: true
			});
			if (await activateAudio.isVisible()) {
				await activateAudio.press('Enter');
				await expect(activateAudio).toBeHidden();
			}
			const validationGate = new Promise<void>((resolve) => {
				releaseValidation = resolve;
			});
			let validationCaptured = false;
			await b.page.route('**/api/session', async (route) => {
				if (route.request().headers()['x-e2e-session-race'] !== 'held') {
					await route.continue();
					return;
				}
				const response = await route.fetch();
				expect((await response.json()).authenticated).toBe(true);
				validationCaptured = true;
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
			await expect
				.poll(() => validationCaptured, {
					message: 'RequireAuth harus mengirim tagged validation sebelum simulasi logout',
					timeout: 10_000
				})
				.toBe(true);
			await b.page.getByRole('button', { name: 'Logout', exact: true }).click();
			const logoutDialog = b.page.getByRole('dialog', { name: 'Konfirmasi Logout' });
			await expect(logoutDialog).toBeVisible();
			await logoutDialog.getByRole('button', { name: 'Keluar', exact: true }).click();
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
		}
	}
);
