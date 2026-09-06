<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly, slide } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import Boxes from '@lucide/svelte/icons/boxes';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Edit3 from '@lucide/svelte/icons/edit-3';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import History from '@lucide/svelte/icons/history';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import Wallet from '@lucide/svelte/icons/wallet';
	import { productService } from '$lib/services/productService';
	import { transactionService } from '$lib/services/transactionService';
	import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
	import { formatRupiah, parseRupiah } from '$lib/utils/currency';
	import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
	import { realtimeManager } from '$lib/realtime/realtimeManager';
	import { refreshBus } from '$lib/utils/refreshBus';
	import { evaluateAndAlertLowStock } from '$lib/services/stockAlertService';
	import LowStockAlertBanner from '$lib/components/shared/LowStockAlertBanner.svelte';
	import {
		UNIT_CATEGORIES,
		convertToBaseUnit,
		safeConvertToBaseUnit,
		detectUnitCategory,
		getCompatibleUnits,
		formatSmartStock,
		formatQuantity,
		type UnitCategory,
		type UnitOption
	} from '$lib/utils/unitConversion';
	import type { Ingredient } from '$lib/types/product';

	// State
	let bahanList = $state<Ingredient[]>([]);
	let isLoading = $state(true);
	let searchKeyword = $state('');
	let selectedCategory = $state('all');

	// Dynamic Category Options & Lists
	const defaultCategories = [
		'Bahan Baku',
		'Buah & Jus',
		'Sirup & Gula',
		'Topping',
		'Kemasan',
		'Barang Jadi'
	];

	const dynamicCategories = $derived.by(() => {
		const set = new Set<string>(['Bahan Baku']);
		for (const b of bahanList) {
			const cat = (b.kategori || '').trim();
			if (cat) set.add(cat);
		}
		return Array.from(set);
	});

	const availableCategoryOptions = $derived.by(() => {
		const set = new Set<string>(defaultCategories);
		for (const b of bahanList) {
			const cat = (b.kategori || '').trim();
			if (cat) set.add(cat);
		}
		return Array.from(set);
	});

	function getCategoryCount(cat: string): number {
		if (cat === 'all') return bahanList.length;
		if (cat === 'low_stock') return lowStockItems.length;
		return bahanList.filter(
			(b) => (b.kategori || 'Bahan Baku').trim().toLowerCase() === cat.toLowerCase()
		).length;
	}

	function getStockHealth(b: Ingredient) {
		const current = Math.max(0, Number(b.stok_saat_ini || 0));
		const threshold = Math.max(0, Number(b.ambang_stok || 0));
		const lastPurchase = Math.max(0, Number(b.jumlah_beli_terakhir || 0));

		// Baseline target / maximum benchmark for progress bar:
		const maxCapacity = Math.max(lastPurchase, threshold > 0 ? threshold * 2.5 : 50, current, 1);

		let percent = Math.min(100, Math.max(0, Math.round((current / maxCapacity) * 100)));
		if (current > 0 && percent === 0) percent = 4;

		// 1. HABIS (0 pcs) -> Rose/Merah Pekat
		if (current === 0) {
			return {
				status: 'out',
				label: 'Habis',
				badgeClass: 'bg-rose-100 text-rose-700 border-rose-200',
				barGradient: 'bg-rose-600',
				trackBg: 'bg-rose-100',
				textColor: 'text-rose-600',
				cardBg: 'border-rose-200/90 bg-gradient-to-b from-rose-50/30 to-white',
				percent: 0
			};
		}

		// 2. SISA SEDIKIT (stok <= ambang batas ATAU percent <= 25%) -> Gradasi Merah/Rose
		if ((threshold > 0 && current <= threshold) || percent <= 25) {
			return {
				status: 'critical',
				label: 'Sisa Sedikit',
				badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
				barGradient: 'bg-gradient-to-r from-rose-500 to-red-500',
				trackBg: 'bg-rose-100/80',
				textColor: 'text-rose-600',
				cardBg: 'border-rose-200/80 bg-gradient-to-b from-rose-50/20 to-white',
				percent
			};
		}

		// 3. MENDEKATI BATAS (stok <= 1.5x ambang ATAU percent <= 45%) -> Gradasi Amber/Oranye
		if ((threshold > 0 && current <= threshold * 1.5) || percent <= 45) {
			return {
				status: 'warning',
				label: 'Mendekati Batas',
				badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
				barGradient: 'bg-gradient-to-r from-amber-400 to-orange-500',
				trackBg: 'bg-amber-100/80',
				textColor: 'text-amber-600',
				cardBg: 'border-amber-200/70 bg-gradient-to-b from-amber-50/15 to-white',
				percent
			};
		}

		// 4. SETENGAH (percent 46% - 74%) -> Gradasi Sky/Biru Cyan
		if (percent < 75) {
			return {
				status: 'half',
				label: 'Setengah',
				badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
				barGradient: 'bg-gradient-to-r from-sky-400 to-blue-500',
				trackBg: 'bg-sky-100/80',
				textColor: 'text-sky-600',
				cardBg: 'border-slate-100/90 hover:border-slate-200/90',
				percent
			};
		}

		// 5. PENUH (percent >= 75%) -> Gradasi Hijau Emerald
		return {
			status: 'full',
			label: 'Penuh',
			badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
			barGradient: 'bg-gradient-to-r from-emerald-400 to-teal-500',
			trackBg: 'bg-emerald-100/60',
			textColor: 'text-emerald-600',
			cardBg: 'border-slate-100/90 hover:border-slate-200/90',
			percent
		};
	}

	// Toast state
	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType = $state<'success' | 'error' | 'info'>('info');

	function notify(message: string, type: 'success' | 'error' | 'info' = 'success') {
		toastMessage = message;
		toastType = type;
		showToast = true;
	}

	// Stats & Filtered Data
	let lowStockItems = $derived(
		bahanList.filter(
			(b) =>
				Number(b.ambang_stok || 0) > 0 && Number(b.stok_saat_ini || 0) <= Number(b.ambang_stok || 0)
		)
	);

	let filteredBahan = $derived.by(() => {
		const query = searchKeyword.trim().toLowerCase();
		return bahanList.filter((b) => {
			const matchesSearch =
				!query ||
				b.nama.toLowerCase().includes(query) ||
				(b.kategori || '').toLowerCase().includes(query);
			if (!matchesSearch) return false;

			if (selectedCategory === 'all') return true;
			if (selectedCategory === 'low_stock') {
				return (
					Number(b.ambang_stok || 0) > 0 &&
					Number(b.stok_saat_ini || 0) <= Number(b.ambang_stok || 0)
				);
			}
			const itemCat = (b.kategori || 'Bahan Baku').trim().toLowerCase();
			return itemCat === selectedCategory.toLowerCase();
		});
	});

	// Load Data
	async function loadBahan(forceRefresh = true) {
		isLoading = true;
		try {
			const data = (await productService.getIngredients(forceRefresh)) as unknown as Ingredient[];
			bahanList = data || [];
			evaluateAndAlertLowStock(bahanList);
		} catch {
			notify('Gagal memuat data stok bahan', 'error');
		} finally {
			isLoading = false;
		}
	}

	// Form Tambah/Edit Bahan
	// Form Tambah/Edit Bahan
	let showBahanModal = $state(false);
	let editBahanId = $state<string | number | null>(null);
	let bahanForm = $state({
		nama: '',
		tipe_satuan: 'berat' as UnitCategory,
		satuan: 'gram',
		isi_per_kemasan: '1',
		satuan_beli: 'kg',
		kategoriSelect: 'Bahan Baku',
		customKategori: '',
		kategori: 'Bahan Baku',
		stok_saat_ini: '',
		ambang_stok: '',
		yield_persen: '100',
		jumlah_beli_terakhir: '',
		biaya_beli_terakhir: ''
	});

	function openAddModal() {
		editBahanId = null;
		const defaultCat =
			selectedCategory !== 'all' && selectedCategory !== 'low_stock'
				? selectedCategory
				: 'Bahan Baku';
		bahanForm = {
			nama: '',
			tipe_satuan: 'berat',
			satuan: 'gram',
			isi_per_kemasan: '1',
			satuan_beli: 'kg',
			kategoriSelect: defaultCat,
			customKategori: '',
			kategori: defaultCat,
			stok_saat_ini: '',
			ambang_stok: '',
			yield_persen: '100',
			jumlah_beli_terakhir: '',
			biaya_beli_terakhir: ''
		};
		showBahanModal = true;
	}

	function openEditModal(bahan: Ingredient) {
		editBahanId = bahan.id;
		const cat = (bahan.kategori || 'Bahan Baku').trim() || 'Bahan Baku';
		const isKnown = availableCategoryOptions.includes(cat);
		const detectedType = bahan.tipe_satuan || detectUnitCategory(bahan.satuan || 'gram');
		bahanForm = {
			nama: bahan.nama,
			tipe_satuan: detectedType,
			satuan: bahan.satuan || (detectedType === 'cairan' ? 'ml' : 'gram'),
			isi_per_kemasan: formatRupiah(bahan.isi_per_kemasan || 1) || '1',
			satuan_beli: bahan.satuan_beli || bahan.satuan || 'kg',
			kategoriSelect: isKnown ? cat : '__new__',
			customKategori: isKnown ? '' : cat,
			kategori: cat,
			stok_saat_ini: formatRupiah(bahan.stok_saat_ini) || '0',
			ambang_stok: formatRupiah(bahan.ambang_stok) || '0',
			yield_persen: formatRupiah(bahan.yield_persen ?? 100) || '100',
			jumlah_beli_terakhir: formatRupiah(bahan.jumlah_beli_terakhir) || '',
			biaya_beli_terakhir: formatRupiah(bahan.biaya_beli_terakhir) || ''
		};
		showBahanModal = true;
	}

	function closeBahanModal() {
		showBahanModal = false;
		editBahanId = null;
	}

	async function handleSaveBahan(e: SubmitEvent) {
		e.preventDefault();
		if (!bahanForm.nama.trim()) {
			notify('Nama bahan wajib diisi', 'error');
			return;
		}

		const purchaseCost = Math.max(0, parseRupiah(bahanForm.biaya_beli_terakhir));
		const purchaseQty = Math.max(0, parseRupiah(bahanForm.jumlah_beli_terakhir));
		const packSize = Math.max(1, parseRupiah(bahanForm.isi_per_kemasan) || 1);
		const purchaseQuantityInBase = safeConvertToBaseUnit(
			purchaseQty,
			bahanForm.satuan_beli || bahanForm.satuan,
			bahanForm.satuan,
			packSize
		);
		const rawYield = parseRupiah(bahanForm.yield_persen) || 100;
		const yieldPercent = Math.min(100, Math.max(1, rawYield));
		const yieldFactor = yieldPercent / 100;
		const netUsableQuantityInBase = purchaseQuantityInBase * yieldFactor;

		const unitCost =
			netUsableQuantityInBase > 0
				? calculateEffectiveUnitCost(purchaseCost, netUsableQuantityInBase)
				: 0;
		const resolvedCategory =
			(bahanForm.kategoriSelect === '__new__'
				? bahanForm.customKategori.trim()
				: bahanForm.kategoriSelect.trim()) || 'Bahan Baku';

		const payload = {
			nama: bahanForm.nama.trim(),
			satuan: bahanForm.satuan || 'gram',
			tipe_satuan: bahanForm.tipe_satuan || 'berat',
			isi_per_kemasan: packSize,
			satuan_beli: bahanForm.satuan_beli || bahanForm.satuan,
			kategori: resolvedCategory,
			stok_saat_ini: Math.max(0, parseRupiah(bahanForm.stok_saat_ini)),
			ambang_stok: Math.max(0, parseRupiah(bahanForm.ambang_stok)),
			yield_persen: yieldPercent,
			biaya_beli_terakhir: purchaseCost,
			jumlah_beli_terakhir: purchaseQuantityInBase,
			biaya_per_satuan: unitCost
		};

		try {
			if (editBahanId) {
				await transactionService.updateRows('bahan', payload, { id: String(editBahanId) });
				notify('Bahan berhasil diperbarui');
			} else {
				await transactionService.insertRows('bahan', payload);
				notify('Bahan baru berhasil ditambahkan');
			}
			closeBahanModal();
			await loadBahan();
		} catch {
			notify('Gagal menyimpan bahan', 'error');
		}
	}

	// Form Mutasi Stok (+ Kulakan / - Buang)
	let showMutasiModal = $state(false);
	let selectedBahanForMutasi = $state<Ingredient | null>(null);
	let mutasiType = $state<'tambah' | 'kurang'>('tambah');
	let mutasiAmount = $state('');
	let mutasiUnit = $state('gram');
	let mutasiNotes = $state('');
	let isSavingMutasi = $state(false);
	let recentMutations = $state<Record<string, unknown>[]>([]);
	let isLoadingMutasiHistory = $state(false);
	let showHistorySection = $state(false);

	// Finansial & Buku Kas Integration (100% Opsional)
	let recordKasTransaction = $state(false);
	let kasNominal = $state('');
	let kasPaymentMethod = $state<'tunai' | 'non-tunai'>('tunai');
	let kasCategory = $state<'beban_usaha' | 'lainnya'>('beban_usaha');
	let updateHppWithPurchase = $state(true);

	function getMutationClickFrequencyMap(): Record<string, number> {
		if (typeof window === 'undefined') return {};
		try {
			const raw = localStorage.getItem('mutasi_click_freq');
			return raw ? JSON.parse(raw) : {};
		} catch {
			return {};
		}
	}

	function incrementMutationClickFrequency(key: string) {
		if (typeof window === 'undefined') return;
		try {
			const map = getMutationClickFrequencyMap();
			map[key] = (map[key] || 0) + 1;
			localStorage.setItem('mutasi_click_freq', JSON.stringify(map));
		} catch {}
	}

	interface GroupedMutationPreset {
		key: string;
		delta_jumlah: number;
		catatan: string;
		occurrences: number;
		latest_created_at: string;
	}

	// Filtered, Deduplicated & Ranked Mutations (Grouped by Amount + Note, sorted by frequency descending, max 10)
	const filteredMutations = $derived.by<GroupedMutationPreset[]>(() => {
		if (!selectedBahanForMutasi || !recentMutations.length) return [];
		const freqMap = getMutationClickFrequencyMap();
		const bahanId = String(selectedBahanForMutasi.id);

		// Group map to combine duplicate amounts & notes
		const groupMap = new Map<string, GroupedMutationPreset>();

		for (const m of recentMutations) {
			const delta = Number(m.delta_jumlah) || 0;
			const source = String(m.source || m.sumber || '').toLowerCase();
			const note = String(m.catatan || '').trim();

			// Exclude POS checkout automatic deductions
			if (source === 'pos' || note.toLowerCase().startsWith('checkout')) continue;

			// Match current modal intent (in vs out)
			if (mutasiType === 'tambah' && delta <= 0) continue;
			if (mutasiType === 'kurang' && delta >= 0) continue;

			const absDelta = Math.abs(delta);
			const cleanNote = note || (delta > 0 ? 'Stok Masuk' : 'Stok Keluar');
			const groupKey = `${bahanId}_${absDelta}_${cleanNote.toLowerCase()}`;
			const time = m.created_at ? String(m.created_at) : '';

			if (!groupMap.has(groupKey)) {
				const clickBoost = freqMap[groupKey] || 0;
				groupMap.set(groupKey, {
					key: groupKey,
					delta_jumlah: delta,
					catatan: cleanNote,
					occurrences: 1 + clickBoost,
					latest_created_at: time
				});
			} else {
				const existing = groupMap.get(groupKey)!;
				existing.occurrences += 1;
				if (
					time &&
					(!existing.latest_created_at ||
						new Date(time).getTime() > new Date(existing.latest_created_at).getTime())
				) {
					existing.latest_created_at = time;
				}
			}
		}

		// Sort by occurrences (frequency) descending, then by latest timestamp descending
		return Array.from(groupMap.values())
			.sort((a, b) => {
				if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
				const timeA = a.latest_created_at ? new Date(a.latest_created_at).getTime() : 0;
				const timeB = b.latest_created_at ? new Date(b.latest_created_at).getTime() : 0;
				return timeB - timeA;
			})
			.slice(0, 10);
	});

	const mutasiCompatibleUnits = $derived.by<UnitOption[]>(() => {
		if (!selectedBahanForMutasi) return [];
		return getCompatibleUnits(selectedBahanForMutasi.satuan || 'gram');
	});

	const mutasiBaseAmount = $derived.by(() => {
		if (!selectedBahanForMutasi || !mutasiAmount) return 0;
		const parsed = parseFloat(String(mutasiAmount).replace(/,/g, '.'));
		if (!parsed || isNaN(parsed) || parsed <= 0) return 0;
		return safeConvertToBaseUnit(
			parsed,
			mutasiUnit,
			selectedBahanForMutasi.satuan || 'gram',
			Number(selectedBahanForMutasi.isi_per_kemasan) || 1
		);
	});

	const mutasiPreviewFinalStock = $derived.by(() => {
		if (!selectedBahanForMutasi) return 0;
		const current = Number(selectedBahanForMutasi.stok_saat_ini || 0);
		const delta = mutasiType === 'tambah' ? mutasiBaseAmount : -mutasiBaseAmount;
		return Math.max(0, current + delta);
	});

	async function loadMutasiHistory(bahanId: string | number) {
		isLoadingMutasiHistory = true;
		try {
			const rows = await transactionService.getRows('bahan_mutasi', {
				bahan_id: String(bahanId),
				limit: '50'
			});
			recentMutations = rows || [];
		} catch {
			recentMutations = [];
		} finally {
			isLoadingMutasiHistory = false;
		}
	}

	function openMutasi(bahan: Ingredient, type: 'tambah' | 'kurang' = 'tambah') {
		selectedBahanForMutasi = bahan;
		mutasiType = type;
		mutasiAmount = '';
		mutasiUnit =
			type === 'tambah' && bahan.satuan_beli ? bahan.satuan_beli : bahan.satuan || 'gram';
		mutasiNotes = '';
		recordKasTransaction = false;
		kasNominal = '';
		kasPaymentMethod = 'tunai';
		kasCategory = 'beban_usaha';
		updateHppWithPurchase = true;
		showHistorySection = false;
		showMutasiModal = true;
		void loadMutasiHistory(bahan.id);
	}

	function closeMutasiModal() {
		showMutasiModal = false;
		selectedBahanForMutasi = null;
		recentMutations = [];
		recordKasTransaction = false;
		kasNominal = '';
	}

	function setQuickAmount(amount: number, unit?: string, note?: string) {
		mutasiAmount = String(amount);
		if (unit) mutasiUnit = unit;
		if (note) mutasiNotes = note;
	}

	function setQuickNote(note: string) {
		mutasiNotes = note;
	}

	function applyMutationFromHistory(preset: GroupedMutationPreset) {
		if (!selectedBahanForMutasi) return;
		const delta = preset.delta_jumlah;
		if (delta === 0) return;

		const absDelta = Math.abs(delta);
		const note = preset.catatan || '';

		// Record click frequency
		incrementMutationClickFrequency(preset.key);

		mutasiType = delta > 0 ? 'tambah' : 'kurang';
		mutasiAmount = String(absDelta);
		mutasiUnit = selectedBahanForMutasi.satuan || 'gram';
		mutasiNotes = note;
		notify(
			`Pilihan "${note}" diterapkan (${delta > 0 ? '+' : ''}${formatQuantity(delta)} ${selectedBahanForMutasi.satuan})`,
			'info'
		);
	}

	async function handleSaveMutasi(e: SubmitEvent) {
		e.preventDefault();
		if (!selectedBahanForMutasi || isSavingMutasi) return;

		const baseQty = mutasiBaseAmount;
		if (baseQty <= 0) {
			notify('Jumlah harus lebih dari 0', 'error');
			return;
		}

		isSavingMutasi = true;
		const signedDelta = mutasiType === 'tambah' ? baseQty : -baseQty;
		const unitInfo =
			mutasiUnit !== selectedBahanForMutasi.satuan ? ` (${mutasiAmount} ${mutasiUnit})` : '';
		const defaultNote =
			mutasiType === 'tambah'
				? `Tambah stok: +${formatQuantity(baseQty)} ${selectedBahanForMutasi.satuan}${unitInfo}`
				: `Koreksi stok: -${formatQuantity(baseQty)} ${selectedBahanForMutasi.satuan}${unitInfo}`;

		try {
			// 1. Simpan Mutasi Stok Fisik
			await transactionService.insertRows('bahan_mutasi', {
				bahan_id: String(selectedBahanForMutasi.id),
				delta_jumlah: signedDelta,
				sumber: 'manual',
				catatan: mutasiNotes.trim() || defaultNote
			});

			const parsedNominal = parseRupiah(kasNominal);

			// 2. Jika opsi Catat Kas Aktif & nominal > 0 -> Simpan ke Buku Kas (Laporan Keuangan)
			if (recordKasTransaction && parsedNominal > 0) {
				const deskripsiKas =
					mutasiNotes.trim() ||
					(mutasiType === 'tambah'
						? `Kulakan Bahan: ${selectedBahanForMutasi.nama} (${mutasiAmount} ${mutasiUnit})`
						: `Beban Kerusakan Bahan: ${selectedBahanForMutasi.nama} (${mutasiAmount} ${mutasiUnit})`);

				await transactionService.insertRows('buku_kas', {
					waktu: new Date().toISOString(),
					sumber: 'stok',
					tipe: 'out',
					jenis: kasCategory,
					nominal: parsedNominal,
					metode_bayar: kasPaymentMethod,
					deskripsi: deskripsiKas
				});

				// 3. Jika Kulakan & opsi update HPP aktif -> update harga beli terakhir & biaya_per_satuan di tabel bahan
				if (mutasiType === 'tambah' && updateHppWithPurchase && baseQty > 0) {
					const rawYield = Number(selectedBahanForMutasi.yield_persen || 100);
					const yieldFactor = Math.min(100, Math.max(1, rawYield)) / 100;
					const netUsable = baseQty * yieldFactor;
					const newUnitCost =
						netUsable > 0 ? calculateEffectiveUnitCost(parsedNominal, netUsable) : 0;

					const purchaseInputQty = parseFloat(String(mutasiAmount).replace(/,/g, '.')) || baseQty;

					await transactionService.updateRows(
						'bahan',
						{
							biaya_beli_terakhir: parsedNominal,
							jumlah_beli_terakhir: purchaseInputQty,
							biaya_per_satuan: newUnitCost
						},
						{ id: String(selectedBahanForMutasi.id) }
					);
				}
			}

			await cacheOrchestrator.clearAllCaches();
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await cacheOrchestrator.invalidateCacheOnChange('buku_kas');

			const notifExtra =
				recordKasTransaction && parsedNominal > 0 ? ' & Pengeluaran kas tercatat' : '';
			notify(
				`Stok ${selectedBahanForMutasi.nama} berhasil diubah (${signedDelta > 0 ? '+' : ''}${formatQuantity(signedDelta)} ${selectedBahanForMutasi.satuan})${notifExtra}`
			);
			closeMutasiModal();
			await loadBahan(true);
		} catch {
			notify('Gagal mengubah stok', 'error');
		} finally {
			isSavingMutasi = false;
		}
	}

	// Modal Hapus Bahan
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<string | number | null>(null);

	function openDeleteConfirm(id: string | number) {
		deleteTargetId = id;
		showDeleteModal = true;
	}

	async function handleDeleteBahan() {
		if (!deleteTargetId) return;
		try {
			await transactionService.deleteRows('bahan', { id: String(deleteTargetId) });
			notify('Bahan berhasil dihapus');
			showDeleteModal = false;
			deleteTargetId = null;
			await loadBahan();
		} catch {
			notify('Gagal menghapus bahan', 'error');
		}
	}

	// Format input helper
	function handleRupiahFormat(
		e: Event,
		field:
			| 'stok_saat_ini'
			| 'ambang_stok'
			| 'jumlah_beli_terakhir'
			| 'biaya_beli_terakhir'
			| 'isi_per_kemasan'
	) {
		const target = e.target as HTMLInputElement;
		const parsed = parseRupiah(target.value);
		bahanForm[field] = parsed ? formatRupiah(parsed) : '';
	}

	// Lifecycle
	let offStokBus: (() => void) | null = null;
	let stokRealtimeDisposers: Array<() => void> = [];

	onMount(async () => {
		await loadBahan(true);
		offStokBus = refreshBus.on('stok', () => {
			void loadBahan(true);
		});
		window.addEventListener('penjualan-berhasil', () => {
			void loadBahan(true);
		});
		stokRealtimeDisposers.push(realtimeManager.subscribe('bahan', () => void loadBahan(true)));
		stokRealtimeDisposers.push(
			realtimeManager.subscribe('bahan_mutasi', () => void loadBahan(true))
		);
		stokRealtimeDisposers.push(
			realtimeManager.subscribe('transaksi_kasir', () => void loadBahan(true))
		);
	});

	onDestroy(() => {
		if (offStokBus) offStokBus();
		for (const unsub of stokRealtimeDisposers) unsub();
		stokRealtimeDisposers = [];
	});
