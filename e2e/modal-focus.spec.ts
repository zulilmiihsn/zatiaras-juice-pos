import { expect, test, type Page, type Locator } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import {
	backgroundScrollProbe,
	gotoHydrated,
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
	expect(response.ok()).toBe(true);
	await expect(page).toHaveURL(/\/$/);
}

async function dialogContainsFocus(page: Page, dialogName: string): Promise<boolean> {
	return page.evaluate((name) => {
		const dialog = document.querySelector(`[role="dialog"][aria-label="${name}"]`);
		return !!dialog && dialog.contains(document.activeElement);
	}, dialogName);
}

async function focusedLabel(page: Page): Promise<string> {
	return page.evaluate(() => (document.activeElement as HTMLElement)?.textContent?.trim() ?? '');
}

async function prepareScrollableBackground(page: Page) {
	await prepareBackgroundScrollProbe(page);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
}

async function expectBackgroundUnmoved(page: Page) {
	const probe = await backgroundScrollProbe(page);
	expect(probe.actual).toBeCloseTo(probe.expected, 0);
}

async function wheelAndSettle(page: Page, delta: number) {
	await page.mouse.wheel(0, delta);
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
}

async function expectWheelContained(page: Page, target: Locator, delta: number) {
	await target.hover();
	await wheelAndSettle(page, delta);
	await expectBackgroundUnmoved(page);
}

async function expectBackgroundRestored(page: Page, dialog: Locator) {
	const origin = await backgroundScrollProbe(page);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	expect(await page.evaluate(() => window.scrollY)).toBe(origin.y);
	await expectBackgroundUnmoved(page);
	await page.mouse.move(5, 5);
	await page.mouse.wheel(0, 400);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(origin.y);
}

// AppModal logout — initial focus, Tab trap, Escape, restore.
test('logout modal traps focus and restores trigger', async ({ page }) => {
	await loginAsOwner(page);
	await gotoHydrated(page, '/pengaturan', 'h2:text-is("Pemilik Kios")');
	const trigger = page.getByRole('button', { name: 'Logout', exact: true });
	await expect(trigger).toBeVisible({ timeout: 30000 });
	await trigger.focus();
	await trigger.click();

	const dialog = page.getByRole('dialog', { name: 'Konfirmasi Logout' });
	await expect(dialog).toBeVisible({ timeout: 15000 });
	await expect
		.poll(() => dialogContainsFocus(page, 'Konfirmasi Logout'), { timeout: 10000 })
		.toBe(true);

	// Tab berputar di dalam: kumpulkan label, pastikan tak keluar + wrap.
	const seen: string[] = [];
	for (let i = 0; i < 6; i++) {
		await page.keyboard.press('Tab');
		expect(await dialogContainsFocus(page, 'Konfirmasi Logout')).toBe(true);
		seen.push(await focusedLabel(page));
	}
	expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
	expect(seen[seen.length - 1]).toBe(seen[1]);

	// Shift+Tab tetap di dalam.
	await page.keyboard.press('Shift+Tab');
	expect(await dialogContainsFocus(page, 'Konfirmasi Logout')).toBe(true);

	// Latar inert saat terbuka.
	expect(await page.evaluate(() => document.querySelector('[inert]') !== null)).toBe(true);

	// Escape tutup + fokus kembali ke pemicu.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden({ timeout: 10000 });
	expect(await focusedLabel(page)).toContain('Logout');
	expect(await page.evaluate(() => document.querySelector('[inert]') !== null)).toBe(false);
});

