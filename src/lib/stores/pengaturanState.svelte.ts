import { isOwnerRole, isKasirRole } from '$lib/utils/roles';
import { goto } from '$app/navigation';
import { auth } from '$lib/auth/auth';
import { userRole, setUserRole } from '$lib/stores/userRole.svelte';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { browser } from '$app/environment';
import { createToastManager } from '$lib/utils/ui';
import Crown from '@lucide/svelte/icons/crown';
import CreditCard from '@lucide/svelte/icons/credit-card';
import User from '@lucide/svelte/icons/user';

export function createPengaturanState() {
	const toastManager = createToastManager();
	let isPwaLibraryLoaded = $state(false);
	let isLoading = $state(true);
	let isProfileLoaded = $state(false);
	let showLogoutModal = $state(false);

	const currentUserRole = $derived(userRole.value || '');
	const roleIcon = $derived(
		isOwnerRole(currentUserRole) ? Crown : isKasirRole(currentUserRole) ? CreditCard : User
	);

	function showNotif(message: string) {
		toastManager.showToastNotification(message, 'warning');
	}

	function handleLogout() {
		showLogoutModal = true;
	}

	async function confirmLogout() {
		await auth.logout();
		goto('/login');
	}

	function cancelLogout() {
		showLogoutModal = false;
	}

	function handleInstallPWA() {
		if (browser && isPwaLibraryLoaded) {
			const pwaInstall = document.querySelector('pwa-install') as
				(HTMLElement & { showDialog: (show: boolean) => void }) | null;
			if (pwaInstall) {
				pwaInstall.showDialog(true);
			}
		}
	}

	async function init() {
		try {
			if (!currentUserRole) {
				const res = await fetch('/api/session');
				if (res.ok) {
					const session = await res.json();
					if (session?.user) setUserRole(session.user.role, session.user);
				}
			}

			isProfileLoaded = true;

			if (typeof window !== 'undefined') {
				window.addEventListener('appinstalled', () => {
					toastManager.showToastNotification(
						'Aplikasi berhasil terpasang di Home Screen!',
						'success',
						4000
					);
				});
			}

			if (browser) {
				try {
					await import('@khmyznikov/pwa-install');
					isPwaLibraryLoaded = true;

					setTimeout(() => {
						const pwaInstall = document.querySelector('pwa-install');
						if (pwaInstall && pwaInstall.shadowRoot) {
							const style = document.createElement('style');
							style.textContent = `
								.header, [part="header"], div[class*="header"] {
									background-color: #FFB6C1 !important;
								}
							`;
							pwaInstall.shadowRoot.appendChild(style);
						}
					}, 500);
				} catch (error) {
					console.error('Failed to load PWA install library:', error);
				}
			}

			isLoading = false;
		} catch (error) {
			ErrorHandler.logError(error, 'loadPengaturanPage');
		}
	}

	return {
		get isPwaLibraryLoaded() {
			return isPwaLibraryLoaded;
		},
		get isLoading() {
			return isLoading;
		},
		get isProfileLoaded() {
			return isProfileLoaded;
		},
		get showLogoutModal() {
			return showLogoutModal;
		},
		toastManager,
		get currentUserRole() {
			return currentUserRole;
		},
		get roleIcon() {
			return roleIcon;
		},
		showNotif,
		handleLogout,
		confirmLogout,
		cancelLogout,
		handleInstallPWA,
		init
	};
}
