import { browser } from '$app/environment';
import type { ProtectedPage } from '$lib/server/pageAccess';

interface SecuritySettings {
	lockedPages: string[] | null;
	pinConfigured?: boolean;
}

// Initialize store with data from localStorage if available
const initialValue = browser
	? (() => {
			try {
				const saved = localStorage.getItem('zatiaras_security_settings');
				if (!saved) return null;

				const parsed = JSON.parse(saved);
				const isPinConfigured = parsed?.pinConfigured === true;
				return {
					lockedPages:
						isPinConfigured && Array.isArray(parsed?.lockedPages) ? parsed.lockedPages : [],
					pinConfigured: isPinConfigured
				} as SecuritySettings;
			} catch (e) {
				console.error('Error parsing security settings from localStorage:', e);
				return null;
			}
		})()
	: null;

class SecuritySettingsState {
	value = $state<SecuritySettings | null>(initialValue);
}
export const securitySettings = new SecuritySettingsState();

class PinAccessState {
	value = $state<{ identity: string; expiresAt: number } | null>(null);
	request = $state<{
		identity: string;
		path: string;
		page: ProtectedPage;
		complete: (verified: boolean) => void;
	} | null>(null);
}
export const pinAccess = new PinAccessState();

export function setSecuritySettings(settings: SecuritySettings) {
	securitySettings.value = settings;
	// Persist to localStorage
	if (browser) {
		try {
			localStorage.setItem(
				'zatiaras_security_settings',
				JSON.stringify({
					lockedPages: settings.lockedPages,
					pinConfigured: settings.pinConfigured
				})
			);
		} catch (e) {
			console.error('Error saving security settings to localStorage:', e);
		}
	}
}

export function clearSecuritySettings() {
	securitySettings.value = null;
	pinAccess.value = null;
	pinAccess.request?.complete(false);
	pinAccess.request = null;
	// Clear from localStorage
	if (browser) {
		try {
			localStorage.removeItem('zatiaras_security_settings');
		} catch (e) {
			console.error('Error clearing security settings from localStorage:', e);
		}
	}
}
