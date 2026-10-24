import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { isPinRequiredError } from '$lib/utils/pinRequiredError';
import type { ProtectedPage } from '$lib/server/pageAccess';
import { pinAccess } from '$lib/stores/securitySettings.svelte';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { userRole, userProfile } from '$lib/stores/userRole.svelte';
import { getOfflineSessionRevision } from '$lib/auth/offlineSession';

export type PinVerificationResult = {
	ok: boolean;
	message?: string;
	expiresAt?: number;
	/** Remaining unlock time; independent of either side's wall clock. */
	expiresInMs?: number;
};

/**
 * Unlock expiry on this device's clock. The server's `expiresAt` is on the server clock, so a
 * device running fast would reject a correct PIN; the remaining time is skew-free.
 * Without `expiresInMs` (older server or mock) the raw `expiresAt` is used.
 */
function localExpiresAt(payload: PinVerificationResult | null): number {
	if (!payload) return 0;
	if (typeof payload.expiresInMs === 'number' && Number.isFinite(payload.expiresInMs))
		return payload.expiresInMs > 0 ? Date.now() + payload.expiresInMs : 0;
	return typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)
		? payload.expiresAt
		: 0;
}

let requestGeneration = 0;
let statusRequest: { identity: string; promise: Promise<boolean> } | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Satu-satunya penulis `pinAccess.value` di layanan ini. Ia juga memasang timer yang
 * mengosongkan izin saat masa buka habis, sehingga layout mengunci ulang tanpa menunggu
 * navigasi (`hasPinAccess` membaca `Date.now()`, yang tidak reaktif).
 */
function setPinAccess(next: { identity: string; expiresAt: number } | null): void {
	clearTimeout(expiryTimer);
	expiryTimer = undefined;
	pinAccess.value = next;
	if (!next || typeof window === 'undefined') return;
	expiryTimer = setTimeout(
		() => {
			// Bandingkan isi, bukan objek: $state membungkus objek dalam proxy.
			const current = pinAccess.value;
			if (current?.identity === next.identity && current.expiresAt === next.expiresAt)
				pinAccess.value = null;
		},
		Math.max(0, next.expiresAt - Date.now())
	);
}

export function pinAccessIdentity(): string {
	if (typeof window === 'undefined' || userRole.value !== 'kasir') return '';
	const profile = userProfile.value as { id?: string; username?: string; branch?: string } | null;
	if (!profile || profile.branch !== selectedBranch.value) return '';
	try {
		return JSON.stringify([
			userRole.value,
			profile.id,
			profile.username,
			profile.branch,
			selectedBranch.value,
			selectedBranch.contextEpoch,
			getOfflineSessionRevision()
		]);
	} catch {
		// Identitas sesi yang tidak dapat dibaca tidak boleh mewarisi izin sebelumnya.
		return '';
	}
}

export function hasPinAccess(): boolean {
	const current = pinAccess.value;
	return Boolean(
		current && current.identity === pinAccessIdentity() && current.expiresAt > Date.now()
	);
}

export function finishPinRequest(verified: boolean): void {
	const request = pinAccess.request;
	pinAccess.request = null;
	request?.complete(verified && request.identity === pinAccessIdentity() && hasPinAccess());
}

export async function requestPinAccess(page: ProtectedPage): Promise<boolean> {
	const identity = pinAccessIdentity();
	const path = typeof window === 'undefined' ? '' : window.location.pathname;
	if (!identity) return false;
	if (await refreshPinAccess()) {
		return identity === pinAccessIdentity() && path === window.location.pathname;
	}
	if (identity !== pinAccessIdentity() || path !== window.location.pathname) return false;
	finishPinRequest(false);
	return new Promise((complete) => {
		pinAccess.request = { identity, path, page, complete };
	});
}

/**
 * `fresh` melewati request status yang sedang berjalan: request itu dikirim sebelum server
 * menolak dan bisa membawa jawaban lama. Nomor generasi membuat hasilnya diabaikan.
 */
export async function refreshPinAccess(options: { fresh?: boolean } = {}): Promise<boolean> {
	const identity = pinAccessIdentity();
	if (!identity) {
		setPinAccess(null);
		return false;
	}
	if (!options.fresh && statusRequest?.identity === identity) return statusRequest.promise;
	const generation = ++requestGeneration;
	const promise = (async () => {
		try {
			const response = await fetch('/api/pin/verify', {
				cache: 'no-store',
				signal: AbortSignal.timeout(8000)
			});
			const payload = (await response.json()) as PinVerificationResult;
			if (generation === requestGeneration && identity === pinAccessIdentity()) {
				const expiresAt = response.ok && payload?.ok === true ? localExpiresAt(payload) : 0;
				setPinAccess(expiresAt > 0 ? { identity, expiresAt } : null);
			}
		} catch {
			// Kegagalan jaringan/status tidak memberikan izin lokal tanpa konfirmasi server.
			if (generation === requestGeneration && identity === pinAccessIdentity()) {
				setPinAccess(null);
			}
		}
		return identity === pinAccessIdentity() && hasPinAccess();
	})();
	statusRequest = { identity, promise };
	try {
		return await promise;
	} finally {
		if (statusRequest?.promise === promise) statusRequest = null;
	}
}

/**
 * 403 `PIN_REQUIRED` berarti server tidak lagi mengakui izin buka (habis atau dicabut),
 * sementara klien masih mengira terbuka. Sinkronkan agar layout menampilkan layar PIN,
 * bukan membiarkan data lama tanpa pesan. True bila galatnya memang itu; caller diam.
 */
export function handlePinRequired(error: unknown): boolean {
	if (!isPinRequiredError(error)) return false;
	void refreshPinAccess({ fresh: true });
	return true;
}

export async function verifyPagePin(
	pin: string,
	page: ProtectedPage
): Promise<PinVerificationResult> {
	const identity = pinAccessIdentity();
	if (!identity) return { ok: false, message: 'Sesi kasir tidak tersedia' };
	requestGeneration++;
	statusRequest = null;
	const response = await fetchWithCsrfRetry('/api/pin/verify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ pin, page })
	});
	const payload = (await response.json().catch(() => null)) as PinVerificationResult | null;
	if (identity !== pinAccessIdentity()) {
		return { ok: false, message: 'Sesi kasir berubah. Masukkan PIN kembali' };
	}
	const expiresAt = response.ok && payload?.ok === true ? localExpiresAt(payload) : 0;
	const ok = expiresAt > Date.now();
	// Hasil status yang mulai sebelum verifikasi tidak boleh menimpa izin yang baru diberikan.
	requestGeneration++;
	statusRequest = null;
	setPinAccess(ok ? { identity, expiresAt } : null);
	return {
		ok,
		expiresAt: ok ? expiresAt : undefined,
		message: payload?.message || (ok ? undefined : 'Verifikasi PIN gagal')
	};
}
