import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import { smartCache, CACHE_KEYS } from '$lib/utils/cache';
import {
	addDaysYmd,
	formatDateYmdWita,
	getLastDaysYmdWita,
	getMonthEndYmd,
	getTodayWita,
	witaToUtcRange
} from '$lib/utils/dateTime';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { dbGet } from '$lib/services/dataApiClient';
import { REPORT_CACHE_VERSION } from '$lib/constants/cache';
import type { TopUsedIngredient } from '$lib/types';
import { calculateTaxes } from '$lib/services/taxService';

async function getCachedPosKas7Hari() {
	const todayStr = getTodayWita();
	const branch = selectedBranch.value || 'default';
	const cacheKey = `pos_kas_7hari_${branch}_${todayStr}`;
	const cached = await idbGet(cacheKey);
	if (cached && Array.isArray(cached.data) && Date.now() - cached.timestamp < 300000) {
		return cached.data;
	}

	const labels = getLastDaysYmdWita(7);
	const { startUtc } = witaToUtcRange(labels[0]);
	const { endUtc } = witaToUtcRange(labels[6]);

	const result = await dbGet('pos_kas_7hari', { start: startUtc, end: endUtc });
	await idbSet(cacheKey, { data: result, timestamp: Date.now() });
	return result;
}

async function getAvgTransaksiHarian(): Promise<number> {
	const todayStr = getTodayWita();
	const branch = selectedBranch.value || 'default';
	const cacheKey = `avg_transaksi_${branch}_${todayStr}`;
	const cached = await idbGet(cacheKey);
	if (cached && typeof cached.value === 'number' && Date.now() - cached.timestamp < 86400000) {
		return cached.value;
	}

	const kas7 = await getCachedPosKas7Hari();
	const labels = getLastDaysYmdWita(7);

	const perHari: Record<string, Set<string>> = {};
	labels.forEach((l) => (perHari[l] = new Set()));
	for (const t of kas7) {
		const date = formatDateYmdWita(t.waktu);
		if (perHari[date] && t.transaction_id) perHari[date].add(t.transaction_id);
	}
	const avg = Math.round(Object.values(perHari).reduce((s, set) => s + set.size, 0) / 7);
	await idbSet(cacheKey, { value: avg, timestamp: Date.now() });
	return avg;
}

async function getJamRamaiMingguan(): Promise<string> {
	const todayStr = getTodayWita();
	const branch = selectedBranch.value || 'default';
	const cacheKey = `jam_ramai_mingguan_${branch}_${todayStr}`;
	const cached = await idbGet(cacheKey);
	if (cached && typeof cached.value === 'string' && Date.now() - cached.timestamp < 86400000) {
		return cached.value;
	}

	const kas = await getCachedPosKas7Hari();
	const witaHour = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Makassar',
		hour: '2-digit',
		hour12: false
	});
	const jamCount: Record<number, number> = {};
	for (const t of kas) {
		const jam = Number(witaHour.format(new Date(t.waktu)));
		jamCount[jam] = (jamCount[jam] || 0) + 1;
	}

	let peak = -1,
		maxCount = 0;
	for (const [jam, count] of Object.entries(jamCount)) {
		if (count > maxCount) {
			maxCount = count;
			peak = Number(jam);
		}
	}

	const result =
		peak >= 0 ? `${String(peak).padStart(2, '0')}.00–${String(peak + 1).padStart(2, '0')}.00` : '';

	await idbSet(cacheKey, { value: result, timestamp: Date.now() });
	return result;
}

export class DashboardService {
	private static instance: DashboardService;

	static getInstance(): DashboardService {
		if (!DashboardService.instance) DashboardService.instance = new DashboardService();
		return DashboardService.instance;
	}

