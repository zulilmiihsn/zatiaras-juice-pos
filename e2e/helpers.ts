import type { Page } from '@playwright/test';

/**
 * Buka halaman lalu tunggu konten hasil render client (hidrasi + data).
 * Klik tombol SSR sebelum hidrasi tidak memicu handler Svelte; selalu
 * tunggu penanda konten client sebelum berinteraksi.
 */
export async function gotoHydrated(page: Page, url: string, clientMarker: string): Promise<void> {
	await page.goto(url);
	await page.locator(clientMarker).first().waitFor({ timeout: 60000 });
}

// Browser runs share one local IP; spread logins across isolated UAT owners below the per-user limit.
export function ownerUsernameForTest(title: string): string {
	if (title === 'legacy status intent without a token is staged and replayed') return 'pemilik';

	let hash = 2166136261;
	for (const character of title) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}
	const slot = (hash >>> 0) % 4;
	return slot === 0 ? 'pemilik' : `pemilik-e2e-${slot}`;
}

/**
 * Mutasi via page.request mengikuti kontrak aplikasi
 * (fetchWithCsrfRetry): token segar per percobaan + SATU retry bila
 * server menolak CSRF_INVALID (rotasi cookie antar GET/POST di jar bersama).
 * Tanpa retry, POST kedua+ flaky 403 di run cepat.
 */
export async function csrfMutate(
	page: Page,
	method: 'POST' | 'PATCH',
	path: string,
	data: unknown
) {
	for (let attempt = 0; attempt < 2; attempt++) {
		// Cache-buster: token GET tak boleh disajikan dari cache HTTP.
		const csrf = (await (await page.request.get(`/api/csrf?_=${Date.now()}`)).json()) as {
			token?: string;
		};
		const res =
			method === 'POST'
				? await page.request.post(path, {
						data,
						headers: csrf.token ? { 'X-CSRF-Token': csrf.token } : {}
					})
				: await page.request.patch(path, {
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
