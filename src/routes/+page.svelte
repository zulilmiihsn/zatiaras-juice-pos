<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { userRole, userProfile, setUserRole } from '$lib/stores/userRole.svelte';
	import { branchLabel } from '$lib/utils/branches';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';
	import PinModal from '$lib/components/shared/PinModal.svelte';
	import { securitySettings } from '$lib/stores/securitySettings.svelte';
	import { verifyPagePin } from '$lib/services/pinAccessService';
	import DashboardMetrics from '$lib/components/dashboard/DashboardMetrics.svelte';
	import WeeklyChart from '$lib/components/dashboard/WeeklyChart.svelte';
	import TokoModal from '$lib/components/dashboard/TokoModal.svelte';
	import TopBarAiAssistant from '$lib/components/shared/TopBarAiAssistant.svelte';
	import DashboardQuickActions from '$lib/components/dashboard/DashboardQuickActions.svelte';
	import DashboardStockPaused from '$lib/components/dashboard/DashboardStockPaused.svelte';
	import DashboardIngredientUsage from '$lib/components/dashboard/DashboardIngredientUsage.svelte';
	import DashboardCashFlow from '$lib/components/dashboard/DashboardCashFlow.svelte';
	import DashboardOperationalStats from '$lib/components/dashboard/DashboardOperationalStats.svelte';
	import DashboardBestSellers from '$lib/components/dashboard/DashboardBestSellers.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { getSesiAktif, getSesiSummary } from '$lib/services/sesiTokoService';
	import { transactionService } from '$lib/services/transactionService';
	import { formatRupiah } from '$lib/utils/currency';
	import { refreshBus } from '$lib/utils/refreshBus';
	import Store from '@lucide/svelte/icons/store';
	import Settings from '@lucide/svelte/icons/settings';

	import type { TokoSession, BukuKasRecord } from '$lib/types';

	import { createDashboardState } from '$lib/stores/dashboardState.svelte';
	import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';

	const dashboard = createDashboardState();

	const currentUserRole = $derived(userRole.value || '');

	// Label dari profil terautentikasi, bukan tebakan UI.
	// Profil belum ada (loading/ganti sesi) = placeholder netral.
	const headerBranchLabel = $derived.by(() => {
		const branch = (userProfile.value as { branch?: unknown } | null)?.branch;
		return branchLabel(branch) ?? '…';
	});

	onMount(async () => {
		void stockPolicyState.refresh();

		// Jika role belum ada di store, validasi dari session backend.
		if (!currentUserRole) {
			const res = await fetch('/api/session');
			if (res.ok) {
				const session = await res.json();
				if (session?.user) setUserRole(session.user.role, session.user);
			}
		}
	});

	let modalAwal = $state<number | null>(null);

	// Toast notification — use shared createToastManager
	const toastManager = createToastManager();
	onDestroy(() => toastManager.dispose());

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
				const summary = await getSesiSummary(sesiAktif.id);
				if (summary) {
					sesiKasSummary = {
						modalAwal: summary.modalAwal,
						totalPenjualan: summary.totalPemasukan,
						pemasukanTunai: summary.pemasukanTunai,
						pemasukanNonTunai: summary.pemasukanNonTunai,
						pengeluaranTunai: summary.pengeluaranTunai,
						uangKasir: summary.uangKasir
					};
					return;
				}
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

	let offDashboardRefreshBus: (() => void) | null = null;

	onMount(() => {
		if (typeof window !== 'undefined' && !localStorage.getItem('zatiaras_session')) {
			return;
		}
		cekSesiToko();
		if (browser) {
			window.addEventListener('openTokoModal', handleOpenTokoModal);
		}
		offDashboardRefreshBus = refreshBus.on('dashboard', () => {
			cekSesiToko();
		});
	});
	onDestroy(() => {
		if (offDashboardRefreshBus) {
			offDashboardRefreshBus();
			offDashboardRefreshBus = null;
		}
		if (browser) {
			window.removeEventListener('openTokoModal', handleOpenTokoModal);
		}
	});

	async function handleOpenTokoModal() {
		// Jika kasir, cek apakah PIN sudah dikonfigurasi.
		// Jika belum disetup pemilik, auto-bypass agar kasir bisa langsung buka/tutup sesi kios.
		if (currentUserRole === 'kasir') {
			let isPinSet = securitySettings.value?.pinConfigured;
			if (isPinSet === undefined) {
				try {
					const data = (await transactionService.getOne('pengaturan')) as {
						pinConfigured?: boolean;
					} | null;
					isPinSet = data?.pinConfigured === true;
				} catch {
					isPinSet = false;
				}
			}

			if (isPinSet) {
				pendingAction = () => {
					cekSesiToko().then(() => {
						isBukaToko = !tokoAktifLocal;
						showTokoModal = true;
					});
				};
				showActionPinModal = true;
				return;
			}
		}
		// Non-kasir atau PIN belum disetup langsung buka modal (auto-bypass)
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
	<!-- Baris brand + status kios; tinggi header disamakan dengan halaman utama lain oleh PageHeader -->
	<PageHeader>
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
					<span class="text-[11px] font-medium text-white/85 md:text-xs">
						{headerBranchLabel}
					</span>
				</div>
			</div>

			<!-- Di md+ Pengaturan sudah selalu ada di sidebar, jadi tombol ini hanya untuk HP -->
			<div class="flex items-center gap-2 md:hidden">
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
	</PageHeader>

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
				<DashboardBestSellers {dashboard} />
			{/snippet}

			{#snippet weeklyChartModule()}
				<!-- Grafik 7 Hari Terakhir -->
				{#if currentUserRole === 'pemilik' || currentUserRole === 'admin'}
					<WeeklyChart weeklyIncome={dashboard.weeklyIncome} weeklyMax={dashboard.weeklyMax} />
				{/if}
			{/snippet}

			{#snippet operationalStatsModule()}
				<DashboardOperationalStats {dashboard} {sesiKasSummary} />
			{/snippet}

			{#snippet cashFlowModule()}
				<DashboardCashFlow
					{modalAwal}
					{sesiKasSummary}
					{tokoAktifLocal}
					onOpenToko={handleOpenTokoModal}
				/>
			{/snippet}

			{#snippet ingredientUsageModule()}
				<DashboardIngredientUsage {dashboard} />
			{/snippet}

			{#snippet stockPausedModule()}
				<DashboardStockPaused />
			{/snippet}

			{#snippet quickActionsModule()}
				<DashboardQuickActions />
			{/snippet}

			<!-- MOBILE VIEW (< md): Menu Terlaris -> Statistik -> Grafik Penjualan -> Kas Fisik -> Bahan -->
			<div class="mt-4 flex flex-col gap-4 md:hidden">
				{@render bestSellersModule()}
				{@render operationalStatsModule()}
				{@render weeklyChartModule()}
				{@render cashFlowModule()}
				{#if stockPolicyState.ignored}
					{@render stockPausedModule()}
				{:else}
					{@render ingredientUsageModule()}
				{/if}
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
					{#if stockPolicyState.ignored}
						{@render stockPausedModule()}
					{:else}
						{@render ingredientUsageModule()}
					{/if}
				</div>
			</div>
		</div>
	</main>
</div>
