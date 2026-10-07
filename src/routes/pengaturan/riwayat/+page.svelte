<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { createToastManager } from '$lib/utils/ui';
	import { ErrorHandler } from '$lib/utils/errorHandling';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import type { HistoryItem } from '$lib/types/laporan';
	import { fetchTransaksiHariIniPage } from '$lib/services/riwayatService';
	import type { RentangRiwayat } from '$lib/services/riwayatService';
	import { printRiwayatStruk } from '$lib/services/riwayatPrint';
	import DetailTransaksiModal from '$lib/components/shared/DetailTransaksiModal.svelte';
	import RiwayatFilterCard from '$lib/components/riwayat/RiwayatFilterCard.svelte';
	import RiwayatTransactionCard from '$lib/components/riwayat/RiwayatTransactionCard.svelte';

	// [CATATAN]: ─── State ─────────────────────────────────────────────────────────────
	let transaksiHariIni = $state<HistoryItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let searchKeyword = $state('');
	let filterPayment = $state('all');
	let filterRentang: RentangRiwayat = $state('hari-ini');
	let showDetailModal = $state(false);
	let selectedTransaksi = $state<HistoryItem | null>(null);

	const toastManager = createToastManager();
	onDestroy(() => toastManager.dispose());

	// [CATATAN]: ─── Helpers ───────────────────────────────────────────────────────────
	async function fetchTransaksiHariIni() {
		loading = true;
		nextCursor = null;
		hasMore = false;
		try {
			const page = await fetchTransaksiHariIniPage({
				searchKeyword,
				filterPayment,
				rentang: filterRentang
			});
			transaksiHariIni = page.items;
			nextCursor = page.nextCursor;
			hasMore = page.hasMore;
		} catch (err) {
			ErrorHandler.logError(err, 'fetchTransaksiHariIni (riwayat kasir)');
			toastManager.showToastNotification('Gagal memuat data transaksi', 'error');
			transaksiHariIni = [];
		} finally {
			loading = false;
		}
	}

	async function muatLebihBanyak() {
		if (loadingMore || !hasMore || !nextCursor) return;
		loadingMore = true;
		try {
			const page = await fetchTransaksiHariIniPage(
				{ searchKeyword, filterPayment, rentang: filterRentang },
				nextCursor
			);
			transaksiHariIni = [...transaksiHariIni, ...page.items];
			nextCursor = page.nextCursor;
			hasMore = page.hasMore;
		} catch (err) {
			ErrorHandler.logError(err, 'fetchTransaksiHariIni (riwayat kasir)');
			toastManager.showToastNotification('Gagal memuat halaman berikut', 'error');
		} finally {
			loadingMore = false;
		}
	}

	function refreshManual() {
		if (!loading) fetchTransaksiHariIni();
	}

	function openDetail(trx: HistoryItem) {
		selectedTransaksi = { ...trx };
		showDetailModal = true;
	}

	// [CATATAN]: ─── Cetak struk ──────────────────────────────────────────────────────
	async function printStruk() {
		if (!selectedTransaksi) return;

		loading = true;
		try {
			await printRiwayatStruk(selectedTransaksi);
		} catch (err) {
			ErrorHandler.logError(err as Error, 'printStruk (riwayat kasir)');
			toastManager.showToastNotification('Gagal mencetak struk', 'error');
		} finally {
			loading = false;
		}
	}

	// [CATATAN]: ─── Lifecycle ────────────────────────────────────────────────────────
	onMount(async () => {
		if (typeof window !== 'undefined') {
			document.body.classList.add('hide-nav');
		}
		await fetchTransaksiHariIni();
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.body.classList.remove('hide-nav');
		}
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div class="page-header relative w-full px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<HeaderBackButton onclick={() => goto('/pengaturan')}>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				{filterRentang === '7-hari' ? 'Riwayat Transaksi 7 Hari' : 'Riwayat Transaksi Hari Ini'}
			</h1>
			<HeaderBackButton label="Refresh" onclick={refreshManual}>
				<RefreshCw class="h-5 w-5 {loading ? 'animate-spin' : ''}" />
			</HeaderBackButton>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<RiwayatFilterCard
			bind:searchKeyword
			bind:filterPayment
			bind:filterRentang
			onchange={fetchTransaksiHariIni}
		/>

		<!-- List Transaksi -->
		{#if loading}
			<div class="soft-float-card p-10 text-center text-xs font-semibold text-slate-400 md:text-sm">
				<div
					class="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-pink-500 border-t-transparent"
				></div>
				Memuat data transaksi...
			</div>
		{:else if transaksiHariIni.length === 0}
			<div class="soft-float-card flex flex-col items-center justify-center p-12 text-center">
				<div
					class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-50 text-pink-500 shadow-2xs"
				>
					<svg
						class="h-7 w-7"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
						/>
					</svg>
				</div>
				<div class="text-sm font-bold text-slate-800 md:text-base">
					{filterRentang === '7-hari'
						? 'Belum Ada Transaksi 7 Hari Terakhir'
						: 'Belum Ada Transaksi Hari Ini'}
				</div>
				<p class="mt-1 text-xs text-slate-400 md:text-sm">
					Transaksi POS dan pencatatan manual akan muncul di sini.
				</p>
			</div>
		{:else}
			<!-- Ringkasan singkat -->
			<div
				class="mb-3 flex items-center justify-between rounded-2xl border border-pink-100 bg-pink-50/70 px-4 py-2.5 shadow-2xs md:px-5 md:py-3"
			>
				<span class="text-xs font-bold text-slate-600 md:text-sm">Total Transaksi</span>
				<span class="text-xs font-black text-pink-600 md:text-sm"
					>{transaksiHariIni.length} transaksi</span
				>
			</div>

			<div class="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3">
				{#each transaksiHariIni as trx (trx.id)}
					<RiwayatTransactionCard {trx} onOpen={openDetail} />
				{/each}
			</div>
			{#if hasMore}
				<button
					type="button"
					onclick={muatLebihBanyak}
					disabled={loadingMore}
					class="soft-float-card mt-3 w-full cursor-pointer p-4 text-center text-sm font-bold text-pink-600 transition-all hover:border-pink-200 active:scale-[0.99] disabled:opacity-50"
				>
					{loadingMore ? 'Memuat...' : 'Muat lebih banyak'}
				</button>
			{/if}
		{/if}
	</div>
</div>

<!-- Modal Detail (Read Only) -->
<DetailTransaksiModal
	open={showDetailModal}
	transaksi={selectedTransaksi}
	readonly={true}
	isPrinting={loading}
	onClose={() => (showDetailModal = false)}
	onPrint={printStruk}
/>

<!-- Toast -->
{#if toastManager.showToast}
	<ToastNotification
		show={toastManager.showToast}
		message={toastManager.toastMessage}
		type={toastManager.toastType}
		position="top"
	/>
{/if}
