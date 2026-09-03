import { dashboardService } from '$lib/services/dashboardService';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
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

	async function loadDashboardData() {
		try {
			// [CATATAN]: Load dashboard stats dengan cache
			const dashboardStats = await dashboardService.getDashboardStats();

			// [CATATAN]: Load best sellers dengan cache
			isLoadingBestSellers = true;
			const nextBestSellers = await dashboardService.getBestSellers();
			isLoadingBestSellers = false;

			// [CATATAN]: Load weekly income dengan cache
			const weeklyData = await dashboardService.getWeeklyIncome();
			applyDashboardPayload(dashboardStats, nextBestSellers, weeklyData);
			await reportCacheMetrics('dashboard');
		} catch (error) {
			errorBestSellers = 'Gagal memuat data dashboard';
		} finally {
			isLoadingDashboard = false;
			isLoadingBestSellers = false;
		}
	}

	function scheduleDashboardRealtimeRefresh(delayMs = 220) {
		if (dashboardRefreshTimer) {
			clearTimeout(dashboardRefreshTimer);
		}

		dashboardRefreshTimer = setTimeout(async () => {
			dashboardRefreshTimer = null;
			if (dashboardRefreshInFlight) return;

			dashboardRefreshInFlight = true;
			try {
				const dashboardStats = await dashboardService.getDashboardStats();
				const nextBestSellers = await dashboardService.getBestSellers();
				const weeklyData = await dashboardService.getWeeklyIncome();
				applyDashboardPayload(dashboardStats, nextBestSellers, weeklyData);
				await reportCacheMetrics('dashboard');
			} finally {
				dashboardRefreshInFlight = false;
			}
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
		let offDashboardRefreshBus: (() => void) | null = null;

		(async () => {
			await loadDashboardData();
			setupRealtimeSubscriptions();
			offDashboardRefreshBus = refreshBus.on('dashboard', () => {
				scheduleDashboardRealtimeRefresh();
			});
		})();

		return () => {
			realtimeDisposers.forEach((d) => d());
			realtimeDisposers = [];
			if (dashboardRefreshTimer) {
				clearTimeout(dashboardRefreshTimer);
				dashboardRefreshTimer = null;
			}
			if (offDashboardRefreshBus) {
				offDashboardRefreshBus();
				offDashboardRefreshBus = null;
			}
		};
	});

	$effect(() => {
		const _branch = selectedBranch.value;
		if (isInitialLoad) {
			isInitialLoad = false;
			return;
		}

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
		// [CATATAN]: Async dalam effect: jalankan via fire-and-forget
		(async () => {
			await cacheOrchestrator.invalidateDashboardCaches();
			await loadDashboardData();
		})();
	});

	async function refreshDashboardData() {
		await loadDashboardData();
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
