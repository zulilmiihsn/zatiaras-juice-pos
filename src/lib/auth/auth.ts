import { browser } from '$app/environment';
import { setUserRole, clearUserRole } from '$lib/stores/userRole.svelte';
import { setSecuritySettings, clearSecuritySettings } from '$lib/stores/securitySettings.svelte';
import { clearCsrfTokenCache, fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
import {
	clearOfflineSessionSnapshot,
	persistOfflineSessionSnapshot,
	readOfflineSessionSnapshot
} from './offlineSession';
import { clearOrderNotificationRegistration } from '$lib/services/orderNotificationService';
import { clearCachedSessionData } from '$lib/utils/sessionCache';

/**
 * Sesi klien hanya cermin snapshot lokal untuk UI/offline. Otoritas tetap cookie sesi
 * `zatiaras_sid` yang diperiksa server di setiap request.
 */
export const auth = {
	getCurrentUser(): Record<string, unknown> | null {
		return browser ? (readOfflineSessionSnapshot()?.user ?? null) : null;
	},

	async logout() {
		clearUserRole();
		clearSecuritySettings();
		clearCsrfTokenCache();
		if (browser) {
			clearOfflineSessionSnapshot();
			await clearCachedSessionData();
			window.dispatchEvent(new CustomEvent('auth-session-refreshed'));
			try {
				await clearOrderNotificationRegistration();
			} catch {
				// Storage can be unavailable; deleting the server session still revokes push delivery.
			}
			try {
				await fetchWithCsrfRetry('/api/logout', {
					method: 'POST',
					headers: {}
				});
			} catch {
				// Offline logout still clears local credentials; the server session expires independently.
			}
			localStorage.removeItem('selectedBranch');
		}
	}
};

export async function loginWithUsername(username: string, password: string, branch: string) {
	const res = await fetchWithCsrfRetry('/api/veriflogin', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password, branch })
	});
	const result = await res.json().catch(() => ({}));
	if (!res.ok || !result.success) {
		reportApiFailure(result, res.status, '/api/veriflogin');
		throw new Error(getApiErrorMessage(result, res.status, 'Login gagal'));
	}
	if (browser) await clearCachedSessionData();
	// Server rotated the CSRF cookie with the new session; drop the pre-login token.
	clearCsrfTokenCache();

	// Kunci halaman PIN hanya berlaku untuk kasir.
	if (result.user.role === 'kasir') {
		try {
			const qs = new URLSearchParams({ branch }).toString();
			const settingsRes = await fetch(`/api/pengaturan?${qs}`);
			const settingsData = settingsRes.ok ? await settingsRes.json() : null;
			const row = Array.isArray(settingsData) ? settingsData[0] : null;
			if (row) {
				const isConfigured = row.pinConfigured === true;
				setSecuritySettings({
					lockedPages: isConfigured ? row.halaman_terkunci || [] : [],
					pinConfigured: isConfigured
				});
			} else {
				setSecuritySettings({ lockedPages: [], pinConfigured: false });
			}
		} catch {
			setSecuritySettings({ lockedPages: [], pinConfigured: false });
		}
	} else {
		clearSecuritySettings();
	}

	// Peran diset SETELAH security settings agar guard halaman tidak membaca kunci kosong.
	setUserRole(result.user.role, result.user);

	if (browser) {
		// Only an explicit session transition invalidates concurrent validators, not a routine refresh.
		clearOfflineSessionSnapshot();
		persistOfflineSessionSnapshot(result.user, Number(result.session?.expiresAt));
		localStorage.setItem('selectedBranch', branch);
		window.dispatchEvent(new CustomEvent('auth-session-refreshed'));
	}

	return result.user;
}
