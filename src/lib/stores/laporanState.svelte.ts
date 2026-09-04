import { onMount, onDestroy } from 'svelte';
import { refreshBus } from '$lib/utils/refreshBus';
import { getTodayWita, getNowWita } from '$lib/utils/dateTime';
import { userRole, setUserRole } from '$lib/stores/userRole.svelte';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import { dashboardService } from '$lib/services/dashboardService';
import { reportCacheMetrics } from '$lib/utils/cacheMetrics';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { createToastManager } from '$lib/utils/ui';
import { ErrorHandler } from '$lib/utils/errorHandling';
import { groupReportTransactions } from '$lib/utils/reportGrouping';
import { calculateTaxes, getTaxSettings } from '$lib/services/taxService';
import type { BukuKasRecord, LaporanSummary } from '$lib/types/laporan';

export function createLaporanState() {
	let FilterIcon = $state<import('svelte').Component | null>(null);

	let isInitialLoad = true;
	let laporanRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	let laporanRefreshInFlight = false;
	let lastLaporanRefreshAt = 0;
	let lastAppliedReportFingerprint = '';

	let showFilter = $state(false);
	let showDatePicker = $state(false);
	let showEndDatePicker = $state(false);
	let isLoadingReport = $state(false);
	let filterType: 'harian' | 'mingguan' | 'bulanan' | 'tahunan' = $state('harian');
	let filterDate = $state(getLocalDateStringWITA());
	let filterMonth = $state((new Date(getNowWita()).getMonth() + 1).toString().padStart(2, '0'));
	let filterYear = $state(new Date(getNowWita()).getFullYear().toString());
	let startDate = $state(getLocalDateStringWITA());
	let endDate = $state(getLocalDateStringWITA());

	let summary: LaporanSummary = $state({
		pendapatan: null,
		pengeluaran: null,
		saldo: null,
		labaKotor: null,
		pajak: null,
		labaBersih: null
	});
	let laporan: BukuKasRecord[] = $state([]);

	const currentUserRole = $derived(userRole.value || '');
	const reportGroups = $derived(groupReportTransactions(laporan));
	const toastManager = createToastManager();

	function getLocalDateStringWITA(): string {
		const now = new Date(getNowWita());
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function computeReportFingerprint(reportData: {
		summary?: LaporanSummary;
		transactions?: BukuKasRecord[];
	}): string {
		const summaryData: LaporanSummary = reportData?.summary || {
			pendapatan: null,
			pengeluaran: null,
			saldo: null,
			labaKotor: null,
			pajak: null,
			labaBersih: null
		};
		const transactions = reportData?.transactions || [];
		const txLength = Array.isArray(transactions) ? transactions.length : 0;
		let totalNominal = 0,
			latestTs = '',
			paymentSignature = '',
			detailSignature = '';
		for (const tx of transactions) {
			totalNominal += Number(tx?.nominal ?? 0) || 0;
			const ts = String(tx?.waktu || tx?.created_at || '');
			if (ts > latestTs) latestTs = ts;
			paymentSignature += `|${tx?.id || ''}:${tx?.metode_bayar || ''}`;
			detailSignature += `|${tx?.id || ''}:${tx?.tipe || ''}:${tx?.jenis || ''}:${tx?.deskripsi || ''}`;
		}
		return [
			Number(summaryData?.pendapatan || 0),
			Number(summaryData?.pengeluaran || 0),
			Number(summaryData?.saldo || 0),
			Number(summaryData?.labaKotor || 0),
			Number(summaryData?.pajak || 0),
			Number(summaryData?.labaBersih || 0),
			txLength,
			totalNominal,
			latestTs,
			paymentSignature,
			detailSignature
		].join('|');
	}

	async function scheduleLaporanRefresh(delayMs = 220, force = false) {
		if (!force && Date.now() - lastLaporanRefreshAt < 400) return;
		if (laporanRefreshTimer) clearTimeout(laporanRefreshTimer);
		laporanRefreshTimer = setTimeout(async () => {
			laporanRefreshTimer = null;
			if (laporanRefreshInFlight) return;
			laporanRefreshInFlight = true;
			try {
				await loadLaporanData({ silent: true });
				lastLaporanRefreshAt = Date.now();
			} finally {
				laporanRefreshInFlight = false;
			}
		}, delayMs);
	}

	async function loadLaporanData(options: { silent?: boolean } = {}) {
		const silent = options.silent === true;
		try {
			if (!silent) isLoadingReport = true;
			if (!startDate || !endDate) {
				startDate = startDate || getLocalDateStringWITA();
				endDate = endDate || startDate;
			}
			const dateRange = startDate === endDate ? startDate : `${startDate}_${endDate}`;
			const reportData = await dashboardService.getReportData(dateRange, 'daily');
			const rawReport = reportData as unknown as {
				data?: {
					summary?: LaporanSummary;
					transactions?: BukuKasRecord[];
				};
				summary?: LaporanSummary;
				transactions?: BukuKasRecord[];
			};
			const reportDataContent = rawReport?.data || rawReport || {};
			const nextFingerprint = computeReportFingerprint(reportDataContent);
			if (nextFingerprint === lastAppliedReportFingerprint) {
				await reportCacheMetrics('laporan');
				return;
			}
			lastAppliedReportFingerprint = nextFingerprint;
			const rawSummary = reportDataContent.summary || {
				pendapatan: 0,
				pengeluaran: 0,
				saldo: 0,
				labaKotor: 0,
				pajak: 0,
				labaBersih: 0
			};
			const pendapatanVal = Number(rawSummary.pendapatan || 0);
			const pengeluaranVal = Number(rawSummary.pengeluaran || 0);
			const labaKotorVal = Number(rawSummary.labaKotor || pendapatanVal - pengeluaranVal);
			const taxResult = calculateTaxes(
				pendapatanVal,
				labaKotorVal,
				getTaxSettings(selectedBranch.value)
			);

			summary = {
				pendapatan: pendapatanVal,
				pengeluaran: pengeluaranVal,
				saldo: labaKotorVal,
				labaKotor: labaKotorVal,
				pajak: taxResult.totalPajak,
				labaBersih: taxResult.labaBersih,
				taxBreakdown: taxResult.breakdowns.map((b) => ({
					nama: b.nama,
					persentase: b.persentase,
					nominal: b.nominalPajak
				})),
				taxLabel: taxResult.activeTaxesLabel
			};
			laporan = reportDataContent.transactions || [];
			await reportCacheMetrics('laporan');
		} catch (error) {
			ErrorHandler.logError(error, 'loadLaporanData');
			if (!silent) toastManager.showToastNotification('Gagal memuat data laporan', 'error');
		} finally {
			if (!silent)
				setTimeout(() => {
					isLoadingReport = false;
				}, 300);
		}
	}

	let realtimeDisposers: Array<() => void> = [];

	function setupRealtimeSubscriptions() {
		realtimeDisposers.forEach((d) => d());
		realtimeDisposers = [
			realtimeManager.subscribe('buku_kas', async () => {
				await scheduleLaporanRefresh(220);
			}),
			realtimeManager.subscribe('transaksi_kasir', async () => {
				await scheduleLaporanRefresh(220);
			})
		];
		if (typeof window !== 'undefined') {
			window.addEventListener('zatiara:tax_settings_updated', async () => {
				lastAppliedReportFingerprint = '';
				await scheduleLaporanRefresh(50, true);
			});
		}
	}

	async function initializePageData() {
		if (!startDate) startDate = getLocalDateStringWITA();
		if (!endDate) endDate = startDate;
		await loadLaporanData();
		setupRealtimeSubscriptions();
	}

	function calculateDateRange(type: string, date?: string, month?: string, year?: string) {
		if (!date && !month && !year) return { startDate: '', endDate: '' };
		try {
			switch (type) {
				case 'harian':
					if (date) return { startDate: date, endDate: date };
					break;
				case 'mingguan':
					if (date) {
						const sd = new Date(date + 'T00:00:00');
						if (isNaN(sd.getTime())) return { startDate: '', endDate: '' };
						const ed = new Date(sd);
						ed.setDate(sd.getDate() + 6);
						return {
							startDate: sd.toISOString().split('T')[0],
							endDate: ed.toISOString().split('T')[0]
						};
					}
					break;
				case 'bulanan':
					if (month && year) {
						const y = parseInt(year),
							m = parseInt(month) - 1;
						if (isNaN(y) || isNaN(m) || m < 0 || m > 11) return { startDate: '', endDate: '' };
						const first = new Date(y, m, 1),
							last = new Date(y, m + 1, 0);
						const fmt = (d: Date) =>
							`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
						return { startDate: fmt(first), endDate: fmt(last) };
					}
					break;
				case 'tahunan':
					if (year) {
						const y = parseInt(year);
						if (isNaN(y) || y < 1900 || y > 2100) return { startDate: '', endDate: '' };
						return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
					}
					break;
			}
		} catch {}
		return { startDate: '', endDate: '' };
	}

	function getDeskripsiLaporan(item: BukuKasRecord): string {
		return item?.deskripsi?.trim() || item?.catatan?.trim() || '-';
	}

	function formatDate(dateString: string, _isEndDate = false): string {
		if (!dateString) return '';
		const date = new Date(dateString + 'T00:00:00+08:00');
		return date.toLocaleDateString('id-ID', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'Asia/Makassar'
		});
	}

	function openDatePicker(): void {
		showDatePicker = true;
	}

	function openEndDatePicker(): void {
		showEndDatePicker = true;
	}

	async function applyFilter(): Promise<void> {
		showFilter = false;
		const range = calculateDateRange(filterType, startDate, filterMonth, filterYear);
		if (range.startDate && range.endDate) {
			startDate = range.startDate;
			endDate = range.endDate;
		}
		await loadLaporanData();
		setupRealtimeSubscriptions();
	}

	onMount(() => {
		import('$lib/utils/iconLoader').then(({ loadRouteIcons }) => {
			loadRouteIcons('laporan');
		});
		import('@lucide/svelte/icons/filter').then((icon) => {
			FilterIcon = icon.default;
		});

		filterDate = getTodayWita();
		startDate = getLocalDateStringWITA();
		endDate = startDate;

		initializePageData().then(() => {
			if (!currentUserRole) {
				fetch('/api/session')
					.then((res) => (res.ok ? res.json() : null))
					.then((session) => {
						if (session?.user) setUserRole(session.user.role, session.user);
					});
			}
		});

		const handleVisibilityChange = () => {
			if (!document.hidden) void scheduleLaporanRefresh(100, true);
		};
		const handleFocus = () => {
			void scheduleLaporanRefresh(100, true);
		};
		const handleNavigation = () => {
			void scheduleLaporanRefresh(100, true);
		};
		const handleAiRecommendationsApplied = async () => {
			try {
				await cacheOrchestrator.invalidateCacheOnChange('buku_kas');
			} catch {}
			await scheduleLaporanRefresh(80, true);
		};

		let offLaporan: () => void;
		if (typeof window !== 'undefined') {
			offLaporan = refreshBus.on('laporan', async () => {
				try {
					await cacheOrchestrator.invalidateCacheOnChange('buku_kas');
				} catch {}
				await scheduleLaporanRefresh(80, true);
			});
		}

		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('focus', handleFocus);
		window.addEventListener('popstate', handleNavigation);
		window.addEventListener(
			'ai-recommendations-applied',
			handleAiRecommendationsApplied as EventListener
		);

		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('focus', handleFocus);
			window.removeEventListener('popstate', handleNavigation);
			window.removeEventListener(
				'ai-recommendations-applied',
				handleAiRecommendationsApplied as EventListener
			);
			if (typeof window !== 'undefined' && offLaporan) offLaporan();
		};
	});

	$effect(() => {
		const _branch = selectedBranch.value;
		if (typeof window !== 'undefined') {
			if (isInitialLoad) {
				isInitialLoad = false;
			} else {
				void scheduleLaporanRefresh(120, true);
			}
		}
	});

	onDestroy(() => {
		realtimeDisposers.forEach((d) => d());
		realtimeDisposers = [];
		if (laporanRefreshTimer) {
			clearTimeout(laporanRefreshTimer);
			laporanRefreshTimer = null;
		}
	});

	return {
		get FilterIcon() {
			return FilterIcon;
		},
		get showFilter() {
			return showFilter;
		},
		set showFilter(v) {
			showFilter = v;
		},
		get showDatePicker() {
			return showDatePicker;
		},
		set showDatePicker(v) {
			showDatePicker = v;
		},
		get showEndDatePicker() {
			return showEndDatePicker;
		},
		set showEndDatePicker(v) {
			showEndDatePicker = v;
		},
		get isLoadingReport() {
			return isLoadingReport;
		},
		get filterType() {
			return filterType;
		},
		set filterType(v) {
			filterType = v;
		},
		get filterDate() {
			return filterDate;
		},
		set filterDate(v) {
			filterDate = v;
		},
		get filterMonth() {
			return filterMonth;
		},
		set filterMonth(v) {
			filterMonth = v;
		},
		get filterYear() {
			return filterYear;
		},
		set filterYear(v) {
			filterYear = v;
		},
		get startDate() {
			return startDate;
		},
		set startDate(v) {
			startDate = v;
		},
		get endDate() {
			return endDate;
		},
		set endDate(v) {
			endDate = v;
		},
		get summary() {
			return summary;
		},
		get laporan() {
			return laporan;
		},
		get currentUserRole() {
			return currentUserRole;
		},
		get reportGroups() {
			return reportGroups;
		},
		toastManager,
		formatDate,
		getDeskripsiLaporan,
		openDatePicker,
		openEndDatePicker,
		applyFilter,
		scheduleLaporanRefresh,
		loadLaporanData
	};
}