	async getDashboardStats() {
		const branch = selectedBranch.value || 'default';
		return smartCache.get(
			`${CACHE_KEYS.DASHBOARD_STATS}_${branch}`,
			async () => {
				const { startUtc: startUTC, endUtc: endUTC } = witaToUtcRange(getTodayWita());

				const qs = new URLSearchParams({
					branch,
					start: startUTC,
					end: endUTC
				}).toString();
				const res = await fetch(`/api/dashboard/stats?${qs}`);
				const payload = await res.json().catch(() => null);
				if (!res.ok) {
					throw new Error(
						typeof payload?.message === 'string'
							? payload.message
							: `Gagal memuat statistik dashboard (${res.status})`
					);
				}
				if (!payload || !Array.isArray(payload.summary)) {
					throw new Error('Respons statistik dashboard tidak valid');
				}
				const { kasir = [], kas = [], summary } = payload;

				if (Array.isArray(summary) && summary.length) {
					const itemTerjual = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.jumlah_item || 0),
						0
					);
					const jumlahTransaksi = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.jumlah_transaksi || 0),
						0
					);
					const omzet = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.penjualan_kotor || 0),
						0
					);
					const hppTotal = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.total_hpp || 0),
						0
					);
					const penjualanTunai = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.penjualan_tunai || 0),
						0
					);
					const penjualanNonTunai = summary.reduce(
						(s: number, row: Record<string, any>) => s + (row.penjualan_nontunai || 0),
						0
					);

					const avgTransaksi = await getAvgTransaksiHarian();
					const jamRamai = await getJamRamaiMingguan();
					const [bahanRes, mutasiRes] = await Promise.all([
						dbGet<Record<string, any>>('bahan', { limit: '500' }).catch(() => []),
						dbGet<Record<string, any>>('bahan_mutasi', { limit: '500' }).catch(() => [])
					]);

					const lowStockBahan = Array.isArray(bahanRes)
						? bahanRes.filter(
								(b) => Number(b.stok_saat_ini ?? 0) <= Number(b.ambang_stok ?? b.stok_minimum ?? 5)
							)
						: [];
					const lowStockCount = lowStockBahan.length;
					const lowStockNames = lowStockBahan
						.slice(0, 3)
						.map((b) => String(b.nama || b.nama_bahan || 'Bahan'));

					const todayYmd = getTodayWita();
					const usageByBahan: Record<string, number> = {};
					if (Array.isArray(mutasiRes)) {
						for (const m of mutasiRes) {
							if (m.created_at && m.delta_jumlah) {
								const mDate = formatDateYmdWita(m.created_at);
								if (mDate === todayYmd && Number(m.delta_jumlah) < 0) {
									const bId = String(m.bahan_id || '');
									if (bId) {
										usageByBahan[bId] = (usageByBahan[bId] || 0) + Math.abs(Number(m.delta_jumlah));
									}
								}
							}
						}
					}

					let topIngredients: TopUsedIngredient[] = [];
					if (Array.isArray(bahanRes) && bahanRes.length > 0) {
						topIngredients = bahanRes
							.map((b) => {
								const bId = String(b.id || '');
								const terpakai = usageByBahan[bId] || 0;
								const stok = Number(b.stok_saat_ini ?? 0);
								const ambang = Number(b.ambang_stok ?? b.stok_minimum ?? 5);
								return {
									id: bId,
									nama: String(b.nama || 'Bahan'),
									satuan: String(b.satuan || 'item'),
									terpakai,
									stok_saat_ini: stok,
									ambang_stok: ambang,
									is_low: stok <= ambang
								};
							})
							.sort((a, b) => {
								if (b.terpakai !== a.terpakai) return b.terpakai - a.terpakai;
								if (a.is_low !== b.is_low) return a.is_low ? -1 : 1;
								return a.stok_saat_ini - b.stok_saat_ini;
							})
							.slice(0, 4);
					}

					return {
						itemTerjual,
						jumlahTransaksi,
						omzet,
						profit: omzet - hppTotal,
						totalItem: itemTerjual,
						avgTransaksi,
						jamRamai,
						penjualanTunai,
						penjualanNonTunai,
						lowStockCount,
						lowStockNames,
						topIngredients,
						weeklyIncome: [],
						weeklyMax: 1,
						bestSellers: []
					};
				}

				const itemTerjual = kasir.reduce(
					(s: number, t: Record<string, any>) => s + (t.jumlah || 1),
					0
				);
				const txIds = new Set(
					kas.map((t: Record<string, any>) => t.transaction_id).filter(Boolean)
				);
				const jumlahTransaksi = txIds.size || kas.length;
				const omzet = kas.reduce((s: number, t: Record<string, any>) => s + (t.nominal || 0), 0);
				const pemasukan = kas
					.filter((t: Record<string, any>) => t.tipe === 'in')
					.reduce((s: number, t: Record<string, any>) => s + (t.nominal || 0), 0);
				const pengeluaran = kas
					.filter((t: Record<string, any>) => t.tipe === 'out')
					.reduce((s: number, t: Record<string, any>) => s + (t.nominal || 0), 0);

				const penjualanTunai = kas
					.filter((t: Record<string, any>) => t.metode_bayar === 'tunai')
					.reduce((s: number, t: Record<string, any>) => s + (t.nominal || 0), 0);
				const penjualanNonTunai = kas
					.filter(
						(t: Record<string, any>) => t.metode_bayar === 'non-tunai' || t.metode_bayar === 'qris'
					)
					.reduce((s: number, t: Record<string, any>) => s + (t.nominal || 0), 0);

				const avgTransaksi = await getAvgTransaksiHarian();
				const jamRamai = await getJamRamaiMingguan();
				const [bahanRes, mutasiRes] = await Promise.all([
					dbGet<Record<string, any>>('bahan', { limit: '500' }).catch(() => []),
					dbGet<Record<string, any>>('bahan_mutasi', { limit: '500' }).catch(() => [])
				]);

				const lowStockBahan = Array.isArray(bahanRes)
					? bahanRes.filter(
							(b) => Number(b.stok_saat_ini ?? 0) <= Number(b.ambang_stok ?? b.stok_minimum ?? 5)
						)
					: [];
				const lowStockCount = lowStockBahan.length;
				const lowStockNames = lowStockBahan
					.slice(0, 3)
					.map((b) => String(b.nama || b.nama_bahan || 'Bahan'));

				const todayYmdFallback = getTodayWita();
				const usageByBahanFallback: Record<string, number> = {};
				if (Array.isArray(mutasiRes)) {
					for (const m of mutasiRes) {
						if (m.created_at && m.delta_jumlah) {
							const mDate = formatDateYmdWita(m.created_at);
							if (mDate === todayYmdFallback && Number(m.delta_jumlah) < 0) {
								const bId = String(m.bahan_id || '');
								if (bId) {
									usageByBahanFallback[bId] =
										(usageByBahanFallback[bId] || 0) + Math.abs(Number(m.delta_jumlah));
								}
							}
						}
					}
				}

				let topIngredientsFallback: TopUsedIngredient[] = [];
				if (Array.isArray(bahanRes) && bahanRes.length > 0) {
					topIngredientsFallback = bahanRes
						.map((b) => {
							const bId = String(b.id || '');
							const terpakai = usageByBahanFallback[bId] || 0;
							const stok = Number(b.stok_saat_ini ?? 0);
							const ambang = Number(b.ambang_stok ?? b.stok_minimum ?? 5);
							return {
								id: bId,
								nama: String(b.nama || 'Bahan'),
								satuan: String(b.satuan || 'item'),
								terpakai,
								stok_saat_ini: stok,
								ambang_stok: ambang,
								is_low: stok <= ambang
							};
						})
						.sort((a, b) => {
							if (b.terpakai !== a.terpakai) return b.terpakai - a.terpakai;
							if (a.is_low !== b.is_low) return a.is_low ? -1 : 1;
							return a.stok_saat_ini - b.stok_saat_ini;
						})
						.slice(0, 4);
				}

				return {
					itemTerjual,
					jumlahTransaksi,
					omzet,
					profit: pemasukan - pengeluaran,
					totalItem: itemTerjual,
					avgTransaksi,
					jamRamai,
					penjualanTunai,
					penjualanNonTunai,
					lowStockCount,
					lowStockNames,
					topIngredients: topIngredientsFallback,
					weeklyIncome: [],
					weeklyMax: 1,
					bestSellers: []
				};
			},
			{ ttl: 45000, backgroundRefresh: true }
		);
	}

	async getBestSellers() {
		const branch = selectedBranch.value || 'default';
		return smartCache.get(
			`${CACHE_KEYS.BEST_SELLERS}_${branch}`,
			async () => {
				const labels = getLastDaysYmdWita(7);
				const { startUtc } = witaToUtcRange(labels[0]);
				const { endUtc } = witaToUtcRange(labels[6]);

				const summaryItems = await dbGet('best_sellers_summary', { start: startUtc, end: endUtc });
				if (summaryItems.length) {
					const combined = new Map<string, { nama: string; image: string; total_qty: number }>();
					for (const item of summaryItems) {
						const cleanName = String(item.nama_produk || '-')
							.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '')
							.trim();
						const key = item.produk_id ? String(item.produk_id) : cleanName;
						const current = combined.get(key) || {
							nama: cleanName,
							image: String(item.image || item.gambar || ''),
							total_qty: 0
						};
						current.total_qty += Number(item.total_qty || 0);
						combined.set(key, current);
					}
					return Array.from(combined.values())
						.sort((a, b) => b.total_qty - a.total_qty)
						.slice(0, 3);
				}

				const items = await dbGet<Record<string, any>>('transaksi_kasir', {
					start: startUtc,
					end: endUtc
				});
				const grouped: Record<string, number> = {};
				for (const item of items) {
					if (!item.produk_id) continue;
					grouped[item.produk_id] = (grouped[item.produk_id] || 0) + (item.jumlah || 1);
				}

				const topIds = Object.entries(grouped)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3)
					.map(([id]) => id);
				if (!topIds.length) return [];

				const allProducts = await dbGet<Record<string, any>>('produk', {});
				return topIds.map((id) => {
					const prod = allProducts.find((p) => p.id === id);
					const cleanName = String(prod?.nama || '-')
						.replace(/\s*\((?:Jumbo|Reguler)\)/gi, '')
						.trim();
					return { nama: cleanName, image: prod?.gambar || '', total_qty: grouped[id] };
				});
			},
			{ ttl: 300000, backgroundRefresh: true }
		);
	}

	async getWeeklyIncome() {
		const branch = selectedBranch.value || 'default';
		return smartCache.get(
			`${CACHE_KEYS.WEEKLY_INCOME}_${branch}`,
			async () => {
				const labels = getLastDaysYmdWita(7);
				const perHari: Record<string, number> = {};
				for (const tanggal of labels) {
					perHari[tanggal] = 0;
				}

				const { startUtc } = witaToUtcRange(labels[0]);
				const { endUtc } = witaToUtcRange(labels[6]);

				const summaryRows = await dbGet('weekly_income_summary', {
					start: startUtc,
					end: endUtc
				});
				if (summaryRows.length) {
					for (const row of summaryRows) {
						const tanggal = String(row.tanggal_penjualan || '');
						if (tanggal in perHari) perHari[tanggal] += Number(row.penjualan_kotor || 0);
					}
					const weeklyIncome = labels.map((l) => perHari[l] || 0);
					return { weeklyIncome, weeklyMax: Math.max(1, ...weeklyIncome) };
				}

				const rows = await dbGet<Record<string, any>>('buku_kas', {
					start: startUtc,
					end: endUtc,
					sumber: 'pos',
					tipe: 'in'
				});
				const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Makassar' });
				for (const t of rows) {
					const d = new Date(t.waktu);
					if (isNaN(d.getTime())) continue;
					const tanggal = fmt.format(d);
					if (tanggal in perHari) perHari[tanggal] += Number(t.nominal || 0);
				}

				const weeklyIncome = labels.map((l) => perHari[l] || 0);
				return { weeklyIncome, weeklyMax: Math.max(1, ...weeklyIncome) };
			},
			{ ttl: 300000, backgroundRefresh: true }
		);
	}

	async getReportData(
		dateRange: string,
		type: 'daily' | 'weekly' | 'monthly' | 'yearly',
		forceRefresh = false
	) {
		const branch = selectedBranch.value || 'default';
		const cacheKey = this.generateSmartCacheKey(type, dateRange, branch);

		return smartCache.get(
			cacheKey,
			async () => {
				let startDate: string, endDate: string;
				switch (type) {
					case 'daily':
						if (dateRange.includes('_')) {
							[startDate, endDate] = dateRange.split('_');
						} else {
							startDate = endDate = dateRange;
						}
						break;
					case 'weekly': {
						const day = new Date(`${dateRange}T00:00:00Z`).getUTCDay();
						startDate = addDaysYmd(dateRange, -day);
						endDate = addDaysYmd(startDate, 6);
						break;
					}
					case 'monthly':
						startDate = `${dateRange}-01`;
						endDate = getMonthEndYmd(dateRange);
						break;
					case 'yearly':
						startDate = `${dateRange}-01-01`;
						endDate = `${dateRange}-12-31`;
						break;
					default:
						startDate = endDate = dateRange;
				}

				const aggParams = new URLSearchParams({
					branch,
					start_date: startDate,
					end_date: endDate
				}).toString();
				const aggRes = await fetch(`/api/reports/aggregate?${aggParams}`);
				if (!aggRes.ok) {
					throw new Error(`Gagal memuat laporan (${aggRes.status})`);
				}
				const aggData = await aggRes.json();
				const laporan: Record<string, unknown>[] = Array.isArray(aggData?.transactions)
					? aggData.transactions
					: [];

				const pemasukan = laporan.filter((t) => t.tipe === 'in');
				const pengeluaran = laporan.filter((t) => t.tipe === 'out');
				const totalPemasukan = pemasukan.reduce((s, t) => s + ((t.nominal as number) || 0), 0);
				const totalPengeluaran = pengeluaran.reduce((s, t) => s + ((t.nominal as number) || 0), 0);
				const labaKotor = totalPemasukan - totalPengeluaran;
				const taxResult = calculateTaxes(totalPemasukan, labaKotor);

				return {
					data: {
						summary: {
							pendapatan: totalPemasukan,
							pengeluaran: totalPengeluaran,
							saldo: labaKotor,
							labaKotor,
							pajak: taxResult.totalPajak,
							labaBersih: taxResult.labaBersih,
							taxBreakdown: taxResult.breakdowns.map((b) => ({
								nama: b.nama,
								persentase: b.persentase,
								nominal: b.nominalPajak
							})),
							taxLabel: taxResult.activeTaxesLabel
						},
						pemasukanUsaha: pemasukan.filter((t) => t.jenis === 'pendapatan_usaha'),
						pemasukanLain: pemasukan.filter((t) => t.jenis === 'lainnya'),
						bebanUsaha: pengeluaran.filter((t) => t.jenis === 'beban_usaha'),
						bebanLain: pengeluaran.filter((t) => t.jenis === 'lainnya'),
						transactions: laporan
					},
					etag: `${type}_${dateRange}_${Date.now()}`
				};
			},
			{ ...this.getCacheOptionsForType(type), forceRefresh }
		);
	}

	generateSmartCacheKey(type: string, dateRange: string, branch: string) {
		return `smart_${type}_${REPORT_CACHE_VERSION}_${branch}_${this.normalizeDateRange(dateRange, type)}`;
	}

	private normalizeDateRange(dateRange: string, type: string): string {
		if (type === 'weekly') {
			const day = new Date(`${dateRange}T00:00:00Z`).getUTCDay();
			return addDaysYmd(dateRange, -day);
		}
		return dateRange;
	}

	private getCacheOptionsForType(type: string): Record<string, unknown> {
		const base = { backgroundRefresh: true, staleWhileRevalidate: true };
		const ttlMap: Record<string, number> = {
			daily: 300000,
			weekly: 900000,
			monthly: 1800000,
			yearly: 3600000
		};
		return { ...base, ttl: ttlMap[type] || 300000 };
	}
}

export const dashboardService = DashboardService.getInstance();
