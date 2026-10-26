import { devices, expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import {
	backgroundScrollProbe,
	csrfPost,
	ownerUsernameForTest,
	prepareBackgroundScrollProbe
} from './helpers';

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
	// Cold WebKit navigation loads the application after the login response and success overlay.
	await page.waitForURL(/\/$/, { timeout: 60_000 });
}

async function expectBackgroundUnmoved(page: Page) {
	const probe = await backgroundScrollProbe(page);
	expect(probe.actual).toBeCloseTo(probe.expected, 0);
}

async function installReportStreamFixture(page: Page, initialText = '') {
	await page.addInitScript((text) => {
		type Entry = { controller: ReadableStreamDefaultController<Uint8Array>; cancelled: boolean };
		const streams: Entry[] = [];
		const fixture = window as Window & { reportStreams?: Entry[]; aiStream?: Entry['controller'] };
		fixture.reportStreams = streams;
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input), location.href);
			if (url.pathname !== '/api/aichat' || url.search || init?.method !== 'POST')
				return originalFetch(input, init);
			let entry: Entry;
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					entry = { controller, cancelled: false };
					streams.push(entry);
					fixture.aiStream = controller;
					if (text)
						controller.enqueue(
							new TextEncoder().encode('data: ' + JSON.stringify({ type: 'token', text }) + '\n\n')
						);
				},
				cancel() {
					entry.cancelled = true;
				}
			});
			return Promise.resolve(
				new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
			);
		};
	}, initialText);
}

