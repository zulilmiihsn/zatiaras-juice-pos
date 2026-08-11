import { getSupabaseClient } from '$lib/database/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { get as storeGet } from 'svelte/store';
import { selectedBranch } from '$lib/stores/selectedBranch';
import { smartCache, CacheUtils, CACHE_KEYS } from '$lib/utils/cache';
import {
	getTodayWita,
	getNowWita,
	witaToUtcRange,
	witaRangeToUtcRange,
	witaRangeToWitaQuery
} from '$lib/utils/dateTime';
import { browser } from '$app/environment';
import { get as getCache, set as setCache } from 'idb-keyval';
import {
	addPendingTransaction,
	getPendingTransactions,
	clearPendingTransactions
} from '$lib/utils/offline';
import { get as idbGet, set as idbSet } from 'idb-keyval';

async function getCachedPosKas7Hari(supabase: SupabaseClient) {
	const todayStr = getTodayWita();
	const branch = storeGet(selectedBranch) || 'default';
	const cacheKey = `pos_kas_7hari_${branch}_${todayStr}`;
	const cached = await getCache(cacheKey);

	if (cached && Array.isArray(cached.data) && Date.now() - cached.timestamp < 300000) {
		return cached.data;
	}

	const hariLabels = [];
	const todayWita = new Date(getTodayWita() + 'T00:00:00+08:00');
	for (let i = 6; i >= 0; i--) {
		const d = new Date(todayWita);
		d.setDate(todayWita.getDate() - i);
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		hariLabels.push(`${yyyy}-${mm}-${dd}`);
	}

	const { startUtc } = witaToUtcRange(hariLabels[0]);
	const { endUtc } = witaToUtcRange(hariLabels[6]);

	const { data: kas7, error } = await supabase
		.from('buku_kas')
		.select('transaction_id,waktu')
		.gte('waktu', startUtc)
		.lte('waktu', endUtc)
		.eq('sumber', 'pos');

	if (error) {
		return [];
	}

	const result = kas7 || [];
	await setCache(cacheKey, { data: result, timestamp: Date.now() });
	return result;
}

// Fungsi cache harian untuk rata-rata transaksi/hari
async function getAvgTransaksiHarian(supabase: SupabaseClient): Promise<number> {
	const todayStr = getTodayWita();
	const branch = storeGet(selectedBranch) || 'default';
	const cacheKey = `avg_transaksi_${branch}_${todayStr}`;
	const cached = await getCache(cacheKey);
	if (cached && typeof cached.value === 'number' && Date.now() - cached.timestamp < 86400000) {
		return cached.value; // Cache 24 jam
	}
	// Hitung ulang
	const hariLabels = [];
	const todayWita = new Date(getTodayWita() + 'T00:00:00+08:00');
	for (let i = 6; i >= 0; i--) {
		const d = new Date(todayWita);
		d.setDate(todayWita.getDate() - i);
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, '0');
		const dd = String(d.getDate()).padStart(2, '0');
		hariLabels.push(`${yyyy}-${mm}-${dd}`);
	}
	const kas7 = await getCachedPosKas7Hari(supabase);
	let avgTransaksi = 0;
	if (kas7) {
		const transaksiPerHari: { [key: string]: Set<string> } = {};
		for (const tanggal of hariLabels) {
			transaksiPerHari[tanggal] = new Set<string>();
		}
		for (const t of kas7) {
			const waktu = new Date(t.waktu);
			const yyyy = waktu.getFullYear();
			const mm = String(waktu.getMonth() + 1).padStart(2, '0');
			const dd = String(waktu.getDate()).padStart(2, '0');
			const tanggal = `${yyyy}-${mm}-${dd}`;
			if (transaksiPerHari[tanggal] && t.transaction_id) {
				transaksiPerHari[tanggal].add(t.transaction_id);
			}
		}
		const totalTransaksi7Hari = (Object.values(transaksiPerHari) as Set<string>[]).reduce(
			(sum, set) => sum + set.size,
			0
		);
		avgTransaksi = Math.round(totalTransaksi7Hari / 7);
	}
	await setCache(cacheKey, { value: avgTransaksi, timestamp: Date.now() });
	return avgTransaksi;
}

