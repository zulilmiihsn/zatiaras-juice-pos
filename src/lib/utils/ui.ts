/**
 * UI utilities untuk komponen Svelte
 */
import { NOTIF } from '$lib/constants/ui';

// [CATATAN]: Toast management utility to reduce code duplication
export function createToastManager() {
	// [CATATAN]: Create reactive stores for toast state
	const toastState = {
		show: false,
		message: '',
		type: 'success' as 'success' | 'error' | 'warning' | 'info',
		timeout: null as number | null
	};

	function showToastNotification(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success',
		duration: number = NOTIF.TOAST_MS
	) {
		toastState.message = message;
		toastState.type = type;
		toastState.show = true;

		// [CATATAN]: Clear existing timeout
		if (toastState.timeout) {
			clearTimeout(toastState.timeout);
		}

		// [CATATAN]: Auto hide after duration
		toastState.timeout = Number(
			setTimeout(() => {
				toastState.show = false;
				toastState.timeout = null;
			}, duration)
		);
	}

	function hideToast() {
		toastState.show = false;
		if (toastState.timeout) {
			clearTimeout(toastState.timeout);
			toastState.timeout = null;
		}
	}

	// [CATATAN]: Return an object with reactive properties
	return {
		get showToast() {
			return toastState.show;
		},
		get toastMessage() {
			return toastState.message;
		},
		get toastType() {
			return toastState.type;
		},
		showToastNotification,
		hideToast
	};
}
