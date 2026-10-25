import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { csrfPost, ownerUsernameForTest } from './helpers';

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

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 }
]) {
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
		await page.evaluate(() => {
			document.body.style.minHeight = '2400px';
			window.scrollTo({ top: 300, behavior: 'instant' });
		});
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
			expect(await page.evaluate(() => window.scrollY)).toBe(300);
		}

		await dialog.getByRole('heading', { name: 'Asisten AI Zatiaras' }).hover();
		await page.mouse.wheel(0, 400);
		await page.evaluate(
			() =>
				new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
				)
		);
		expect(await page.evaluate(() => window.scrollY)).toBe(300);
		await dialog.getByRole('button', { name: 'Tutup Asisten AI' }).click();
		await expect(dialog).toHaveCount(0);
		expect(await page.evaluate(() => window.scrollY)).toBe(300);
		await page.mouse.move(10, viewport.height / 2);
		await page.mouse.wheel(0, 400);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
	});
}