// Fungsi cache mingguan untuk jam paling ramai (7 hari terakhir)
async function getJamRamaiMingguan(supabase: SupabaseClient): Promise<string> {
	const todayStr = getTodayWita();
	const branch = storeGet(selectedBranch) || 'default';
	const cacheKey = `jam_ramai_mingguan_${branch}_${todayStr}`;
	const cached = await getCache(cacheKey);
	if (cached && typeof cached.value === 'string' && Date.now() - cached.timestamp < 86400000) {
		return cached.value; // Cache 24 jam untuk konsistensi dengan rata-rata transaksi
	}
	
	// Hitung ulang - gunakan cache data POS 7 hari yang sama dengan avg transaksi
	const kas = await getCachedPosKas7Hari(supabase);
	
	const jamCount: { [key: string]: number } = {};
	if (kas) {
		for (const t of kas) {
			const waktu = new Date(t.waktu);
			const waktuWITA = new Date(waktu);
			const jam = waktuWITA.getHours();
			jamCount[jam] = (jamCount[jam] || 0) + 1;
		}
	}
	
	let peakHour = '';
	let maxCount = 0;
	for (const [jam, count] of Object.entries(jamCount)) {
		if (count > maxCount) {
			maxCount = count;
			peakHour = jam;
		}
	}
	
	let jamRamai = '';
	if (peakHour !== '') {
		const jamInt = parseInt(peakHour, 10);
		jamRamai = `${jamInt.toString().padStart(2, '0')}.00–${(jamInt + 1).toString().padStart(2, '0')}.00`;
	}
	
	await setCache(cacheKey, { value: jamRamai, timestamp: Date.now() });
	return jamRamai;
}

// Data service untuk fetching dengan smart caching
export class DataService {
	private static instance: DataService;
	private supabase: SupabaseClient;
	private isInitialLoad = true; // Add flag to prevent double fetching

	constructor() {
		this.supabase = getSupabaseClient(storeGet(selectedBranch));
		// Subscribe ke selectedBranch agar supabase client ikut berubah
		selectedBranch.subscribe((branch) => {
			// Skip jika ini adalah initial load
			if (this.isInitialLoad) {
				this.isInitialLoad = false;
				return;
			}
			this.supabase = getSupabaseClient(branch);
		});
	}

	// Getter untuk supabase client
	get supabaseClient() {
		return this.supabase;
	}

	static getInstance(): DataService {
		if (!DataService.instance) {
			DataService.instance = new DataService();
		}
		return DataService.instance;
	}

	// Dashboard data fetching dengan cache
	async getDashboardStats() {
		const branch = storeGet(selectedBranch) || 'default';
		return smartCache.get(
			`${CACHE_KEYS.DASHBOARD_STATS}_${branch}`,
			async () => {
				// Data hari ini untuk item terjual, jumlah transaksi, omzet, dst
				const now = new Date();
				const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
				const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
				const startUTC = start.toISOString();
				const endUTC = end.toISOString();

				const kasirPromise = this.supabase
					.from('transaksi_kasir')
					.select('qty, transaction_id')
					.gte('created_at', startUTC)
					.lte('created_at', endUTC);

				const bukuKasPromise = this.supabase
					.from('buku_kas')
					.select('amount,tipe,transaction_id')
					.gte('waktu', startUTC)
					.lte('waktu', endUTC)
					.eq('sumber', 'pos');

				const [kasirResult, bukuKasResult] = await Promise.all([kasirPromise, bukuKasPromise]);
				const { data: kasir, error: errorKasir } = kasirResult;
				const { data: kas, error } = bukuKasResult;

				if (error || errorKasir) {
					return {
						itemTerjual: 0,
						jumlahTransaksi: 0,
						omzet: 0,
						profit: 0,
						totalItem: 0,
						avgTransaksi: 0,
						jamRamai: '',
						weeklyIncome: [],
						weeklyMax: 1,
						bestSellers: []
					};
				}

				const itemTerjual = kasir?.reduce((sum: number, t: any) => sum + (t.qty || 1), 0) || 0;
				const transactionIds = new Set((kas || []).map((t: any) => t.transaction_id).filter(Boolean));
				const jumlahTransaksi = transactionIds.size > 0 ? transactionIds.size : kas.length;
				const omzet = kas.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

				// Profit riil sederhana (tanpa HPP): pemasukan - pengeluaran di hari ini
				const pemasukan = (kas || [])
					.filter((t: any) => t.tipe === 'in')
					.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
				const pengeluaran = (kas || [])
					.filter((t: any) => t.tipe === 'out')
					.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
				const profit = pemasukan - pengeluaran;

				// Ambil avgTransaksi dan jamRamai dari cache mingguan
				const [avgTransaksi, jamRamai] = await Promise.all([
					getAvgTransaksiHarian(this.supabase),
					getJamRamaiMingguan(this.supabase)
				]);

				return {
					itemTerjual,
					jumlahTransaksi,
					omzet,
					profit,
					totalItem: itemTerjual,
					avgTransaksi,
					jamRamai,
					weeklyIncome: [],
					weeklyMax: 1,
					bestSellers: []
				};
			},
			{
				ttl: 45000,
				backgroundRefresh: true
			}
		);
	}

