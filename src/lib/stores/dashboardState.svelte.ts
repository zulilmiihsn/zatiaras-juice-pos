import { untrack } from 'svelte';
import { dashboardService } from '$lib/services/dashboardService';
import { handlePinRequired } from '$lib/services/pinAccessService';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { reportCacheMetrics } from '$lib/utils/cacheMetrics';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { refreshBus } from '$lib/utils/refreshBus';
import type { DashboardStats, WeeklyIncomeData, BestSeller, TopUsedIngredient } from '$lib/types';

export function createDashboardState() {
	let omzet = $state(0);
	let jumlahTransaksi = $state(0);
	let profit = $state(0);
	let itemTerjual = $state(0);
	let totalItem = $state(0);
	let avgTransaksi = $state(0);
	let jamRamai = $state('');
	let penjualanTunai = $state(0);
	let penjualanNonTunai = $state(0);
	let lowStockCount = $state(0);
	let lowStockNames = $state<string[]>([]);
	let topIngredients = $state<TopUsedIngredient[]>([]);

	let weeklyIncome = $state<number[]>([]);
	let weeklyMax = $state(1);
	let bestSellers = $state<BestSeller[]>([]);

	let isLoadingBestSellers = $state(true);
	let errorBestSellers = $state('');
	let isLoadingDashboard = $state(true);

	let dashboardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let dashboardRefreshInFlight = false;
	let lastDashboardPayloadFingerprint = '';

	let active = false;
	let generation = 0;
	let refreshRequested = false;
	let forceRequested = false;
	let isInitialLoad = true;

	function computeDashboardPayloadFingerprint(
		data: DashboardStats | null,
		nextBestSellers: BestSeller[],
		weeklyData: WeeklyIncomeData
	): string {
		const weekly = Array.isArray(weeklyData?.weeklyIncome) ? weeklyData.weeklyIncome : [];
		const sellers = Array.isArray(nextBestSellers) ? nextBestSellers : [];
		const sellersSignature = sellers
			.map((item) => `${item?.nama || ''}:${Number(item?.total_qty || 0)}`)
			.join(',');

		return [
			Number(data?.omzet || 0),
			Number(data?.jumlahTransaksi || 0),
			Number(data?.profit || 0),
			Number(data?.itemTerjual || 0),
			Number(data?.totalItem || 0),
			Number(data?.avgTransaksi || 0),
			String(data?.jamRamai || ''),
			Number(data?.penjualanTunai || 0),
			Number(data?.penjualanNonTunai || 0),
			Number(data?.lowStockCount || 0),
			(data?.lowStockNames || []).join(','),
			(data?.topIngredients || [])
				.map((i) => `${i.id}:${i.terpakai}:${i.stok_saat_ini}:${i.is_low}`)
				.join(';'),
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
		penjualanTunai = Number(data.penjualanTunai || 0);
		penjualanNonTunai = Number(data.penjualanNonTunai || 0);
		lowStockCount = Number(data.lowStockCount || 0);
		lowStockNames = Array.isArray(data.lowStockNames) ? data.lowStockNames : [];
		topIngredients = Array.isArray(data.topIngredients) ? data.topIngredients : [];
	}

	function applyDashboardPayload(
		data: DashboardStats | null,
		nextBestSellers: BestSeller[],
		weeklyData: WeeklyIncomeData
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

	async function loadDashboardData(forceRefresh = false) {
		refreshRequested = true;
		forceRequested ||= forceRefresh;
		if (dashboardRefreshInFlight || !active) return;
		dashboardRefreshInFlight = true;
		try {
			while (active && refreshRequested) {
				refreshRequested = false;
				const force = forceRequested;
				forceRequested = false;
				const flightGeneration = generation;
				const branch = selectedBranch.value;
				const epoch = selectedBranch.contextEpoch;
				const current = () =>
					active &&
					generation === flightGeneration &&
					selectedBranch.value === branch &&
					selectedBranch.contextEpoch === epoch;
				try {
					const dashboardStats = await dashboardService.getDashboardStats(force);
					if (!current()) continue;
					const nextBestSellers = await dashboardService.getBestSellers(force);
					if (!current()) continue;
					const weeklyData = await dashboardService.getWeeklyIncome(force);
					if (!current()) continue;
					applyDashboardPayload(dashboardStats, nextBestSellers, weeklyData);
					errorBestSellers = '';
					await reportCacheMetrics('dashboard');
				} catch (error) {
					if (current() && !handlePinRequired(error))
						errorBestSellers = 'Gagal memuat data dashboard';
				} finally {
					if (current()) {
						isLoadingDashboard = false;
						isLoadingBestSellers = false;
					}
				}
			}
		} finally {
			dashboardRefreshInFlight = false;
		}
	}

	function scheduleDashboardRealtimeRefresh(delayMs = 220) {
		if (dashboardRefreshTimer) {
			clearTimeout(dashboardRefreshTimer);
		}

		dashboardRefreshTimer = setTimeout(async () => {
			dashboardRefreshTimer = null;
			await loadDashboardData(true);
		}, delayMs);
	}

	let realtimeDisposers: Array<() => void> = [];

	function setupRealtimeSubscriptions() {
		realtimeDisposers.forEach((d) => d());
		realtimeDisposers = [
			realtimeManager.subscribe('buku_kas', async () => scheduleDashboardRealtimeRefresh()),
			realtimeManager.subscribe('transaksi_kasir', async () => scheduleDashboardRealtimeRefresh())
		];
	}

	$effect(() => {
		const branch = selectedBranch.value;
		const epoch = selectedBranch.contextEpoch;
		if (typeof window === 'undefined' || !localStorage.getItem('zatiaras_session')) return;
		active = true;
		generation++;
		lastDashboardPayloadFingerprint = '';
		const force = !isInitialLoad;
		isInitialLoad = false;
		omzet = jumlahTransaksi = profit = itemTerjual = totalItem = avgTransaksi = 0;
		penjualanTunai = penjualanNonTunai = lowStockCount = 0;
		lowStockNames = [];
		topIngredients = [];
		jamRamai = '';
		weeklyIncome = [];
		weeklyMax = 1;
		bestSellers = [];
		isLoadingDashboard = isLoadingBestSellers = true;
		untrack(() => {
			setupRealtimeSubscriptions();
			void loadDashboardData(force);
		});
		const offDashboardRefreshBus = refreshBus.on('dashboard', () =>
			scheduleDashboardRealtimeRefresh()
		);
		const onResume = () => {
			if (
				document.visibilityState !== 'visible' ||
				!navigator.onLine ||
				selectedBranch.value !== branch ||
				selectedBranch.contextEpoch !== epoch
			)
				return;
			scheduleDashboardRealtimeRefresh();
		};
		document.addEventListener('visibilitychange', onResume);
		window.addEventListener('focus', onResume);
		window.addEventListener('pageshow', onResume);
		window.addEventListener('online', onResume);
		window.addEventListener('realtime-connected', onResume);

		return () => {
			active = false;
			generation++;
			refreshRequested = forceRequested = false;
			document.removeEventListener('visibilitychange', onResume);
			window.removeEventListener('focus', onResume);
			window.removeEventListener('pageshow', onResume);
			window.removeEventListener('online', onResume);
			window.removeEventListener('realtime-connected', onResume);
			realtimeDisposers.forEach((d) => d());
			realtimeDisposers = [];
			if (dashboardRefreshTimer) {
				clearTimeout(dashboardRefreshTimer);
				dashboardRefreshTimer = null;
			}
			offDashboardRefreshBus();
		};
	});

	async function refreshDashboardData() {
		await loadDashboardData(true);
	}

	return {
		get omzet() {
			return omzet;
		},
		get jumlahTransaksi() {
			return jumlahTransaksi;
		},
		get profit() {
			return profit;
		},
		get itemTerjual() {
			return itemTerjual;
		},
		get totalItem() {
			return totalItem;
		},
		get avgTransaksi() {
			return avgTransaksi;
		},
		get jamRamai() {
			return jamRamai;
		},
		get penjualanTunai() {
			return penjualanTunai;
		},
		get penjualanNonTunai() {
			return penjualanNonTunai;
		},
		get lowStockCount() {
			return lowStockCount;
		},
		get lowStockNames() {
			return lowStockNames;
		},
		get topIngredients() {
			return topIngredients;
		},
		get weeklyIncome() {
			return weeklyIncome;
		},
		get weeklyMax() {
			return weeklyMax;
		},
		get bestSellers() {
			return bestSellers;
		},
		get isLoadingDashboard() {
			return isLoadingDashboard;
		},
		get isLoadingBestSellers() {
			return isLoadingBestSellers;
		},
		get errorBestSellers() {
			return errorBestSellers;
		},
		refreshDashboardData
	};
}
