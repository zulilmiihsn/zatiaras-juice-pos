<script lang="ts">
	import { onMount, onDestroy, type Component } from 'svelte';
	import { slide, fade, fly } from 'svelte/transition';
	import { cubicIn, cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { auth } from '$lib/auth/auth';
	import { browser } from '$app/environment';
	import { userRole, userProfile, setUserRole } from '$lib/stores/userRole';
	import { get as storeGet } from 'svelte/store';
	import { selectedBranch } from '$lib/stores/selectedBranch';
	import { dataService, realtimeManager } from '$lib/services/dataService';
	import { reportCacheMetrics } from '$lib/utils/cacheMetrics';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import DashboardMetrics from '$lib/components/dashboard/dashboardMetrics.svelte';
	import BestSellersList from '$lib/components/dashboard/bestSellersList.svelte';
	import IncomeChart from '$lib/components/dashboard/incomeChart.svelte';
	import { getNowWita, getTodayWita, witaToUtcISO } from '$lib/utils/dateTime';
	import PinModal from '$lib/components/shared/pinModal.svelte';
	import { securitySettings } from '$lib/stores/securitySettings';

	interface DashboardStats {
		omzet: number;
		jumlahTransaksi: number;
		profit: number;
		itemTerjual: number;
		totalItem: number;
		avgTransaksi: number;
		jamRamai: string;
	}

	let dashboardData: {
		omzet: number;
		jumlahTransaksi: number;
		profit: number;
		itemTerjual: number;
		totalItem: number;
		avgTransaksi: number;
		jamRamai: string;
		weeklyIncome: number[];
		weeklyMax: number;
		bestSellers: { name: string; image?: string; total_qty: number }[];
	} | null = null;

	let barsVisible = false;
	let incomeChartRef: HTMLDivElement | null = null;
	onMount(() => {
		if (incomeChartRef) {
			const observer = new window.IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						barsVisible = true;
						observer.disconnect();
					}
				},
				{ threshold: 0.3 }
			);
			observer.observe(incomeChartRef);
		}
	});

	// Lazy load icons
	let Wallet: any = null;
	let ShoppingBag: any = null;
	let Coins: any = null;
	let Users: any = null;
	let Clock: any = null;
	let TrendingUp: any = null;
	let omzet = 0;
	let jumlahTransaksi = 0;
	let profit = 0;
	let itemTerjual = 0;
	let totalItem = 0;
	let avgTransaksi = 0;
	let jamRamai = '';
	let weeklyIncome: number[] = [];
	let weeklyMax = 1;
	let bestSellers: { name: string; image?: string; total_qty: number }[] = [];

	// Subscribe ke store
	let currentUserRole = '';
	let userProfileData: { role: string; username: string } | null = null;

	userRole.subscribe((val) => (currentUserRole = val || ''));
	userProfile.subscribe((val) => (userProfileData = val));

	let isLoadingBestSellers = true;
	let errorBestSellers = '';
	let isLoadingDashboard = true;
	let dashboardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let dashboardRefreshInFlight = false;
	let lastDashboardPayloadFingerprint = '';

	let unsubscribeBranch: (() => void) | null = null;
	let isInitialLoad = true; // Add flag to prevent double fetching

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

		// Load data dengan smart caching
		await loadDashboardData();

		// Setup real-time subscriptions
		setupRealtimeSubscriptions();

		isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

		// Jika role belum ada di store, coba validasi dengan Supabase
		if (!currentUserRole) {
			const {
				data: { session }
			} = await dataService.supabaseClient.auth.getSession();
			if (session?.user) {
				const { data: profile } = await dataService.supabaseClient
					.from('profil')
					.select('role, username')
					.eq('id', session.user.id)
					.single();
				if (profile) {
					setUserRole(profile.role, profile);
				}
			}
		}

		// Removed fetchPin() and locked_pages check

		// Subscribe ke selectedBranch untuk fetch ulang data saat cabang berubah
		unsubscribeBranch = selectedBranch.subscribe(async (newBranch) => {
			// Skip jika ini adalah initial load
			if (isInitialLoad) {
				isInitialLoad = false;
				return;
			}

			// Reset semua metriks
			omzet = 0;
			jumlahTransaksi = 0;
			profit = 0;
			itemTerjual = 0;
			totalItem = 0;
			avgTransaksi = 0;
			jamRamai = '';
			weeklyIncome = [];
			weeklyMax = 1;
			bestSellers = [];
			isLoadingDashboard = true;
			isLoadingBestSellers = true;
			// Invalidate cache dashboard metriks untuk semua cabang
			await dataService.invalidateDashboardCaches();
			// Fetch ulang data
			await loadDashboardData();
		});
		// window.refreshDashboardData removed
	});

	onDestroy(() => {
		if (unsubscribeBranch) unsubscribeBranch();
		realtimeManager.unsubscribeAll();
		if (dashboardRefreshTimer) {
			clearTimeout(dashboardRefreshTimer);
			dashboardRefreshTimer = null;
		}
		// window.refreshDashboardData cleanup removed
	});

	function scheduleDashboardRealtimeRefresh(delayMs = 220) {
		if (dashboardRefreshTimer) {
			clearTimeout(dashboardRefreshTimer);
		}

		dashboardRefreshTimer = setTimeout(async () => {
			dashboardRefreshTimer = null;
			if (dashboardRefreshInFlight) return;

			dashboardRefreshInFlight = true;
			try {
				const dashboardStats = await dataService.getDashboardStats();
				const nextBestSellers = await dataService.getBestSellers();
				const weeklyData = await dataService.getWeeklyIncome();
				applyDashboardPayload(dashboardStats, nextBestSellers, weeklyData);
				await reportCacheMetrics('dashboard');
			} finally {
				dashboardRefreshInFlight = false;
			}
		}, delayMs);
	}

	// Load dashboard data dengan smart caching
	async function loadDashboardData() {
		try {
			isLoadingDashboard = true;

			// Load dashboard stats dengan cache
			const dashboardStats = await dataService.getDashboardStats();

			// Load best sellers dengan cache
			isLoadingBestSellers = true;
			const nextBestSellers = await dataService.getBestSellers();
			isLoadingBestSellers = false;

			// Load weekly income dengan cache
			const weeklyData = await dataService.getWeeklyIncome();
			applyDashboardPayload(dashboardStats, nextBestSellers, weeklyData);
			await reportCacheMetrics('dashboard');
		} catch (error) {
			errorBestSellers = 'Gagal memuat data dashboard';
		} finally {
			isLoadingDashboard = false;
			isLoadingBestSellers = false;
		}
	}

	// Setup real-time subscriptions
	function setupRealtimeSubscriptions() {
		// Subscribe to buku_kas changes for real-time dashboard updates
		realtimeManager.subscribe('buku_kas', async (payload) => {
			scheduleDashboardRealtimeRefresh();
		});

		// Subscribe to transaksi_kasir changes
		realtimeManager.subscribe('transaksi_kasir', async (payload) => {
			scheduleDashboardRealtimeRefresh();
		});
	}

	function computeDashboardPayloadFingerprint(
		data: DashboardStats | null,
		nextBestSellers: { name: string; image?: string; total_qty: number }[],
		weeklyData: { weeklyIncome: number[]; weeklyMax: number }
	): string {
		const weekly = Array.isArray(weeklyData?.weeklyIncome) ? weeklyData.weeklyIncome : [];
		const sellers = Array.isArray(nextBestSellers) ? nextBestSellers : [];
		const sellersSignature = sellers
			.map((item) => `${item?.name || ''}:${Number(item?.total_qty || 0)}`)
			.join(',');

		return [
			Number(data?.omzet || 0),
			Number(data?.jumlahTransaksi || 0),
			Number(data?.profit || 0),
			Number(data?.itemTerjual || 0),
			Number(data?.totalItem || 0),
			Number(data?.avgTransaksi || 0),
			String(data?.jamRamai || ''),
			weekly.length,
			weekly.reduce((sum, value) => sum + Number(value || 0), 0),
			Number(weeklyData?.weeklyMax || 1),
			sellers.length,
			sellersSignature
		].join('|');
	}

	function applyDashboardData(data: DashboardStats | null) {
		if (!data) return;
		omzet = data.omzet;
		jumlahTransaksi = data.jumlahTransaksi;
		profit = data.profit;
		itemTerjual = data.itemTerjual;
		totalItem = data.totalItem;
		avgTransaksi = data.avgTransaksi;
		jamRamai = data.jamRamai;
	}

	function applyDashboardPayload(
		data: DashboardStats | null,
		nextBestSellers: { name: string; image?: string; total_qty: number }[],
		weeklyData: { weeklyIncome: number[]; weeklyMax: number }
	) {
		const nextFingerprint = computeDashboardPayloadFingerprint(data, nextBestSellers, weeklyData);
		if (nextFingerprint === lastDashboardPayloadFingerprint) {
			return;
		}

		lastDashboardPayloadFingerprint = nextFingerprint;
		applyDashboardData(data);
		bestSellers = nextBestSellers || [];
		weeklyIncome = weeklyData?.weeklyIncome || [];
		weeklyMax = weeklyData?.weeklyMax || 1;
	}

	// Manual refresh function (for testing)
	async function refreshDashboardData() {
		await loadDashboardData();
	}

	// Removed fetchPin()

	// Data dummy, nanti diisi dari Supabase
	let modalAwal: number | null = null;

	// Touch handling variables
	let touchStartX = 0;
	let touchStartY = 0;
	let touchEndX = 0;
	let touchEndY = 0;
	let isSwiping = false;
	let isTouchDevice = false;
	let clickBlocked = false;

	const navs = [
		{ label: 'Beranda', path: '/' },
		{ label: 'Kasir', path: '/pos' },
		{ label: 'Catat', path: '/catat' },
		{ label: 'Laporan', path: '/laporan' }
	];

	// Removed 'stats' array

	let imageError: Record<number, boolean> = {};

	function handleImgError(index: number) {
		imageError[index] = true;
	}

	// Hapus deklarasi let days = ...
	// Tambahkan fungsi untuk generate label hari dinamis
	function getLast7DaysLabels() {
		const hari = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
		const today = new Date();
		let labels = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(today.getDate() - i);
			labels.push(hari[d.getDay()]);
		}
		return labels;
	}

	function getLast7DaysLabelsWITA() {
		const hari = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
		const todayWITA = getTodayWITA();
		let labels = [];
		for (let i = 6; i >= 0; i--) {
			const d = new Date(todayWITA);
			d.setDate(todayWITA.getDate() - i);
			labels.push(hari[d.getDay()]);
		}
		return labels;
	}

	// Removed PIN Modal State (showPinModal, pin, isClosing)

	// Toast notification state
	let showToast = false;
	let toastMessage = '';
	let toastType: 'success' | 'error' | 'warning' | 'info' = 'success';

	function showToastNotification(
		message: string,
		type: 'success' | 'error' | 'warning' | 'info' = 'success'
	) {
		toastMessage = message;
		toastType = type;
		showToast = true;
	}

	let showTokoModal = false;
	let isBukaToko = true; // true: buka toko, false: tutup toko
