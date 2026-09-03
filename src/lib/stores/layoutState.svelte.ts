import { page } from '$app/state';
import { userRole } from '$lib/stores/userRole.svelte';
import { productService } from '$lib/services/productService';
import { dashboardService } from '$lib/services/dashboardService';
import { syncPendingTransactions } from '$lib/services/offlineSync';
import {
	getPendingTransactions,
	removePendingTransaction,
	retryFailedPendingTransactions,
	retryPendingTransaction
} from '$lib/utils/offline';
import type { PendingTransaction } from '$lib/utils/offlineQueue';
import { createToastManager } from '$lib/utils/ui';
import type { Workbox as WorkboxInstance } from 'workbox-window';

export function createLayoutState() {
	// [CATATAN]: ── PWA ──────────────────────────────────────────────────────────────────
	let showUpdateNotification = $state(false);
	let pwaWorkbox: WorkboxInstance | null = null;

	// [CATATAN]: ── Offline / pending sync ────────────────────────────────────────────────
	let hasPrefetchedMenu = false;
	let hasPrefetchedOwnerInsights = false;
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);
	let pendingCount = $state(0);
	let pendingFailedCount = $state(0);
	let pendingTransactions = $state<PendingTransaction[]>([]);
	let isPendingSyncing = $state(false);
	const toastManager = createToastManager();

	async function updatePending() {
		const pending = await getPendingTransactions();
		pendingTransactions = pending;
		pendingCount = pending.length;
		pendingFailedCount = pending.filter((item) => item.status === 'failed').length;
	}

	async function retryPendingTransactions() {
		if (isOffline || isPendingSyncing) return;
		isPendingSyncing = true;
		try {
			await retryFailedPendingTransactions(['network', 'rate_limit', 'server']);
			await syncPendingTransactions({ force: true });
			await updatePending();
		} finally {
			isPendingSyncing = false;
		}
	}

	async function retryOnePendingTransaction(queueId: string) {
		if (isOffline || isPendingSyncing) return;
		isPendingSyncing = true;
		try {
			await retryPendingTransaction(queueId);
			await syncPendingTransactions({ force: true, queueIds: [queueId] });
			await updatePending();
		} finally {
			isPendingSyncing = false;
		}
	}

	async function removeOnePendingTransaction(queueId: string) {
		await removePendingTransaction(queueId);
		await updatePending();
	}

	function scheduleIdleTask(task: () => void, timeout = 1200) {
		const win = window as unknown as {
			requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
		};
		if (typeof win.requestIdleCallback === 'function') {
			win.requestIdleCallback(task, { timeout });
		} else {
			setTimeout(task, timeout);
		}
	}

	function shouldPrefetchOwnerInsights() {
		const role = userRole.value;
		const isOwner = role === 'pemilik' || role === 'admin';
		const path = page.url.pathname;
		return isOwner && (path === '/' || path.startsWith('/laporan'));
	}

	async function prefetchMenuData() {
		if (hasPrefetchedMenu || !navigator.onLine) return;
		hasPrefetchedMenu = true;
		try {
			await Promise.all([
				productService.getProducts(),
				productService.getCategories(),
				productService.getAddOns()
			]);
		} catch {}
	}

	async function prefetchOwnerInsights() {
		if (hasPrefetchedOwnerInsights || !navigator.onLine || !shouldPrefetchOwnerInsights()) return;
		hasPrefetchedOwnerInsights = true;
		try {
			const today = new Date();
			const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
			await Promise.all([
				dashboardService.getBestSellers(),
				dashboardService.getWeeklyIncome(),
				dashboardService.getReportData(currentMonth, 'monthly')
			]);
		} catch {}
	}

	async function setupPwa() {
		if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
		try {
			const { Workbox } = await import('workbox-window');
			const wb = new Workbox('/sw.js');
			pwaWorkbox = wb;
			wb.addEventListener('waiting', () => {
				showUpdateNotification = true;
			});
			wb.addEventListener('controlling', () => {
				window.location.reload();
			});
			await wb.register();
		} catch (error) {
			console.log('PWA registration failed:', error);
		}
	}

	function setupWindowListeners() {
		isOffline = !navigator.onLine;
		updatePending();
		scheduleIdleTask(() => {
			void prefetchMenuData();
			void prefetchOwnerInsights();
		});
		window.addEventListener('offline', () => {
			isOffline = true;
		});
		window.addEventListener('online', () => {
			isOffline = false;
			updatePending();
			scheduleIdleTask(() => {
				void prefetchMenuData();
				void prefetchOwnerInsights();
			});
		});
		window.addEventListener('storage', () => {
			updatePending();
		});
		window.addEventListener('pending-synced', () => {
			toastManager.showToastNotification(
				'Transaksi offline berhasil dikirim ke server!',
				'success'
			);
			updatePending();
		});
		window.addEventListener('pending-sync-start', () => {
			isPendingSyncing = true;
		});
		window.addEventListener('pending-sync-result', () => {
			isPendingSyncing = false;
			void updatePending();
		});
		window.addEventListener('pending-changed', updatePending);
	}

	async function applyUpdate() {
		if (pwaWorkbox && import.meta.env.PROD) {
			try {
				pwaWorkbox.messageSkipWaiting();
			} catch (error) {
				console.log('Failed to apply update:', error);
			}
		}
	}

	function dismissUpdate() {
		showUpdateNotification = false;
	}

	return {
		get showUpdateNotification() {
			return showUpdateNotification;
		},
		get isOffline() {
			return isOffline;
		},
		get pendingCount() {
			return pendingCount;
		},
		get pendingFailedCount() {
			return pendingFailedCount;
		},
		get pendingTransactions() {
			return pendingTransactions;
		},
		get isPendingSyncing() {
			return isPendingSyncing;
		},
		toastManager,
		setupPwa,
		setupWindowListeners,
		updatePending,
		retryPendingTransactions,
		retryOnePendingTransaction,
		removeOnePendingTransaction,
		scheduleIdleTask,
		prefetchMenuData,
		prefetchOwnerInsights,
		applyUpdate,
		dismissUpdate
	};
}
