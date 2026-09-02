import { goto } from '$app/navigation';
import { loadRouteIcons } from '$lib/utils/iconLoader';
import { auth } from '$lib/auth/auth';
import { userRole, setUserRole } from '$lib/stores/userRole.svelte';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { browser } from '$app/environment';
import { NOTIF } from '$lib/constants/ui';
import Crown from '@lucide/svelte/icons/crown';
import CreditCard from '@lucide/svelte/icons/credit-card';
import User from '@lucide/svelte/icons/user';
import type { Component } from 'svelte';

type IconComponent = Component<Record<string, unknown>>;

export function createPengaturanState() {
	let isPwaLibraryLoaded = $state(false);
	let isLoading = $state(true);
	let isProfileLoaded = $state(false);
	let showLogoutModal = $state(false);
	let showPwaInstalledToast = $state(false);
	let showNotification = $state(false);
	let notificationMessage = $state('');
	let notificationTimeout: ReturnType<typeof setTimeout> | null = null;

	let LogOut = $state<IconComponent | null>(null);
	let Shield = $state<IconComponent | null>(null);
	let Palette = $state<IconComponent | null>(null);
	let Database = $state<IconComponent | null>(null);
	let HelpCircle = $state<IconComponent | null>(null);
	let Settings = $state<IconComponent | null>(null);
	let Bell = $state<IconComponent | null>(null);
	let Download = $state<IconComponent | null>(null);
	let Printer = $state<IconComponent | null>(null);
	let History = $state<IconComponent | null>(null);

	const currentUserRole = $derived(userRole.value || '');
	const roleIcon = $derived(
		currentUserRole === 'admin' || currentUserRole === 'pemilik'
			? Crown
			: currentUserRole === 'kasir'
				? CreditCard
				: User
	);

	function showNotif(message: string) {
		notificationMessage = message;
		showNotification = true;
		if (notificationTimeout !== null) clearTimeout(notificationTimeout);
		notificationTimeout = setTimeout(() => {
			showNotification = false;
		}, NOTIF.TOAST_MS);
	}

	function handleLogout() {
		showLogoutModal = true;
	}

	function confirmLogout() {
		auth.logout();
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
		loadRouteIcons('pengaturan');
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
					showPwaInstalledToast = true;
					setTimeout(() => (showPwaInstalledToast = false), 4000);
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

			LogOut = (await import('@lucide/svelte/icons/log-out')).default as unknown as IconComponent;
			Shield = (await import('@lucide/svelte/icons/shield')).default as unknown as IconComponent;
			Palette = (await import('@lucide/svelte/icons/palette')).default as unknown as IconComponent;
			Database = (await import('@lucide/svelte/icons/database'))
				.default as unknown as IconComponent;
			HelpCircle = (await import('@lucide/svelte/icons/help-circle'))
				.default as unknown as IconComponent;
			Settings = (await import('@lucide/svelte/icons/settings'))
				.default as unknown as IconComponent;
			Bell = (await import('@lucide/svelte/icons/bell')).default as unknown as IconComponent;
			Download = (await import('@lucide/svelte/icons/download'))
				.default as unknown as IconComponent;
			Printer = (await import('@lucide/svelte/icons/printer')).default as unknown as IconComponent;
			History = (await import('@lucide/svelte/icons/history')).default as unknown as IconComponent;
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
		get showPwaInstalledToast() {
			return showPwaInstalledToast;
		},
		get showNotification() {
			return showNotification;
		},
		get notificationMessage() {
			return notificationMessage;
		},
		get currentUserRole() {
			return currentUserRole;
		},
		get roleIcon() {
			return roleIcon;
		},
		get LogOut() {
			return LogOut;
		},
		get Shield() {
			return Shield;
		},
		get Palette() {
			return Palette;
		},
		get Database() {
			return Database;
		},
		get HelpCircle() {
			return HelpCircle;
		},
		get Settings() {
			return Settings;
		},
		get Bell() {
			return Bell;
		},
		get Download() {
			return Download;
		},
		get Printer() {
			return Printer;
		},
		get History() {
			return History;
		},
		showNotif,
		handleLogout,
		confirmLogout,
		cancelLogout,
		handleInstallPWA,
		init
	};
}