	// Best sellers dengan cache per cabang
	async getBestSellers() {
		const branch = storeGet(selectedBranch);
		return smartCache.get(
			`${CACHE_KEYS.BEST_SELLERS}_${branch}`,
			async () => {
				const todayWita = new Date(getNowWita());
				const yyyy = todayWita.getFullYear();
				const mm = String(todayWita.getMonth() + 1).padStart(2, '0');
				const dd = String(todayWita.getDate()).padStart(2, '0');
				const todayStr = `${yyyy}-${mm}-${dd}`;

				// --- GRAFIK 7 HARI TERAKHIR (WITA) ---
				const hariLabels: string[] = [];
				const pendapatanPerHari: Record<string, number> = {};
				for (let i = 6; i >= 0; i--) {
					const d = new Date(todayWita);
					d.setDate(todayWita.getDate() - i);
					const yyyy = d.getFullYear();
					const mm = String(d.getMonth() + 1).padStart(2, '0');
					const dd = String(d.getDate()).padStart(2, '0');
					const tanggal = `${yyyy}-${mm}-${dd}`;
					hariLabels.push(tanggal);
					pendapatanPerHari[tanggal] = 0;
				}

				const { startUtc: start7Utc, endUtc: end7Utc } = witaToUtcRange(hariLabels[0]);
				const { endUtc: end7LastUtc } = witaToUtcRange(hariLabels[6]);

				const { data: items, error } = await this.supabase
					.from('transaksi_kasir')
					.select('produk_id, qty, created_at')
					.gte('created_at', start7Utc)
					.lte('created_at', end7LastUtc);

				let bestSellersResult: any[] = [];
				if (!error && items) {
					const grouped: { [key: string]: any } = {};
					for (const item of items) {
						if (!item.produk_id) continue;
						if (!grouped[item.produk_id]) grouped[item.produk_id] = 0;
						grouped[item.produk_id] += item.qty || 1;
					}

					const topProdukIds = Object.entries(grouped)
						.sort((a: any, b: any) => b[1] - a[1])
						.slice(0, 3)
						.map(([produk_id]) => produk_id);

					if (topProdukIds.length > 0) {
						const { data: allProducts } = await this.supabase
							.from('produk')
							.select('id, name, gambar');

						const validProdukIds = topProdukIds.filter(
							(id: string) => allProducts && allProducts.some((p: any) => p.id === id)
						);

						if (validProdukIds.length > 0) {
							bestSellersResult = validProdukIds.map((produk_id: string) => {
								const prod = allProducts?.find((p: any) => p.id === produk_id);
								return {
									name: prod?.name || '-',
									image: prod?.gambar || '',
									total_qty: grouped[produk_id]
								};
							});
						}
					}
				}

				return bestSellersResult;
			},
			{
				ttl: 300000, // 5 minutes
				backgroundRefresh: true
			}
		);
	}

