import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { setUserRole, clearUserRole } from '$lib/stores/userRole.svelte';
type BranchKey = string;
import { setSecuritySettings, clearSecuritySettings } from '$lib/stores/securitySettings.svelte';
import { clearCsrfTokenCache, fetchWithCsrfRetry } from '$lib/utils/csrf';
import { getApiErrorMessage, reportApiFailure } from '$lib/utils/errorHandling';
import {
	clearOfflineSessionSnapshot,
	persistOfflineSessionSnapshot,
	readOfflineSessionSnapshot
} from './offlineSession';

// [CATATAN]: Session store
export const session = writable<{
	isAuthenticated: boolean;
	user: unknown;
	token: unknown;
	expiresAt?: number;
}>({
	isAuthenticated: false,
	user: null,
	token: null
});

if (typeof window !== 'undefined') {
	const saved = readOfflineSessionSnapshot();
	if (saved) session.set(saved);
}

// [CATATAN]: Authentication functions
export const auth = {
	// [CATATAN]: Check if user is authenticated
	isAuthenticated(): boolean {
		const currentSession = get(session) as {
			role?: string;
			id?: string;
			isAuthenticated?: boolean;
		} | null;
		return Boolean(currentSession?.isAuthenticated);
	},

	// [CATATAN]: Get current user
	getCurrentUser() {
		const currentSession = get(session);
		return currentSession?.user || null;
	},

	// [CATATAN]: Check if user has specific role
	hasRole(role: string): boolean {
		const user = this.getCurrentUser();
		return (user as { role?: string })?.role === role;
	},

	// [CATATAN]: Logout function
	async logout() {
		if (browser) {
			try {
				await fetchWithCsrfRetry('/api/logout', {
					method: 'POST',
					headers: {}
				});
			} catch {
				// [CATATAN]: no-op
			}
		}

		// [CATATAN]: Clear session store
		session.set({
			isAuthenticated: false,
			user: null,
			token: null
		});

		// [CATATAN]: Clear localStorage
		if (typeof window !== 'undefined') {
			clearOfflineSessionSnapshot();
			localStorage.removeItem('selectedBranch');
		}

		// [CATATAN]: Clear user role and profile
		clearUserRole();
		clearSecuritySettings();
		clearCsrfTokenCache();
	}
};

export async function loginWithUsername(username: string, password: string, branch: BranchKey) {
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

	// [CATATAN]: Jika peran adalah 'kasir', ambil pengaturan keamanan
	if (result.user.role === 'kasir') {
		try {
			const qs = new URLSearchParams({ branch }).toString();
			const settingsRes = await fetch(`/api/pengaturan?${qs}`);
			const settingsData = settingsRes.ok ? await settingsRes.json() : null;
			const row = Array.isArray(settingsData) ? settingsData[0] : null;
			if (row) {
				setSecuritySettings({ lockedPages: row.halaman_terkunci || [] });
			} else {
				setSecuritySettings({ lockedPages: [] });
			}
		} catch {
			setSecuritySettings({ lockedPages: [] });
		}
	} else {
		clearSecuritySettings();
	}

	// [CATATAN]: Set user role dan profile ke store SETELAH security settings
	setUserRole(result.user.role, result.user);

	// [CATATAN]: Tidak perlu reset/fetch cache apapun

	// [CATATAN]: Simpan session ke store dan localStorage
	const sessionData = {
		isAuthenticated: true,
		user: result.user,
		token: null,
		expiresAt: Number(result.session?.expiresAt)
	};
	session.set(sessionData);

	// [CATATAN]: Simpan ke localStorage untuk persistensi setelah refresh
	if (typeof window !== 'undefined') {
		persistOfflineSessionSnapshot(result.user, sessionData.expiresAt);
		localStorage.setItem('selectedBranch', branch);
		window.dispatchEvent(new CustomEvent('auth-session-refreshed'));
	}

	return result.user;
}