// ModalSheet keranjang — trap + Escape + restore.
// Pil keranjang hanya tampil di viewport mobile (md:hidden).
test('cart sheet traps focus and restores trigger', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await loginAsOwner(page);
	await page.goto('/pos');
	const product = page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ });
	await expect(product).toBeVisible({ timeout: 60000 });
	await product.click();
	await page.getByRole('button', { name: 'Jumbo Rp 10.000', exact: true }).click();
	await page.getByRole('button', { name: 'Tambah Rp 10.000', exact: true }).click();

	const triggerButton = page.getByRole('button', { name: /^Buka keranjang/ });
	await expect(triggerButton).toBeVisible({ timeout: 15000 });
	const triggerAria = (await triggerButton.getAttribute('aria-label')) ?? 'Buka keranjang';
	await triggerButton.focus();
	await triggerButton.click();

	const sheet = page.locator('[role="dialog"]').last();
	await expect(sheet).toBeVisible({ timeout: 15000 });
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
					const top = dialogs[dialogs.length - 1];
					return !!top && top.contains(document.activeElement);
				}),
			{ timeout: 10000 }
		)
		.toBe(true);

	for (let i = 0; i < 8; i++) {
		await page.keyboard.press('Tab');
		const inside = await page.evaluate(() => {
			const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
			const top = dialogs[dialogs.length - 1];
			return !!top && top.contains(document.activeElement);
		});
		expect(inside).toBe(true);
	}

	// Kebijakan lama sheet tak inert-kan latar.
	expect(await page.evaluate(() => document.querySelector('[inert]') !== null)).toBe(true);

	await page.keyboard.press('Escape');
	await expect(sheet).toBeHidden({ timeout: 10000 });
	const restoredAria = await page.evaluate(
		() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? ''
	);
	expect(restoredAria).toBe(triggerAria);
});

// Kontrak kebijakan kanonik pada DOM browser nyata — panel tanpa
// focusable, Escape nested hanya menutup dialog teratas, inert dialog nested
// dilepas saat ditutup, restore ke pemicu atau dialog tersisa.
test('modalFocus handles empty panels, nested Escape, inert cleanup and restore', async ({
	page
}) => {
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.evaluate(async () => {
		const path = '/src/lib/utils/modalFocus.ts';
		const { modalFocus } = await import(/* @vite-ignore */ path);
		const root = document.createElement('div');
		root.id = 'mf-root';
		root.innerHTML = `
			<button id="mf-open-outer">Buka luar</button>
			<button id="mf-open-empty">Buka kosong</button>
			<div id="mf-sibling" role="dialog" aria-label="Saudara" hidden>
				<button id="mf-sibling-button">Saudara</button>
			</div>
			<div id="mf-outer" role="dialog" aria-label="Luar">
				<button id="mf-outer-first">Pertama</button>
				<h2 id="mf-outer-heading" tabindex="-1">Judul</h2>
				<button id="mf-open-inner">Buka dalam</button>
				<div id="mf-inner" role="dialog" aria-label="Dalam" hidden>
					<input id="mf-inner-input" aria-label="Isian" />
				</div>
			</div>
			<div id="mf-empty" role="dialog" aria-label="Kosong" hidden><p>Tanpa kontrol</p></div>`;
		document.body.appendChild(root);
		const log: string[] = [];
		const handles = new Map<string, { destroy(): void }>();
		const w = window as unknown as Record<string, unknown>;
		w.mfLog = log;
		w.mfOpen = (id: string) => {
			const node = document.getElementById(id)!;
			node.hidden = false;
			handles.set(id, modalFocus(node, { onEscape: () => log.push(id) }));
		};
		w.mfClose = (id: string) => {
			handles.get(id)?.destroy();
			handles.delete(id);
			document.getElementById(id)!.hidden = true;
		};
	});
	const active = () => page.evaluate(() => document.activeElement?.id ?? '');
	const call = (fn: 'mfOpen' | 'mfClose', id: string) =>
		page.evaluate(
			([name, target]) => (window as unknown as Record<string, (id: string) => void>)[name](target),
			[fn, id] as const
		);
	const escapes = () => page.evaluate(() => [...(window as unknown as { mfLog: string[] }).mfLog]);

	// Panel tanpa focusable tetap menerima fokus; Tab tidak keluar.
	await page.locator('#mf-open-empty').focus();
	await call('mfOpen', 'mf-empty');
	await expect.poll(active).toBe('mf-empty');
	await page.keyboard.press('Tab');
	expect(await active()).toBe('mf-empty');
	await call('mfClose', 'mf-empty');
	expect(await active()).toBe('mf-open-empty');

	// Nested: Escape dari dialog dalam hanya menutup dialog dalam.
	await page.locator('#mf-open-outer').focus();
	await call('mfOpen', 'mf-outer');
	await expect.poll(active).toBe('mf-outer-first');
	await page.locator('#mf-open-inner').focus();
	await call('mfOpen', 'mf-inner');
	await expect.poll(active).toBe('mf-inner-input');
	expect(await page.locator('#mf-outer-first').getAttribute('inert')).toBe('');
	await page.keyboard.press('Escape');
	expect(await escapes()).toEqual(['mf-inner']);
	await page.keyboard.press('Shift+Tab');
	expect(await active()).toBe('mf-inner-input');

	// Tutup dalam: isi dialog luar aktif lagi, fokus kembali ke pemicunya.
	await call('mfClose', 'mf-inner');
	expect(await page.locator('#mf-outer-first').getAttribute('inert')).toBeNull();
	expect(await active()).toBe('mf-open-inner');
	await page.keyboard.press('Tab');
	expect(await active()).toBe('mf-outer-first');
	await page.keyboard.press('Escape');
	expect(await escapes()).toEqual(['mf-inner', 'mf-outer']);

	// Tab dari heading tabindex=-1 di tengah panel lanjut ke kontrol berikutnya.
	await page.locator('#mf-outer-heading').focus();
	await page.keyboard.press('Tab');
	expect(await active()).toBe('mf-open-inner');

	// Dialog saudara bertumpuk: dialog bawah inert, hanya teratas menangani Escape.
	await call('mfOpen', 'mf-sibling');
	await expect.poll(active).toBe('mf-sibling-button');
	expect(await page.locator('#mf-outer').getAttribute('inert')).toBe('');
	await page.keyboard.press('Escape');
	expect(await escapes()).toEqual(['mf-inner', 'mf-outer', 'mf-sibling']);
	await call('mfClose', 'mf-sibling');
	expect(await page.locator('#mf-outer').getAttribute('inert')).toBeNull();
	expect(await active()).toBe('mf-open-inner');

	// Pemicu disabled tidak bisa menerima fokus; latar bebas dari inert.
	await page.evaluate(() => {
		(document.getElementById('mf-open-outer') as HTMLButtonElement).disabled = true;
	});
	await call('mfClose', 'mf-outer');
	expect(await active()).toBe('');
	expect(await page.evaluate(() => document.querySelector('[inert]') === null)).toBe(true);
});