	// Weekly income dengan cache per cabang
	async getWeeklyIncome() {
		const branch = storeGet(selectedBranch);
		return smartCache.get(
			`${CACHE_KEYS.WEEKLY_INCOME}_${branch}`,
			async () => {
				const todayWita = new Date(getNowWita());
				const hariLabels: string[] = [];
				const pendapatanPerHari: Record<string, number> = {};

				for (let i = 6; i >= 0; i--) {
					const d = new Date(todayWita);
					d.setDate(todayWita.getDate() - i);
					const yyyy = d.getFullYear();
					const mm = String(d.getMonth() + 1).padStart(2, '0');
					const dd = String(d.getDate()).padStart(2, '0');
					const tanggal = `${yyyy}-${mm}-${dd}`;
					hariLabels.push(tanggal);
					pendapatanPerHari[tanggal] = 0;
				}

				const { startUtc: start7Utc } = witaToUtcRange(hariLabels[0]);
				const { endUtc: end7Utc } = witaToUtcRange(hariLabels[6]);

				const { data: kas7Hari, error } = await this.supabase
					.from('buku_kas')
					.select('amount,waktu')
					.gte('waktu', start7Utc)
					.lte('waktu', end7Utc)
					.eq('sumber', 'pos')
					.eq('tipe', 'in');

				if (!error && kas7Hari) {
					const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
						timeZone: 'Asia/Makassar'
					});

					for (const transaksi of kas7Hari) {
						const waktu = transaksi?.waktu ? new Date(transaksi.waktu) : null;
						if (!waktu || Number.isNaN(waktu.getTime())) continue;
						const tanggalWita = dateFormatter.format(waktu);
						if (!(tanggalWita in pendapatanPerHari)) continue;
						pendapatanPerHari[tanggalWita] += Number(transaksi?.amount || 0);
					}
				}

				const weeklyIncome = hariLabels.map((tanggal) => pendapatanPerHari[tanggal] || 0);
				const weeklyMax = Math.max(1, ...weeklyIncome);

				return { weeklyIncome, weeklyMax };
			},
			{
				ttl: 300000, // 5 minutes
				backgroundRefresh: true
			}
		);
	}

	// Products dengan cache
	async getProducts() {
		const branch = storeGet(selectedBranch) || 'default';
		const cacheKey = `${CACHE_KEYS.PRODUCTS}_${branch}`;

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			const cached = await idbGet('products');
			if (cached) return cached;
			return [];
		}

		const data = await smartCache.get(
			cacheKey,
			async () => {
				const { data, error } = await this.supabase
					.from('produk')
					.select('*')
					.order('created_at', { ascending: false });
				if (error) return [];
				return data || [];
			},
			{ ttl: 180000, backgroundRefresh: true }
		);

		await idbSet('products', data || []);
		return data || [];
	}

	// Categories dengan cache
	async getCategories() {
		const branch = storeGet(selectedBranch) || 'default';
		const cacheKey = `${CACHE_KEYS.CATEGORIES}_${branch}`;

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			const cached = await idbGet('categories');
			if (cached) return cached;
			return [];
		}

		const data = await smartCache.get(
			cacheKey,
			async () => {
				const { data, error } = await this.supabase
					.from('kategori')
					.select('*')
					.order('created_at', { ascending: false });
				if (error) return [];
				return data || [];
			},
			{ ttl: 180000, backgroundRefresh: true }
		);

		await idbSet('categories', data || []);
		return data || [];
	}

	// Add-ons dengan cache
	async getAddOns() {
		const branch = storeGet(selectedBranch) || 'default';
		const cacheKey = `${CACHE_KEYS.ADDONS}_${branch}`;

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			const cached = await idbGet('addons');
			if (cached) return cached;
			return [];
		}

		const data = await smartCache.get(
			cacheKey,
			async () => {
				const { data, error } = await this.supabase
					.from('tambahan')
					.select('*')
					.order('created_at', { ascending: false });
				if (error) return [];
				return data || [];
			},
			{ ttl: 180000, backgroundRefresh: true }
		);

		await idbSet('addons', data || []);
		return data || [];
	}

	// Report data dengan ETag support
	async getReportData(dateRange: string, type: 'daily' | 'weekly' | 'monthly' | 'yearly') {
		// SMART CACHING: Cache per date range dengan strategi yang lebih pintar
		const branch = storeGet(selectedBranch) || 'default';
		const cacheKey = this.generateSmartCacheKey(type, dateRange, branch);

		// Check cache first dengan TTL yang berbeda per type
		const cacheOptions = this.getCacheOptionsForType(type);

		return smartCache.get(
			cacheKey,
			async () => {
				// Generate ETag based on date range and type
				const etagValue = `${type}_${dateRange}_${Date.now()}`;

				let startDate: string, endDate: string;

				switch (type) {
					case 'daily':
						// Handle both single date and date range
						if (dateRange.includes('_')) {
							const [start, end] = dateRange.split('_');
							startDate = start;
							endDate = end;
						} else {
							startDate = dateRange;
							endDate = dateRange;
						}
						break;
					case 'weekly':
						// Calculate week range
						const date = new Date(dateRange);
						const startOfWeek = new Date(date);
						startOfWeek.setDate(date.getDate() - date.getDay());
						const endOfWeek = new Date(startOfWeek);
						endOfWeek.setDate(startOfWeek.getDate() + 6);
						startDate = startOfWeek.toISOString().split('T')[0];
						endDate = endOfWeek.toISOString().split('T')[0];
						break;
					case 'monthly':
						startDate = `${dateRange}-01`;
						const lastDay = new Date(
							parseInt(dateRange.split('-')[0]),
							parseInt(dateRange.split('-')[1]),
							0
						);
						endDate = lastDay.toISOString().split('T')[0];
						break;
					case 'yearly':
						startDate = `${dateRange}-01-01`;
						endDate = `${dateRange}-12-31`;
						break;
					default:
						startDate = dateRange;
						endDate = dateRange;
				}

				let startWita: string, endWita: string;

				try {
					// STANDAR: Gunakan WITA untuk query database
					if (startDate === endDate) {
						// Single date: gunakan witaRangeToWitaQuery dengan tanggal yang sama
						const { startWita: startWitaTemp, endWita: endWitaTemp } = witaRangeToWitaQuery(
							startDate,
							startDate
						);
						startWita = startWitaTemp;
						endWita = endWitaTemp;
					} else {
						// Range date: gunakan witaRangeToWitaQuery
						const { startWita: startWitaTemp, endWita: endWitaTemp } = witaRangeToWitaQuery(
							startDate,
							endDate
						);
						startWita = startWitaTemp;
						endWita = endWitaTemp;
					}
				} catch (error) {
					// Fallback to current date if date conversion fails
					const today = getTodayWita();
					try {
						const { startWita: startWitaTemp, endWita: endWitaTemp } = witaRangeToWitaQuery(
							today,
							today
						);
						startWita = startWitaTemp;
						endWita = endWitaTemp;
					} catch (fallbackError) {
						// Use hardcoded fallback
						startWita = today + 'T00:00:00+08:00';
						endWita = today + 'T23:59:59+08:00';
					}
				}

				// PARALLEL PAGINATION: Ambil semua buku_kas sekali, lalu turunkan kategorinya di memori
				const allBukuKas = await this.fetchAllDataParallel(
					'buku_kas',
					startWita,
					endWita
				);

				const posBukuKas = (allBukuKas || []).filter((item: any) => item?.sumber === 'pos');
				const manualItems = (allBukuKas || []).filter(
					(item: any) => item?.sumber && item.sumber !== 'pos'
				);
				const uncategorizedItems = (allBukuKas || []).filter((item: any) => !item?.sumber);

				// Ambil detail transaksi kasir untuk POS yang sudah difilter
				let posItems = [];
				if (posBukuKas && posBukuKas.length > 0) {
					// Gunakan buku_kas_id untuk relasi yang benar
					const bukuKasIds = posBukuKas.map((bk: any) => bk.id).filter(Boolean);
					const bukuKasById = new Map(posBukuKas.map((bk: any) => [bk.id, bk]));
					const transaksiKasirSelect =
						'id,buku_kas_id,produk_id,custom_name,qty,amount,created_at,produk(name)';

					// Batasi query jika terlalu banyak buku_kas_id
					let transaksiKasir, errorTransaksiKasir;
					if (bukuKasIds.length > 1000) {
						// Gunakan query berdasarkan created_at range sebagai alternatif
						const { data: transaksiKasirAlt, error: errorTransaksiKasirAlt } = await this.supabase
							.from('transaksi_kasir')
							.select(transaksiKasirSelect)
							.gte('created_at', startWita)
							.lte('created_at', endWita);

						transaksiKasir = transaksiKasirAlt;
						errorTransaksiKasir = errorTransaksiKasirAlt;
					} else {
						const { data: transaksiKasirData, error: errorTransaksiKasirData } = await this.supabase
							.from('transaksi_kasir')
							.select(transaksiKasirSelect)
							.in('buku_kas_id', bukuKasIds);

						transaksiKasir = transaksiKasirData;
						errorTransaksiKasir = errorTransaksiKasirData;
					}

					if (!errorTransaksiKasir && transaksiKasir) {
						// Gabungkan data buku_kas dengan transaksi_kasir menggunakan buku_kas_id
						posItems = transaksiKasir
							.map((tk: any) => {
								const bukuKas = bukuKasById.get(tk.buku_kas_id);
								return {
									...tk,
									buku_kas: bukuKas
								};
							})
							.filter((item: any) => item.buku_kas); // Hanya ambil yang ada buku_kas-nya
					} else {
						posItems = [];
					}
				}

				// Gunakan data yang lebih lengkap untuk laporan
				const laporan: any[] = [];

				// Tambahkan data POS dari transaksi_kasir
				posItems.forEach((item: any) => {
					laporan.push({
						...item,
						sumber: 'pos',
						payment_method: item.buku_kas?.payment_method,
						waktu: item.buku_kas?.waktu,
						jenis: item.buku_kas?.jenis,
						tipe: item.buku_kas?.tipe,
						description: item.produk?.name || item.custom_name || 'Item Custom',
						nominal: item.amount || 0
					});
				});

				// Tambahkan data manual/catat
				(manualItems || []).forEach((item: any) => {
					laporan.push({
						...item,
						sumber: item.sumber || 'catat',
						payment_method: item.payment_method,
						waktu: item.waktu,
						jenis: item.jenis,
						tipe: item.tipe,
						description: item.description,
						nominal: item.amount || 0
					});
				});

				// Tambahkan transaksi tanpa sumber agar tetap tampil pada laporan
				uncategorizedItems.forEach((item: any) => {
					laporan.push({
						...item,
						sumber: 'lainnya',
						payment_method: item.payment_method,
						waktu: item.waktu,
						jenis: item.jenis,
						tipe: item.tipe,
						description: item.description || 'Transaksi Lainnya',
						nominal: item.amount || 0
					});
				});

				// Pemasukan/pengeluaran per jenis
				const pemasukan = laporan.filter((t: any) => t.tipe === 'in');
				const pengeluaran = laporan.filter((t: any) => t.tipe === 'out');

				// Hitung total pemasukan dan pengeluaran
				const totalPemasukan = pemasukan.reduce((sum: number, t: any) => sum + (t.nominal || 0), 0);
				const totalPengeluaran = pengeluaran.reduce(
					(sum: number, t: any) => sum + (t.nominal || 0),
					0
				);

				// Hitung Laba (Rugi) Kotor
				const labaKotor = totalPemasukan - totalPengeluaran;

				// Hitung Pajak Penghasilan (0,5% dari Laba Kotor, tapi 0 jika Laba Kotor < 0)
				const pajak = labaKotor > 0 ? Math.round(labaKotor * 0.005) : 0;

				// Hitung Laba (Rugi) Bersih
				const labaBersih = labaKotor - pajak;

				const reportData = {
					summary: {
						pendapatan: totalPemasukan,
						pengeluaran: totalPengeluaran,
						saldo: totalPemasukan - totalPengeluaran,
						labaKotor,
						pajak,
						labaBersih
					},
					pemasukanUsaha: pemasukan.filter((t: any) => t.jenis === 'pendapatan_usaha'),
					pemasukanLain: pemasukan.filter((t: any) => t.jenis === 'lainnya'),
					bebanUsaha: pengeluaran.filter((t: any) => t.jenis === 'beban_usaha'),
					bebanLain: pengeluaran.filter((t: any) => t.jenis === 'lainnya'),
					transactions: laporan
				};

				return { data: reportData, etag: etagValue };
			},
			cacheOptions
		);
	}

	// Real-time data subscription
	subscribeToRealtimeData(table: string, callback: (payload: any) => void) {
		if (!browser) return null;

		const subscription = this.supabase
			.channel(`realtime_${table}`)
			.on('postgres_changes', { event: '*', schema: 'public', table }, callback)
			.subscribe();

		return subscription;
	}

		private async invalidateDashboardCachesForBranch(branch: string) {
			await Promise.all([
				smartCache.invalidate(`${CACHE_KEYS.DASHBOARD_STATS}_${branch}`),
				smartCache.invalidate(`${CACHE_KEYS.BEST_SELLERS}_${branch}`),
				smartCache.invalidate(`${CACHE_KEYS.WEEKLY_INCOME}_${branch}`)
			]);
		}

		async invalidateDashboardCaches(branch?: string) {
			if (branch) {
				await this.invalidateDashboardCachesForBranch(branch);
				return;
			}

			await Promise.all([
				smartCache.invalidate(`${CACHE_KEYS.DASHBOARD_STATS}_*`),
				smartCache.invalidate(`${CACHE_KEYS.BEST_SELLERS}_*`),
				smartCache.invalidate(`${CACHE_KEYS.WEEKLY_INCOME}_*`)
			]);
		}

	// SMART CACHE INVALIDATION: Invalidate cache when data changes
	async invalidateCacheOnChange(table: string) {
		const branch = storeGet(selectedBranch) || 'default';

		switch (table) {
			case 'produk':
			case 'kategori':
			case 'tambahan':
				await smartCache.invalidate(`${CACHE_KEYS.PRODUCTS}_${branch}`);
				await smartCache.invalidate(`${CACHE_KEYS.CATEGORIES}_${branch}`);
				await smartCache.invalidate(`${CACHE_KEYS.ADDONS}_${branch}`);
				break;
			case 'buku_kas':
			case 'transaksi_kasir':
				await this.invalidateDashboardCaches(branch);
				await CacheUtils.invalidateReportData();
				// SMART: Invalidate semua report caches yang mungkin terpengaruh
				await this.invalidateAllReportCaches();
				break;
			case 'profil':
				await smartCache.invalidate(CACHE_KEYS.USER_PROFILE);
				await smartCache.invalidate(CACHE_KEYS.USER_ROLE);
				break;
			case 'pengaturan':
				await smartCache.invalidate(CACHE_KEYS.SECURITY_SETTINGS);
				break;
		}
	}

	// SMART CACHE INVALIDATION: Invalidate semua report caches
	async invalidateAllReportCaches() {
		const reportTypes = ['daily', 'weekly', 'monthly', 'yearly'];
		const invalidationPromises = reportTypes.map((type) => this.invalidateReportCache(type));
		await Promise.allSettled(invalidationPromises);
	}

	// Get cache statistics
	getCacheStats() {
		return smartCache.getStats();
	}

	// Clear all caches
	async clearAllCaches() {
		await smartCache.clear();
	}

	// PARALLEL PAGINATION: Fetch all data using parallel queries
	async fetchAllDataParallel(
		table: string,
		startTime: string,
		endTime: string,
		additionalFilters: any = {}
	): Promise<any[]> {
		try {
			// First, get total count to determine how many batches we need
			let query = this.supabase
				.from(table)
				.select('*', { count: 'exact', head: true })
				.gte('waktu', startTime)
				.lte('waktu', endTime);

			// Apply additional filters
			Object.keys(additionalFilters).forEach((key) => {
				const filter = additionalFilters[key];
				if (key === 'cabang') {
					// Skip cabang filter - branch is handled by getSupabaseClient(branch)
					return;
				}
				if (typeof filter === 'object' && filter.neq) {
					query = query.neq(key, filter.neq);
				} else {
					query = query.eq(key, filter);
				}
			});

			const { count, error: countError } = await query;

			if (countError) {
				return [];
			}

			if (!count || count === 0) {
				return [];
			}

			// Calculate number of batches needed
			const batchSize = 1000;
			const totalBatches = Math.ceil(count / batchSize);

			// Create parallel queries for all batches
			const batchPromises = [];

			for (let i = 0; i < totalBatches; i++) {
				const offset = i * batchSize;
				const promise = this.fetchBatch(
					table,
					startTime,
					endTime,
					offset,
					batchSize,
					additionalFilters
				);
				batchPromises.push(promise);
			}

			// Execute all queries in parallel
			const batchResults = await Promise.all(batchPromises);

			// Combine all results
			const allData = [];
			for (const batchData of batchResults) {
				if (batchData && batchData.length > 0) {
					allData.push(...batchData);
				}
			}

			return allData;
		} catch (error) {
			return [];
		}
	}

	// Helper function to fetch a single batch
	private async fetchBatch(
		table: string,
		startTime: string,
		endTime: string,
		offset: number,
		limit: number,
		additionalFilters: any = {}
	): Promise<any[]> {
		try {
			let query = this.supabase
				.from(table)
				.select('*')
				.gte('waktu', startTime)
				.lte('waktu', endTime)
				.range(offset, offset + limit - 1)
				.order('waktu', { ascending: true });

			// Apply additional filters
			Object.keys(additionalFilters).forEach((key) => {
				const filter = additionalFilters[key];
				if (key === 'cabang') {
					// Skip cabang filter - branch is handled by getSupabaseClient(branch)
					return;
				}
				if (typeof filter === 'object' && filter.neq) {
					query = query.neq(key, filter.neq);
				} else {
					query = query.eq(key, filter);
				}
			});

			const { data, error } = await query;

			if (error) {
				return [];
			}

			return data || [];
		} catch (error) {
			return [];
		}
	}

	// SMART CACHING: Generate cache key yang lebih pintar
	private generateSmartCacheKey(type: string, dateRange: string, branch: string): string {
		// Normalize date range untuk konsistensi cache
		const normalizedRange = this.normalizeDateRange(dateRange, type);
		return `smart_${type}_${branch}_${normalizedRange}`;
	}

	// SMART CACHING: Normalize date range untuk cache consistency
	private normalizeDateRange(dateRange: string, type: string): string {
		switch (type) {
			case 'daily':
				if (dateRange.includes('_')) {
					const [start, end] = dateRange.split('_');
					return `${start}_${end}`;
				}
				return dateRange;
			case 'weekly':
				// Normalize ke start of week
				const date = new Date(dateRange);
				const startOfWeek = new Date(date);
				startOfWeek.setDate(date.getDate() - date.getDay());
				return startOfWeek.toISOString().split('T')[0];
			case 'monthly':
				// Normalize ke YYYY-MM format
				return dateRange;
			case 'yearly':
				// Normalize ke YYYY format
				return dateRange;
			default:
				return dateRange;
		}
	}

	// SMART CACHING: Get cache options berdasarkan type
	private getCacheOptionsForType(type: string): any {
		const baseOptions = {
			backgroundRefresh: true,
			staleWhileRevalidate: true
		};

		switch (type) {
			case 'daily':
				return {
					...baseOptions,
					ttl: 300000, // 5 menit - data harian lebih sering berubah
					backgroundRefreshInterval: 60000 // 1 menit
				};
			case 'weekly':
				return {
					...baseOptions,
					ttl: 900000, // 15 menit - data mingguan lebih stabil
					backgroundRefreshInterval: 300000 // 5 menit
				};
			case 'monthly':
				return {
					...baseOptions,
					ttl: 1800000, // 30 menit - data bulanan sangat stabil
					backgroundRefreshInterval: 900000 // 15 menit
				};
			case 'yearly':
				return {
					...baseOptions,
					ttl: 3600000, // 1 jam - data tahunan sangat stabil
					backgroundRefreshInterval: 1800000 // 30 menit
				};
			default:
				return {
					...baseOptions,
					ttl: 300000, // 5 menit default
					backgroundRefreshInterval: 60000
				};
		}
	}

	// SMART CACHING: Invalidate cache berdasarkan date range
	async invalidateReportCache(type: string, dateRange?: string) {
		const branch = storeGet(selectedBranch) || 'default';
		if (dateRange) {
			// Invalidate specific date range
			const cacheKey = this.generateSmartCacheKey(type, dateRange, branch);
			await smartCache.invalidate(cacheKey);
		} else {
			// Invalidate all report caches for this type
			const pattern = `smart_${type}_${branch}_*`;
			await smartCache.invalidate(pattern);
		}
	}

	// SMART CACHING: Preload data untuk date ranges yang sering digunakan
	async preloadCommonDateRanges() {
		const today = new Date();
		const commonRanges = [
			// Hari ini
			{ type: 'daily', range: today.toISOString().split('T')[0] },
			// Kemarin
			{
				type: 'daily',
				range: new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
			},
			// Minggu ini
			{ type: 'weekly', range: today.toISOString().split('T')[0] },
			// Bulan ini
			{
				type: 'monthly',
				range: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
			},
			// Tahun ini
			{ type: 'yearly', range: today.getFullYear().toString() }
		];

		// Preload secara parallel
		const preloadPromises = commonRanges.map(({ type, range }) =>
			this.getReportData(range, type as any).catch((error) => {
				return null;
			})
		);

		await Promise.allSettled(preloadPromises);
	}
}