// Semua request invalid berhenti sebelum provider; CSRF_INVALID hanya retry sekali sesuai kontrak.
test('aichat negative contracts stay stable', async ({ page }) => {
	const anonymous = await csrfPost(page, '/api/aichat', { text: 'halo' });
	expect(anonymous.status()).toBe(401);

	await loginAsOwner(page, test.info().title);

	const empty = await csrfPost(page, '/api/aichat?action=analyze', { text: '' });
	expect(empty.status()).toBe(400);
	expect(((await empty.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');

	const long = await csrfPost(page, '/api/aichat?action=analyze', { text: 'x'.repeat(2001) });
	expect(long.status()).toBe(400);
	expect(((await long.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');

	const chatEmpty = await csrfPost(page, '/api/aichat', { question: '' });
	expect(chatEmpty.status()).toBe(400);
	expect(((await chatEmpty.json()) as { code?: string }).code).toBe('VALIDATION_ERROR');
});

test('stopping an old AI response cannot clear a newer request', async ({ page }) => {
	await installReportStreamFixture(page, 'Jawaban mulai.');
	await loginAsOwner(page, test.info().title);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Laporan', exact: true })
		.click();
	await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
	await dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...').fill('Pertanyaan pertama');
	await dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...').press('Enter');
	await expect(dialog.getByText('Jawaban mulai.', { exact: true })).toBeVisible();
	await dialog.evaluate((node) => {
		const stop = node.querySelector<HTMLButtonElement>('[aria-label="Hentikan respons AI"]');
		const input = node.querySelector<HTMLInputElement>('input');
		if (!stop || !input || !input.form) throw new Error('Chat controls are unavailable');
		// Both intents occur before the old request can finish its asynchronous cleanup.
		stop.click();
		input.value = 'Pertanyaan kedua';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.form.requestSubmit();
		const first = (
			window as Window & {
				reportStreams?: Array<{
					controller: ReadableStreamDefaultController<Uint8Array>;
					cancelled: boolean;
				}>;
			}
		).reportStreams?.[0];
		if (first && !first.cancelled) first.controller.close();
	});
	await expect(dialog.getByText('Pertanyaan kedua', { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();
	await page.evaluate(() => {
		const streams = (
			window as Window & {
				reportStreams?: Array<{ controller: ReadableStreamDefaultController<Uint8Array> }>;
			}
		).reportStreams;
		if (!streams?.[1]) throw new Error('The second response has not started');
		streams[1].controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
		streams[1].controller.close();
	});
	await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toHaveCount(0);
});

test('report context changes clear old messages and navigation cancels the active stream', async ({
	page
}) => {
	await installReportStreamFixture(page, 'Jawaban konteks awal.');
	await loginAsOwner(page, test.info().title);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Laporan', exact: true })
		.click();
	await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
	const input = dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...');
	await input.fill('Analisis konteks pertama');
	await input.press('Enter');
	await expect(dialog.getByText('Jawaban konteks awal.', { exact: true })).toBeVisible();
	await page.evaluate(async () => {
		const modulePath = '/src/lib/stores/selectedBranch.svelte.ts';
		const { selectedBranch } = await import(/* @vite-ignore */ modulePath);
		selectedBranch.value = 'berau';
		selectedBranch.value = 'samarinda';
	});
	await expect(dialog.getByText('Jawaban konteks awal.', { exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toHaveCount(0);
	const cancelled = (index: number) =>
		page.evaluate(
			(at) =>
				(window as Window & { reportStreams?: Array<{ cancelled: boolean }> }).reportStreams?.[at]
					?.cancelled,
			index
		);
	await expect.poll(() => cancelled(0)).toBe(true);
	await input.fill('Analisis baru');
	await input.press('Enter');
	await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();
	await expect(dialog.getByText('Jawaban konteks awal.', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: 'Tutup Asisten AI' }).click();
	await expect(dialog).toHaveCount(0);
	// Closing only hides the conversation; leaving its page owns cancellation.
	expect(await cancelled(1)).toBe(false);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Catat', exact: true })
		.click();
	await expect(page).toHaveURL(/\/catat$/);
	await expect.poll(() => cancelled(1)).toBe(true);
	expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('native mobile swipes stay inside the chat while tokens arrive continuously', async ({
	browser,
	baseURL
}) => {
	const context = await browser.newContext({ ...devices['Pixel 7'], baseURL });
	const page = await context.newPage();
	try {
		await installReportStreamFixture(page, 'Awal jawaban.');
		await loginAsOwner(page, test.info().title);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Laporan', exact: true })
			.click();
		await expect(page).toHaveURL(/\/laporan$/);
		await prepareBackgroundScrollProbe(page);
		await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
		await dialog
			.getByPlaceholder('Ketik pertanyaan untuk asisten AI...')
			.fill('Analisis dengan sentuhan');
		await dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...').press('Enter');
		await expect(dialog.getByText('Awal jawaban.', { exact: true })).toBeVisible();
		const chat = dialog.locator('div.overflow-y-auto');
		const cdp = await context.newCDPSession(page);
		await chat.evaluate((node) => {
			const starts: Array<{ target: EventTarget | null; top: number }> = [];
			(window as Window & { touchStarts?: typeof starts }).touchStarts = starts;
			node.addEventListener(
				'touchstart',
				(event) => starts.push({ target: event.target, top: node.scrollTop }),
				{ passive: true }
			);
		});
		async function swipe(direction: number) {
			const previousStarts = await page.evaluate(
				() => (window as Window & { touchStarts?: unknown[] }).touchStarts?.length ?? 0
			);
			const box = await chat.boundingBox();
			if (!box) throw new Error('Chat viewport is unavailable');
			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			const distance = Math.min(120, box.height / 3) * direction;
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
			await expect
				.poll(() =>
					page.evaluate(
						() => (window as Window & { touchStarts?: unknown[] }).touchStarts?.length ?? 0
					)
				)
				.toBeGreaterThan(previousStarts);
			const topAtStart = await page.evaluate(
				() =>
					(window as Window & { touchStarts?: Array<{ top: number }> }).touchStarts?.at(-1)?.top ??
					0
			);
			for (let step = 1; step <= 8; step++) {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x, y: y + (distance * step) / 8 }]
				});
				await page.evaluate(
					() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
				);
				expect(
					await page.evaluate(() => {
						const target = (
							window as Window & { touchStarts?: Array<{ target: Node }> }
						).touchStarts?.at(-1)?.target;
						return target?.isConnected;
					})
				).toBe(true);
			}
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			return topAtStart;
		}
		await swipe(-1);
		await expectBackgroundUnmoved(page);
		await page.evaluate(() => {
			const fixture = window as Window & {
				aiStream?: ReadableStreamDefaultController<Uint8Array>;
				streamFrame?: number;
				streamTicks?: number;
			};
			fixture.streamTicks = 0;
			fixture.aiStream?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ type: 'token', text: '\n\nJawaban panjang untuk pengujian.'.repeat(40) })}\n\n`
				)
			);
			const pump = () => {
				fixture.aiStream?.enqueue(
					new TextEncoder().encode(
						`data: ${JSON.stringify({ type: 'token', text: '\n\nToken baru terus masuk.' })}\n\n`
					)
				);
				fixture.streamTicks = (fixture.streamTicks ?? 0) + 1;
				if (fixture.streamTicks < 240) fixture.streamFrame = requestAnimationFrame(pump);
			};
			fixture.streamFrame = requestAnimationFrame(pump);
		});
		await expect
			.poll(() => chat.evaluate((node) => node.scrollHeight - node.clientHeight))
			.toBeGreaterThan(400);
		await expect
			.poll(() => chat.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
			.toBeLessThanOrEqual(2);
		const before = await swipe(1);
		await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();
		await expectBackgroundUnmoved(page);
		expect(await chat.evaluate((node) => node.scrollTop)).toBeLessThan(before - 20);
		await page.evaluate(() => {
			const fixture = window as Window & {
				aiStream?: ReadableStreamDefaultController<Uint8Array>;
				streamFrame?: number;
			};
			if (fixture.streamFrame !== undefined) cancelAnimationFrame(fixture.streamFrame);
			fixture.aiStream?.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
			fixture.aiStream?.close();
		});
	} finally {
		await context.close();
	}
});

for (const engine of ['chromium', 'webkit'] as const) {
	const iphone = devices['iPhone 13'];
	const iphoneTest = test.extend({
		browserName: engine,
		viewport: iphone.viewport,
		userAgent: iphone.userAgent,
		deviceScaleFactor: iphone.deviceScaleFactor,
		isMobile: iphone.isMobile,
		hasTouch: iphone.hasTouch
	});
	iphoneTest(
		`${engine} keeps the page visually locked while an active AI response receives viewport scrolling`,
		async ({ page }) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await installReportStreamFixture(page, 'Jawaban sedang dibuat.');
			await test.step('Authenticate the iPhone browser context', () =>
				loginAsOwner(page, test.info().title));
			await page
				.getByRole('navigation', { name: 'Navigasi utama' })
				.getByRole('link', { name: 'Laporan', exact: true })
				.click();
			await expect(page).toHaveURL(/\/laporan$/);
			await page.evaluate(() => {
				document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
				document.body.style.setProperty('position', 'relative', 'important');
				document.body.style.minHeight = '2400px';
				const probe = document.createElement('div');
				probe.id = 'page-scroll-probe';
				probe.style.cssText =
					'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
				document.body.appendChild(probe);
				window.scrollTo({ top: 300, behavior: 'instant' });
			});
			const position = () =>
				page.locator('#page-scroll-probe').evaluate((node) => node.getBoundingClientRect().top);
			const before = await position();
			// Keep the prescribed page offset; a locator click first scrolls this trigger into view.
			await page
				.getByRole('button', { name: 'Buka Asisten AI', exact: true })
				.evaluate((node) => node.click());
			const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
			await dialog
				.getByPlaceholder('Ketik pertanyaan untuk asisten AI...')
				.fill('Periksa posisi halaman');
			await dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...').press('Enter');
			await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();
			await page.evaluate(() => window.scrollTo({ top: 650, behavior: 'instant' }));
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			expect(await position()).toBeCloseTo(before, 0);
			await dialog.getByRole('button', { name: 'Hentikan respons AI' }).click();
			await dialog.getByRole('button', { name: 'Tutup Asisten AI' }).click();
			await expect(dialog).toHaveCount(0);
			expect(await page.evaluate(() => window.scrollY)).toBe(300);
			expect(await page.evaluate(() => document.body.style.position)).toBe('relative');
			expect(await page.evaluate(() => document.body.style.getPropertyPriority('position'))).toBe(
				'important'
			);
			expect(await page.evaluate(() => document.documentElement.style.overflowY)).toBe('auto');
			expect(errors).toEqual([]);
		}
	);
}

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 }
]) {
	test(`active AI stream contains wheel gestures with an explicit document scroller at ${viewport.width}px`, async ({
		page
	}) => {
		await page.setViewportSize(viewport);
		await installReportStreamFixture(page, 'Awal jawaban.');
		await loginAsOwner(page, test.info().title);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Laporan', exact: true })
			.click();
		await expect(page).toHaveURL(/\/laporan$/);
		await prepareBackgroundScrollProbe(page);
		await page.evaluate(() =>
			document.documentElement.style.setProperty('overflow-y', 'auto', 'important')
		);
		await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
		const input = dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...');
		await input.fill('Analisis sambil membaca');
		await input.press('Enter');
		await expect(dialog.getByText('Awal jawaban.', { exact: true })).toBeVisible();
		const chat = dialog.locator('div.overflow-y-auto');
		const stop = dialog.getByRole('button', { name: 'Hentikan respons AI' });
		await expect(stop).toBeVisible();
		await chat.hover();
		await page.mouse.wheel(0, 400);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
				)
		);
		await expectBackgroundUnmoved(page);
		await page.evaluate(() => {
			const fixture = window as Window & {
				aiStream?: ReadableStreamDefaultController<Uint8Array>;
				streamFrame?: number;
				streamTicks?: number;
			};
			fixture.streamTicks = 0;
			const pump = () => {
				fixture.aiStream?.enqueue(
					new TextEncoder().encode(
						`data: ${JSON.stringify({ type: 'token', text: '\n\nBagian jawaban terus bertambah.' })}\n\n`
					)
				);
				fixture.streamTicks = (fixture.streamTicks ?? 0) + 1;
				fixture.streamFrame = requestAnimationFrame(pump);
			};
			fixture.aiStream?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ type: 'token', text: '\n\nIsi jawaban panjang.'.repeat(40) })}\n\n`
				)
			);
			fixture.streamFrame = requestAnimationFrame(pump);
		});
		await expect
			.poll(() => chat.evaluate((node) => node.scrollHeight - node.clientHeight))
			.toBeGreaterThan(400);
		await chat.hover();
		await page.mouse.wheel(0, -300);
		await expect
			.poll(() => chat.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
			.toBeGreaterThan(100);
		await expect(stop).toBeVisible();
		await expectBackgroundUnmoved(page);
		await page.evaluate(() => {
			const fixture = window as Window & {
				aiStream?: ReadableStreamDefaultController<Uint8Array>;
				streamFrame?: number;
			};
			if (fixture.streamFrame !== undefined) cancelAnimationFrame(fixture.streamFrame);
			fixture.aiStream?.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
			fixture.aiStream?.close();
		});
		await expect(stop).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Tutup Asisten AI' }).click();
		await expect(dialog).toHaveCount(0);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
			'auto'
		);
		await page.mouse.move(5, 5);
		await page.mouse.wheel(0, 400);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
	});

	test(`AI streaming preserves manual scroll at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await installReportStreamFixture(page);
		await loginAsOwner(page, test.info().title);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Laporan', exact: true })
			.click();
		await expect(page).toHaveURL(/\/laporan$/);
		await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
		const input = dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...');
		await input.fill('Analisis penjualan toko');
		await input.press('Enter');
		await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();

		const chat = dialog.locator('div.overflow-y-auto');
		const distanceFromBottom = () =>
			chat.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
		async function emit(type: 'token' | 'done' | 'error', text = '') {
			await page.evaluate(
				({ type, text }) => {
					const controller = (
						window as Window & { aiStream?: ReadableStreamDefaultController<Uint8Array> }
					).aiStream;
					if (!controller) throw new Error('AI stream fixture is not ready');
					controller.enqueue(
						new TextEncoder().encode(`data: ${JSON.stringify({ type, text, error: text })}\n\n`)
					);
					if (type === 'done') controller.close();
				},
				{ type, text }
			);
			// Wait for rendering and the scroll callback, without timing-dependent sleeps.
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
		}

		await emit('token', 'Penjualan toko stabil.\n\n'.repeat(40));
		await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);
		await emit('token', 'Tambahan analisis.\n\n'.repeat(5));
		await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);

		await chat.hover();
		await page.mouse.wheel(0, -300);
		await expect.poll(distanceFromBottom).toBeGreaterThan(100);
		const readingPosition = await chat.evaluate((node) => node.scrollTop);
		await emit('token', 'Jawaban terus bertambah.\n\n'.repeat(5));
		expect(await chat.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0);
		await emit('token', 'Bagian berikutnya.\n\n'.repeat(5));
		expect(await chat.evaluate((node) => node.scrollTop)).toBeCloseTo(readingPosition, 0);

		await chat.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);
		await emit('token', 'Melanjutkan analisis terbaru.\n\n'.repeat(5));
		await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);

		await chat.evaluate((node) => {
			node.scrollTop -= 12;
		});
		await expect.poll(distanceFromBottom).toBeGreaterThan(2);
		const nearBottomPosition = await chat.evaluate((node) => node.scrollTop);
		await emit('token', 'Pengguna membaca baris sebelumnya.\n\n');
		expect(await chat.evaluate((node) => node.scrollTop)).toBeCloseTo(nearBottomPosition, 0);

		await page.mouse.wheel(0, -300);
		await expect.poll(distanceFromBottom).toBeGreaterThan(100);
		const finalPosition = await chat.evaluate((node) => node.scrollTop);
		await emit('error', 'Data tambahan tidak tersedia');
		expect(await chat.evaluate((node) => node.scrollTop)).toBeCloseTo(finalPosition, 0);
		await emit('done');
		await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toHaveCount(0);
		expect(await chat.evaluate((node) => node.scrollTop)).toBeCloseTo(finalPosition, 0);

		await input.fill('Lanjutkan analisis');
		await input.press('Enter');
		await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toBeVisible();
		await emit('token', 'Jawaban untuk pertanyaan berikutnya.\n\n'.repeat(5));
		await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2);
		await emit('done');
	});

	test(`AI scroll boundaries do not scroll reports at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await loginAsOwner(page, test.info().title);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Laporan', exact: true })
			.click();
		await expect(page).toHaveURL(/\/laporan$/);
		// A long report with room to scroll in either direction exposes chaining at both edges.
		await prepareBackgroundScrollProbe(page);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
		await page.getByRole('button', { name: 'Buka Asisten AI', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true });
		const chat = dialog.locator('div.overflow-y-auto');
		const input = dialog.getByPlaceholder('Ketik pertanyaan untuk asisten AI...');
		await expect(input).toBeVisible();
		await page.route('**/api/aichat', (route) =>
			route.fulfill({ json: { success: true, answer: 'Penjualan toko stabil.\n\n'.repeat(50) } })
		);
		await input.fill('Analisis penjualan toko');
		await input.press('Enter');
		await expect(chat.getByText('Penjualan toko stabil.', { exact: true })).toHaveCount(50);
		await expect(dialog.getByRole('button', { name: 'Hentikan respons AI' })).toHaveCount(0);
		await expect
			.poll(() => chat.evaluate((node) => node.scrollHeight - node.clientHeight))
			.toBeGreaterThan(100);

		for (const delta of [-400, 400]) {
			await chat.evaluate((node, delta) => {
				node.scrollTop = delta < 0 ? 0 : node.scrollHeight;
			}, delta);
			await chat.hover();
			await page.mouse.wheel(0, delta);
			await page.evaluate(
				() =>
					new Promise<void>((resolve) =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			await expectBackgroundUnmoved(page);
		}

		await dialog.getByRole('heading', { name: 'Asisten AI Zatiaras' }).hover();
		await page.mouse.wheel(0, 400);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
				)
		);
		await expectBackgroundUnmoved(page);
		await dialog.getByRole('button', { name: 'Tutup Asisten AI' }).click();
		await expect(dialog).toHaveCount(0);
		await expectBackgroundUnmoved(page);
		await page.mouse.move(10, viewport.height / 2);
		await page.mouse.wheel(0, 400);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
	});
}
