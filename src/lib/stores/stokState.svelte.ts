// AUD-053: state, perintah, dan lifecycle halaman Stok (sebelumnya inline di
// routes/stok/+page.svelte). Halaman hanya merender; komponen dialog menerima `s`.
import { productService } from '$lib/services/productService';
import { transactionService } from '$lib/services/transactionService';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { cacheOrchestrator } from '$lib/utils/cacheOrchestrator';
import {
	formatRupiah,
	parseRupiah,
	parseQuantityInput,
	sanitizeQuantityDraft,
	formatQuantityField
} from '$lib/utils/currency';
import {
	bahanFormFromIngredient,
	buildBahanPayload,
	emptyBahanForm,
	DEFAULT_BAHAN_CATEGORY,
	type BahanForm
} from '$lib/utils/bahanForm';
import { realtimeManager } from '$lib/realtime/realtimeManager';
import { refreshBus } from '$lib/utils/refreshBus';
import { evaluateAndAlertLowStock } from '$lib/services/stockAlertService';
import {
	convertToBaseUnit,
	safeConvertFromBaseUnit,
	getCompatibleUnits,
	formatQuantity,
	type UnitOption
} from '$lib/utils/unitConversion';
import type { Ingredient } from '$lib/types/product';
import {
	filterLowStock,
	filterBahan,
	buildCategoryOptions,
	countCategory
} from '$lib/utils/stockHealth';
import { readMutationFrequency, recordMutationClick } from '$lib/utils/mutationFrequency';

import { selectedBranch } from '$lib/stores/selectedBranch.svelte';

import { createToastManager } from '$lib/utils/ui.svelte';