// Export singleton instance
export const dataService = DataService.getInstance();

// Real-time subscription manager
export class RealtimeManager {
	private subscriptions = new Map<string, any>();
	private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private latestPayload = new Map<string, any>();

	subscribe(table: string, callback: (payload: any) => void) {
		// Unsubscribe if already subscribed
		if (this.subscriptions.has(table)) {
			this.unsubscribe(table);
		}

		const subscription = dataService.subscribeToRealtimeData(table, (payload) => {
			this.latestPayload.set(table, payload);
			if (this.pendingTimers.has(table)) {
				return;
			}

			const timerId = setTimeout(async () => {
				this.pendingTimers.delete(table);
				const latest = this.latestPayload.get(table);
				this.latestPayload.delete(table);

				await dataService.invalidateCacheOnChange(table);
				callback(latest);
			}, 250);

			this.pendingTimers.set(table, timerId);
		});

		this.subscriptions.set(table, subscription);
	}

	unsubscribe(table: string) {
		const pending = this.pendingTimers.get(table);
		if (pending) {
			clearTimeout(pending);
			this.pendingTimers.delete(table);
		}
		this.latestPayload.delete(table);

		const subscription = this.subscriptions.get(table);
		if (subscription) {
			subscription.unsubscribe();
			this.subscriptions.delete(table);
		}
	}