// Verifikasi PIN untuk aksi kasir (buka/tutup)
let showActionPinModal = false;
let actionPin = '1234';
let modalAwalInput = '';
let pinInputToko = '';
let pinErrorToko = '';
let tokoAktifLocal = false;
let sesiAktif: {
		id: string;
		opening_cash: number;
		opening_time: string;
		is_active: boolean;
	} | null = null;
let ringkasanTutup: {
		modalAwal: number;
		totalPenjualan: number;
		pemasukanTunai: number;
		pengeluaranTunai: number;
		uangKasir: number;
	} = {
		modalAwal: 0,
		totalPenjualan: 0,
		pemasukanTunai: 0,
		pengeluaranTunai: 0,
		uangKasir: 0
	};

	function updateTokoAktif(val: boolean) {
		tokoAktifLocal = val;
		// window.tokoAktif removed
	}

	async function cekSesiToko() {
		const { data } = await dataService.supabaseClient
			.from('sesi_toko')
			.select('*')
			.eq('is_active', true)
			.order('opening_time', { ascending: false })
			.limit(1)
			.maybeSingle();
		sesiAktif = data || null;
		updateTokoAktif(!!sesiAktif);
		// Update modalAwal agar box di beranda selalu sinkron
		modalAwal = sesiAktif?.opening_cash ?? null;
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
		// Jika kasir, wajib verifikasi PIN dahulu (PIN dari pengaturan/securitySettings)
		if (currentUserRole === 'kasir') {
			const settingsVal: any = storeGet(securitySettings);
			actionPin = (settingsVal && settingsVal.pin) || '1234';
			pendingAction = () => {
				cekSesiToko().then(() => {
					isBukaToko = !tokoAktifLocal;
					showTokoModal = true;
					modalAwalInput = '';
					pinInputToko = '';
					pinErrorToko = '';
					if (!isBukaToko) hitungRingkasanTutup();
				});
			};
			showActionPinModal = true;
			return;
		}
		// Non-kasir langsung buka modal
		cekSesiToko().then(() => {
			isBukaToko = !tokoAktifLocal;
			showTokoModal = true;
			modalAwalInput = '';
			pinInputToko = '';
			pinErrorToko = '';
			if (!isBukaToko) hitungRingkasanTutup();
		});
	}

	// Pending action setelah PIN benar
	let pendingAction: (() => void) | null = null;