for (const viewport of [
	{ width: 1280, height: 800 },
	{ width: 390, height: 844 }
]) {
	test(`AppModal contains background scroll at ${viewport.width}px`, async ({ page }) => {
		await page.setViewportSize(viewport);
		await loginAsOwner(page);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Laporan', exact: true })
			.click();
		await expect(page).toHaveURL(/\/laporan$/);
		await prepareScrollableBackground(page);
		await page.getByRole('button', { name: 'Filter laporan', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Filter Laporan', exact: true });
		await expect(dialog).toBeVisible();

		const heading = dialog.getByRole('heading', { name: 'Filter Laporan', exact: true });
		await expectWheelContained(page, heading, -400);
		await expectWheelContained(page, heading, 400);
		await page.mouse.move(5, 5);
		await wheelAndSettle(page, 400);
		await expectBackgroundUnmoved(page);
		await expectBackgroundRestored(page, dialog);
	});

	test(`ModalSheet contains scroll at both edges at ${viewport.width}px`, async ({ page }) => {
		// A short viewport makes the real product options overflow at both widths.
		await page.setViewportSize({ ...viewport, height: 600 });
		await loginAsOwner(page);
		await page
			.getByRole('navigation', { name: 'Navigasi utama' })
			.getByRole('link', { name: 'Kasir', exact: true })
			.click();
		await expect(page).toHaveURL(/\/pos$/);
		await prepareScrollableBackground(page);
		await page.getByRole('button', { name: /(?:Pilih|Tambah) Es Teh UAT/ }).click();
		const dialog = page.getByRole('dialog', { name: 'Es Teh UAT', exact: true });
		await expect(dialog).toBeVisible();

		const content = dialog.locator('.sheet-content');
		await expect
			.poll(() => content.evaluate((node) => node.scrollHeight - node.clientHeight))
			.toBeGreaterThan(0);
		await content.hover();
		await page.mouse.wheel(0, 100);
		await expect.poll(() => content.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
		await expectBackgroundUnmoved(page);
		for (const delta of [-400, 400]) {
			await dialog.locator('.sheet-content, .addon-modal-content').evaluateAll((nodes, delta) => {
				for (const node of nodes) node.scrollTop = delta < 0 ? 0 : node.scrollHeight;
			}, delta);
			await expectWheelContained(page, content, delta);
		}
		await expectWheelContained(
			page,
			dialog.getByRole('heading', { name: 'Es Teh UAT', exact: true }),
			400
		);
		await page.mouse.move(5, 5);
		await wheelAndSettle(page, 400);
		await expectBackgroundUnmoved(page);
		await expectBackgroundRestored(page, dialog);
	});
}

test('AppModal keeps long stock forms scrollable without moving the background', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 640 });
	await loginAsOwner(page);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Stok', exact: true })
		.click();
	await expect(page).toHaveURL(/\/stok$/);
	await prepareScrollableBackground(page);
	await page.getByRole('button', { name: 'Tambah Bahan Baku', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Tambah Bahan Baku', exact: true });
	await expect(dialog).toBeVisible();

	const form = dialog.locator('form');
	await expect
		.poll(() => form.evaluate((node) => node.scrollHeight - node.clientHeight))
		.toBeGreaterThan(0);
	await form.hover();
	await page.mouse.wheel(0, 100);
	await expect.poll(() => form.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
	await expectBackgroundUnmoved(page);
	for (const delta of [-400, 400]) {
		await form.evaluate((node, delta) => {
			node.scrollTop = delta < 0 ? 0 : node.scrollHeight;
		}, delta);
		await expectWheelContained(page, form, delta);
	}
	await expectBackgroundRestored(page, dialog);
});

test('dialog scroll lock survives non-LIFO disposal and restores the original style and position', async ({
	page
}) => {
	await page.goto('/login');
	const result = await page.evaluate(async () => {
		const modulePath = '/src/lib/utils/modalFocus.ts';
		const { modalFocus } = await import(/* @vite-ignore */ modulePath);
		const original = document.body.style.cssText;
		document.body.style.minHeight = '2400px';
		document.body.style.setProperty('overflow', 'auto', 'important');
		window.scrollTo({ top: 300, behavior: 'instant' });
		const first = document.createElement('div');
		const second = document.createElement('div');
		first.className = 'z-dialog';
		second.className = 'z-sheet';
		first.tabIndex = second.tabIndex = -1;
		document.body.append(first, second);
		const outer = modalFocus(first);
		const initialLock = document.body.style.overflow;
		const inner = modalFocus(second);
		const topLayer =
			Number(getComputedStyle(second).zIndex) > Number(getComputedStyle(first).zIndex);
		outer.destroy();
		const remainingLock = document.body.style.overflow;
		inner.destroy();
		const restored = {
			value: document.body.style.overflow,
			priority: document.body.style.getPropertyPriority('overflow'),
			top: window.scrollY,
			inert: document.querySelector('[inert]') !== null,
			layer: second.style.zIndex
		};
		first.remove();
		second.remove();
		document.body.style.cssText = original;
		return { initialLock, remainingLock, topLayer, restored };
	});
	expect(result).toEqual({
		initialLock: 'hidden',
		remainingLock: 'hidden',
		topLayer: true,
		restored: { value: 'auto', priority: 'important', top: 300, inert: false, layer: '' }
	});
});

test('transaction option sheet traps keyboard focus and restores its trigger', async ({ page }) => {
	await loginAsOwner(page);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Catat', exact: true })
		.click();
	await expect(page).toHaveURL(/\/catat$/);
	const trigger = page.locator('#jenis-dropdown');
	await trigger.click();
	const dialog = page.getByRole('dialog', { name: 'Modal pilih opsi', exact: true });
	await expect(dialog).toBeVisible();
	await expect
		.poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
		.toBe(true);
	for (let index = 0; index < 5; index++) {
		await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
		expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	}
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(trigger).toBeFocused();
	expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('modal navigation restores destination offsets with smooth scrolling and overlapping completions', async ({
	page
}) => {
	await page.goto('/login');
	const result = await page.evaluate(async () => {
		const modulePath = '/src/lib/utils/modalFocus.ts';
		const { modalFocus, prepareModalNavigation } = await import(/* @vite-ignore */ modulePath);
		document.body.style.minHeight = '3000px';
		document.documentElement.style.setProperty('scroll-behavior', 'smooth', 'important');
		window.scrollTo({ top: 500, behavior: 'instant' });
		const node = document.createElement('div');
		node.style.cssText = 'position:fixed;inset:0';
		document.body.appendChild(node);
		const action = modalFocus(node);
		try {
			const first = Promise.withResolvers<void>();
			prepareModalNavigation(first.promise);
			window.scrollTo(0, 300);
			first.resolve();
			await first.promise;
			const firstTop = document.body.style.top;
			const old = Promise.withResolvers<void>();
			const current = Promise.withResolvers<void>();
			prepareModalNavigation(old.promise);
			prepareModalNavigation(current.promise);
			window.scrollTo(0, 200);
			old.resolve();
			await old.promise;
			const pendingPosition = document.body.style.position;
			current.resolve();
			await current.promise;
			const cancelled = Promise.withResolvers<void>();
			prepareModalNavigation(cancelled.promise);
			cancelled.reject(new Error('Cancelled navigation fixture'));
			await cancelled.promise.catch(() => undefined);
			const finalTop = document.body.style.top;
			action.destroy();
			node.remove();
			return {
				firstTop,
				pendingPosition,
				finalTop,
				y: window.scrollY,
				behavior: document.documentElement.style.scrollBehavior,
				priority: document.documentElement.style.getPropertyPriority('scroll-behavior')
			};
		} finally {
			if (node.isConnected) {
				action.destroy();
				node.remove();
			}
		}
	});
	expect(result).toEqual({
		firstTop: '-300px',
		pendingPosition: '',
		finalTop: '-200px',
		y: 200,
		behavior: 'smooth',
		priority: 'important'
	});
});

test('browser back and forward preserve page positions when leaving an open modal', async ({
	page
}) => {
	await loginAsOwner(page);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.evaluate(() => {
		document.body.style.minHeight = '3000px';
		document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
		window.scrollTo({ top: 500, behavior: 'auto' });
	});
	expect(await page.evaluate(() => window.scrollY)).toBe(500);
	// Activate without Playwright scrolling the navigation link into view first.
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Laporan', exact: true })
		.evaluate((node) => node.click());
	await expect(page).toHaveURL(/\/laporan$/);
	await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'auto' }));
	expect(await page.evaluate(() => window.scrollY)).toBe(300);
	await page
		.getByRole('button', { name: 'Buka Asisten AI', exact: true })
		.evaluate((node) => node.click());
	await expect(
		page.getByRole('dialog', { name: 'Asisten AI Zatiaras', exact: true })
	).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\/$/);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
	await page.goForward();
	await expect(page).toHaveURL(/\/laporan$/);
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
	expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
});

test('cropper cancellation leaves its parent menu dialog locked and usable', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await loginAsOwner(page);
	await page
		.getByRole('navigation', { name: 'Navigasi utama' })
		.getByRole('link', { name: 'Pengaturan', exact: true })
		.click();
	await page.getByRole('link', { name: 'Kelola usaha', exact: true }).click();
	await page.getByRole('link', { name: /Manajemen Menu/ }).click();
	await expect(page).toHaveURL(/\/pengaturan\/pemilik\/manajemenmenu$/);
	await page.getByRole('button', { name: 'Tambah Menu', exact: true }).first().click();
	const parent = page.getByRole('dialog', { name: 'Tambah Menu Baru', exact: true });
	await expect(parent).toBeVisible();
	const data = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 8;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas fixture is unavailable');
		context.fillStyle = '#db2777';
		context.fillRect(0, 0, 8, 8);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	await parent.locator('input[type="file"]').setInputFiles({
		name: 'uji-crop.png',
		mimeType: 'image/png',
		buffer: Buffer.from(data, 'base64')
	});
	const cropper = page.getByRole('dialog', { name: 'Potong gambar', exact: true });
	await expect(cropper).toBeVisible();
	await expect
		.poll(() => cropper.evaluate((node) => node.contains(document.activeElement)))
		.toBe(true);
	await page.screenshot({ path: test.info().outputPath('nested-cropper.png') });
	await page.keyboard.press('Escape');
	await expect(cropper).toHaveCount(0);
	await expect(parent).toBeVisible();
	expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
	await parent.getByLabel('Nama Menu').fill('Menu belum disimpan');
	await page.keyboard.press('Escape');
	await expect(parent).toHaveCount(0);
	expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
	expect(errors).toEqual([]);
});

test('failed login dialog traps focus and closes without leaving the page locked', async ({
	page
}) => {
	await page.goto('/login');
	await expect(page.locator('form[data-hydrated="true"]')).toBeVisible({ timeout: 60_000 });
	await page.route('**/api/veriflogin', (route) =>
		route.fulfill({ status: 401, json: { success: false, message: 'Kredensial uji tidak valid' } })
	);
	await page.getByPlaceholder('Masukkan username').fill('uji-dialog');
	await page.getByPlaceholder('Masukkan password').fill('SandiUjiModal123!');
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Login Gagal', exact: true });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Tab');
	expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
	await page.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