	unsubscribeAll() {
		for (const timerId of this.pendingTimers.values()) {
			clearTimeout(timerId);
		}
		this.pendingTimers.clear();
		this.latestPayload.clear();

		for (const [table, subscription] of this.subscriptions.entries()) {
			subscription.unsubscribe();
		}
		this.subscriptions.clear();
	}
}

export const realtimeManager = new RealtimeManager();

// Auto-cleanup on page unload
if (browser) {
	window.addEventListener('beforeunload', () => {
		realtimeManager.unsubscribeAll();
	});
}

export async function syncPendingTransactions() {
	const pendings = await getPendingTransactions();
	if (!pendings.length) return;
	for (const trx of pendings) {
		let attempt = 0;
		const maxAttempts = 3;
		const baseDelay = 800;
		while (attempt < maxAttempts) {
			try {
				let bukuKasId = null;
				if (trx.bukuKas) {
					await dataService.supabaseClient.from('buku_kas').insert(trx.bukuKas);
					const { data: lastBukuKas } = await dataService.supabaseClient
						.from('buku_kas')
						.select('id')
						.eq('transaction_id', trx.bukuKas.transaction_id)
						.order('waktu', { ascending: false })
						.limit(1)
						.maybeSingle();
					bukuKasId = lastBukuKas?.id || null;
				} else {
					await dataService.supabaseClient.from('buku_kas').insert(trx);
				}
				if (trx.transaksiKasir && Array.isArray(trx.transaksiKasir) && trx.transaksiKasir.length) {
					const transaksiKasirWithId = trx.transaksiKasir.map((item: any) => ({
						...item,
						buku_kas_id: bukuKasId
					}));
					await dataService.supabaseClient.from('transaksi_kasir').insert(transaksiKasirWithId);
				}
				break; // sukses
			} catch (e) {
				attempt++;
				if (attempt >= maxAttempts) {
					// Gagal permanen pada item ini, lanjutkan item berikutnya
					break;
				}
				await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, attempt - 1)));
			}
		}
	}
	await clearPendingTransactions();
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent('pending-synced'));
	}
}

if (typeof window !== 'undefined') {
	window.addEventListener('online', syncPendingTransactions);
}
