<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { auth } from '$lib/auth/auth';
	import { browser } from '$app/environment';
	import { createSwipeNavigation } from '$lib/utils/touchNavigation';
	import { userRole, userProfile, setUserRole } from '$lib/stores/userRole.svelte';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import { realtimeManager } from '$lib/realtime/realtimeManager';
	import { reportCacheMetrics } from '$lib/utils/cacheMetrics';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { getNowWita } from '$lib/utils/dateTime';
	import PinModal from '$lib/components/shared/pinModal.svelte';
	import { verifyPagePin } from '$lib/services/pinAccessService';
	import DashboardMetrics from '$lib/components/dashboard/DashboardMetrics.svelte';
	import WeeklyChart from '$lib/components/dashboard/WeeklyChart.svelte';
	import TokoModal from '$lib/components/dashboard/TokoModal.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { getSesiAktif } from '$lib/services/sesiTokoService';
	import { refreshBus } from '$lib/utils/refreshBus';

	import type { DashboardStats, WeeklyIncomeData, BestSeller, TokoSession } from '$lib/types';
	import type { ComponentType } from 'svelte';

	// Lazy load icons — assigned in onMount, consumed by DashboardMetrics via svelte:component
	let Wallet = $state<ComponentType | null>(null);
	let ShoppingBag = $state<ComponentType | null>(null);
	let Coins = $state<ComponentType | null>(null);
	let Users = $state<ComponentType | null>(null);
	let Clock = $state<ComponentType | null>(null);
	let TrendingUp = $state<ComponentType | null>(null);

	import { createDashboardState } from '$lib/stores/dashboardState.svelte';

	const dashboard = createDashboardState();

	// Subscribe ke store
	let currentUserRole = $state('');

	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	onMount(async () => {
		// Preload ikon untuk halaman beranda agar ikon metrik muncul cepat
		import('$lib/utils/iconLoader').then(({ loadRouteIcons }) => {
			// non-blocking
			loadRouteIcons('dashboard');
			// anticipatory preload ke rute yang sering dituju berikutnya
			setTimeout(() => loadRouteIcons('pos'), 0);
			setTimeout(() => loadRouteIcons('laporan'), 0);
		});
		const icons = await Promise.all([
			import('lucide-svelte/icons/wallet'),
			import('lucide-svelte/icons/shopping-bag'),
			import('lucide-svelte/icons/coins'),
			import('lucide-svelte/icons/users'),
			import('lucide-svelte/icons/clock'),
			import('lucide-svelte/icons/trending-up')
		]);
		Wallet = icons[0].default;
		ShoppingBag = icons[1].default;
		Coins = icons[2].default;
		Users = icons[3].default;
		Clock = icons[4].default;
		TrendingUp = icons[5].default;

		// Jika role belum ada di store, validasi dari session backend.
		if (!currentUserRole) {
			const res = await fetch('/api/session');
			if (res.ok) {
				const session = await res.json();
				if (session?.user) setUserRole(session.user.role, session.user);
			}
		}
	});

	// Manual refresh function (for testing)
	async function refreshDashboardData() {
		await dashboard.refreshDashboardData();
	}

	let modalAwal = $state<number | null>(null);

	const swipeNav = createSwipeNavigation(0); // 0 = Beranda

	let imageError = $state<Record<number, boolean>>({});

	function handleImgError(index: number) {
		imageError[index] = true;
	}

	function getLast7DaysLabelsWITA() {
		const hari = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
		const todayWITA = getTodayWitaDate();
		let labels = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(todayWITA);
			d.setDate(todayWITA.getDate() - i);
			labels.push(hari[d.getDay()]);
		}
		return labels;
	}

	// Toast notification — use shared createToastManager
	const toastManager = createToastManager();

	// Shim for local callers that expect showToastNotification(msg, type)
	function showToastNotification(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success'
	) {
		toastManager.showToastNotification(message, type);
	}

	let showTokoModal = $state(false);
	let isBukaToko = $state(true); // true: buka toko, false: tutup toko
	// Verifikasi PIN untuk aksi kasir (buka/tutup)
	let showActionPinModal = $state(false);
	let modalAwalInput = $state('');
	let pinInputToko = $state('');
	let pinErrorToko = $state('');
	let tokoAktifLocal = $state(false);
	let sesiAktif = $state<TokoSession | null>(null);
	let ringkasanTutup = $state({
		modalAwal: 0,
		totalPenjualan: 0,
		pemasukanTunai: 0,
		pengeluaranTunai: 0,
		uangKasir: 0
	});

	function updateTokoAktif(val: boolean) {
		tokoAktifLocal = val;
	}

	async function cekSesiToko() {
		sesiAktif = await getSesiAktif();
		updateTokoAktif(!!sesiAktif);
		// Update modalAwal agar box di beranda selalu sinkron
		modalAwal = sesiAktif?.kas_awal ?? null;
	}

	onMount(() => {
		cekSesiToko();
		if (browser) {
			window.addEventListener('openTokoModal', handleOpenTokoModal);
		}
	});
	onDestroy(() => {
		if (browser) {
			window.removeEventListener('openTokoModal', handleOpenTokoModal);
		}
	});

	function handleOpenTokoModal() {
		// Jika kasir, wajib verifikasi PIN di server dahulu.
		if (currentUserRole === 'kasir') {
			pendingAction = () => {
				cekSesiToko().then(() => {
					isBukaToko = !tokoAktifLocal;
					showTokoModal = true;
				});
			};
			showActionPinModal = true;
			return;
		}
		// Non-kasir langsung buka modal
		cekSesiToko().then(() => {
			isBukaToko = !tokoAktifLocal;
			showTokoModal = true;
		});
	}

	// Pending action setelah PIN benar
	let pendingAction = $state<(() => void) | null>(null);

	function handleActionPinSuccess() {
		showActionPinModal = false;
		if (pendingAction) pendingAction();
		pendingAction = null;
	}

	function handleActionPinClose() {
		showActionPinModal = false;
		pendingAction = null;
	}

	let hideTopbar = $state(false);
	let topbarRef = $state<HTMLDivElement | null>(null);
	let sentinelRef = $state<HTMLDivElement | null>(null);
	onMount(() => {
		// Observer untuk sticky topbar
		if (sentinelRef && topbarRef) {
			const observer = new window.IntersectionObserver(
				(entries) => {
					hideTopbar = !entries[0].isIntersecting;
				},
				{ threshold: 0 }
			);
			observer.observe(sentinelRef);
		}
	});

	// Fungsi untuk mendapatkan tanggal hari ini WITA (tanpa jam)
	function getTodayWitaDate() {
		// Ambil waktu sekarang di Asia/Makassar (WITA)
		const witaString = getNowWita();
		const witaDate = new Date(witaString);
		witaDate.setHours(0, 0, 0, 0); // Set ke jam 00:00:00
		return witaDate;
	}

	// Inisialisasi range 7 hari terakhir berdasarkan hari WITA
	const todayWitaDate = getTodayWitaDate();
	const sevenDaysAgoWita = new Date(todayWitaDate);
	sevenDaysAgoWita.setDate(todayWitaDate.getDate() - 6); // 6 hari ke belakang + hari ini = 7 hari
