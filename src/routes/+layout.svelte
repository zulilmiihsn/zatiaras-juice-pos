<script lang="ts">
	import '../app.css';
	import Topbar from '$lib/components/shared/topBar.svelte';
	import BottomNav from '$lib/components/shared/bottomNav.svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { onMount, onDestroy, type Snippet } from 'svelte';
	import { goto, invalidateAll, onNavigate } from '$app/navigation';
	import { navigating } from '$app/stores';
	import Download from '@lucide/svelte/icons/download';
	import { posGridView } from '$lib/stores/posGridView.svelte';
	import { auth } from '$lib/auth/auth';
	import { userRole, userProfile } from '$lib/stores/userRole.svelte';
	import { transactionService } from '$lib/services/transactionService';
	import PinModal from '$lib/components/shared/pinModal.svelte';
	import { securitySettings, setSecuritySettings } from '$lib/stores/securitySettings.svelte';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import { requireAuth } from '$lib/utils/authGuard';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createLayoutState } from '$lib/stores/layoutState.svelte';
	import { verifyPagePin } from '$lib/services/pinAccessService';
	import { refreshBus } from '$lib/utils/refreshBus';
	import PendingTransactionsSheet from '$lib/components/shared/PendingTransactionsSheet.svelte';

	let { children }: { children: Snippet } = $props();

	const layoutSt = createLayoutState();
	let showPendingTransactions = $state(false);
	onDestroy(() => layoutSt.dispose());

	// [CATATAN]: ── Navigasi & View Transitions ──────────────────────────────────────────
	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		return new Promise((resolve) => {
			try {
				const transition = document.startViewTransition(async () => {
					resolve();
					await navigation.complete;
				});
				transition.finished.catch(() => {});
			} catch {
				resolve();
			}
		});
	});

	let showNav = $state(true);
	$effect(() => {
		const path = $page.url.pathname;
		const noNavRoutes = ['/login', '/unauthorized', '/pos/bayar', '/offline'];
		showNav = !(noNavRoutes.includes(path) || path.startsWith('/pengaturan'));
	});

	// [CATATAN]: ── PIN Modal ─────────────────────────────────────────────────────────────
	let showPinModal = $state(false);
	let currentLockedPage = $state<'beranda' | 'laporan' | 'pengaturan' | 'catat'>('beranda');
	let pinUnlockedForCurrentPage = false;
	let lastPath = '';
	let isLoadingSecuritySettings = false;
	let securityRefreshCounter = $state(0);
	let securityRequestGen = 0;
	let securityRefreshQueued = false;

	function settingsEqual(
		a: { lockedPages: string[] | null; pinConfigured?: boolean } | null,
		b: { lockedPages: string[] | null; pinConfigured?: boolean } | null
	): boolean {
		if (a === b) return true;
		if (!a || !b) return false;
		if (Boolean(a.pinConfigured) !== Boolean(b.pinConfigured)) return false;
		const al = a.lockedPages ?? [];
		const bl = b.lockedPages ?? [];
		return al.length === bl.length && al.every((v, i) => v === bl[i]);
	}

	async function loadKasirSecuritySettings() {
		// Identitas sesi penuh: perubahan apa pun menginvalidasi request lama.
		const identityAtStart = securityIdentity();
		if (isLoadingSecuritySettings) {
			// Jangan hilangkan refresh cabang baru: antrekan lalu mulai sesudah in-flight.
			securityRefreshQueued = true;
			return;
		}
		isLoadingSecuritySettings = true;
		const gen = ++securityRequestGen;
		try {
			const data = (await transactionService.getOne('pengaturan')) as {
				halaman_terkunci?: string[];
				pinConfigured?: boolean;
			} | null;
			// Buang hasil basi sesi/cabang lain; antrekan refresh identitas terbaru.
			if (gen !== securityRequestGen || securityIdentity() !== identityAtStart) {
				securityRefreshQueued = true;
				return;
			}
			if (data) {
				const isConfigured = data.pinConfigured === true;
				const next = {
					lockedPages: isConfigured ? data.halaman_terkunci || [] : [],
					pinConfigured: isConfigured
				};
				if (!settingsEqual(securitySettings.value, next)) setSecuritySettings(next);
			}
		} catch {
			// [CATATAN]: no-op
		} finally {
			if (gen === securityRequestGen) isLoadingSecuritySettings = false;
			if (securityRefreshQueued) {
				securityRefreshQueued = false;
				void loadKasirSecuritySettings();
			}
		}
	}

	function securityIdentity(): string {
		const profile = userProfile.value as { username?: unknown; id?: unknown } | null;
		const user =
			typeof profile?.username === 'string'
				? profile.username
				: typeof profile?.id === 'string'
					? profile.id
					: '';
		return `${userRole.value || ''}|${selectedBranch.value || ''}|${user}`;
	}

	function mapLockedNameToPath(name: string): string {
		if (!name) return '';
		const lowered = name.toLowerCase();
		if (lowered === 'beranda' || lowered === 'home') return '/';
		return `/${lowered}`;
	}

	$effect(() => {
		if ($navigating) pinUnlockedForCurrentPage = false;
	});

	// Effect fetch: hanya identitas sesi/role/cabang + sinyal refresh eksplisit.
	// Sengaja TIDAK membaca securitySettings.value agar tulis store tidak memicu fetch lagi.
	$effect(() => {
		if (!browser) return;
		const role = userRole.value;
		const branch = selectedBranch.value;
		const sessionUser = (userProfile.value as { username?: unknown } | null)?.username ?? '';
		void sessionUser;
		void securityRefreshCounter;
		if (role === 'kasir' && branch) {
			void loadKasirSecuritySettings();
		}
	});

	// Effect tampilan: baca settings + path tanpa fetch.
	$effect(() => {
		const currentUserRole = userRole.value;
		const currentSecuritySettings = securitySettings.value;
		const currentPath = $page.url.pathname;
		if (currentPath !== lastPath) {
			pinUnlockedForCurrentPage = false;
			lastPath = currentPath;
		}
		const isPinConfigured = currentSecuritySettings?.pinConfigured === true;
		const lockedPage = isPinConfigured
			? currentSecuritySettings?.lockedPages?.find((lockedPageName) => {
					const fullLockedPath = mapLockedNameToPath(lockedPageName);
					if (!fullLockedPath) return false;
					if (fullLockedPath === '/') return currentPath === '/';
					return currentPath === fullLockedPath || currentPath.startsWith(fullLockedPath + '/');
				})
			: null;
		const normalizedLockedPage = lockedPage?.toLowerCase();
		const isCurrentPageLocked = Boolean(lockedPage);
		if (currentUserRole === 'kasir' && isCurrentPageLocked && !pinUnlockedForCurrentPage) {
			currentLockedPage =
				normalizedLockedPage === 'home'
					? 'beranda'
					: (normalizedLockedPage as typeof currentLockedPage);
			showPinModal = true;
		} else {
			showPinModal = false;
		}
	});

	async function handlePinSuccess() {
		pinUnlockedForCurrentPage = true;
		showPinModal = false;
		securityRefreshCounter++;
		await invalidateAll();
		refreshBus.emit('dashboard');
		if (browser) {
			window.dispatchEvent(
				new CustomEvent('page-unlocked', { detail: { page: currentLockedPage } })
			);
		}
	}

	function handlePinError(_detail: { message: string }) {}

	function handlePinClose() {
		showPinModal = false;
		if (!pinUnlockedForCurrentPage) {
			goto('/pos');
		}
	}

	onMount(async () => {
		await layoutSt.setupPwa();
		const publicRoutes = ['/login', '/offline', '/unauthorized'];
		if (!publicRoutes.includes($page.url.pathname) && !(await requireAuth())) return;
		layoutSt.setupWindowListeners();
	});
