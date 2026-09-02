import { browser } from '$app/environment';

interface SecuritySettings {
	lockedPages: string[] | null;
}

// [CATATAN]: Initialize store with data from localStorage if available
const initialValue = browser
	? (() => {
			try {
				const saved = localStorage.getItem('zatiaras_security_settings');
				if (!saved) return null;

				const parsed = JSON.parse(saved);
				return {
					lockedPages: Array.isArray(parsed?.lockedPages) ? parsed.lockedPages : null
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

export function setSecuritySettings(settings: SecuritySettings) {
	securitySettings.value = settings;
	// [CATATAN]: Persist to localStorage
	if (browser) {
		try {
			localStorage.setItem(
				'zatiaras_security_settings',
				JSON.stringify({
					lockedPages: settings.lockedPages
				})
			);
		} catch (e) {
			console.error('Error saving security settings to localStorage:', e);
		}
	}
}

export function clearSecuritySettings() {
	securitySettings.value = null;
	// [CATATAN]: Clear from localStorage
	if (browser) {
		try {
			localStorage.removeItem('zatiaras_security_settings');
		} catch (e) {
			console.error('Error clearing security settings from localStorage:', e);
		}
	}
}