</script>

<!-- PinModal removed -->

<!-- Toast Notification -->
<ToastNotification
	show={toastManager.showToast}
	message={toastManager.toastMessage}
	type={toastManager.toastType}
	position="top"
/>

{#if showActionPinModal}
	<PinModal
		show={showActionPinModal}
		title="Verifikasi Aksi"
		subtitle="Masukkan PIN untuk melanjutkan"
		onVerify={(pin) => verifyPagePin(pin, 'beranda')}
		onSuccess={handleActionPinSuccess}
		onClose={handleActionPinClose}
	/>
{/if}

<!-- Modal Buka/Tutup Toko -->
<TokoModal bind:show={showTokoModal} {isBukaToko} {sesiAktif} onTokoStatusChanged={cekSesiToko} />

<!-- Top Bar Status Toko -->
<div class="relative min-h-[64px] w-full overflow-hidden md:mx-0">
	{#key tokoAktifLocal}
		<div
			bind:this={topbarRef}
			class="absolute top-0 left-0 flex w-full items-center justify-between gap-4 bg-gradient-to-r from-pink-400 to-pink-500 px-4 py-3 text-white transition-transform duration-500 ease-in-out"
			style="height:64px"
			in:fly={{ x: -64, duration: 350 }}
			out:fly={{ x: 64, duration: 350 }}
		>
			<div class="flex items-center gap-3">
				<span class="text-3xl md:text-4xl">{tokoAktifLocal ? '🍹' : '🔒'}</span>
				<div class="flex flex-col">
					<span class="text-base font-extrabold tracking-wide md:text-lg"
						>{tokoAktifLocal ? 'Toko Sedang Buka' : 'Toko Sedang Tutup'}</span
					>
					<span class="text-xs opacity-80 md:text-sm"
						>{tokoAktifLocal ? 'Siap melayani pelanggan' : 'Belum menerima transaksi'}</span
					>
				</div>
			</div>
			{#if currentUserRole === ''}
				<div
					class="h-9 min-w-[92px] animate-pulse rounded-lg bg-white/30 px-3 py-2 md:h-10 md:min-w-[110px]"
				></div>
			{:else if currentUserRole === 'kasir' || currentUserRole === 'pemilik'}
				<button
					class="flex h-9 min-w-[92px] items-center gap-2 rounded-lg bg-white/20 px-3 py-2 text-xs font-bold text-white shadow transition-all hover:bg-white/30 active:bg-white/40 md:h-10 md:min-w-[110px] md:text-sm"
					onclick={handleOpenTokoModal}
				>
					<span class="text-lg">{tokoAktifLocal ? '🔒' : '🍹'}</span>
					<span>{tokoAktifLocal ? 'Tutup Toko' : 'Buka Toko'}</span>
				</button>
			{/if}
		</div>
	{/key}
</div>
<div bind:this={sentinelRef} style="height:1px;width:100%"></div>

<!-- Page swipe is optional; visible navigation remains the primary control. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-white"
	ontouchstart={swipeNav.handleTouchStart}
	ontouchmove={swipeNav.handleTouchMove}
	ontouchend={swipeNav.handleTouchEnd}
	onclick={swipeNav.handleGlobalClick}
>
	<main
		aria-label="Dashboard"
		class="page-content min-h-0 w-full max-w-full flex-1 overflow-x-hidden md:mx-auto md:max-w-3xl md:rounded-2xl md:bg-white md:shadow-xl lg:max-w-5xl"
	>
		<div class="px-4 pt-2 pb-4 md:px-8 md:pt-4 md:pb-8 lg:px-12 lg:pt-6 lg:pb-10">
			<div class="flex flex-col space-y-3 md:space-y-10">
				<!-- Metrik Utama -->
				<DashboardMetrics
					itemTerjual={dashboard.itemTerjual}
					jumlahTransaksi={dashboard.jumlahTransaksi}
					omzet={dashboard.omzet}
					{modalAwal}
				/>
				<!-- Menu Terlaris -->
				<div class="mt-6 md:mt-12">
					<div
						class="mt-2 mb-2 text-base font-medium text-pink-500 md:mt-0 md:mb-6 md:text-2xl md:text-lg md:font-bold md:tracking-tight"
					>
						Menu Terlaris
					</div>
					{#if dashboard.isLoadingBestSellers}
						<div class="flex flex-col gap-3 md:gap-4 md:space-y-0 md:divide-y md:divide-pink-100">
							{#each Array(3) as _, i}
								<div
									class="relative flex animate-pulse items-center gap-3 rounded-xl bg-gray-100 p-3 shadow-md md:min-h-[88px] md:items-center md:gap-6 md:rounded-2xl md:bg-white md:p-6 md:shadow-none"
								>
									<div class="h-12 w-12 rounded-lg bg-gray-200 md:h-16 md:w-16"></div>
									<div class="min-w-0 flex-1">
										<div class="mb-2 h-4 w-24 rounded bg-gray-200 md:mb-3 md:w-32"></div>
										<div class="h-3 w-16 rounded bg-gray-200 md:w-24"></div>
									</div>
								</div>
							{/each}
						</div>
					{:else if dashboard.errorBestSellers}
						<div class="py-6 text-center text-base text-red-400 md:text-lg">
							{dashboard.errorBestSellers}
						</div>
					{:else if dashboard.bestSellers.length === 0}
						<div class="py-6 text-center text-base text-gray-400 md:text-lg">
							Belum ada data menu terlaris
						</div>
					{:else}
						<div class="flex flex-col gap-3 md:gap-4 md:space-y-0 md:divide-y md:divide-pink-100">
							{#each dashboard.bestSellers.slice(0, 3) as m, i}
								<div
									class="relative flex items-center gap-3 rounded-xl bg-white p-3 shadow-md md:min-h-[88px] md:items-center md:gap-6 md:rounded-2xl md:border md:border-pink-200 md:bg-white md:p-6 md:shadow-none {i ===
									0
										? 'border-2 border-yellow-400 md:border-2 md:border-pink-200 md:border-yellow-400'
										: ''}"
								>
									{#if i === 0}
										<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
											>👑</span
										>
									{:else if i === 1}
										<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
											>🥈</span
										>
									{:else if i === 2}
										<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
											>🥉</span
										>
									{/if}
									{#if m.image && !imageError[i]}
										<img
											class="h-12 w-12 rounded-lg bg-pink-50 object-cover md:h-16 md:w-16"
											src={m.image}
											alt={m.nama}
											onerror={() => handleImgError(i)}
										/>
									{:else}
										<div
											class="flex h-12 w-12 items-center justify-center rounded-lg bg-pink-50 text-4xl text-pink-400 md:h-16 md:w-16 md:text-5xl"
										>
											🍹
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div
											class="truncate text-base font-semibold text-gray-900 md:mb-1 md:text-xl lg:text-2xl"
										>
											{m.nama}
										</div>
										<div class="text-sm text-pink-400 md:text-lg">{m.total_qty} terjual</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<!-- Statistik -->
				<div class="mt-6 md:mt-12">
					<div
						class="mt-2 mb-2 text-base font-medium text-pink-500 md:mt-0 md:mb-6 md:text-2xl md:text-lg md:font-bold md:tracking-tight"
					>
						Statistik
					</div>
					<div class="grid grid-cols-2 gap-3 md:mb-6 md:grid-cols-2 md:gap-6">
						<div
							class="flex flex-col items-center rounded-xl bg-white p-3 shadow md:rounded-2xl md:border md:border-pink-100 md:p-6 md:shadow-none"
						>
							<div class="text-xl font-bold text-pink-400 md:text-2xl lg:text-3xl">
								{dashboard.avgTransaksi ?? '--'}
							</div>
							<div class="mt-1 text-xs text-gray-500 md:text-sm">Rata-rata transaksi</div>
						</div>
						<div
							class="flex flex-col items-center rounded-xl bg-white p-3 shadow md:rounded-2xl md:border md:border-pink-100 md:p-6 md:shadow-none"
						>
							<div class="text-xl font-bold text-pink-400 md:text-2xl lg:text-3xl">
								{#if dashboard.jamRamai}
									{dashboard.jamRamai}
								{:else}
									00.00
								{/if}
							</div>
							<div class="mt-1 text-xs text-gray-500 md:text-sm">Jam paling ramai</div>
						</div>
					</div>
					<!-- Grafik Pendapatan 7 Hari -->
					<div class="mt-3 md:mt-0">
						<WeeklyChart weeklyIncome={dashboard.weeklyIncome} weeklyMax={dashboard.weeklyMax} />
					</div>
				</div>
			</div>
		</div>
	</main>
	<div class="sticky bottom-0 z-30 bg-white md:hidden">
		<!-- BottomNav hanya muncul di mobile -->
	</div>
</div>
