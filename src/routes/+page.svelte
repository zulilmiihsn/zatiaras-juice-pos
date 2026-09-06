<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { auth } from '$lib/auth/auth';
	import { browser } from '$app/environment';
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
	import TopBarAiAssistant from '$lib/components/shared/topBarAiAssistant.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { getSesiAktif } from '$lib/services/sesiTokoService';
	import { transactionService } from '$lib/services/transactionService';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import { refreshBus } from '$lib/utils/refreshBus';
	import Store from '@lucide/svelte/icons/store';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import Boxes from '@lucide/svelte/icons/boxes';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Crown from '@lucide/svelte/icons/crown';
	import RankMedal from '$lib/components/dashboard/RankMedal.svelte';
	import Settings from '@lucide/svelte/icons/settings';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import Coffee from '@lucide/svelte/icons/coffee';
	import Receipt from '@lucide/svelte/icons/receipt';
	import CreditCard from '@lucide/svelte/icons/credit-card';

	import type {
		DashboardStats,
		WeeklyIncomeData,
		BestSeller,
		TokoSession,
		BukuKasRecord
	} from '$lib/types';
	type IconComponent = typeof import('@lucide/svelte/icons/wallet').default;

	// [CATATAN]: Lazy load icons — assigned in onMount, consumed by DashboardMetrics via svelte:component
	let Wallet = $state<IconComponent | null>(null);
	let ShoppingBag = $state<IconComponent | null>(null);
	let Coins = $state<IconComponent | null>(null);
	let Users = $state<IconComponent | null>(null);
	let Clock = $state<IconComponent | null>(null);
	let TrendingUp = $state<IconComponent | null>(null);

	import { createDashboardState } from '$lib/stores/dashboardState.svelte';

	const dashboard = createDashboardState();

	// [CATATAN]: Subscribe ke store
	let currentUserRole = $state('');

	$effect(() => {
		currentUserRole = userRole.value || '';
	});

	onMount(async () => {
		// [CATATAN]: Preload ikon untuk halaman beranda agar ikon metrik muncul cepat
		import('$lib/utils/iconLoader').then(({ loadRouteIcons }) => {
			// [CATATAN]: non-blocking
			loadRouteIcons('dashboard');
			// [CATATAN]: anticipatory preload ke rute yang sering dituju berikutnya
			setTimeout(() => loadRouteIcons('pos'), 0);
			setTimeout(() => loadRouteIcons('laporan'), 0);
		});
		const icons = await Promise.all([
			import('@lucide/svelte/icons/wallet'),
			import('@lucide/svelte/icons/shopping-bag'),
			import('@lucide/svelte/icons/coins'),
			import('@lucide/svelte/icons/users'),
			import('@lucide/svelte/icons/clock'),
			import('@lucide/svelte/icons/trending-up')
		]);
		Wallet = icons[0].default;
		ShoppingBag = icons[1].default;
		Coins = icons[2].default;
		Users = icons[3].default;
		Clock = icons[4].default;
		TrendingUp = icons[5].default;

		// [CATATAN]: Jika role belum ada di store, validasi dari session backend.
		if (!currentUserRole) {
			const res = await fetch('/api/session');
			if (res.ok) {
				const session = await res.json();
				if (session?.user) setUserRole(session.user.role, session.user);
			}
		}
	});

	// [CATATAN]: Manual refresh function (for testing)
	async function refreshDashboardData() {
		await dashboard.refreshDashboardData();
	}

	let modalAwal = $state<number | null>(null);

	let imageError = $state<Record<number, boolean>>({});

	function handleImgError(index: number) {
		imageError[index] = true;
	}

	function formatStok(val: number): string {
		if (val === undefined || val === null || isNaN(val)) return '0';
		const rounded = Math.round(Number(val) * 100) / 100;
		return rounded.toString();
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

	// [CATATAN]: Toast notification — use shared createToastManager
	const toastManager = createToastManager();

	// [CATATAN]: Shim for local callers that expect showToastNotification(msg, type)
	function showToastNotification(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success'
	) {
		toastManager.showToastNotification(message, type);
	}

	let showTokoModal = $state(false);
	let isBukaToko = $state(true); // true: buka toko, false: tutup toko
	// [CATATAN]: Verifikasi PIN untuk aksi kasir (buka/tutup)
	let showActionPinModal = $state(false);
	let modalAwalInput = $state('');
	let pinInputToko = $state('');
	let pinErrorToko = $state('');
	let tokoAktifLocal = $state(false);
	let sesiAktif = $state<TokoSession | null>(null);
	let sesiKasSummary = $state({
		modalAwal: 0,
		totalPenjualan: 0,
		pemasukanTunai: 0,
		pemasukanNonTunai: 0,
		pengeluaranTunai: 0,
		uangKasir: 0
	});

	function updateTokoAktif(val: boolean) {
		tokoAktifLocal = val;
	}

	async function cekSesiToko() {
		sesiAktif = await getSesiAktif();
		updateTokoAktif(!!sesiAktif);
		modalAwal = sesiAktif?.kas_awal ?? null;

		if (sesiAktif?.id) {
			try {
				const kasRaw = (await transactionService.getRows('buku_kas', {
					id_sesi_toko: sesiAktif.id
				})) as unknown as BukuKasRecord[];
				const kas: BukuKasRecord[] = Array.isArray(kasRaw) ? kasRaw : [];
				const penjualanTunai = kas
					.filter((t) => t.tipe === 'in' && t.metode_bayar === 'tunai')
					.reduce((a, b) => a + (b.nominal || 0), 0);
				const penjualanNonTunai = kas
					.filter((t) => t.tipe === 'in' && t.metode_bayar !== 'tunai')
					.reduce((a, b) => a + (b.nominal || 0), 0);
				const pengeluaranTunai = kas
					.filter((t) => t.tipe === 'out' && t.metode_bayar === 'tunai')
					.reduce((a, b) => a + (b.nominal || 0), 0);
				const modalAwalValue = sesiAktif.kas_awal || 0;
				const totalPenjualan = kas
					.filter((t) => t.tipe === 'in')
					.reduce((a, b) => a + (b.nominal || 0), 0);
				const uangKasir = modalAwalValue + penjualanTunai - pengeluaranTunai;

				sesiKasSummary = {
					modalAwal: modalAwalValue,
					totalPenjualan,
					pemasukanTunai: penjualanTunai,
					pemasukanNonTunai: penjualanNonTunai,
					pengeluaranTunai,
					uangKasir
				};
			} catch {
				sesiKasSummary = {
					modalAwal: modalAwal ?? 0,
					totalPenjualan: 0,
					pemasukanTunai: 0,
					pemasukanNonTunai: 0,
					pengeluaranTunai: 0,
					uangKasir: modalAwal ?? 0
				};
			}
		} else {
			sesiKasSummary = {
				modalAwal: 0,
				totalPenjualan: 0,
				pemasukanTunai: 0,
				pemasukanNonTunai: 0,
				pengeluaranTunai: 0,
				uangKasir: 0
			};
		}
	}

	onMount(() => {
		if (typeof window !== 'undefined' && !localStorage.getItem('zatiaras_session')) {
			return;
		}
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
		// [CATATAN]: Jika kasir, wajib verifikasi PIN di server dahulu.
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
		// [CATATAN]: Non-kasir langsung buka modal
		cekSesiToko().then(() => {
			isBukaToko = !tokoAktifLocal;
			showTokoModal = true;
		});
	}

	// [CATATAN]: Pending action setelah PIN benar
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
		// [CATATAN]: Observer untuk sticky topbar
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

	// [CATATAN]: Fungsi untuk mendapatkan tanggal hari ini WITA (tanpa jam)
	function getTodayWitaDate() {
		// [CATATAN]: Ambil waktu sekarang di Asia/Makassar (WITA)
		const witaString = getNowWita();
		const witaDate = new Date(witaString);
		witaDate.setHours(0, 0, 0, 0); // Set ke jam 00:00:00
		return witaDate;
	}

	// [CATATAN]: Inisialisasi range 7 hari terakhir berdasarkan hari WITA
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

<div class="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<!-- Fluid Wave Header for Beranda (Identical to Laporan, Catat, Stok) -->
	<div
		class="relative overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 pt-4 pb-12 shadow-xl shadow-pink-500/15 md:pt-6 md:pb-14"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="mx-auto w-full max-w-5xl">
			<!-- Top Brand Row (Official Zatiaras Logo & Profile) -->
			<div class="relative z-10 flex items-center justify-between pb-3 md:pb-4">
				<div class="flex items-center gap-3">
					<TopBarAiAssistant />
					<div class="flex flex-col">
						<h1
							class="text-base leading-tight font-bold tracking-tight text-white drop-shadow-xs md:text-lg"
						>
							Zatiaras Juice
						</h1>
						<span class="text-[11px] font-medium text-white/85 md:text-xs">Samarinda</span>
					</div>
				</div>

				<div class="flex items-center gap-2">
					<!-- Settings Icon Button -->
					<a
						href="/pengaturan"
						aria-label="Pengaturan"
						class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-xs backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95 md:h-10 md:w-10"
					>
						<Settings size={18} class="stroke-[2.2]" />
					</a>
				</div>
			</div>

			<!-- Banner Status Toko (Buka / Tutup) -->
			<button
				type="button"
				onclick={handleOpenTokoModal}
				class="relative z-10 flex w-full cursor-pointer items-center justify-between rounded-full px-4 py-2.5 text-left shadow-md shadow-pink-950/10 transition-all duration-150 hover:shadow-lg active:scale-[0.98] md:mx-auto md:max-w-xl md:px-5 md:py-3 {tokoAktifLocal
					? 'border border-emerald-300/70 bg-emerald-50/95 backdrop-blur-md'
					: 'border border-rose-200/70 bg-white/95 backdrop-blur-md'}"
			>
				<div class="flex min-w-0 items-center gap-3">
					<div
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-xs md:h-10 md:w-10 {tokoAktifLocal
							? 'bg-emerald-500'
							: 'bg-rose-500'}"
					>
						<Store size={18} class="stroke-[2.2]" />
					</div>
					<div class="flex min-w-0 flex-col">
						<div class="flex items-center gap-1.5 leading-tight">
							<span class="truncate text-xs font-bold tracking-tight text-slate-900 md:text-sm">
								{tokoAktifLocal ? 'Kios Buka' : 'Kios Tutup'}
							</span>
							<span
								class="inline-block h-2 w-2 shrink-0 rounded-full {tokoAktifLocal
									? 'animate-pulse bg-emerald-500'
									: 'bg-rose-500'}"
							></span>
						</div>
						<span class="mt-0.5 truncate text-[11px] font-medium text-slate-500 md:text-xs">
							{#if tokoAktifLocal}
								Modal Kas: <span class="font-bold text-emerald-800"
									>{modalAwal !== null ? `Rp ${formatRupiah(modalAwal)}` : 'Rp 0'}</span
								>
							{:else}
								Belum ada sesi kasir aktif
							{/if}
						</span>
					</div>
				</div>

				<span
					class="ml-2 shrink-0 text-xs font-bold transition-all md:text-sm {tokoAktifLocal
						? 'text-slate-400 hover:text-slate-600'
						: 'text-pink-600 hover:text-pink-700'}"
				>
					{tokoAktifLocal ? 'Tutup Sesi ›' : 'Buka Sesi →'}
				</span>
			</button>
		</div>
	</div>

	<main
		aria-label="Dashboard"
		class="page-content relative z-20 -mt-6 min-h-0 w-full max-w-full flex-1 overflow-x-hidden px-4"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col pb-8 md:pb-12">
			<!-- Metrik Utama -->
			<DashboardMetrics
				itemTerjual={dashboard.itemTerjual}
				jumlahTransaksi={dashboard.jumlahTransaksi}
				omzet={dashboard.omzet}
				{modalAwal}
				avgTransaksi={dashboard.avgTransaksi}
				jamRamai={dashboard.jamRamai}
			/>

			<!-- Snippet Definitions for Dashboard Modules -->
			{#snippet bestSellersModule()}
				<!-- Menu Terlaris (Peringkat Penjualan) -->
				<div>
					<div class="mb-2.5 flex items-center justify-between px-1">
						<div>
							<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
								Peringkat Penjualan
							</div>
							<div class="text-sm font-bold text-slate-900 sm:text-base">Menu Terlaris</div>
						</div>
						{#if dashboard.bestSellers.length > 0}
							<span
								class="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-0.5 text-[11px] font-bold text-pink-700"
							>
								{dashboard.bestSellers.length} Menu
							</span>
						{/if}
					</div>
					{#if dashboard.isLoadingBestSellers}
						<div class="flex flex-col gap-2.5">
							{#each Array(3) as _}
								<div
									class="flex animate-pulse items-center gap-3.5 rounded-[24px] bg-white p-3.5 shadow-xs"
								>
									<div class="h-12 w-12 rounded-[18px] bg-slate-100"></div>
									<div class="min-w-0 flex-1">
										<div class="mb-2 h-4 w-32 rounded bg-slate-100"></div>
										<div class="h-3 w-20 rounded bg-slate-100"></div>
									</div>
								</div>
							{/each}
						</div>
					{:else if dashboard.errorBestSellers}
						<div
							class="glass-card rounded-[24px] py-6 text-center text-xs font-bold text-rose-500 shadow-sm"
						>
							{dashboard.errorBestSellers}
						</div>
					{:else if dashboard.bestSellers.length === 0}
						<div
							class="glass-card rounded-[24px] py-8 text-center text-xs font-medium text-slate-400 shadow-sm"
						>
							Belum ada data transaksi menu terlaris
						</div>
					{:else}
						<div class="flex flex-col gap-2.5">
							{#each dashboard.bestSellers.slice(0, 5) as m, i}
								<div
									class="soft-float-card relative flex items-center justify-between overflow-visible p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99]"
								>
									{#if i === 0}
										<!-- Crown Gimmick -->
										<div
											class="pointer-events-none absolute -top-3.5 -left-2 z-10 flex h-7 w-7 -rotate-[18deg] items-center justify-center drop-shadow-sm"
											title="Peringkat 1 Terlaris"
										>
											<Crown size={22} class="fill-amber-400 stroke-[2.2] text-amber-500" />
										</div>
									{/if}

									<div class="flex min-w-0 items-center gap-3">
										<!-- Rank Medal -->
										<RankMedal rank={i + 1} />

										<!-- Product Image / Icon -->
										<div
											class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[18px] border border-pink-100/60 bg-pink-50/70 text-2xl"
										>
											{#if m.image && !imageError[i]}
												<img
													class="h-full w-full object-cover"
													src={m.image}
													alt={m.nama}
													onerror={() => handleImgError(i)}
												/>
											{:else}
												<CupIcon class="h-6 w-6 text-pink-500" strokeWidth={2} />
											{/if}
										</div>

										<!-- Title -->
										<div class="min-w-0 flex-1">
											<h4 class="truncate text-sm leading-tight font-bold text-slate-900">
												{m.nama}
											</h4>
											<span class="text-[11px] font-medium text-slate-400">Favorit Pelanggan</span>
										</div>
									</div>

									<!-- Sold Count Pill -->
									<div class="shrink-0 pl-2">
										<span
											class="inline-flex items-center rounded-full border border-pink-100 bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700"
										>
											{m.total_qty ?? 0}
											<span class="ml-1 text-[10px] font-semibold text-slate-400">terjual</span>
										</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/snippet}

			{#snippet weeklyChartModule()}
				<!-- Grafik 7 Hari Terakhir -->
				{#if currentUserRole === 'pemilik' || currentUserRole === 'admin'}
					<WeeklyChart weeklyIncome={dashboard.weeklyIncome} weeklyMax={dashboard.weeklyMax} />
				{/if}
			{/snippet}

			{#snippet operationalStatsModule()}
				{@const payTunai = sesiKasSummary.pemasukanTunai || dashboard.penjualanTunai || 0}
				{@const payNonTunai = sesiKasSummary.pemasukanNonTunai || dashboard.penjualanNonTunai || 0}
				{@const totalPay = payTunai + payNonTunai}
				<!-- Statistik Operasional (2x2 Grid) -->
				<div>
					<div class="mb-2.5 px-1">
						<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
							Metrik Kios
						</div>
						<div class="text-sm font-bold text-slate-900 sm:text-base">Statistik Operasional</div>
					</div>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-2">
						<!-- Card 1: Rata-rata per Transaksi -->
						<div
							class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
						>
							<div class="flex items-center justify-between">
								<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Rata-Rata Nota
								</span>
								<div
									class="flex h-8 w-8 items-center justify-center rounded-xl border border-pink-100/80 bg-pink-50 text-pink-600 shadow-2xs"
								>
									<Receipt size={16} class="stroke-[2.2]" />
								</div>
							</div>
							<div class="mt-2.5">
								<div
									class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl"
								>
									{dashboard.jumlahTransaksi && dashboard.omzet
										? `Rp ${formatRupiah(Math.round(dashboard.omzet / dashboard.jumlahTransaksi))}`
										: 'Rp 0'}
								</div>
								<div class="mt-0.5 text-[11px] font-medium text-slate-400">per transaksi</div>
							</div>
						</div>

						<!-- Card 2: Volume Cup per Nota -->
						<div
							class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
						>
							<div class="flex items-center justify-between">
								<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Volume Cup
								</span>
								<div
									class="flex h-8 w-8 items-center justify-center rounded-xl border border-rose-100/80 bg-rose-50 text-rose-600 shadow-2xs"
								>
									<Coffee size={16} class="stroke-[2.2]" />
								</div>
							</div>
							<div class="mt-2.5">
								<div
									class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl"
								>
									{dashboard.avgTransaksi ?? '--'}
									<span class="text-xs font-bold text-slate-400">cup</span>
								</div>
								<div class="mt-0.5 text-[11px] font-medium text-slate-400">rata-rata per nota</div>
							</div>
						</div>

						<!-- Card 3: Jam Paling Ramai -->
						<div
							class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
						>
							<div class="flex items-center justify-between">
								<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Jam Ramai
								</span>
								<div
									class="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-100/80 bg-amber-50 text-amber-600 shadow-2xs"
								>
									<ClockIcon size={16} class="stroke-[2.2]" />
								</div>
							</div>
							<div class="mt-2.5">
								<div
									class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl"
								>
									{dashboard.jamRamai || '--'}
								</div>
								<div class="mt-0.5 text-[11px] font-medium text-slate-400">waktu terpadat</div>
							</div>
						</div>

						<!-- Card 4: Rasio Pembayaran (QRIS vs Tunai) -->
						<div
							class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
						>
							<div class="flex items-center justify-between">
								<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Metode Bayar
								</span>
								<div
									class="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-100/80 bg-emerald-50 text-emerald-600 shadow-2xs"
								>
									<CreditCard size={16} class="stroke-[2.2]" />
								</div>
							</div>
							<div class="mt-2.5">
								{#if totalPay > 0}
									{@const pctNonTunai = Math.round((payNonTunai / totalPay) * 100)}
									{@const pctTunai = 100 - pctNonTunai}
									<!-- Segmented Visual Bar -->
									<div
										class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/50"
									>
										{#if pctNonTunai > 0}
											<div
												class="h-full rounded-l-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
												style="width: {pctNonTunai}%"
												title="QRIS {pctNonTunai}%"
											></div>
										{/if}
										{#if pctTunai > 0}
											<div
												class="h-full {pctNonTunai > 0
													? 'rounded-r-full'
													: 'rounded-full'} bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-500"
												style="width: {pctTunai}%"
												title="Tunai {pctTunai}%"
											></div>
										{/if}
									</div>
									<div class="mt-1.5 flex items-center justify-between text-[11px] font-black">
										<span class="flex items-center gap-1 text-emerald-700">
											<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
											QRIS {pctNonTunai}%
										</span>
										<span class="flex items-center gap-1 text-pink-600">
											<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
											Tunai {pctTunai}%
										</span>
									</div>
								{:else}
									<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5">
										<div class="h-full w-1/2 rounded-l-full bg-slate-200/60"></div>
										<div class="h-full w-1/2 rounded-r-full bg-slate-200/40"></div>
									</div>
									<div
										class="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-400"
									>
										<span>QRIS 0%</span>
										<span>Tunai 0%</span>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			{/snippet}

			{#snippet cashFlowModule()}
				<!-- Ringkasan Kas di Laci / Status Sesi Kasir -->
				<div class="soft-float-card relative overflow-hidden p-4.5 sm:p-5">
					<div class="mb-3 flex items-center justify-between">
						<div>
							<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
								Arus Kas Fisik
							</div>
							<div class="text-sm font-bold text-slate-900 sm:text-base">Estimasi Kas di Laci</div>
						</div>
						<button
							type="button"
							onclick={handleOpenTokoModal}
							class="flex cursor-pointer items-center gap-1 rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-xs font-bold text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
						>
							<span>{tokoAktifLocal ? 'Kelola Sesi ›' : 'Buka Kios →'}</span>
						</button>
					</div>

					<div class="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
						<div class="flex items-center justify-between text-xs">
							<span class="font-medium text-slate-500">Modal Kas Awal</span>
							<span class="font-bold text-slate-800">
								{modalAwal !== null ? `Rp ${formatRupiah(sesiKasSummary.modalAwal)}` : 'Rp 0'}
							</span>
						</div>
						<div class="mt-2 flex items-center justify-between text-xs">
							<span class="font-medium text-slate-500">Pemasukan Tunai</span>
							<span class="font-bold text-emerald-600">
								+ Rp {formatRupiah(sesiKasSummary.pemasukanTunai)}
							</span>
						</div>
						{#if sesiKasSummary.pengeluaranTunai > 0}
							<div class="mt-2 flex items-center justify-between text-xs">
								<span class="font-medium text-slate-500">Pengeluaran Tunai</span>
								<span class="font-bold text-rose-600">
									- Rp {formatRupiah(sesiKasSummary.pengeluaranTunai)}
								</span>
							</div>
						{/if}
						<div class="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2.5">
							<span class="text-xs font-bold text-slate-900">Total Uang di Laci</span>
							<span class="text-base font-extrabold text-pink-700 sm:text-lg">
								Rp {formatRupiah(sesiKasSummary.uangKasir)}
							</span>
						</div>
					</div>
				</div>
			{/snippet}

			{#snippet ingredientUsageModule()}
				<!-- Ranking Penggunaan Bahan Baku Hari Ini -->
				<div>
					<div class="mb-2.5 flex items-center justify-between px-1">
						<div>
							<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
								Inventaris Harian
							</div>
							<div class="text-sm font-bold text-slate-900 sm:text-base">Pemakaian Bahan</div>
						</div>
						<a
							href="/stok"
							class="flex items-center gap-1 text-xs font-bold whitespace-nowrap text-pink-600 transition-colors hover:text-pink-700"
						>
							<span>Semua Stok</span>
							<ArrowRight size={13} class="stroke-[2.5]" />
						</a>
					</div>

					{#if dashboard.lowStockCount > 0}
						<a
							href="/stok"
							class="mb-2.5 flex items-center justify-between rounded-2xl border border-rose-200/90 bg-rose-50/80 p-3 text-rose-950 shadow-2xs transition-all hover:bg-rose-100/70 active:scale-[0.99]"
						>
							<div class="flex min-w-0 items-center gap-2.5">
								<div
									class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white"
								>
									<AlertTriangle size={15} class="stroke-[2.5]" />
								</div>
								<div class="truncate text-xs font-bold">
									<span>{dashboard.lowStockCount} Bahan Menipis:</span>
									<span class="font-medium text-rose-700">
										{dashboard.lowStockNames.join(', ')}</span
									>
								</div>
							</div>
							<span class="shrink-0 text-xs font-bold text-rose-600 underline">Restock</span>
						</a>
					{/if}

					{#if dashboard.topIngredients.length === 0}
						<div class="rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-xs">
							<Boxes class="mx-auto mb-2 h-8 w-8 stroke-[1.8] text-slate-300" />
							<div class="text-xs font-bold text-slate-700">Belum Ada Data Bahan</div>
							<div class="mt-0.5 text-[11px] text-slate-400">
								Tambahkan bahan baku di menu Stok untuk tracking pemakaian
							</div>
						</div>
					{:else}
						<div class="flex flex-col gap-2.5">
							{#each dashboard.topIngredients as ing, i}
								<div
									class="soft-float-card relative flex items-center justify-between overflow-visible p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] {ing.is_low
										? 'border border-rose-200/80 bg-rose-50/20'
										: ''}"
								>
									{#if i === 0}
										<!-- Crown Gimmick -->
										<div
											class="pointer-events-none absolute -top-3.5 -left-2 z-10 flex h-7 w-7 -rotate-[18deg] items-center justify-center drop-shadow-sm"
											title="Peringkat 1 Pemakaian"
										>
											<Crown size={22} class="fill-amber-400 stroke-[2.2] text-amber-500" />
										</div>
									{/if}

									<div class="flex min-w-0 items-center gap-3">
										<!-- Rank Medal -->
										<RankMedal rank={i + 1} />

										<!-- Ingredient Icon Box -->
										<div
											class="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] {ing.is_low
												? 'border border-rose-200/70 bg-rose-50 text-rose-600'
												: 'border border-pink-100/60 bg-pink-50/70 text-pink-600'}"
										>
											{#if ing.is_low}
												<AlertTriangle size={20} class="stroke-[2.2]" />
											{:else}
												<Boxes size={20} class="stroke-[2.2]" />
											{/if}
										</div>

										<!-- Title & Usage -->
										<div class="min-w-0 flex-1">
											<h4 class="truncate text-sm leading-tight font-bold text-slate-900">
												{ing.nama}
											</h4>
											<div class="mt-0.5 text-[11px] font-medium text-slate-400">
												{#if ing.terpakai > 0}
													Terpakai hari ini: <span class="font-bold text-slate-700"
														>{formatStok(ing.terpakai)} {ing.satuan}</span
													>
												{:else}
													<span>Belum ada pemakaian</span>
												{/if}
											</div>
										</div>
									</div>

									<!-- Remaining Stock Pill -->
									<div class="shrink-0 pl-2">
										<span
											class="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold {ing.is_low
												? 'border border-rose-200 bg-rose-100 text-rose-800'
												: 'border border-emerald-100 bg-emerald-50 text-emerald-800'}"
										>
											{ing.is_low ? 'Menipis · ' : ''}Sisa {formatStok(ing.stok_saat_ini)}
											{ing.satuan}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/snippet}

			{#snippet quickActionsModule()}
				<!-- Quick Action Panel for Tablet POS (Aksi Cepat Kasir) -->
				<div
					class="rounded-[28px] border border-slate-200/70 bg-white/90 p-4.5 shadow-2xs backdrop-blur-md"
				>
					<div class="mb-3 flex items-center justify-between">
						<span class="text-xs font-bold tracking-wider text-slate-400 uppercase"
							>Pintasan Cepat</span
						>
						<span class="text-[11px] font-semibold text-slate-400">Aksi Kios</span>
					</div>
					<div class="grid grid-cols-3 gap-3">
						<a
							href="/pos"
							class="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-3 py-3 text-xs font-extrabold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98]"
						>
							<ShoppingBagIcon size={16} class="stroke-[2.2]" />
							<span>Buka Kasir</span>
						</a>
						<a
							href="/catat"
							class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.98]"
						>
							<BookOpen size={16} class="stroke-[2.2] text-pink-600" />
							<span>Catat Kas</span>
						</a>
						<a
							href="/stok"
							class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.98]"
						>
							<Boxes size={16} class="stroke-[2.2] text-emerald-600" />
							<span>Kelola Stok</span>
						</a>
					</div>
				</div>
			{/snippet}

			<!-- MOBILE VIEW (< md): Menu Terlaris -> Statistik -> Grafik Penjualan -> Kas Fisik -> Bahan -->
			<div class="mt-4 flex flex-col gap-4 md:hidden">
				{@render bestSellersModule()}
				{@render operationalStatsModule()}
				{@render weeklyChartModule()}
				{@render cashFlowModule()}
				{@render ingredientUsageModule()}
			</div>

			<!-- TABLET / DESKTOP VIEW (>= md): 2-Column Bento Grid -->
			<div class="mt-6 hidden md:grid md:grid-cols-12 md:items-start md:gap-6">
				<!-- Left Column (md:col-span-7) -->
				<div class="flex flex-col gap-5 md:col-span-7">
					{@render weeklyChartModule()}
					{@render operationalStatsModule()}
					{@render quickActionsModule()}
				</div>

				<!-- Right Column (md:col-span-5) -->
				<div class="flex flex-col gap-5 md:col-span-5">
					{@render bestSellersModule()}
					{@render cashFlowModule()}
					{@render ingredientUsageModule()}
				</div>
			</div>
		</div>
	</main>
</div>