function handleActionPinSuccess() {
	showActionPinModal = false;
	if (pendingAction) pendingAction();
	pendingAction = null;
}

function handleActionPinClose() {
	showActionPinModal = false;
	pendingAction = null;
}

	async function handleBukaToko() {
		const modalAwalRaw = Number((modalAwalInput || '').replace(/\D/g, ''));
		if (!modalAwalRaw || isNaN(modalAwalRaw) || modalAwalRaw < 0) {
			pinErrorToko = 'Modal awal wajib diisi dan valid';
			return;
		}
		await dataService.supabaseClient.from('sesi_toko').insert({
			opening_cash: modalAwalRaw,
			opening_time: witaToUtcISO(getTodayWita(), getNowWita().split('T')[1]),
			is_active: true
		});
		showTokoModal = false;
		cekSesiToko();
	}

	async function hitungRingkasanTutup() {
		if (!sesiAktif) return;
		const { data: kasRaw } = await dataService.supabaseClient
			.from('buku_kas')
			.select('*')
			.eq('id_sesi_toko', sesiAktif.id);
		type Kas = {
			payment_method?: string;
			tipe?: string;
			amount?: number;
			transaction_date?: string;
			id_sesi_toko?: string;
			sumber?: string;
		};
		let kas: Kas[] = Array.isArray(kasRaw) ? kasRaw : [];

		// Penjualan tunai (semua pemasukan tunai)
		const penjualanTunai = kas
			.filter((t) => t.tipe === 'in' && t.payment_method === 'tunai')
			.reduce((a, b) => a + (b.amount || 0), 0);
		// Pengeluaran tunai
		const pengeluaranTunai = kas
			.filter((t) => t.tipe === 'out' && t.payment_method === 'tunai')
			.reduce((a, b) => a + (b.amount || 0), 0);
		const modalAwal = sesiAktif.opening_cash || 0;
		// Total penjualan = semua pemasukan (in) dari sumber pos
		const totalPenjualan = kas
			.filter((t) => t.tipe === 'in' && t.sumber === 'pos')
			.reduce((a, b) => a + (b.amount || 0), 0);
		// Uang kasir seharusnya
		const uangKasir = modalAwal + penjualanTunai - pengeluaranTunai;
		ringkasanTutup = {
			modalAwal,
			totalPenjualan,
			pemasukanTunai: penjualanTunai,
			pengeluaranTunai,
			uangKasir
		};
	}

	async function handleTutupToko() {
		if (!sesiAktif) return;
		await dataService.supabaseClient
			.from('sesi_toko')
			.update({
				closing_time: witaToUtcISO(getTodayWita(), getNowWita().split('T')[1]),
				is_active: false
			})
			.eq('id', sesiAktif.id);
		showTokoModal = false;
		cekSesiToko();
	}

	function handleTouchStart(e: TouchEvent) {
		if (!isTouchDevice) return;

		// Don't handle touch on interactive elements
		const target = e.target as HTMLElement;
		if (
			target.tagName === 'BUTTON' ||
			target.tagName === 'INPUT' ||
			target.tagName === 'A' ||
			target.closest('button') ||
			target.closest('input') ||
			target.closest('a')
		) {
			return;
		}

		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		isSwiping = false;
		clickBlocked = false;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isTouchDevice) return;

		// Don't handle touch on interactive elements
		const target = e.target as HTMLElement;
		if (
			target.tagName === 'BUTTON' ||
			target.tagName === 'INPUT' ||
			target.tagName === 'A' ||
			target.closest('button') ||
			target.closest('input') ||
			target.closest('a')
		) {
			return;
		}
		if (browser) {
			touchEndX = e.touches[0].clientX;
			touchEndY = e.touches[0].clientY;
			const deltaX = Math.abs(touchEndX - touchStartX);
			const deltaY = Math.abs(touchEndY - touchStartY);
			const viewportWidth = window.innerWidth;
			const swipeThreshold = viewportWidth * 0.25; // 25% of viewport width (sama dengan pengaturan/pemilik)
			if (deltaX > swipeThreshold && deltaX > deltaY) {
				isSwiping = true;
				clickBlocked = true;
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (!isTouchDevice) return;

		// Don't handle touch on interactive elements
		const target = e.target as HTMLElement;
		if (
			target.tagName === 'BUTTON' ||
			target.tagName === 'INPUT' ||
			target.tagName === 'A' ||
			target.closest('button') ||
			target.closest('input') ||
			target.closest('a')
		) {
			return;
		}

		if (browser && isSwiping) {
			// Handle swipe navigation
			const deltaX = touchEndX - touchStartX;
			const viewportWidth = window.innerWidth;
			const swipeThreshold = viewportWidth * 0.25; // 25% of viewport width (sama dengan pengaturan/pemilik)

			if (Math.abs(deltaX) > swipeThreshold) {
				const currentIndex = 0; // Beranda is index 0
				if (deltaX > 0 && currentIndex > 0) {
					// Swipe right - go to previous tab
					goto(navs[currentIndex - 1].path);
				} else if (deltaX < 0 && currentIndex < navs.length - 1) {
					// Swipe left - go to next tab
					goto(navs[currentIndex + 1].path);
				}
			}

			// Block any subsequent click events
			setTimeout(() => {
				clickBlocked = false;
			}, 100);
		}
	}

	function handleGlobalClick(e: Event) {
		if (clickBlocked) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
	}

	// New function to format modalAwalInput to Rupiah format
	function formatModalAwalInput(e: Event) {
		let value = (e.target as HTMLInputElement).value.replace(/[^0-9]/g, ''); // Remove non-numeric characters
		if (value.length > 0) {
			value = Number(value).toLocaleString('id-ID'); // Format as Rupiah
		}
		modalAwalInput = value;
	}

	// New function to get the raw number from formatted input
	function getModalAwalInputRaw() {
		return Number(modalAwalInput.replace(/\./g, '')); // Remove dots and convert to number
	}

	// New function to set the raw number to formatted input
	function getModalAwalInputFormatted() {
		return modalAwalInput;
	}

	// New function to set the formatted value for binding
	function setModalAwalInputFormatted(value: string) {
		modalAwalInput = value;
	}

	let hideTopbar = false;
	let topbarRef: HTMLDivElement | null = null;
	let sentinelRef: HTMLDivElement | null = null;
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
	function getTodayWITA() {
		// Ambil waktu sekarang di Asia/Makassar (WITA)
		const now = new Date();
		const witaString = getNowWita();
		const witaDate = new Date(witaString);
		witaDate.setHours(0, 0, 0, 0); // Set ke jam 00:00:00
		return witaDate;
	}

	// Inisialisasi range 7 hari terakhir berdasarkan hari WITA
	const todayWITA = getTodayWITA();
	const sevenDaysAgoWITA = new Date(todayWITA);
	sevenDaysAgoWITA.setDate(todayWITA.getDate() - 6); // 6 hari ke belakang + hari ini = 7 hari
	const startDate = sevenDaysAgoWITA.toISOString().slice(0, 10) + 'T00:00:00.000Z';

	let selectedBarIndex: number | null = null;
	let showBarInsight = false;
	let barHoldTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleBarPointerDown(i: number) {
		barHoldTimeout = setTimeout(() => {
			selectedBarIndex = i;
			showBarInsight = true;
		}, 120); // Sedikit delay agar tidak accidental tap
	}

	function handleBarPointerUp() {
		if (barHoldTimeout) clearTimeout(barHoldTimeout);
		showBarInsight = false;
		selectedBarIndex = null;
	}
</script>

<!-- PinModal removed -->

<!-- Toast Notification -->
<ToastNotification
	show={showToast}
	message={toastMessage}
	type={toastType}
	duration={2000}
	position="top"
/>

{#if showActionPinModal}
	<PinModal
		show={showActionPinModal}
		pin={actionPin}
		title="Verifikasi Aksi"
		subtitle="Masukkan PIN untuk melanjutkan"
		on:success={handleActionPinSuccess}
		on:close={handleActionPinClose}
	/>
{/if}

<!-- Modal Buka/Tutup Toko -->
{#if showTokoModal}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
		onclick={() => (showTokoModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showTokoModal = false)}
		role="dialog"
		aria-modal="true"
		aria-label="Modal buka tutup toko"
		onkeyup={(e) => e.key === 'Enter' && (showTokoModal = false)}
		tabindex="-1"
		onkeypress={(e) => e.key === 'Enter' && (showTokoModal = false)}
	>
		<div
			class="modal-slideup mx-auto box-border w-full max-w-[95vw] rounded-2xl bg-white p-8 shadow-2xl md:p-12 lg:max-w-lg lg:p-10 xl:max-w-xl xl:p-12 2xl:max-w-2xl 2xl:p-16"
			onclick={(event) => event.stopPropagation()}
			role="document"
		>
			{#if isBukaToko}
				<div class="mb-4 flex flex-col items-center">
					<div class="mb-2 text-4xl">🍹</div>
					<h2 class="mb-1 text-xl font-bold text-pink-500">Buka Toko</h2>
					<div class="mb-2 text-sm text-gray-400">Yuk, buka toko dan mulai hari ini.</div>
				</div>
				<div class="mb-4">
					<div class="relative">
						<span
							class="absolute top-1/2 left-4 -translate-y-1/2 font-semibold text-pink-400 select-none"
							>Rp</span
						>
						<input
							type="text"
							inputmode="numeric"
							pattern="[0-9]*"
							min="0"
							bind:value={modalAwalInput}
							oninput={formatModalAwalInput}
							class="w-full rounded-xl border-2 border-pink-200 bg-pink-50 py-3 pr-4 pl-12 text-lg font-bold text-gray-800 placeholder-pink-300 shadow-sm transition outline-none focus:ring-2 focus:ring-pink-300"
							placeholder="Modal awal kas hari ini"
						/>
					</div>
				</div>
				{#if pinErrorToko}
					<div
						class="fixed top-20 left-1/2 z-50 rounded-xl bg-red-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out"
						style="transform: translateX(-50%);"
						in:fly={{ y: -32, duration: 300, easing: cubicOut }}
						out:fade={{ duration: 200 }}
					>
						{pinErrorToko}
					</div>
				{/if}
				<button
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 py-3 text-lg font-extrabold text-white shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-100"
					onclick={handleBukaToko}
				>
					<span class="text-2xl">🍹</span>
					<span>Buka Toko Sekarang</span>
				</button>
			{:else}
				<div class="mb-4 flex flex-col items-center">
					<div class="mb-2 text-4xl">🔒</div>
					<h2 class="mb-1 text-xl font-bold text-pink-500">Tutup Toko</h2>
					<div class="mb-2 text-center text-sm text-gray-400">
						Terima kasih atas kerja keras hari ini! Cek ringkasan sebelum tutup toko.
					</div>
				</div>
				<div class="mb-4 space-y-3 text-base text-gray-700">
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Modal Awal</span><span>Rp {ringkasanTutup.modalAwal.toLocaleString('id-ID')}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Total Penjualan</span><span
							>Rp {ringkasanTutup.totalPenjualan.toLocaleString('id-ID')}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Pemasukan Tunai</span><span
							>Rp {ringkasanTutup.pemasukanTunai.toLocaleString('id-ID')}</span
						>
					</div>
					<div
						class="flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50 px-4 py-3 font-semibold"
					>
						<span>Pengeluaran Tunai</span><span
							>Rp {ringkasanTutup.pengeluaranTunai.toLocaleString('id-ID')}</span
						>
					</div>
					<div class="mb-1 flex flex-col items-center">
						<div class="mb-1 text-center text-base font-bold text-pink-600 md:text-lg">
							Uang Kasir Seharusnya
						</div>
						<div
							class="mx-8 flex w-full max-w-xs flex-col items-center justify-center rounded-xl border-2 border-pink-400 bg-white px-2 py-5 shadow-sm md:mx-16"
						>
							<div class="mb-1 text-4xl">💸</div>
							<span
								class="animate-glow text-2xl font-extrabold whitespace-nowrap text-pink-600 md:text-3xl"
								>Rp {ringkasanTutup.uangKasir.toLocaleString('id-ID')}</span
							>
							<div class="mt-2 text-center text-xs text-gray-400">
								Pastikan uang kasir sesuai sebelum tutup toko
							</div>
						</div>
					</div>
				</div>
				<button
					class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-pink-400 py-3 text-lg font-extrabold text-white shadow-xl transition-all hover:scale-105 hover:shadow-2xl active:scale-100"
					onclick={handleTutupToko}
				>
					<span class="text-2xl">🔒</span>
					<span>Tutup Toko Sekarang</span>
				</button>
			{/if}
		</div>
	</div>
{/if}

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

<div
	class="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-white"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
>
	<main
		class="page-content min-h-0 w-full max-w-full flex-1 overflow-x-hidden md:mx-auto md:max-w-3xl md:rounded-2xl md:bg-white md:shadow-xl lg:max-w-5xl"
	>
		<div class="px-4 pt-2 pb-4 md:px-8 md:pt-4 md:pb-8 lg:px-12 lg:pt-6 lg:pb-10">
			<div class="flex flex-col space-y-3 md:space-y-10">
				<!-- Metrik Utama -->
				<DashboardMetrics
					{itemTerjual}
					{jumlahTransaksi}
					{omzet}
					{modalAwal}
					ShoppingBagIcon={ShoppingBag}
					TrendingUpIcon={TrendingUp}
					WalletIcon={Wallet}
				/>

				<!-- Menu Terlaris -->
				<BestSellersList
					{isLoadingBestSellers}
					{errorBestSellers}
					{bestSellers}
				/>

				<!-- Grafik & Statistik -->
				<div bind:this={incomeChartRef}>
					<IncomeChart
						{avgTransaksi}
						{jamRamai}
						{weeklyIncome}
						{weeklyMax}
						{barsVisible}
						{getLast7DaysLabelsWITA}
					/>
				</div>
			</div>
		</div>
	</main>
	<div class="sticky bottom-0 z-30 bg-white md:hidden">
		<!-- BottomNav hanya muncul di mobile -->
	</div>
</div>

<style>
	.modal-slideup {
		animation: modalSlideUp 0.28s cubic-bezier(0.4, 1.4, 0.6, 1);
	}
	@keyframes modalSlideUp {
		from {
			transform: translateY(64px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes glow {
		0%,
		100% {
			box-shadow: 0 0 0 0 #ec489980;
		}
		50% {
			box-shadow: 0 0 16px 4px #ec489980;
		}
	}
	.animate-glow {
		animation: glow 1.5s ease-in-out 1;
	}
</style>
