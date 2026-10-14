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

// AppModal logout — initial focus, Tab trap, Escape, restore.
test('logout modal traps focus and restores trigger', async ({ page }) => {
	await loginAsOwner(page);
	await page.goto('/pengaturan');
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
