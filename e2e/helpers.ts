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