export function createStokState() {
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

	// Satu pemindaian daftar per perubahan bahanList.
	const categoryOptions = $derived(buildCategoryOptions(bahanList, defaultCategories));
	const dynamicCategories = $derived(categoryOptions.dynamic);
	const availableCategoryOptions = $derived(categoryOptions.available);

	function getCategoryCount(cat: string): number {
		return countCategory(bahanList, lowStockItems.length, cat);
	}

	// Toast state
	// Toast kanonik (timer + reset show) seperti halaman lain; dulu show tak pernah direset.
	const toastManager = createToastManager();
	function notify(message: string, type: 'success' | 'error' | 'info' = 'success') {
		toastManager.showToastNotification(message, type);
	}

	// Stats & Filtered Data (predikat/filter terpusat di stockHealth.ts).
	const lowStockItems = $derived(filterLowStock(bahanList));

	const filteredBahan = $derived.by(() => {
		return filterBahan(bahanList, searchKeyword, selectedCategory);
	});

	// Load Data
	// AUD-021: generasi per load. Hanya request terkini boleh commit data,
	// tampilkan error, atau finalize loading. Request basi yang selesai
	// belakangan diabaikan diam-diam.
	let bahanLoadGeneration = 0;
	async function loadBahan(forceRefresh = true) {
		const generation = ++bahanLoadGeneration;
		const alive = () => generation === bahanLoadGeneration;
		isLoading = true;
		try {
			const data = (await productService.getIngredients(forceRefresh)) as unknown as Ingredient[];
			if (!alive()) return;
			bahanList = data || [];
			evaluateAndAlertLowStock(bahanList);
		} catch {
			if (!alive()) return;
			notify('Gagal memuat data stok bahan', 'error');
		} finally {
			if (alive()) isLoading = false;
		}
	}

	// Form Tambah/Edit Bahan
	// Form Tambah/Edit Bahan
	let showBahanModal = $state(false);
	let editBahanId = $state<string | number | null>(null);
	let bahanForm = $state<BahanForm>(emptyBahanForm());
	const editingBahan = $derived(
		editBahanId === null
			? null
			: (bahanList.find((b) => String(b.id) === String(editBahanId)) ?? null)
	);

	function openAddModal() {
		editBahanId = null;
		bahanForm = emptyBahanForm(
			selectedCategory !== 'all' && selectedCategory !== 'low_stock'
				? selectedCategory
				: DEFAULT_BAHAN_CATEGORY
		);
		showBahanModal = true;
	}

	function openEditModal(bahan: Ingredient) {
		editBahanId = bahan.id;
		bahanForm = bahanFormFromIngredient(bahan, availableCategoryOptions);
		showBahanModal = true;
	}

	function closeBahanModal() {
		showBahanModal = false;
		editBahanId = null;
	}

	async function handleSaveBahan(e: SubmitEvent) {
		e.preventDefault();
		// AUD-053: kebijakan payload sama dengan Manajemen Menu (utils/bahanForm).
		const built = buildBahanPayload(bahanForm, Boolean(editBahanId), editingBahan);
		if (!built.ok) {
			notify(built.error, 'error');
			return;
		}
		const payload = built.payload;

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
	// Kunci idempotency perintah kulakan: stabil per niat modal agar retry aman.
	let mutasiOperationKey = $state('');
	let mutasiGeneration = 0;
	let mutasiPendingRequest = $state<{
		body: string;
		branch: string;
		signedDelta: number;
		bahanNama: string;
		satuan: string;
		withKas: boolean;
		ambiguousResult: boolean;
	} | null>(null);

	function getMutationClickFrequencyMap(): Record<string, number> {
		return readMutationFrequency();
	}

	function incrementMutationClickFrequency(key: string) {
		recordMutationClick(key);
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

	// Preset "Kulakan Terakhir" (AUD-007): tersimpan dalam satuan dasar,
	// wajib dikonversi balik ke satuan beli untuk label + isian. Tanpa ini
	// 1000 gram tersimpan tampil/diisi sebagai 1000 kg (= 1.000.000 gram).
	const terakhirKulakanPreset = $derived.by(() => {
		if (!selectedBahanForMutasi) return null;
		const storedBase = Number(selectedBahanForMutasi.jumlah_beli_terakhir || 0);
		if (!Number.isFinite(storedBase) || storedBase <= 0) return null;
		const baseUnit = selectedBahanForMutasi.satuan || 'gram';
		const buyUnit = selectedBahanForMutasi.satuan_beli || baseUnit;
		const pack = Number(selectedBahanForMutasi.isi_per_kemasan) || 1;
		const display = safeConvertFromBaseUnit(storedBase, buyUnit, baseUnit, pack);
		if (Number.isFinite(display) && display > 0) return { amount: display, unit: buyUnit };
		return { amount: storedBase, unit: baseUnit };
	});

	const mutasiBaseAmount = $derived.by(() => {
		if (!selectedBahanForMutasi || !mutasiAmount) return 0;
		const parsed = parseQuantityInput(mutasiAmount);
		if (!parsed || isNaN(parsed) || parsed <= 0) return 0;
		try {
			const base = convertToBaseUnit(
				parsed,
				mutasiUnit,
				selectedBahanForMutasi.satuan || 'gram',
				Number(selectedBahanForMutasi.isi_per_kemasan) || 1
			);
			return Number.isFinite(base) ? base : 0;
		} catch {
			return 0;
		}
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
		mutasiGeneration += 1;
		mutasiPendingRequest = null;
		isSavingMutasi = false;
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
		mutasiOperationKey = crypto.randomUUID();
		showHistorySection = false;
		showMutasiModal = true;
		void loadMutasiHistory(bahan.id);
	}

	function closeMutasiModal() {
		if (
			mutasiPendingRequest &&
			!window.confirm(
				'Permintaan kulakan mungkin sudah tersimpan. Menutup dialog tidak membatalkannya. Periksa riwayat sebelum membuat kulakan baru. Tetap tutup?'
			)
		)
			return;
		mutasiGeneration += 1;
		mutasiPendingRequest = null;
		mutasiOperationKey = '';
		isSavingMutasi = false;
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
		if (!mutasiPendingRequest && baseQty <= 0) {
			notify('Jumlah harus lebih dari 0', 'error');
			return;
		}

		const generation = mutasiGeneration;
		isSavingMutasi = true;
		try {
			// Bekukan body dan ringkasan saat submit pertama. Retry ambigu tidak
			// boleh membaca form/katalog/cabang baru dengan operation key lama.
			if (!mutasiPendingRequest) {
				const parsedAmount = parseQuantityInput(mutasiAmount);
				const parsedNominal = parseRupiah(kasNominal);
				const withKas = recordKasTransaction && parsedNominal > 0;
				const deskripsiKas =
					mutasiNotes.trim() ||
					(mutasiType === 'tambah'
						? `Kulakan Bahan: ${selectedBahanForMutasi.nama} (${mutasiAmount} ${mutasiUnit})`
						: `Beban Kerusakan Bahan: ${selectedBahanForMutasi.nama} (${mutasiAmount} ${mutasiUnit})`);
				const branch = selectedBranch.value;
				mutasiPendingRequest = {
					branch,
					body: JSON.stringify({
						branch,
						payload: {
							bahan_id: String(selectedBahanForMutasi.id),
							arah: mutasiType,
							jumlah: parsedAmount,
							satuan: mutasiUnit,
							catatan: mutasiNotes.trim() || undefined,
							operation_key: mutasiOperationKey,
							kas: withKas
								? {
										nominal: parsedNominal,
										metode_bayar: kasPaymentMethod,
										jenis: kasCategory,
										deskripsi: deskripsiKas
									}
								: null,
							update_hpp: mutasiType === 'tambah' && updateHppWithPurchase
						}
					}),
					signedDelta: mutasiType === 'tambah' ? baseQty : -baseQty,
					bahanNama: selectedBahanForMutasi.nama,
					satuan: selectedBahanForMutasi.satuan || 'gram',
					withKas,
					ambiguousResult: false
				};
			}
			const intent = mutasiPendingRequest;
			const res = await fetchWithCsrfRetry('/api/bahan/purchase', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: intent.body
			});
			if (generation !== mutasiGeneration || selectedBranch.value !== intent.branch) return;
			if (!res.ok) {
				const detail = await res.json().catch(() => null);
				if (generation !== mutasiGeneration) return;
				// 400 menolak attempt ini, bukan menyangkal commit attempt lama yang ambigu.
				if (res.status === 400 && !intent.ambiguousResult) mutasiPendingRequest = null;
				else intent.ambiguousResult = true;
				notify(
					`Gagal mengubah stok: ${detail?.message || `HTTP ${res.status}`}. Periksa riwayat sebelum membuat kulakan baru.`,
					'error'
				);
				return;
			}

			await cacheOrchestrator.clearAllCaches();
			await cacheOrchestrator.invalidateCacheOnChange('bahan');
			await cacheOrchestrator.invalidateCacheOnChange('buku_kas');

			if (generation !== mutasiGeneration || selectedBranch.value !== intent.branch) return;
			const notifExtra = intent.withKas ? ' & Pengeluaran kas tercatat' : '';
			mutasiPendingRequest = null;
			notify(
				`Stok ${intent.bahanNama} berhasil diubah (${intent.signedDelta > 0 ? '+' : ''}${formatQuantity(intent.signedDelta)} ${intent.satuan})${notifExtra}`
			);
			closeMutasiModal();
			await loadBahan(true);
		} catch {
			// Hasil jaringan ambigu: pertahankan intent/key supaya retry tidak membuat kulakan kedua.
			if (generation === mutasiGeneration) {
				if (mutasiPendingRequest) mutasiPendingRequest.ambiguousResult = true;
				notify(
					'Hasil kulakan belum terkonfirmasi. Coba lagi dengan permintaan yang sama.',
					'error'
				);
			}
		} finally {
			if (generation === mutasiGeneration) isSavingMutasi = false;
		}
	}

	// Modal Hapus Bahan
	let showDeleteModal = $state(false);
	let deleteTargetId = $state<string | number | null>(null);

	function openDeleteConfirm(id: string | number) {
		deleteTargetId = id;
		showDeleteModal = true;
	}

	function closeDeleteConfirm() {
		showDeleteModal = false;
		deleteTargetId = null;
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

	// Format input helper: uang format tiap ketik; jumlah HANYA sanitasi saat
	// ketik (draft "0," dipertahankan) dan diformat pada blur.
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
		if (field === 'biaya_beli_terakhir') {
			const parsed = parseRupiah(target.value);
			bahanForm[field] = parsed ? formatRupiah(parsed) : '';
			return;
		}
		bahanForm[field] = sanitizeQuantityDraft(target.value);
	}

	function handleQuantityBlur(
		field: 'stok_saat_ini' | 'ambang_stok' | 'jumlah_beli_terakhir' | 'isi_per_kemasan'
	) {
		formatQuantityField(bahanForm, field);
	}

	// Lifecycle
	// AUD-022: setup sinkron sebelum await apa pun agar resolving
	// tak mendaftarkan subscription sesudah destroy. Handler window
	// bernama agar bisa dilepas; destroy menaikkan generasi load
	// (batalkan commit in-flight AUD-021).
	let offStokBus: (() => void) | null = null;
	let stokRealtimeDisposers: Array<() => void> = [];
	let stokMounted = false;

	function handlePenjualanBerhasil(): void {
		void loadBahan(true);
	}

	function teardownStokSubscriptions(): void {
		stokMounted = false;
		bahanLoadGeneration++;
		mutasiGeneration++;
		if (typeof window !== 'undefined') {
			window.removeEventListener('penjualan-berhasil', handlePenjualanBerhasil);
		}
		if (offStokBus) offStokBus();
		offStokBus = null;
		for (const unsub of stokRealtimeDisposers) unsub();
		stokRealtimeDisposers = [];
	}

	function mount(): void {
		stokMounted = true;
		offStokBus = refreshBus.on('stok', () => {
			if (stokMounted) void loadBahan(true);
		});
		window.addEventListener('penjualan-berhasil', handlePenjualanBerhasil);
		stokRealtimeDisposers.push(
			realtimeManager.subscribe('bahan', () => {
				if (stokMounted) void loadBahan(true);
			})
		);
		stokRealtimeDisposers.push(
			realtimeManager.subscribe('bahan_mutasi', () => {
				if (stokMounted) void loadBahan(true);
			})
		);
		stokRealtimeDisposers.push(
			realtimeManager.subscribe('transaksi_kasir', () => {
				if (stokMounted) void loadBahan(true);
			})
		);
		void loadBahan(true);
	}

	function destroy(): void {
		teardownStokSubscriptions();
	}

	return {
		get bahanList() {
			return bahanList;
		},
		get isLoading() {
			return isLoading;
		},
		get searchKeyword() {
			return searchKeyword;
		},
		set searchKeyword(value) {
			searchKeyword = value;
		},
		get selectedCategory() {
			return selectedCategory;
		},
		set selectedCategory(value) {
			selectedCategory = value;
		},
		get showBahanModal() {
			return showBahanModal;
		},
		get editBahanId() {
			return editBahanId;
		},
		get bahanForm() {
			return bahanForm;
		},
		get showMutasiModal() {
			return showMutasiModal;
		},
		get selectedBahanForMutasi() {
			return selectedBahanForMutasi;
		},
		get mutasiType() {
			return mutasiType;
		},
		get mutasiAmount() {
			return mutasiAmount;
		},
		set mutasiAmount(value) {
			mutasiAmount = value;
		},
		get mutasiUnit() {
			return mutasiUnit;
		},
		set mutasiUnit(value) {
			mutasiUnit = value;
		},
		get mutasiNotes() {
			return mutasiNotes;
		},
		set mutasiNotes(value) {
			mutasiNotes = value;
		},
		get isSavingMutasi() {
			return isSavingMutasi;
		},
		get isLoadingMutasiHistory() {
			return isLoadingMutasiHistory;
		},
		get showHistorySection() {
			return showHistorySection;
		},
		set showHistorySection(value) {
			showHistorySection = value;
		},
		get recordKasTransaction() {
			return recordKasTransaction;
		},
		set recordKasTransaction(value) {
			recordKasTransaction = value;
		},
		get kasNominal() {
			return kasNominal;
		},
		set kasNominal(value) {
			kasNominal = value;
		},
		get kasPaymentMethod() {
			return kasPaymentMethod;
		},
		set kasPaymentMethod(value) {
			kasPaymentMethod = value;
		},
		get kasCategory() {
			return kasCategory;
		},
		set kasCategory(value) {
			kasCategory = value;
		},
		get updateHppWithPurchase() {
			return updateHppWithPurchase;
		},
		set updateHppWithPurchase(value) {
			updateHppWithPurchase = value;
		},
		get mutasiPendingRequest() {
			return mutasiPendingRequest;
		},
		get showDeleteModal() {
			return showDeleteModal;
		},
		get dynamicCategories() {
			return dynamicCategories;
		},
		get availableCategoryOptions() {
			return availableCategoryOptions;
		},
		get lowStockItems() {
			return lowStockItems;
		},
		get filteredBahan() {
			return filteredBahan;
		},
		get filteredMutations() {
			return filteredMutations;
		},
		get mutasiCompatibleUnits() {
			return mutasiCompatibleUnits;
		},
		get terakhirKulakanPreset() {
			return terakhirKulakanPreset;
		},
		get mutasiBaseAmount() {
			return mutasiBaseAmount;
		},
		get mutasiPreviewFinalStock() {
			return mutasiPreviewFinalStock;
		},
		getCategoryCount,
		openAddModal,
		openEditModal,
		closeBahanModal,
		handleSaveBahan,
		openMutasi,
		closeMutasiModal,
		setQuickAmount,
		setQuickNote,
		applyMutationFromHistory,
		handleSaveMutasi,
		openDeleteConfirm,
		closeDeleteConfirm,
		handleDeleteBahan,
		handleRupiahFormat,
		handleQuantityBlur,
		get editingBahan() {
			return editingBahan;
		},
		toastManager,
		mount,
		destroy
	};
}

export type StokState = ReturnType<typeof createStokState>;
