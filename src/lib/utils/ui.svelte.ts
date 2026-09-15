import { NOTIF } from '$lib/constants/ui';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export function createToastManager() {
	let show = $state(false);
	let message = $state('');
	let type = $state<ToastType>('success');
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function clearTimer() {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
	}

	function showToastNotification(
		value: string,
		nextType: ToastType = 'success',
		duration: number = NOTIF.TOAST_MS
	) {
		message = value;
		type = nextType;
		show = true;
		clearTimer();
		if (duration > 0) {
			timeout = setTimeout(() => {
				show = false;
				timeout = null;
			}, duration);
		}
	}

	function hideToast() {
		show = false;
		clearTimer();
	}

	function dispose() {
		clearTimer();
	}

	return {
		get showToast() {
			return show;
		},
		get toastMessage() {
			return message;
		},
		get toastType() {
			return type;
		},
		showToastNotification,
		hideToast,
		dispose
	};
}
