import type { Page } from '@playwright/test';
// Browser runs share one local IP; spread logins across isolated UAT owners below the per-user limit.
export { ownerUsernameForTest } from '../scripts/e2e-environment.mjs';

/** Measure the painted background, since iOS scroll locking fixes body in the viewport. */
export async function prepareBackgroundScrollProbe(page: Page): Promise<void> {
	await page.getByRole('dialog').waitFor({ state: 'detached' });
	// URL changes precede the router's final scroll restoration and the outgoing dialog's cleanup.
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				// Native smooth scrolling can outlive the navigation's URL and DOM updates.
				const position = () => {
					const viewport = window.visualViewport;
					const main = document.querySelector('main');
					return [
						window.scrollX,
						window.scrollY,
						viewport?.offsetTop ?? 0,
						viewport?.scale ?? 1,
						main?.getBoundingClientRect().top ?? 0,
						main?.scrollTop ?? 0
					];
				};
				let previous = position();
				let stableFrames = 0;
				const check = () => {
					const current = position();
					stableFrames = current.every((value, index) => value === previous[index])
						? stableFrames + 1
						: 0;
					previous = current;
					if (stableFrames >= 3) resolve();
					else requestAnimationFrame(check);
				};
				requestAnimationFrame(check);
			})
	);
	await page.evaluate(() => {
		const background = document.querySelector('main');
		if (!background) throw new Error('Background page content is unavailable');
		const anchors = [document.documentElement, document.body, background].map((element) => ({
			element,
			value: element.style.getPropertyValue('overflow-anchor'),
			priority: element.style.getPropertyPriority('overflow-anchor')
		}));
		for (const { element } of anchors)
			element.style.setProperty('overflow-anchor', 'none', 'important');
		document.body.style.minHeight = '2400px';
		document.body.style.setProperty('position', 'relative', 'important');
		document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
		document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
		// Report data can grow after mount; test gestures must be the only source of viewport movement.
		window.scrollTo({ top: 300, behavior: 'instant' });
		const capture = () => ({
			y: window.scrollY,
			// Body formatting changes under position:fixed; measure actual page content, including its own scroller.
			top:
				background.getBoundingClientRect().top -
				background.scrollTop -
				(window.visualViewport?.offsetTop ?? 0),
			node: background
		});
		const fixture = window as Window & {
			backgroundScrollProbe?: { y: number; top: number; node: HTMLElement };
		};
		fixture.backgroundScrollProbe = capture();
		// Locator clicks can scroll their trigger into view before the modal opens.
		document.addEventListener(
			'click',
			() => {
				fixture.backgroundScrollProbe = capture();
				// The chat must retain production anchoring while gestures and token updates are tested.
				for (const { element, value, priority } of anchors) {
					if (value) element.style.setProperty('overflow-anchor', value, priority);
					else element.style.removeProperty('overflow-anchor');
				}
			},
			{ once: true, capture: true }
		);
	});
}

export async function backgroundScrollProbe(
	page: Page
): Promise<{ actual: number; expected: number; y: number }> {
	return page.evaluate(() => {
		const origin = (
			window as Window & { backgroundScrollProbe?: { y: number; top: number; node: HTMLElement } }
		).backgroundScrollProbe;
		if (!origin?.node.isConnected) throw new Error('Background scroll fixture is unavailable');
		return {
			actual:
				origin.node.getBoundingClientRect().top -
				origin.node.scrollTop -
				(window.visualViewport?.offsetTop ?? 0),
			expected: origin.top,
			y: origin.y
		};
	});
}

/**
 * Buka halaman lalu tunggu konten hasil render client (hidrasi + data).
 * Klik tombol SSR sebelum hidrasi tidak memicu handler Svelte; selalu
 * tunggu penanda konten client sebelum berinteraksi.
 */
export async function gotoHydrated(page: Page, url: string, clientMarker: string): Promise<void> {
	await page.goto(url);
	await page.locator(clientMarker).first().waitFor({ timeout: 60000 });
}

/**
 * Mutasi via page.request mengikuti kontrak aplikasi
 * (fetchWithCsrfRetry): baca endpoint tanpa cache per percobaan + SATU retry
 * bila server menolak CSRF_INVALID. Cookie valid tetap stabil antar GET caller;
 * cookie yang hilang/diubah tetap harus melalui guard, bukan bypass/extra retry.
 */
export async function csrfMutate(
	page: Page,
	method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	path: string,
	data: unknown
) {
	for (let attempt = 0; attempt < 2; attempt++) {
		// Cache-buster: token GET tak boleh disajikan dari cache HTTP.
		const csrf = (await (await page.request.get(`/api/csrf?_=${Date.now()}`)).json()) as {
			token?: string;
		};
		const res = await page.request.fetch(path, {
			method,
			data,
			headers: csrf.token ? { 'X-CSRF-Token': csrf.token } : {}
		});
		if (res.status() !== 403) return res;
		// Baca sekali: body terkonsumsi di sini; status cukup untuk retry.
		const retryable = (await res.text().catch(() => '')).includes('CSRF_INVALID');
		if (!retryable || attempt > 0) {
			throw new Error(`csrfMutate ${path} ditolak: HTTP 403 non-CSRF`);
		}
	}
	throw new Error('csrfMutate tak terduga gagal');
}

/** Kompatibilitas: POST saja. */
export async function csrfPost(page: Page, path: string, data: unknown) {
	return csrfMutate(page, 'POST', path, data);
}
