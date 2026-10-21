// State, perintah, dan lifecycle halaman Pengaturan Pemilik > Stok
// (kebijakan monitoring, notifikasi, rekonsiliasi). Halaman hanya merender.
import { isOwnerRole } from '$lib/utils/roles';
import { goto } from '$app/navigation';
import { browser } from '$app/environment';
import { userRole } from '$lib/stores/userRole.svelte';
import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
import {
	isSoundEnabled,
	setSoundEnabled,
	isStrictStockEnforcement,
	setStrictStockEnforcement,
	playLowStockSound,
	requestNotificationPermission
} from '$lib/services/stockAlertService';
import { fetchStockPolicy, updateStockPolicy } from '$lib/services/stockPolicyService';
import { fetchWithCsrfRetry } from '$lib/utils/csrf';
import { productService } from '$lib/services/productService';
import type {
	StockReconciliationItem,
	StockReconciliationJob
} from '$lib/server/stockReconciliation';
import type { OfflineReviewRow } from '$lib/server/stockOfflineReview';

export function createOwnerStockState() {
	let soundEnabled = $state(true);
	let strictStockEnabled = $state(false);
	let notifPermission = $state<NotificationPermission>('default');

	// Master toggle monitoring stok per cabang (sumber kebenaran: server).
	let policyMode = $state<'tracked' | 'ignored'>('tracked');
	let policyRevision = $state(0);
	let policyCanManage = $state(false);
	let policyLoading = $state(true);
	let policyError = $state('');
	let policyToggling = $state(false);
	let showDisableConfirm = $state(false);
	let showEnableConfirm = $state(false);
	let cancelDisableButton = $state<HTMLButtonElement | null>(null);
	let cancelEnableButton = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		if (showDisableConfirm) {
			cancelDisableButton?.focus();
		}
		if (showEnableConfirm) {
			cancelEnableButton?.focus();
		}
	});

	function handleModalKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || policyToggling || reconLoading) return;
		if (showDisableConfirm) showDisableConfirm = false;
		if (showEnableConfirm) showEnableConfirm = false;
		if (showReconModal) showReconModal = false;
	}

	if (browser) {
		window.addEventListener('keydown', handleModalKeydown);
	}
	function destroy(): void {
		if (browser) {
			window.removeEventListener('keydown', handleModalKeydown);
		}
	}

	let enableError = $state('');

	async function confirmEnableStock() {
		enableError = '';
		if (!reconJob) {
			await startReconciliation();
			if (!reconJob) {
				// startReconciliation gagal: reconError sudah diisi, biarkan modal
				// konfirmasi tetap terbuka agar pemilik bisa baca lalu batalkan.
				enableError = reconError;
				return;
			}
		}
		showEnableConfirm = false;
		showReconModal = true;
	}

	// Rekonsiliasi aktivasi ulang (pemilik, saat mode ignored).
	// Bentuk wire dipakai bersama server (import type, terhapus saat bundle).
	type ReconItem = StockReconciliationItem;
	type ReconJob = StockReconciliationJob;
	let reconJob = $state<ReconJob | null>(null);
	let reconLoading = $state(false);
	let reconError = $state('');
	let reconDraft = $state<Record<string, string>>({});
	let reconPendingReviews = $state(0);
	let reconSearch = $state('');
	let showReconModal = $state(false);
	let reconFilter = $state('semua');
	let entityMeta = $state<
		Record<string, { nama: string; satuan: string; sistem: number | null; kategori: string }>
	>({});

	const reconCounted = $derived(
		reconJob ? reconJob.items.filter((item) => item.counted_quantity !== null).length : 0
	);
	const reconTotal = $derived(reconJob ? reconJob.items.length : 0);
	const reconComplete = $derived(reconJob?.status === 'ready' && reconCounted === reconTotal);
	const reconGroups = $derived.by(() => {
		if (!reconJob) return [];
		const q = reconSearch.trim().toLowerCase();
		const match = (item: ReconItem) => {
			if (!q) return true;
			const meta = entityMeta[`${item.entity_type}:${item.entity_id}`];
			return (
				item.entity_id.toLowerCase().includes(q) || (meta?.nama || '').toLowerCase().includes(q)
			);
		};
		const visibles = reconJob.items.filter(
			(item) =>
				match(item) &&
				(reconFilter === 'semua' ||
					(item.entity_type === 'produk' ? 'produk' : itemKategori(item)) === reconFilter)
		);
		const groups = [];
		const products = visibles.filter((item) => item.entity_type === 'produk');
		if (products.length > 0) {
			groups.push({ type: 'produk', title: 'Produk', items: products });
		}
		const byKategori = new Map<string, ReconItem[]>();
		for (const item of visibles) {
			if (item.entity_type !== 'bahan') continue;
			const kategori = itemKategori(item);
			if (!byKategori.has(kategori)) byKategori.set(kategori, []);
			byKategori.get(kategori)!.push(item);
		}
		for (const [kategori, items] of [...byKategori.entries()].sort((a, b) =>
			a[0].localeCompare(b[0], 'id')
		)) {
			groups.push({ type: 'bahan', title: kategori, items });
		}
		return groups;
	});

	function itemKategori(item: ReconItem): string {
		if (item.entity_type !== 'bahan') return 'produk';
		const kategori = entityMeta[`${item.entity_type}:${item.entity_id}`]?.kategori?.trim();
		return kategori || 'Bahan baku';
	}

	const reconFilterOptions = $derived.by(() => {
		if (!reconJob) return [];
		const options = [{ value: 'semua', label: 'Semua' }];
		if (reconJob.items.some((item) => item.entity_type === 'produk')) {
			options.push({ value: 'produk', label: 'Produk' });
		}
		const kategoris = new Set<string>();
		for (const item of reconJob.items) {
			if (item.entity_type === 'bahan') kategoris.add(itemKategori(item));
		}
		for (const kategori of [...kategoris].sort((a, b) => a.localeCompare(b, 'id'))) {
			options.push({ value: kategori, label: kategori });
		}
		return options;
	});

	// Tinjauan antrean offline yang dikarantina (HTTP 428).
	type OfflineReview = OfflineReviewRow;
	let reconReviews = $state<OfflineReview[]>([]);
	let reconReviewActing = $state('');

	function toggleSound() {
		soundEnabled = !soundEnabled;
		setSoundEnabled(soundEnabled);
		if (soundEnabled) {
			playLowStockSound(true);
		}
	}

	function toggleStrictStock() {
		strictStockEnabled = !strictStockEnabled;
		setStrictStockEnforcement(strictStockEnabled);
	}

	async function handleRequestNotif() {
		const res = await requestNotificationPermission();
		notifPermission = res;
		playLowStockSound(true);
	}

	async function loadPolicy() {
		policyLoading = true;
		policyError = '';
		try {
			const policy = await fetchStockPolicy();
			policyMode = policy.mode;
			policyRevision = policy.revision;
			policyCanManage = policy.can_manage_policy;
		} catch (error) {
			policyError = error instanceof Error ? error.message : 'Gagal memuat pengaturan stok';
		} finally {
			policyLoading = false;
		}
	}

	async function confirmDisableStock() {
		policyToggling = true;
		policyError = '';
		try {
			const branch = selectedBranch.value;
			const policy = await updateStockPolicy({
				branch,
				expected_revision: policyRevision,
				mode: 'ignored'
			});
			policyMode = policy.mode;
			policyRevision = policy.revision;
			showDisableConfirm = false;
		} catch (error) {
			policyError = error instanceof Error ? error.message : 'Gagal menonaktifkan monitoring stok';
		} finally {
			policyToggling = false;
		}
	}

	async function loadPendingReviews(): Promise<void> {
		try {
			const response = await fetch('/api/pengaturan/stok/offline-reviews', {
				headers: { Accept: 'application/json' },
				cache: 'no-store'
			});
			if (!response.ok) return;
			const payload = (await response.json()) as {
				data?: { items?: OfflineReview[] };
			};
			const items = payload?.data?.items || [];
			reconReviews = items.filter((item) => item.status !== 'consumed');
			reconPendingReviews = items.filter((item) => item.status === 'pending').length;
		} catch {
			// Best-effort.
		}
	}

	async function resolveReview(
		idempotencyKey: string,
		expectedRevision: number,
		action: 'approve_current' | 'withdraw'
	) {
		reconReviewActing = idempotencyKey;
		reconError = '';
		try {
			const branch = selectedBranch.value;
			const response = await fetchReconTimeout(
				`/api/pengaturan/stok/offline-reviews/${encodeURIComponent(idempotencyKey)}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						branch,
						expected_revision: expectedRevision,
						action
					})
				}
			);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Gagal memproses review (HTTP ${response.status})`);
			}
			await loadPendingReviews();
		} catch (error) {
			reconError = reconErrorMessage(error, 'Gagal memproses review antrean');
		} finally {
			reconReviewActing = '';
		}
	}

	function formatQueuedAt(value: number): string {
		try {
			return new Date(value).toLocaleString('id-ID', {
				day: '2-digit',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return String(value);
		}
	}

	async function loadEntityMeta(): Promise<void> {
		try {
			const [ingredients, products] = await Promise.all([
				productService.getIngredients().catch(() => []),
				productService.getProducts().catch(() => [])
			]);
			const meta: Record<
				string,
				{ nama: string; satuan: string; sistem: number | null; kategori: string }
			> = {};
			for (const bahan of (ingredients || []) as Array<Record<string, unknown>>) {
				const id = String(bahan.id ?? '');
				if (!id) continue;
				const stok = Number(bahan.stok_saat_ini);
				const kategori =
					typeof bahan.kategori === 'string' && bahan.kategori.trim()
						? bahan.kategori.trim()
						: 'Bahan baku';
				meta[`bahan:${id}`] = {
					nama: typeof bahan.nama === 'string' && bahan.nama ? bahan.nama : id,
					satuan: typeof bahan.satuan === 'string' ? bahan.satuan : '',
					sistem: Number.isFinite(stok) ? stok : null,
					kategori
				};
			}
			for (const produk of (products || []) as Array<Record<string, unknown>>) {
				const id = String(produk.id ?? '');
				if (!id) continue;
				const stok = Number(produk.stok);
				meta[`produk:${id}`] = {
					nama: typeof produk.nama === 'string' && produk.nama ? produk.nama : id,
					satuan: 'pcs',
					sistem: Number.isFinite(stok) ? stok : null,
					kategori: 'produk'
				};
			}
			entityMeta = meta;
		} catch {
			// Nama fallback ke ID; hitung fisik tetap bisa diisi.
		}
	}

	async function loadActiveReconciliation(): Promise<void> {
		try {
			const response = await fetchReconTimeout('/api/pengaturan/stok/reconciliation/active', {
				headers: { Accept: 'application/json' },
				cache: 'no-store'
			});
			if (!response.ok) return;
			const payload = (await response.json()) as { data?: { job?: ReconJob | null } };
			if (payload?.data?.job) {
				reconJob = payload.data.job;
				reconDraft = {};
				void Promise.all([loadEntityMeta(), loadPendingReviews()]);
			}
		} catch {
			// Best-effort.
		}
	}

	const REQUEST_TIMEOUT_MS = 30000;

	function isTimeoutError(error: unknown): boolean {
		return error instanceof Error && error.message === 'REQUEST_TIMEOUT';
	}

	async function fetchReconTimeout(input: string, init: RequestInit): Promise<Response> {
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			return await Promise.race([
				fetchWithCsrfRetry(input, init),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS);
				})
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	function timeoutMessage(): string {
		return 'Jaringan lambat atau respons hilang. Periksa koneksi, muat ulang bila perlu, lalu coba lagi.';
	}

	function reconErrorMessage(error: unknown, fallback: string): string {
		if (isTimeoutError(error)) return timeoutMessage();
		return error instanceof Error ? error.message : fallback;
	}

	async function startReconciliation() {
		reconLoading = true;
		reconError = '';
		try {
			const branch = selectedBranch.value;
			const response = await fetchReconTimeout('/api/pengaturan/stok/reconciliation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ branch })
			});
			if (!response.ok) {
				if (response.status === 409) {
					await loadActiveReconciliation();
					if (reconJob) return;
				}
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Gagal membuat rekonsiliasi (HTTP ${response.status})`);
			}
			const payload = (await response.json()) as { data: ReconJob };
			reconJob = payload.data;
			reconDraft = {};
			reconSearch = '';
			void Promise.all([loadEntityMeta(), loadPendingReviews()]);
		} catch (error) {
			if (isTimeoutError(error)) {
				// Server mungkin sudah memproses: adopsi job aktif bila ada.
				await loadActiveReconciliation();
				if (reconJob) {
					return;
				}
				reconError = timeoutMessage();
			} else {
				reconError = error instanceof Error ? error.message : 'Gagal membuat rekonsiliasi';
			}
		} finally {
			reconLoading = false;
		}
	}

	async function saveReconCounts() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = selectedBranch.value;
			const items = reconJob.items.flatMap((item) => {
				const key = `${item.entity_type}:${item.entity_id}`;
				// Input number menyimpan angka; tombol "≈ sistem" menyimpan string.
				const raw = String(reconDraft[key] ?? '')
					.trim()
					.replace(',', '.');
				if (raw === '') return [];
				const counted = Number(raw);
				if (!Number.isFinite(counted) || counted < 0) {
					throw new Error(`Hitungan ${item.entity_id} harus angka nonnegatif`);
				}
				return [
					{
						entity_type: item.entity_type,
						entity_id: item.entity_id,
						counted_quantity: counted
					}
				];
			});
			if (items.length === 0) {
				throw new Error('Isi dulu hasil hitung fisik minimal satu item sebelum menyimpan');
			}
			const response = await fetchReconTimeout(
				`/api/pengaturan/stok/reconciliation/${reconJob.id}/items`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ branch, items })
				}
			);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Gagal menyimpan hitungan (HTTP ${response.status})`);
			}
			const payload = (await response.json()) as { data: ReconJob };
			reconJob = payload.data;
			reconDraft = {};
		} catch (error) {
			reconError = reconErrorMessage(error, 'Gagal menyimpan hitungan');
		} finally {
			reconLoading = false;
		}
	}

	async function cancelReconciliation() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = selectedBranch.value;
			const response = await fetchReconTimeout(
				`/api/pengaturan/stok/reconciliation/${reconJob.id}`,
				{
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ branch })
				}
			);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Gagal membatalkan (HTTP ${response.status})`);
			}
			reconJob = null;
			reconDraft = {};
			showReconModal = false;
		} catch (error) {
			reconError = reconErrorMessage(error, 'Gagal membatalkan rekonsiliasi');
		} finally {
			reconLoading = false;
		}
	}

	async function finalizeReconciliation() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = selectedBranch.value;
			const response = await fetchReconTimeout(
				`/api/pengaturan/stok/reconciliation/${reconJob.id}/finalize`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						branch,
						expected_policy_revision: reconJob.expected_policy_revision
					})
				}
			);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Finalisasi ditolak (HTTP ${response.status})`);
			}
			reconJob = null;
			reconDraft = {};
			showReconModal = false;
			await loadPolicy();
		} catch (error) {
			reconError = reconErrorMessage(error, 'Finalisasi rekonsiliasi gagal');
		} finally {
			reconLoading = false;
		}
	}

	function mount(): void {
		if (!isOwnerRole(userRole.value)) {
			goto('/unauthorized');
			return;
		}
		soundEnabled = isSoundEnabled();
		strictStockEnabled = isStrictStockEnforcement();
		if (browser && 'Notification' in window) {
			notifPermission = Notification.permission;
		}
		void loadPolicy();
		void loadPendingReviews();
		void loadActiveReconciliation();
	}

	return {
		get soundEnabled() {
			return soundEnabled;
		},
		get strictStockEnabled() {
			return strictStockEnabled;
		},
		get notifPermission() {
			return notifPermission;
		},
		get policyMode() {
			return policyMode;
		},
		get policyCanManage() {
			return policyCanManage;
		},
		get policyLoading() {
			return policyLoading;
		},
		get policyError() {
			return policyError;
		},
		get policyToggling() {
			return policyToggling;
		},
		get showDisableConfirm() {
			return showDisableConfirm;
		},
		set showDisableConfirm(value) {
			showDisableConfirm = value;
		},
		get showEnableConfirm() {
			return showEnableConfirm;
		},
		set showEnableConfirm(value) {
			showEnableConfirm = value;
		},
		get cancelDisableButton() {
			return cancelDisableButton;
		},
		set cancelDisableButton(value) {
			cancelDisableButton = value;
		},
		get cancelEnableButton() {
			return cancelEnableButton;
		},
		set cancelEnableButton(value) {
			cancelEnableButton = value;
		},
		get enableError() {
			return enableError;
		},
		set enableError(value) {
			enableError = value;
		},
		get reconJob() {
			return reconJob;
		},
		get reconLoading() {
			return reconLoading;
		},
		get reconError() {
			return reconError;
		},
		get reconDraft() {
			return reconDraft;
		},
		get reconPendingReviews() {
			return reconPendingReviews;
		},
		get reconSearch() {
			return reconSearch;
		},
		set reconSearch(value) {
			reconSearch = value;
		},
		get showReconModal() {
			return showReconModal;
		},
		set showReconModal(value) {
			showReconModal = value;
		},
		get reconFilter() {
			return reconFilter;
		},
		set reconFilter(value) {
			reconFilter = value;
		},
		get entityMeta() {
			return entityMeta;
		},
		get reconReviews() {
			return reconReviews;
		},
		get reconReviewActing() {
			return reconReviewActing;
		},
		get reconCounted() {
			return reconCounted;
		},
		get reconTotal() {
			return reconTotal;
		},
		get reconComplete() {
			return reconComplete;
		},
		get reconGroups() {
			return reconGroups;
		},
		get reconFilterOptions() {
			return reconFilterOptions;
		},
		confirmEnableStock,
		toggleSound,
		toggleStrictStock,
		handleRequestNotif,
		confirmDisableStock,
		resolveReview,
		formatQueuedAt,
		saveReconCounts,
		cancelReconciliation,
		finalizeReconciliation,
		mount,
		destroy
	};
}

export type OwnerStockState = ReturnType<typeof createOwnerStockState>;
