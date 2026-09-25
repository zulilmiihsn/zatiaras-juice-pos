<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Bell from '@lucide/svelte/icons/bell';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { userRole } from '$lib/stores/userRole.svelte';
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
	let cancelDisableButton = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		if (showDisableConfirm) {
			cancelDisableButton?.focus();
		}
	});

	function handleDisableKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showDisableConfirm && !policyToggling) {
			showDisableConfirm = false;
		}
	}

	if (browser) {
		window.addEventListener('keydown', handleDisableKeydown);
	}
	onDestroy(() => {
		if (browser) {
			window.removeEventListener('keydown', handleDisableKeydown);
		}
	});

	// Rekonsiliasi aktivasi ulang (pemilik, saat mode ignored).
	type ReconItem = {
		entity_type: 'produk' | 'bahan';
		entity_id: string;
		counted_quantity: number | null;
	};
	type ReconJob = {
		id: string;
		status: string;
		expected_policy_revision: number;
		items: ReconItem[];
	};
	let reconJob = $state<ReconJob | null>(null);
	let reconLoading = $state(false);
	let reconError = $state('');
	let reconDraft = $state<Record<string, string>>({});
	let reconPendingReviews = $state(0);

	// Tinjauan antrean offline yang dikarantina (HTTP 428).
	type OfflineReview = {
		idempotency_key: string;
		request_fingerprint: string;
		queued_at: number;
		policy_revision_at_queue: number | null;
		current_policy_revision: number;
		revision: number;
		status: string;
	};
	let reconReviews = $state<OfflineReview[]>([]);
	let reconReviewsError = $state('');
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
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
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
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const response = await fetchWithCsrfRetry(
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
			reconError = error instanceof Error ? error.message : 'Gagal memproses review antrean';
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

	async function startReconciliation() {
		reconLoading = true;
		reconError = '';
		try {
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const response = await fetchWithCsrfRetry('/api/pengaturan/stok/reconciliation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ branch })
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as {
					message?: string;
				} | null;
				throw new Error(payload?.message || `Gagal membuat rekonsiliasi (HTTP ${response.status})`);
			}
			const payload = (await response.json()) as { data: ReconJob };
			reconJob = payload.data;
			reconDraft = {};
			await loadPendingReviews();
		} catch (error) {
			reconError = error instanceof Error ? error.message : 'Gagal membuat rekonsiliasi';
		} finally {
			reconLoading = false;
		}
	}

	async function saveReconCounts() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const items = reconJob.items.flatMap((item) => {
				const key = `${item.entity_type}:${item.entity_id}`;
				const raw = (reconDraft[key] ?? '').trim().replace(',', '.');
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
			const response = await fetchWithCsrfRetry(
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
			reconError = error instanceof Error ? error.message : 'Gagal menyimpan hitungan';
		} finally {
			reconLoading = false;
		}
	}

	async function cancelReconciliation() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const response = await fetchWithCsrfRetry(
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
		} catch (error) {
			reconError = error instanceof Error ? error.message : 'Gagal membatalkan rekonsiliasi';
		} finally {
			reconLoading = false;
		}
	}

	async function finalizeReconciliation() {
		if (!reconJob) return;
		reconLoading = true;
		reconError = '';
		try {
			const branch = localStorage.getItem('selectedBranch')?.toLowerCase() || 'samarinda';
			const response = await fetchWithCsrfRetry(
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
			await loadPolicy();
		} catch (error) {
			reconError = error instanceof Error ? error.message : 'Finalisasi rekonsiliasi gagal';
		} finally {
			reconLoading = false;
		}
	}

	onMount(() => {
		if (userRole.value !== 'pemilik' && userRole.value !== 'admin') {
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
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<a
				href="/pengaturan/pemilik"
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</a>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Stok</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Content -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 md:px-6">
		<!-- 0. Master Toggle Monitoring Stok -->
		<div class="soft-float-card flex flex-col gap-3 p-5 md:p-6">
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-start gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
					>
						<Boxes class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-sm font-bold text-slate-900 md:text-base">Monitoring Stok</span>
							{#if policyLoading}
								<span
									class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 md:text-[10px]"
								>
									Memuat…
								</span>
							{:else if policyMode === 'tracked'}
								<span
									class="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700 md:text-[10px]"
								>
									Aktif
								</span>
							{:else}
								<span
									class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-600 md:text-[10px]"
								>
									Nonaktif
								</span>
							{/if}
						</div>
						<p class="mt-1 text-xs text-slate-500 md:text-sm">
							{policyMode === 'tracked'
								? 'POS memantau dan mengurangi stok otomatis saat penjualan.'
								: 'POS berjalan tanpa monitoring atau pengurangan stok. Data lama tetap tersimpan.'}
						</p>
						{#if policyError}
							<p class="mt-1 text-xs font-bold text-rose-600">{policyError}</p>
						{/if}
						{#if !policyLoading && !policyCanManage && policyMode === 'tracked'}
							<p class="mt-1 text-[11px] text-slate-400">
								Perubahan monitoring belum tersedia untuk cabang ini.
							</p>
						{/if}
					</div>
				</div>

				<button
					type="button"
					role="switch"
					aria-label={policyMode === 'tracked'
						? 'Nonaktifkan monitoring stok'
						: 'Aktifkan kembali monitoring stok'}
					aria-checked={policyMode === 'tracked'}
					disabled={policyLoading || policyToggling || !policyCanManage}
					onclick={() => {
						if (policyMode === 'tracked') showDisableConfirm = true;
					}}
					class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {policyMode ===
					'tracked'
						? 'bg-pink-600'
						: 'bg-slate-200'}"
				>
					<span
						class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {policyMode ===
						'tracked'
							? 'translate-x-5'
							: 'translate-x-0'}"
					></span>
				</button>
			</div>

			{#if showDisableConfirm && policyMode === 'tracked'}
				<div
					class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-[2px] sm:items-center"
					role="presentation"
					onclick={(event) => {
						if (!policyToggling && event.target === event.currentTarget) {
							showDisableConfirm = false;
						}
					}}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="disable-stock-title"
						class="w-full max-w-md rounded-3xl border border-rose-200 bg-white p-5 text-xs text-slate-700 shadow-2xl md:p-6"
					>
						<p id="disable-stock-title" class="text-sm font-bold text-slate-900 md:text-base">
							Nonaktifkan monitoring stok?
						</p>
						<ul class="mt-2 list-disc space-y-1 pl-4">
							<li>Penjualan tetap berjalan normal.</li>
							<li>Stok tidak berkurang otomatis dan peringatan berhenti.</li>
							<li>Data stok lama tidak dihapus.</li>
							<li>Aktivasi ulang membutuhkan rekonsiliasi fisik.</li>
							<li>Pastikan antrean offline semua perangkat sudah tersinkron.</li>
						</ul>
						<div class="mt-4 flex justify-end gap-2">
							<button
								type="button"
								bind:this={cancelDisableButton}
								disabled={policyToggling}
								onclick={() => (showDisableConfirm = false)}
								class="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 disabled:opacity-50"
							>
								Batal
							</button>
							<button
								type="button"
								disabled={policyToggling}
								onclick={confirmDisableStock}
								class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
							>
								{policyToggling ? 'Menyimpan…' : 'Ya, nonaktifkan'}
							</button>
						</div>
					</div>
				</div>
			{/if}

			{#if policyMode === 'ignored' && !policyLoading}
				<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
					<p class="text-xs font-bold text-slate-900">Aktifkan kembali monitoring stok</p>
					<p class="mt-0.5 text-[11px] text-slate-500">
						Saldo lama dianggap basi. Lakukan hitung fisik, simpan, lalu finalisasi untuk
						mengaktifkan kembali.
					</p>
					{#if reconError}
						<p class="mt-1 text-xs font-bold text-rose-600">{reconError}</p>
					{/if}
					{#if !reconJob}
						<button
							type="button"
							disabled={reconLoading || !policyCanManage}
							onclick={startReconciliation}
							class="mt-2 cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
						>
							{reconLoading ? 'Membuat…' : 'Mulai rekonsiliasi'}
						</button>
					{:else}
						<p class="mt-2 text-[11px] text-slate-500">
							Job {reconJob.id.slice(0, 8)}… • Status {reconJob.status} • Antrean perlu tinjauan: {reconPendingReviews}
						</p>
						<div class="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
							{#each reconJob.items as item}
								{@const key = `${item.entity_type}:${item.entity_id}`}
								<label
									class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
								>
									<span class="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">
										{item.entity_type} · {item.entity_id}
										{#if item.counted_quantity !== null}
											<span class="text-emerald-600">({item.counted_quantity})</span>
										{/if}
									</span>
									<input
										type="number"
										min="0"
										step={item.entity_type === 'produk' ? '1' : 'any'}
										placeholder="Hitung fisik"
										bind:value={reconDraft[key]}
										class="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs"
									/>
								</label>
							{/each}
						</div>
						<div class="mt-2 flex flex-wrap gap-2">
							<button
								type="button"
								disabled={reconLoading}
								onclick={saveReconCounts}
								class="cursor-pointer rounded-full border border-pink-200 bg-pink-50 px-4 py-1.5 text-xs font-bold text-pink-700 disabled:opacity-50"
							>
								{reconLoading ? 'Menyimpan…' : 'Simpan hitungan'}
							</button>
							<button
								type="button"
								disabled={reconLoading}
								onclick={finalizeReconciliation}
								class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
							>
								{reconLoading ? 'Memproses…' : 'Finalisasi & aktifkan'}
							</button>
							<button
								type="button"
								disabled={reconLoading}
								onclick={cancelReconciliation}
								class="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-500 disabled:opacity-50"
							>
								Batalkan job
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if reconReviews.length > 0}
			<!-- Tinjauan antrean offline yang dikarantina -->
			<div class="soft-float-card flex flex-col gap-3 p-5 md:p-6">
				<div>
					<h3 class="text-xs font-bold text-slate-800 md:text-sm">
						Antrean Offline Perlu Tinjauan
					</h3>
					<p class="text-[11px] text-slate-400 md:text-xs">
						Transaksi ini melewati perubahan kebijakan stok. Setujui untuk replay dengan kebijakan
						saat ini, atau biarkan menunggu hitung fisik.
					</p>
				</div>
				{#if reconError}
					<p class="text-xs font-bold text-rose-600">{reconError}</p>
				{/if}
				<div class="flex max-h-72 flex-col gap-2 overflow-y-auto">
					{#each reconReviews as review (review.idempotency_key)}
						<div class="rounded-xl border border-slate-200 bg-white px-3 py-2">
							<div class="flex items-center justify-between gap-2">
								<span
									class="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-slate-700"
								>
									{review.idempotency_key.slice(0, 18)}…
								</span>
								<span
									class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black {review.status ===
									'pending'
										? 'bg-amber-100 text-amber-700'
										: review.status === 'approved_current'
											? 'bg-emerald-100 text-emerald-700'
											: 'bg-slate-100 text-slate-600'}"
								>
									{review.status === 'pending'
										? 'Menunggu'
										: review.status === 'approved_current'
											? 'Disetujui'
											: review.status}
								</span>
							</div>
							<div class="mt-0.5 text-[11px] text-slate-400">
								Antre {formatQueuedAt(review.queued_at)} • Revisi saat antre: {review.policy_revision_at_queue ??
									'-'} → saat ini {review.current_policy_revision}
							</div>
							<div class="mt-2 flex gap-2">
								{#if review.status === 'pending'}
									<button
										type="button"
										disabled={reconReviewActing === review.idempotency_key}
										onclick={() =>
											resolveReview(review.idempotency_key, review.revision, 'approve_current')}
										class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-3.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
									>
										{reconReviewActing === review.idempotency_key ? 'Memproses…' : 'Setujui replay'}
									</button>
								{:else if review.status === 'approved_current'}
									<button
										type="button"
										disabled={reconReviewActing === review.idempotency_key}
										onclick={() =>
											resolveReview(review.idempotency_key, review.revision, 'withdraw')}
										class="cursor-pointer rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[11px] font-bold text-slate-600 disabled:opacity-50"
									>
										Tarik persetujuan
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- 1. Kebijakan Checkout -->
			<div class="soft-float-card flex flex-col justify-between p-5 md:p-6">
				<div class="flex items-start justify-between gap-3">
					<div class="flex items-start gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
						>
							<Boxes class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
						</div>
						<div>
							<div class="flex items-center gap-2">
								<span class="text-sm font-bold text-slate-900 md:text-base"
									>Kunci Saat Stok Habis</span
								>
								{#if strictStockEnabled}
									<span
										class="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-700 md:text-[10px]"
									>
										Ketat
									</span>
								{:else}
									<span
										class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 md:text-[10px]"
									>
										Bebas
									</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-slate-500 md:text-sm">
								{policyMode === 'ignored'
									? 'Monitoring nonaktif: kunci checkout tidak berlaku dan checkout tidak memeriksa stok.'
									: strictStockEnabled
										? 'Item dengan bahan/stok 0 dilarang checkout di POS.'
										: 'Kasir tetap dapat melakukan checkout meski stok di sistem habis.'}
							</p>
						</div>
					</div>

					<button
						type="button"
						role="switch"
						aria-label={strictStockEnabled
							? 'Matikan kunci checkout stok habis'
							: 'Aktifkan kunci checkout stok habis'}
						aria-checked={strictStockEnabled}
						disabled={policyMode === 'ignored'}
						onclick={toggleStrictStock}
						class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {strictStockEnabled
							? 'bg-pink-600'
							: 'bg-slate-200'}"
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {strictStockEnabled
								? 'translate-x-5'
								: 'translate-x-0'}"
						></span>
					</button>
				</div>
			</div>

			<!-- 2. Alarm & Notifikasi -->
			<div class="soft-float-card space-y-4 p-5 md:p-6">
				<div class="flex items-center gap-2.5 border-b border-slate-100 pb-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 md:h-9 md:w-9"
					>
						<Bell class="h-4.5 w-4.5 stroke-[2.2] md:h-5 md:w-5" />
					</div>
					<h2 class="text-xs font-bold tracking-wider text-slate-800 uppercase md:text-sm">
						Alarm & Notifikasi
					</h2>
				</div>

				<!-- Suara Alarm -->
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						{#if soundEnabled}
							<Volume2 class="h-4.5 w-4.5 text-emerald-600 md:h-5 md:w-5" />
						{:else}
							<VolumeX class="h-4.5 w-4.5 text-slate-400 md:h-5 md:w-5" />
						{/if}
						<div>
							<div class="text-xs font-bold text-slate-800 md:text-sm">Suara Alarm Stok</div>
							<div class="text-[11px] text-slate-400 md:text-xs">Bunyi nada saat bahan habis</div>
						</div>
					</div>
					<button
						type="button"
						role="switch"
						aria-label={soundEnabled ? 'Matikan suara alarm' : 'Nyalakan suara alarm'}
						aria-checked={soundEnabled}
						onclick={toggleSound}
						class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {soundEnabled
							? 'bg-pink-600'
							: 'bg-slate-200'}"
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {soundEnabled
								? 'translate-x-5'
								: 'translate-x-0'}"
						></span>
					</button>
				</div>

				<!-- Notifikasi HP -->
				<div class="flex items-center justify-between border-t border-slate-100 pt-3">
					<div>
						<div class="text-xs font-bold text-slate-800 md:text-sm">Notifikasi Sistem HP</div>
						<div class="text-[11px] text-slate-400 md:text-xs">Muncul di status bar HP</div>
					</div>
					<div>
						{#if notifPermission === 'granted'}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 md:text-xs"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Aktif
							</span>
						{:else}
							<button
								type="button"
								onclick={handleRequestNotif}
								class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-3 py-1 text-[11px] font-bold text-white shadow-2xs hover:opacity-95 active:scale-95 md:px-4 md:py-1.5 md:text-xs"
							>
								Aktifkan
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- 3. Kelola Inventaris -->
		<div class="soft-float-card p-4 md:p-5">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-xs font-bold text-slate-800 md:text-sm">Inventaris Bahan & Menu</h3>
					<p class="text-[11px] text-slate-400 md:text-xs">
						Lihat dan ubah stok bahan baku secara real-time
					</p>
				</div>
				<button
					type="button"
					onclick={() => goto('/stok')}
					class="flex cursor-pointer items-center gap-1.5 rounded-full border border-pink-100 bg-pink-50 px-3.5 py-1.5 text-xs font-bold text-pink-600 transition-all hover:bg-pink-100 active:scale-95 md:px-4 md:py-2 md:text-sm"
				>
					<span>Buka Stok</span>
					<ExternalLink class="h-3.5 w-3.5 stroke-[2.2] md:h-4 md:w-4" />
				</button>
			</div>
		</div>
	</div>
</div>