</script>

{#if layoutSt.pendingCount > 0}
	<div
		class="animate-fade-in z-fab fixed right-3 bottom-3 left-3 mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-stone-700 bg-[#282423] px-4 py-3 text-white shadow-xl"
		data-testid="pending-transaction-banner"
	>
		{#if layoutSt.isOffline}
			<WifiOff class="h-5 w-5 shrink-0 text-amber-300" />
		{:else}
			<RefreshCw
				class="h-5 w-5 shrink-0 text-[#e6a8b7] {layoutSt.isPendingSyncing ? 'animate-spin' : ''}"
			/>
		{/if}
		<div class="min-w-0 flex-1">
			<div class="text-sm font-bold">{layoutSt.pendingCount} transaksi belum tersinkron</div>
			<div class="text-xs text-stone-300">
				{layoutSt.isOffline
					? 'Menunggu koneksi internet'
					: layoutSt.pendingFailedCount > 0
						? `${layoutSt.pendingFailedCount} transaksi perlu dicoba ulang`
						: layoutSt.isPendingSyncing
							? 'Sedang mengirim transaksi'
							: 'Siap dikirim'}
			</div>
		</div>
		<div class="flex shrink-0 gap-2">
			<button
				type="button"
				class="rounded-lg border border-stone-500 px-3 py-2 text-xs font-bold text-white transition-transform duration-200 active:scale-[0.98]"
				onclick={() => (showPendingTransactions = true)}
			>
				Detail
			</button>
			<button
				type="button"
				class="rounded-lg bg-white px-3 py-2 text-xs font-bold text-stone-900 transition-transform duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				disabled={layoutSt.isOffline || layoutSt.isPendingSyncing}
				onclick={layoutSt.retryPendingTransactions}
			>
				{layoutSt.isPendingSyncing ? 'Mengirim' : 'Sinkronkan'}
			</button>
		</div>
	</div>
{/if}

<PendingTransactionsSheet
	open={showPendingTransactions}
	transactions={layoutSt.pendingTransactions}
	isOffline={layoutSt.isOffline}
	isSyncing={layoutSt.isPendingSyncing}
	canRemove={userRole.value === 'pemilik' || userRole.value === 'admin'}
	onClose={() => (showPendingTransactions = false)}
	onRetry={layoutSt.retryOnePendingTransaction}
	onRetryAll={layoutSt.retryPendingTransactions}
	onRemove={layoutSt.removeOnePendingTransaction}
/>

{#if layoutSt.toastManager.showToast}
	<ToastNotification
		show={layoutSt.toastManager.showToast}
		message={layoutSt.toastManager.toastMessage}
		type={layoutSt.toastManager.toastType}
	/>
{/if}

{#if showNav}
	<div class="page-transition flex min-h-[100dvh] flex-col bg-[#faf7f8]">
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render children()}
		</div>
		{#if showPinModal}
			<PinModal
				show={showPinModal}
				title="Akses Terkunci"
				subtitle="Masukkan PIN untuk mengakses halaman ini"
				onVerify={(pin) => verifyPagePin(pin, currentLockedPage)}
				onSuccess={handlePinSuccess}
				onError={handlePinError}
				onClose={handlePinClose}
			/>
		{/if}
		<div class="z-fab sticky bottom-0 overflow-visible md:pointer-events-none md:px-4">
			<div class="md:pointer-events-auto">
				<BottomNav />
			</div>
		</div>
	</div>
{:else}
	<div class="page-transition flex min-h-[100dvh] flex-col bg-[#faf7f8]">
		<div class="min-h-0 flex-1 overflow-y-auto">
			{@render children()}
		</div>
		{#if showPinModal}
			<PinModal
				show={showPinModal}
				title="Akses Terkunci"
				subtitle="Masukkan PIN untuk mengakses halaman ini"
				onVerify={(pin) => verifyPagePin(pin, currentLockedPage)}
				onSuccess={handlePinSuccess}
				onError={handlePinError}
				onClose={handlePinClose}
			/>
		{/if}
	</div>
{/if}

<svelte:head>
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, maximum-scale=5, minimum-scale=1"
	/>
	<title>ZatiarasPOS</title>
</svelte:head>

<style>
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.animate-fade-in {
		animation: fade-in 0.4s ease;
	}

	:global(html) {
		touch-action: manipulation;
		-webkit-text-size-adjust: 100%;
		-ms-text-size-adjust: 100%;
	}
	:global(body) {
		touch-action: manipulation;
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		-khtml-user-select: none;
		-moz-user-select: none;
		-ms-user-select: none;
		user-select: none;
	}
	:global(input, textarea, [contenteditable]) {
		-webkit-user-select: text;
		-khtml-user-select: text;
		-moz-user-select: text;
		-ms-user-select: text;
		user-select: text;
	}
</style>