</script>

<div class="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<!-- Fluid Wave Header for Stok -->
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
			<div class="relative z-10 mb-3 text-center md:mb-4">
				<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs md:text-xl">
					Stok & Bahan Baku
				</h1>
				<p class="text-xs font-medium text-white/85 md:text-sm">
					Pantau ketersediaan buah, gula, susu, dan perlengkapan
				</p>
			</div>

			<!-- Search Bar (Rounded-Full Glass Pill on the Wave) -->
			<div class="relative z-10 mx-auto max-w-sm md:max-w-md">
				<div
					class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400"
				>
					<Search class="h-4 w-4" />
				</div>
				<input
					type="text"
					bind:value={searchKeyword}
					placeholder="Cari buah, gula, susu, cup..."
					class="w-full rounded-full border border-white/80 bg-white/95 py-2.5 pr-4 pl-10 text-sm text-slate-900 shadow-md backdrop-blur-md transition-all placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 focus:outline-none md:text-base"
				/>
			</div>
		</div>
	</div>

	<!-- Main Content Area -->
	<main
		aria-label="Halaman stok dan inventaris"
		class="page-content relative z-20 -mt-6 min-h-0 w-full max-w-full flex-1 overflow-x-hidden px-4 pb-24 md:pb-28"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col pb-8 md:pb-12">
			<LowStockAlertBanner
				{lowStockItems}
				onFilterClick={() => (selectedCategory = 'low_stock')}
				isSticky={true}
			/>

			<!-- Summary Cards (Glassmorphic Cards) -->
			<div class="mb-4 grid grid-cols-2 gap-3">
				<div
					class="glass-card flex flex-col justify-between rounded-[28px] bg-white/90 p-4 shadow-lg backdrop-blur-sm"
				>
					<div class="mb-1 flex items-center justify-between text-slate-400">
						<span class="text-[11px] font-bold tracking-wider text-pink-700 uppercase"
							>Total Bahan</span
						>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-2xl bg-pink-100/80 text-pink-700"
						>
							<Boxes class="h-4 w-4 stroke-[2.2]" />
						</div>
					</div>
					<div class="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
						{bahanList.length}
					</div>
					<span class="text-xs font-medium text-slate-500">item terdaftar</span>
				</div>

				<div
					class="glass-card flex flex-col justify-between rounded-[28px] bg-white/90 p-4 shadow-lg backdrop-blur-sm"
				>
					<div class="mb-1 flex items-center justify-between">
						<span
							class="text-[11px] font-extrabold tracking-wider uppercase {lowStockItems.length > 0
								? 'text-rose-700'
								: 'text-emerald-700'}"
						>
							Stok Menipis
						</span>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-2xl {lowStockItems.length > 0
								? 'bg-rose-100 text-rose-600'
								: 'bg-emerald-100 text-emerald-600'}"
						>
							<AlertTriangle class="h-4 w-4 stroke-[2.2]" />
						</div>
					</div>
					<div
						class="text-2xl font-black tracking-tight sm:text-3xl {lowStockItems.length > 0
							? 'text-rose-600'
							: 'text-slate-900'}"
					>
						{lowStockItems.length}
					</div>
					<span
						class="text-xs {lowStockItems.length > 0
							? 'font-semibold text-rose-600'
							: 'font-medium text-emerald-600'}"
					>
						{lowStockItems.length > 0 ? 'Perlu belanja segera!' : 'Semua stok aman'}
					</span>
				</div>
			</div>

			<!-- Category Filter Pills Bar (Scrollable) -->
			<div class="no-scrollbar -mx-4 mb-3.5 flex items-center gap-2 overflow-x-auto px-4 py-1">
				<button
					type="button"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {selectedCategory ===
					'all'
						? 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-md shadow-pink-500/20'
						: 'border border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50'}"
					onclick={() => (selectedCategory = 'all')}
				>
					<span>Semua</span>
					<span
						class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {selectedCategory === 'all'
							? 'bg-white/25 text-white'
							: 'bg-slate-100 text-slate-600'}"
					>
						{bahanList.length}
					</span>
				</button>

				<button
					type="button"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {selectedCategory ===
					'low_stock'
						? 'bg-gradient-to-r from-rose-600 to-red-500 text-white shadow-md shadow-rose-500/20'
						: 'border border-rose-100/90 bg-rose-50/60 text-rose-700 hover:bg-rose-100/60'}"
					onclick={() => (selectedCategory = 'low_stock')}
				>
					<span>Stok Menipis</span>
					{#if lowStockItems.length > 0}
						<span
							class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {selectedCategory ===
							'low_stock'
								? 'bg-white/25 text-white'
								: 'bg-rose-200/80 text-rose-800'}"
						>
							{lowStockItems.length}
						</span>
					{/if}
				</button>

				{#each dynamicCategories as cat (cat)}
					{@const count = getCategoryCount(cat)}
					<button
						type="button"
						class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {selectedCategory ===
						cat
							? 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-md shadow-pink-500/20'
							: 'border border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50'}"
						onclick={() => (selectedCategory = cat)}
					>
						<span>{cat}</span>
						<span
							class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {selectedCategory === cat
								? 'bg-white/25 text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							{count}
						</span>
					</button>
				{/each}
			</div>

			<!-- List of Ingredients -->
			<div class="flex-1" id="stok-list-container">
				{#if isLoading}
					<div class="flex flex-col gap-2.5">
						{#each Array(4) as _}
							<div class="h-24 animate-pulse rounded-3xl bg-white/70"></div>
						{/each}
					</div>
				{:else if filteredBahan.length === 0}
					<div
						class="pointer-events-none flex min-h-[40vh] flex-col items-center justify-center py-12 text-center"
					>
						<div
							class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-pink-50 text-pink-500 shadow-sm"
						>
							<Boxes class="h-7 w-7" />
						</div>
						<div class="text-base font-bold text-slate-800">Belum Ada Stok Bahan</div>
						<div class="mt-1 max-w-xs text-xs text-slate-500">
							Tambahkan bahan baku kios seperti buah, gula pasir, susu, atau cup untuk mulai
							memantau stok.
						</div>
					</div>
				{:else}
					<div class="flex flex-col gap-3 md:grid md:grid-cols-4 md:gap-3.5">
						{#each filteredBahan as bahan (bahan.id)}
							{@const health = getStockHealth(bahan)}
							<div
								class="soft-float-card group relative flex flex-col justify-between gap-3.5 rounded-[26px] border bg-white/95 p-4.5 shadow-[0_2px_14px_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-200 hover:shadow-md active:scale-[0.995] md:rounded-2xl {health.cardBg}"
							>
								<!-- Top Row: Name + Health Badge -->
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-1.5">
											<h3 class="truncate text-base font-black tracking-tight text-slate-900">
												{bahan.nama}
											</h3>
											<span
												class="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-100/90 px-2 py-0.5 text-[10px] font-black tracking-wider text-slate-600 uppercase"
											>
												{bahan.kategori || 'Bahan Baku'}
											</span>
										</div>

										<div class="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
											<span>Modal Asli:</span>
											<span class="font-extrabold text-pink-700">
												Rp {formatRupiah(Math.round(Number(bahan.biaya_per_satuan || 0)))}
											</span>
											<span class="text-slate-400">/ {bahan.satuan}</span>
										</div>
									</div>

									<!-- Health Badge -->
									<span
										class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-black tracking-wide {health.badgeClass}"
									>
										{health.label}
									</span>
								</div>

								<!-- Middle Section: Stock Metrics & Visual Progress Bar -->
								<div class="rounded-2xl border border-slate-100/90 bg-slate-50/85 p-3">
									<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
										<div class="flex items-baseline gap-1.5">
											<span class="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
												{formatSmartStock(bahan.stok_saat_ini, bahan.satuan)}
											</span>
										</div>

										<div class="flex items-center gap-1 text-xs">
											{#if Number(bahan.ambang_stok || 0) > 0}
												<span class="text-slate-400">Min:</span>
												<span class="font-bold text-slate-700">
													{formatSmartStock(bahan.ambang_stok || 0, bahan.satuan)}
												</span>
											{:else}
												<span class="font-medium text-slate-400">Batas: -</span>
											{/if}
										</div>
									</div>

									<!-- Progress Bar -->
									<div class="space-y-1">
										<div
											class="relative h-2.5 w-full overflow-hidden rounded-full {health.trackBg}"
										>
											<div
												class="h-full rounded-full transition-all duration-500 ease-out {health.barGradient}"
												style="width: {health.percent}%"
											></div>
										</div>
										<div
											class="flex items-center justify-between text-[10px] font-bold text-slate-400"
										>
											<span>0</span>
											<span class="{health.textColor} font-extrabold"
												>{health.percent}% Kapasitas</span
											>
											<span
												>{Number(bahan.ambang_stok || 0) > 0
													? `${formatRupiah(bahan.ambang_stok || 0)} min`
													: 'Maks'}</span
											>
										</div>
									</div>
								</div>

								<!-- Action Buttons: Mobile Layout (Single Row) -->
								<div class="flex shrink-0 items-center gap-2 pt-1 md:hidden">
									<button
										class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-pink-50/90 px-4 py-2.5 text-xs font-black text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
										onclick={() => openMutasi(bahan, 'tambah')}
									>
										<Plus class="h-4 w-4 stroke-[2.5]" />
										<span>Masuk</span>
									</button>
									<button
										class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-rose-50/90 px-4 py-2.5 text-xs font-black text-rose-700 transition-all hover:bg-rose-100 active:scale-95"
										onclick={() => openMutasi(bahan, 'kurang')}
									>
										<span class="text-base leading-none font-black">−</span>
										<span>Keluar</span>
									</button>
									<button
										class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-slate-100/80 text-slate-600 transition-all hover:bg-slate-200/80 active:scale-95"
										onclick={() => openEditModal(bahan)}
										aria-label="Edit bahan"
									>
										<Edit3 class="h-4.5 w-4.5" />
									</button>
									<button
										class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-rose-50/80 text-rose-500 transition-all hover:bg-rose-100 active:scale-95"
										onclick={() => openDeleteConfirm(bahan.id)}
										aria-label="Hapus bahan"
									>
										<Trash2 class="h-4.5 w-4.5" />
									</button>
								</div>

								<!-- Action Buttons: Tablet Layout (2 Spacious Normal-Sized Rows) -->
								<div class="hidden shrink-0 flex-col gap-2 pt-1 md:flex">
									<div class="grid grid-cols-2 gap-2">
										<button
											class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-pink-50/90 py-2.5 text-xs font-black text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
											onclick={() => openMutasi(bahan, 'tambah')}
										>
											<Plus class="h-4 w-4 stroke-[2.5]" />
											<span>Masuk</span>
										</button>
										<button
											class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-rose-50/90 py-2.5 text-xs font-black text-rose-700 transition-all hover:bg-rose-100 active:scale-95"
											onclick={() => openMutasi(bahan, 'kurang')}
										>
											<span class="text-base leading-none font-black">−</span>
											<span>Keluar</span>
										</button>
									</div>
									<div class="flex items-center gap-2">
										<button
											class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-100 active:scale-95"
											onclick={() => openEditModal(bahan)}
										>
											<Edit3 class="h-3.5 w-3.5" />
											<span>Ubah</span>
										</button>
										<button
											class="flex cursor-pointer items-center justify-center rounded-xl border border-rose-100/80 bg-rose-50/80 px-3 py-2 text-rose-500 transition-all hover:bg-rose-100 active:scale-95"
											onclick={() => openDeleteConfirm(bahan.id)}
											aria-label="Hapus bahan"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</main>

	<!-- Floating Action Button (FAB) -->
	<button
		class="z-fab fixed right-6 bottom-20 flex h-14 w-14 items-center justify-center rounded-full bg-pink-500 text-white shadow-lg shadow-pink-500/25 transition-all hover:bg-pink-600 active:scale-95"
		onclick={openAddModal}
		aria-label="Tambah Bahan Baku"
	>
		<Plus class="h-7 w-7" />
	</button>
</div>

<!-- Modal Tambah / Edit Bahan -->
{#if showBahanModal}
	<div
		class="z-modal fixed inset-0 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		onclick={(e) => e.target === e.currentTarget && closeBahanModal()}
		onkeydown={(e) => e.key === 'Escape' && closeBahanModal()}
		tabindex="-1"
	>
		<div
			class="relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-[32px] border border-pink-100/90 bg-white shadow-2xl ring-1 ring-pink-500/10 transition-all"
			in:fly={{ y: 24, duration: 220, easing: cubicOut }}
		>
			<div
				class="flex flex-shrink-0 items-center justify-between border-b border-pink-100/80 bg-gradient-to-r from-pink-50/90 via-rose-50/80 to-pink-50/90 px-6 py-4.5"
			>
				<div class="flex items-center gap-3.5">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 text-white shadow-sm shadow-pink-500/25"
					>
						<Boxes class="h-5 w-5 stroke-[2.2]" />
					</div>
					<div>
						<h2 class="text-lg font-black tracking-tight text-slate-900">
							{editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
						</h2>
						<p class="text-xs font-medium text-slate-500 sm:text-sm">
							{editBahanId
								? 'Perbarui data stok & kalkulator modal'
								: 'Daftarkan bahan baku & takaran saji baru'}
						</p>
					</div>
				</div>
				<button
					type="button"
					class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-pink-100/70 hover:text-slate-700 active:scale-95"
					onclick={closeBahanModal}
					aria-label="Tutup modal"
				>
					<X class="h-4 w-4 stroke-[2.2]" />
				</button>
			</div>

			<form
				id="stok-bahan-form"
				class="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
				onsubmit={handleSaveBahan}
				autocomplete="off"
			>
				<div class="flex flex-col gap-1.5">
					<label
						for="modal-bahan-nama"
						class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
					>
						Nama Bahan
					</label>
					<input
						id="modal-bahan-nama"
						type="text"
						class="w-full rounded-xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
						bind:value={bahanForm.nama}
						required
						placeholder="Contoh: Alpukat Mentega, Gula Pasir, Cup 16oz"
					/>
				</div>

				<!-- Tipe Satuan / Sifat Bahan -->
				<div class="flex flex-col gap-1.5">
					<span class="text-xs font-bold tracking-wider text-zinc-700 uppercase">
						Tipe Takaran / Sifat Bahan
					</span>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each UNIT_CATEGORIES as cat}
							<button
								type="button"
								class="flex cursor-pointer flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all {bahanForm.tipe_satuan ===
								cat.value
									? 'border-pink-500 bg-pink-50/80 font-bold text-pink-700 shadow-xs ring-2 ring-pink-500/20'
									: 'border-zinc-200/80 bg-zinc-50/50 text-zinc-600 hover:border-pink-200 hover:bg-white'}"
								onclick={() => {
									bahanForm.tipe_satuan = cat.value;
									bahanForm.satuan = cat.defaultBase;
									if (cat.value === 'berat') bahanForm.satuan_beli = 'kg';
									else if (cat.value === 'cairan') bahanForm.satuan_beli = 'liter';
									else if (cat.value === 'kemasan') bahanForm.satuan_beli = 'pack';
									else bahanForm.satuan_beli = 'buah';
								}}
							>
								<span class="text-xs font-bold capitalize">{cat.value}</span>
								<span class="mt-0.5 text-[10px] font-medium text-zinc-400">({cat.defaultBase})</span
								>
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<label
						for="modal-bahan-kategori"
						class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
					>
						Kategori Bahan
					</label>
					<div class="flex flex-col gap-2">
						<div class="relative">
							<select
								id="modal-bahan-kategori"
								class="w-full cursor-pointer appearance-none rounded-xl border-0 bg-zinc-50 py-3 pr-10 pl-4 text-sm font-medium text-zinc-900 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
								bind:value={bahanForm.kategoriSelect}
							>
								{#each availableCategoryOptions as cat}
									<option value={cat}>{cat}</option>
								{/each}
								<option value="__new__">+ Buat Kategori Baru...</option>
							</select>
							<ChevronDown
								class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400"
							/>
						</div>

						{#if bahanForm.kategoriSelect === '__new__'}
							<input
								type="text"
								class="w-full rounded-xl border-0 bg-pink-50/50 px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-pink-300 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
								bind:value={bahanForm.customKategori}
								placeholder="Ketik nama kategori baru (contoh: Kemasan, Buah Segar)"
								required
							/>
						{/if}
					</div>
				</div>

				<!-- Satuan Dasar & Stok Siap Pakai -->
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<label
							for="modal-bahan-satuan"
							class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
						>
							Satuan Simpan
						</label>
						<div class="relative">
							<select
								id="modal-bahan-satuan"
								class="w-full cursor-pointer appearance-none rounded-xl border-0 bg-zinc-50 py-3 pr-10 pl-4 text-sm text-zinc-900 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
								bind:value={bahanForm.satuan}
							>
								{#if bahanForm.tipe_satuan === 'cairan'}
									<option value="ml">Mililiter (ml)</option>
									<option value="liter">Liter (L)</option>
									<option value="cup">Cup (200ml)</option>
								{:else if bahanForm.tipe_satuan === 'berat'}
									<option value="gram">Gram (g)</option>
									<option value="kg">Kilogram (kg)</option>
									<option value="ons">Ons (100g)</option>
								{:else if bahanForm.tipe_satuan === 'kemasan'}
									<option value="pcs">Pcs / Lembar</option>
									<option value="pack">Pack / Bungkus</option>
								{:else}
									<option value="buah">Buah</option>
									<option value="porsi">Porsi</option>
									<option value="pcs">Pcs</option>
									<option value="biji">Biji</option>
								{/if}
							</select>
							<ChevronDown
								class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400"
							/>
						</div>
					</div>

					<div class="flex flex-col gap-1.5">
						<label
							for="modal-bahan-stok"
							class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
						>
							Stok Siap Pakai
						</label>
						<input
							id="modal-bahan-stok"
							type="text"
							class="w-full rounded-xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
							bind:value={bahanForm.stok_saat_ini}
							oninput={(e) => handleRupiahFormat(e, 'stok_saat_ini')}
							placeholder="0"
						/>
					</div>
				</div>

				{#if bahanForm.tipe_satuan === 'kemasan'}
					<div class="flex flex-col gap-1.5">
						<label
							for="modal-bahan-isi-kemasan"
							class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
						>
							1 Pack/Bungkus Isi Berapa Pcs?
						</label>
						<input
							id="modal-bahan-isi-kemasan"
							type="text"
							class="w-full rounded-xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
							bind:value={bahanForm.isi_per_kemasan}
							oninput={(e) => handleRupiahFormat(e, 'isi_per_kemasan')}
							placeholder="Contoh: 50"
						/>
					</div>
				{/if}

				<div class="flex flex-col gap-1.5">
					<label
						for="modal-bahan-ambang"
						class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
					>
						Batas Peringatan Habis ({bahanForm.satuan})
					</label>
					<input
						id="modal-bahan-ambang"
						type="text"
						class="w-full rounded-xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
						bind:value={bahanForm.ambang_stok}
						oninput={(e) => handleRupiahFormat(e, 'ambang_stok')}
						placeholder="Contoh: 5"
					/>
					<p class="text-xs text-zinc-400">
						Jika stok di bawah angka ini, muncul status peringatan stok.
					</p>
				</div>

				<!-- Pembelian / Kulakan Grosir -->
				<div class="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-3.5">
					<div class="mb-2 text-xs font-extrabold tracking-wider text-zinc-800 uppercase">
						Kalkulator Kulakan / Pembelian Grosir
					</div>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<label for="modal-bahan-beli-qty" class="text-[11px] font-bold text-zinc-600">
								Jumlah Beli
							</label>
							<div class="flex gap-2">
								<input
									id="modal-bahan-beli-qty"
									type="text"
									class="w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
									bind:value={bahanForm.jumlah_beli_terakhir}
									oninput={(e) => handleRupiahFormat(e, 'jumlah_beli_terakhir')}
									placeholder="1"
								/>
								<div class="relative w-28">
									<select
										class="w-full cursor-pointer appearance-none rounded-xl border-0 bg-white py-2.5 pr-7 pl-2.5 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:ring-2 focus:ring-pink-500 focus:outline-none"
										bind:value={bahanForm.satuan_beli}
									>
										{#if bahanForm.tipe_satuan === 'berat'}
											<option value="kg">kg</option>
											<option value="gram">gram</option>
											<option value="ons">ons</option>
										{:else if bahanForm.tipe_satuan === 'cairan'}
											<option value="liter">Liter</option>
											<option value="ml">ml</option>
										{:else if bahanForm.tipe_satuan === 'kemasan'}
											<option value="pack">Pack / bks</option>
											<option value="slop">Slop</option>
											<option value="dus">Dus</option>
											<option value="pcs">pcs</option>
										{:else}
											<option value="buah">buah</option>
											<option value="porsi">porsi</option>
											<option value="biji">biji</option>
										{/if}
									</select>
									<ChevronDown
										class="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
									/>
								</div>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<label for="modal-bahan-beli-cost" class="text-[11px] font-bold text-zinc-600">
								Total Harga Beli
							</label>
							<div class="relative">
								<span
									class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-zinc-400"
									>Rp</span
								>
								<input
									id="modal-bahan-beli-cost"
									type="text"
									class="w-full rounded-xl border-0 bg-white py-2.5 pr-3 pl-9 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
									bind:value={bahanForm.biaya_beli_terakhir}
									oninput={(e) => handleRupiahFormat(e, 'biaya_beli_terakhir')}
									placeholder="35.000"
								/>
							</div>
						</div>
					</div>

					<!-- Hitung Susut Kulit/Biji (Hanya untuk Buah Segar / Tipe Berat & Unit) -->
					{#if bahanForm.tipe_satuan === 'berat' || bahanForm.tipe_satuan === 'unit'}
						<div class="mt-3 flex flex-col gap-2 border-t border-zinc-200/60 pt-3">
							<div class="flex items-center justify-between">
								<label
									class="flex cursor-pointer items-center gap-2 text-xs font-bold text-zinc-700 select-none"
								>
									<input
										type="checkbox"
										class="h-4 w-4 rounded border-zinc-300 text-pink-600 focus:ring-pink-500/20"
										checked={Number(bahanForm.yield_persen || 100) < 100}
										onchange={(e) => {
											bahanForm.yield_persen = e.currentTarget.checked ? '70' : '100';
										}}
									/>
									<span>Hitung Susut Kulit/Biji (Khusus Buah Utuh)</span>
								</label>
								{#if Number(bahanForm.yield_persen || 100) < 100}
									<span class="text-xs font-black text-pink-600"
										>{bahanForm.yield_persen}% Bersih</span
									>
								{/if}
							</div>

							{#if Number(bahanForm.yield_persen || 100) < 100}
								<div class="flex flex-col gap-2 pt-1">
									<div class="relative">
										<input
											id="modal-bahan-yield"
											type="number"
											min="1"
											max="100"
											class="w-full rounded-xl border-0 bg-white px-3.5 py-2 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
											bind:value={bahanForm.yield_persen}
											placeholder="70"
										/>
										<span
											class="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-bold text-zinc-400"
											>% Daging Bersih</span
										>
									</div>
									<!-- Quick Preset Buttons -->
									<div class="flex flex-wrap items-center gap-1.5 pt-0.5">
										<span class="text-[10px] font-semibold text-zinc-400">Pilihan Cepat:</span>
										<button
											type="button"
											class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
											onclick={() => (bahanForm.yield_persen = '70')}
										>
											Alpukat/Mangga (70%)
										</button>
										<button
											type="button"
											class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
											onclick={() => (bahanForm.yield_persen = '45')}
										>
											Nanas (45%)
										</button>
										<button
											type="button"
											class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
											onclick={() => (bahanForm.yield_persen = '50')}
										>
											Jeruk (50%)
										</button>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					{#if parseRupiah(bahanForm.jumlah_beli_terakhir) > 0}
						{@const numQty = parseRupiah(bahanForm.jumlah_beli_terakhir)}
						{@const numCost = parseRupiah(bahanForm.biaya_beli_terakhir)}
						{@const packSize = Math.max(1, parseRupiah(bahanForm.isi_per_kemasan) || 1)}
						{@const baseQty = safeConvertToBaseUnit(
							numQty,
							bahanForm.satuan_beli || bahanForm.satuan,
							bahanForm.satuan,
							packSize
						)}
						{@const isFruitYield =
							(bahanForm.tipe_satuan === 'berat' || bahanForm.tipe_satuan === 'unit') &&
							Number(bahanForm.yield_persen || 100) < 100}
						{@const numYield = isFruitYield
							? Math.min(100, Math.max(1, Number(bahanForm.yield_persen || 100)))
							: 100}
						{@const netBaseQty = (baseQty * numYield) / 100}
						{@const effectiveUnitCost =
							netBaseQty > 0 ? calculateEffectiveUnitCost(numCost, netBaseQty) : 0}

						<div
							class="mt-3 rounded-xl border border-pink-100 bg-pink-50/80 p-2.5 text-xs text-zinc-700"
						>
							<div class="flex flex-wrap items-center justify-between gap-1 font-bold">
								<span class="text-zinc-600">
									{#if isFruitYield}
										Daging Bersih: <span class="text-zinc-900"
											>{formatQuantity(netBaseQty)} {bahanForm.satuan}</span
										>
										<span class="text-[10px] font-normal text-zinc-400">
											(dari {formatQuantity(baseQty)} {bahanForm.satuan} utuh)</span
										>
									{:else}
										Total: <span class="text-zinc-900"
											>{formatQuantity(baseQty)} {bahanForm.satuan}</span
										>
									{/if}
								</span>
								<span class="text-pink-700">
									Modal: Rp {formatRupiah(Math.round(effectiveUnitCost))} / {bahanForm.satuan}
								</span>
							</div>
						</div>
					{/if}
				</div>
			</form>

			<!-- Fixed Action Buttons -->
			<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-4 sm:p-5">
				<button
					type="button"
					class="flex-1 cursor-pointer rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
					onclick={closeBahanModal}
				>
					Batal
				</button>
				<button
					type="submit"
					form="stok-bahan-form"
					class="flex-2 cursor-pointer rounded-2xl bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3.5 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98]"
				>
					{editBahanId ? 'Simpan Perubahan' : 'Tambah Bahan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Mutasi Cepat (+ Kulakan / - Koreksi) -->
{#if showMutasiModal && selectedBahanForMutasi}
	<div
		class="z-modal fixed inset-0 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		onclick={(e) => e.target === e.currentTarget && closeMutasiModal()}
		onkeydown={(e) => e.key === 'Escape' && closeMutasiModal()}
		tabindex="-1"
	>
		<div
			class="relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-[32px] border border-pink-100/90 bg-white shadow-2xl ring-1 ring-pink-500/10"
			in:fly={{ y: 24, duration: 220, easing: cubicOut }}
		>
			<!-- Header -->
			<div
				class="relative flex items-center justify-between border-b border-pink-100/80 bg-gradient-to-r from-pink-50/90 via-rose-50/80 to-pink-50/90 px-5 py-4 sm:px-6"
			>
				<div class="flex items-center gap-3.5">
					<div
						class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm {mutasiType ===
						'tambah'
							? 'bg-gradient-to-tr from-pink-600 to-rose-500 shadow-pink-500/25'
							: 'bg-gradient-to-tr from-amber-600 to-rose-600 shadow-amber-500/25'}"
					>
						{#if mutasiType === 'tambah'}
							<ArrowUpRight class="h-5 w-5 stroke-[2.5]" />
						{:else}
							<ArrowDownRight class="h-5 w-5 stroke-[2.5]" />
						{/if}
					</div>
					<div>
						<h2 class="text-base font-black tracking-tight text-slate-900 sm:text-lg">
							{mutasiType === 'tambah' ? 'Catat Kulakan / Masuk' : 'Koreksi / Buang Rusak'}
						</h2>
						<p class="text-xs font-semibold text-pink-700 sm:text-sm">
							{selectedBahanForMutasi.nama}
							<span class="font-normal text-slate-400"
								>• Sisa: {formatQuantity(selectedBahanForMutasi.stok_saat_ini)}
								{selectedBahanForMutasi.satuan}</span
							>
						</p>
					</div>
				</div>

				<button
					type="button"
					onclick={closeMutasiModal}
					class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-pink-100/70 hover:text-slate-700 active:scale-95"
					aria-label="Tutup"
				>
					<X class="h-4 w-4 stroke-[2.2]" />
				</button>
			</div>

			<!-- Scrollable Form Body -->
			<form
				id="stok-mutasi-form"
				onsubmit={handleSaveMutasi}
				autocomplete="off"
				class="flex flex-1 flex-col gap-4 overflow-y-auto p-5 sm:p-6"
			>
				<!-- Dual Amount & Unit Selector -->
				<div class="flex flex-col gap-1.5">
					<label
						for="mutasi-amount"
						class="text-xs font-black tracking-wider text-slate-700 uppercase"
					>
						Jumlah & Satuan
					</label>
					<div
						class="flex items-center rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 ring-1 ring-transparent transition-all focus-within:border-pink-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-pink-500/15"
					>
						<input
							id="mutasi-amount"
							type="number"
							step="any"
							min="0.0001"
							bind:value={mutasiAmount}
							required
							placeholder="0"
							class="min-w-0 flex-1 border-0 bg-transparent px-4 py-2.5 text-xl font-black text-slate-900 placeholder:text-slate-300 focus:outline-none"
						/>
						<div class="relative shrink-0 pr-1">
							<select
								bind:value={mutasiUnit}
								class="cursor-pointer appearance-none rounded-xl border border-pink-200/90 bg-white py-2.5 pr-8 pl-3.5 text-xs font-black text-pink-700 shadow-2xs transition-all hover:bg-pink-50/50 focus:border-pink-500 focus:outline-none sm:text-sm"
							>
								{#each mutasiCompatibleUnits as unit}
									<option value={unit.value}>{unit.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-pink-500"
							/>
						</div>
					</div>
				</div>

				<!-- Live Conversion & Calculation Preview Card -->
				{#if mutasiBaseAmount > 0}
					<div
						class="rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50/90 via-rose-50/60 to-white p-4 text-xs shadow-2xs sm:text-sm"
					>
						{#if mutasiUnit !== selectedBahanForMutasi.satuan}
							<div
								class="mb-2.5 flex items-center justify-between border-b border-pink-100/70 pb-2 text-xs"
							>
								<span class="font-bold text-pink-800">Konversi Satuan:</span>
								<span
									class="rounded-lg border border-pink-100 bg-white px-2.5 py-1 font-black text-pink-700 shadow-2xs"
								>
									{formatQuantity(mutasiAmount)}
									{mutasiUnit} = {formatQuantity(mutasiBaseAmount)}
									{selectedBahanForMutasi.satuan}
								</span>
							</div>
						{/if}
						<div class="flex items-center justify-between">
							<span class="font-bold text-slate-600">Estimasi Stok Akhir:</span>
							<div class="flex items-center gap-2 font-black text-slate-900">
								<span class="text-slate-500"
									>{formatQuantity(selectedBahanForMutasi.stok_saat_ini)}</span
								>
								<span class={mutasiType === 'tambah' ? 'text-emerald-600' : 'text-rose-600'}>
									{mutasiType === 'tambah' ? '+' : '-'}{formatQuantity(mutasiBaseAmount)}
								</span>
								<span class="text-slate-300">➔</span>
								<span
									class="rounded-xl bg-white px-3 py-1 text-sm font-black text-pink-700 shadow-xs ring-1 ring-pink-500/10 sm:text-base"
								>
									{formatQuantity(mutasiPreviewFinalStock)}
									{selectedBahanForMutasi.satuan}
								</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Rekomendasi Cepat / Quick Presets -->
				<div class="flex flex-col gap-2">
					<div
						class="flex items-center justify-between text-xs font-black tracking-wider text-slate-600 uppercase"
					>
						<span class="flex items-center gap-1.5">
							<Sparkles class="h-3.5 w-3.5 text-pink-500" />
							Pilihan Cepat
						</span>
					</div>

					<div class="flex flex-wrap gap-2">
						<!-- Terakhir Kulakan Chip -->
						{#if mutasiType === 'tambah' && Number(selectedBahanForMutasi.jumlah_beli_terakhir || 0) > 0}
							<button
								type="button"
								onclick={() =>
									setQuickAmount(
										Number(selectedBahanForMutasi?.jumlah_beli_terakhir || 1),
										selectedBahanForMutasi?.satuan_beli || selectedBahanForMutasi?.satuan,
										'Kulakan rutin'
									)}
								class="flex cursor-pointer items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50/90 px-3.5 py-2 text-xs font-extrabold text-pink-700 shadow-2xs transition-all hover:bg-pink-100/80 active:scale-95 sm:text-sm"
							>
								<Sparkles class="h-3.5 w-3.5 text-pink-600" />
								<span
									>Kulakan Terakhir ({formatQuantity(selectedBahanForMutasi.jumlah_beli_terakhir)}
									{selectedBahanForMutasi.satuan_beli || selectedBahanForMutasi.satuan})</span
								>
							</button>
						{/if}

						<!-- Standard Numerical Presets based on mutasiType -->
						{#if mutasiType === 'tambah'}
							{#each [1, 2, 5, 10, 20] as val}
								<button
									type="button"
									onclick={() => setQuickAmount(val)}
									class="cursor-pointer rounded-xl border border-slate-200/90 bg-slate-50 px-3.5 py-1.5 text-xs font-extrabold text-slate-700 transition-all hover:border-pink-300 hover:bg-pink-50/50 hover:text-pink-700 active:scale-95 sm:text-sm"
								>
									+{val}
								</button>
							{/each}
						{:else}
							{#each [1, 2, 5, 10] as val}
								<button
									type="button"
									onclick={() => setQuickAmount(val)}
									class="cursor-pointer rounded-xl border border-slate-200/90 bg-slate-50 px-3.5 py-1.5 text-xs font-extrabold text-slate-700 transition-all hover:border-rose-300 hover:bg-rose-50/50 hover:text-rose-700 active:scale-95 sm:text-sm"
								>
									-{val}
								</button>
							{/each}
							{#if Number(selectedBahanForMutasi.stok_saat_ini || 0) > 0}
								<button
									type="button"
									onclick={() =>
										setQuickAmount(
											Number(selectedBahanForMutasi?.stok_saat_ini || 0),
											selectedBahanForMutasi?.satuan,
											'Habis / Stok Rusak Total'
										)}
									class="cursor-pointer rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-extrabold text-rose-700 transition-all hover:bg-rose-100/80 active:scale-95 sm:text-sm"
								>
									Habiskan ({formatQuantity(selectedBahanForMutasi.stok_saat_ini)})
								</button>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Catatan & Quick Note Tags -->
				<div class="flex flex-col gap-1.5">
					<label
						for="mutasi-notes"
						class="text-xs font-black tracking-wider text-slate-700 uppercase"
					>
						Catatan
					</label>
					<input
						id="mutasi-notes"
						type="text"
						bind:value={mutasiNotes}
						placeholder={mutasiType === 'tambah'
							? 'Contoh: Beli di pasar subuh'
							: 'Contoh: Buah busuk / tumpah'}
						class="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 transition-all placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15 focus:outline-none"
					/>
					<!-- Quick Tag Pills -->
					<div class="flex flex-wrap gap-1.5 pt-1">
						{#if mutasiType === 'tambah'}
							{#each ['Pasar Subuh', 'Supplier Grosir', 'Supermarket', 'Restock Toko'] as tag}
								<button
									type="button"
									onclick={() => setQuickNote(tag)}
									class="cursor-pointer rounded-xl border border-slate-200/80 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition-all hover:border-pink-300 hover:text-pink-700 active:scale-95"
								>
									{tag}
								</button>
							{/each}
						{:else}
							{#each ['Kadaluarsa / Basi', 'Tumpah / Pecah', 'Koreksi Hitungan', 'Penyusutan Alami'] as tag}
								<button
									type="button"
									onclick={() => setQuickNote(tag)}
									class="cursor-pointer rounded-xl border border-slate-200/80 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition-all hover:border-rose-300 hover:text-rose-700 active:scale-95"
								>
									{tag}
								</button>
							{/each}
						{/if}
					</div>
				</div>

				<!-- Finansial / Buku Kas Integration Toggle Card (Progressive Disclosure) -->
				<div
					class="rounded-2xl border {recordKasTransaction
						? 'border-pink-300 bg-pink-50/50 shadow-xs ring-1 ring-pink-500/15'
						: 'border-slate-200/80 bg-slate-50/50'} p-4 transition-all"
				>
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors {recordKasTransaction
									? 'bg-pink-600 text-white shadow-xs shadow-pink-600/30'
									: 'bg-slate-200 text-slate-600'}"
							>
								<Wallet class="h-4.5 w-4.5 stroke-[2.2]" />
							</div>
							<div>
								<span class="block text-xs font-black text-slate-800 sm:text-sm">
									{mutasiType === 'tambah'
										? 'Catat Pengeluaran Uang Kas?'
										: 'Catat Kerugian ke Buku Kas?'}
								</span>
								<p class="text-[11px] font-medium text-slate-500">
									{mutasiType === 'tambah'
										? 'Otomatis catat belanja kulakan ke Buku Kas & Laporan Keuangan'
										: 'Catat nilai nominal bahan terbuang/rusak sebagai beban'}
								</p>
							</div>
						</div>

						<!-- Switch Toggle (Default: OFF / 100% Opsional) -->
						<button
							type="button"
							role="switch"
							aria-label={mutasiType === 'tambah'
								? 'Catat pengeluaran uang kas'
								: 'Catat kerugian ke buku kas'}
							aria-checked={recordKasTransaction}
							onclick={() => {
								recordKasTransaction = !recordKasTransaction;
								if (recordKasTransaction && !kasNominal && selectedBahanForMutasi) {
									if (
										mutasiType === 'tambah' &&
										Number(selectedBahanForMutasi.biaya_beli_terakhir || 0) > 0
									) {
										kasNominal = formatRupiah(selectedBahanForMutasi.biaya_beli_terakhir);
									} else if (
										mutasiType === 'kurang' &&
										Number(selectedBahanForMutasi.biaya_per_satuan || 0) > 0 &&
										mutasiBaseAmount > 0
									) {
										kasNominal = formatRupiah(
											Math.round(mutasiBaseAmount * Number(selectedBahanForMutasi.biaya_per_satuan))
										);
									}
								}
							}}
							class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {recordKasTransaction
								? 'bg-pink-600'
								: 'bg-slate-300'}"
						>
							<span
								class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out {recordKasTransaction
									? 'translate-x-5'
									: 'translate-x-0'}"
							></span>
						</button>
					</div>

					{#if recordKasTransaction}
						<div
							class="mt-4 flex flex-col gap-3.5 border-t border-pink-200/70 pt-3.5"
							in:slide={{ duration: 180 }}
						>
							<!-- Input Nominal Uang -->
							<div class="flex flex-col gap-1">
								<label
									for="kas-nominal"
									class="text-xs font-black tracking-wider text-slate-700 uppercase"
								>
									Total Nominal Uang
								</label>
								<div class="relative flex items-center">
									<span
										class="pointer-events-none absolute left-4 text-sm font-black text-slate-400"
										>Rp</span
									>
									<input
										id="kas-nominal"
										type="text"
										inputmode="numeric"
										value={kasNominal}
										oninput={(e) => {
											const val = (e.target as HTMLInputElement).value;
											kasNominal = formatRupiah(parseRupiah(val));
										}}
										placeholder="0"
										class="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-4 pl-11 text-base font-black text-slate-900 shadow-2xs transition-all focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15 focus:outline-none"
									/>
								</div>
							</div>

							<!-- Metode Pembayaran & Kategori Akuntansi -->
							<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
								<!-- Metode Pembayaran -->
								<div class="flex flex-col gap-1">
									<span class="text-[11px] font-black tracking-wider text-slate-700 uppercase"
										>Metode Bayar</span
									>
									<div class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-200/70 p-1">
										<button
											type="button"
											onclick={() => (kasPaymentMethod = 'tunai')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {kasPaymentMethod ===
											'tunai'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Tunai (Laci)
										</button>
										<button
											type="button"
											onclick={() => (kasPaymentMethod = 'non-tunai')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {kasPaymentMethod ===
											'non-tunai'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Non-Tunai
										</button>
									</div>
								</div>

								<!-- Kategori Biaya Buku Kas -->
								<div class="flex flex-col gap-1">
									<span class="text-[11px] font-black tracking-wider text-slate-700 uppercase"
										>Kategori Akuntansi</span
									>
									<div class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-200/70 p-1">
										<button
											type="button"
											onclick={() => (kasCategory = 'beban_usaha')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {kasCategory ===
											'beban_usaha'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Beban Usaha
										</button>
										<button
											type="button"
											onclick={() => (kasCategory = 'lainnya')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {kasCategory ===
											'lainnya'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Lainnya
										</button>
									</div>
								</div>
							</div>

							<!-- Live HPP Calculator Card (Khusus Tambah / Kulakan) -->
							{#if mutasiType === 'tambah' && parseRupiah(kasNominal) > 0 && mutasiBaseAmount > 0}
								<div class="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs">
									<label class="flex cursor-pointer items-start gap-2.5">
										<input
											type="checkbox"
											bind:checked={updateHppWithPurchase}
											class="mt-0.5 h-4 w-4 rounded text-pink-600 focus:ring-pink-500"
										/>
										<div>
											<span class="font-extrabold text-emerald-950">Perbarui HPP Bahan Baku</span>
											<p class="mt-0.5 text-emerald-800">
												Biaya modal baru: <strong class="font-black"
													>Rp{formatRupiah(
														Math.round(parseRupiah(kasNominal) / mutasiBaseAmount)
													)}</strong
												>
												/ {selectedBahanForMutasi.satuan}
												<span class="text-emerald-700"
													>(sebelumnya: Rp{formatRupiah(
														selectedBahanForMutasi.biaya_per_satuan || 0
													)})</span
												>
											</p>
										</div>
									</label>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Riwayat Mutasi Terakhir (Mini Section - Max 10 items, scrollable for 3 visible) -->
				<div class="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
					<button
						type="button"
						onclick={() => (showHistorySection = !showHistorySection)}
						class="flex w-full cursor-pointer items-center justify-between text-left text-xs font-black text-slate-700 transition-colors hover:text-pink-600"
					>
						<span class="flex items-center gap-2">
							<History class="h-4 w-4 text-slate-400" />
							Riwayat {mutasiType === 'tambah' ? 'Kulakan / Masuk' : 'Koreksi / Buang'} ({filteredMutations.length})
						</span>
						<ChevronDown
							class="h-4 w-4 text-slate-400 transition-transform {showHistorySection
								? 'rotate-180'
								: ''}"
						/>
					</button>

					{#if showHistorySection}
						<div class="mt-3 border-t border-slate-200/60 pt-2.5" in:slide={{ duration: 180 }}>
							{#if isLoadingMutasiHistory}
								<p class="py-2 text-center text-xs text-slate-400">Memuat riwayat...</p>
							{:else if filteredMutations.length === 0}
								<p class="py-2 text-center text-xs text-slate-400">
									Belum ada riwayat {mutasiType === 'tambah' ? 'kulakan manual' : 'koreksi/buang'} untuk
									bahan ini.
								</p>
							{:else}
								<div class="no-scrollbar flex max-h-[195px] flex-col gap-2 overflow-y-auto pr-1">
									{#each filteredMutations as preset}
										<button
											type="button"
											onclick={() => applyMutationFromHistory(preset)}
											title="Klik untuk mengisi form dengan data ini"
											class="group flex w-full cursor-pointer items-center justify-between rounded-2xl border border-slate-100 bg-white p-3.5 text-left text-xs shadow-2xs transition-all hover:border-pink-300 hover:bg-pink-50/60 active:scale-[0.98] sm:text-sm"
										>
											<div class="min-w-0 flex-1 pr-3">
												<p
													class="truncate font-bold text-slate-900 transition-colors group-hover:text-pink-700"
												>
													{preset.catatan}
												</p>
												{#if preset.latest_created_at}
													<p class="mt-0.5 text-xs text-slate-400">
														{new Date(preset.latest_created_at).toLocaleDateString('id-ID', {
															day: 'numeric',
															month: 'short',
															hour: '2-digit',
															minute: '2-digit'
														})}
													</p>
												{/if}
											</div>
											<span
												class="shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-black sm:text-sm {preset.delta_jumlah >
												0
													? 'bg-emerald-50 text-emerald-700'
													: 'bg-rose-50 text-rose-700'}"
											>
												{preset.delta_jumlah > 0 ? '+' : ''}{formatQuantity(
													Math.abs(preset.delta_jumlah)
												)}
												{selectedBahanForMutasi.satuan}
											</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</form>

			<!-- Action Buttons -->
			<div class="flex gap-3 border-t border-slate-100 bg-white p-4 sm:p-5">
				<button
					type="button"
					onclick={closeMutasiModal}
					class="flex-1 cursor-pointer rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
				>
					Batal
				</button>
				<button
					type="submit"
					form="stok-mutasi-form"
					disabled={isSavingMutasi || mutasiBaseAmount <= 0}
					class="flex-2 cursor-pointer rounded-2xl bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3.5 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSavingMutasi ? 'Menyimpan...' : 'Simpan Perubahan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Konfirmasi Hapus -->
{#if showDeleteModal}
	<div
		class="z-alert fixed inset-0 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		onclick={(e) => e.target === e.currentTarget && (showDeleteModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDeleteModal = false)}
		tabindex="-1"
	>
		<div
			class="relative flex w-full max-w-xs flex-col items-center overflow-hidden rounded-[32px] border border-rose-100/90 bg-white p-6 shadow-2xl ring-1 ring-rose-500/10"
			in:fly={{ y: 20, duration: 200, easing: cubicOut }}
		>
			<div
				class="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 shadow-2xs"
			>
				<Trash2 class="h-6 w-6 stroke-[2.2]" />
			</div>
			<h2 class="mb-1 text-center text-lg font-black text-slate-900">Hapus Bahan Ini?</h2>
			<p class="mb-5 text-center text-xs font-medium text-slate-500 sm:text-sm">
				Bahan yang dihapus tidak dapat dipulihkan dan resep menu yang menggunakannya akan
				terpengaruh.
			</p>
			<div class="flex w-full gap-3">
				<button
					type="button"
					class="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
					onclick={() => (showDeleteModal = false)}
				>
					Batal
				</button>
				<button
					type="button"
					class="flex-1 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 py-3 text-sm font-black text-white shadow-md shadow-rose-600/25 transition-all hover:opacity-95 active:scale-95"
					onclick={handleDeleteBahan}
				>
					Ya, Hapus
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Toast Notification -->
<ToastNotification show={showToast} message={toastMessage} type={toastType} position="top" />
