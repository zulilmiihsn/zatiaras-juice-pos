<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { refreshBus } from '$lib/utils/refreshBus';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { userRole } from '$lib/stores/userRole.svelte';
	import DropdownSheet from '$lib/components/shared/DropdownSheet.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { ErrorHandler } from '$lib/utils/errorHandling';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';
	import { transactionService } from '$lib/services/transactionService';
	import type { HistoryItem } from '$lib/types/laporan';
	import Trash from '@lucide/svelte/icons/trash';
	import { fetchTransaksiHariIniPage } from '$lib/services/riwayatService';
	import type { RentangRiwayat } from '$lib/services/riwayatService';
	import { printRiwayatStruk } from '$lib/services/riwayatPrint';
	import DetailTransaksiModal from '$lib/components/shared/DetailTransaksiModal.svelte';
	import RiwayatFilterCard from '$lib/components/riwayat/RiwayatFilterCard.svelte';
	import RiwayatTransactionCard from '$lib/components/riwayat/RiwayatTransactionCard.svelte';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';

	let transaksiHariIni = $state<HistoryItem[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let nextCursor = $state<string | null>(null);
	let hasMore = $state(false);
	let showDeleteModal = $state(false);
	let transaksiToDelete = $state<HistoryItem | null>(null);
	let searchKeyword = $state('');
	let filterPayment = $state('all'); // 'all' | 'qris' | 'tunai'
	let filterRentang: RentangRiwayat = $state('hari-ini');

	let showDetailModal = $state(false);
	let selectedTransaksi = $state<HistoryItem | null>(null);
	let showDropdownPayment = $state(false);
	const paymentOptions = [
		{ value: 'tunai', label: 'Tunai' },
		{ value: 'qris', label: 'QRIS/Non-Tunai' }
	];

	// Toast management
	const toastManager = createToastManager();
	onDestroy(() => toastManager.dispose());

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
		} catch (error) {
			ErrorHandler.logError(error, 'fetchTransaksiHariIni');
			toastManager.showToastNotification('Gagal memuat data transaksi', 'error');
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
		} catch (error) {
			ErrorHandler.logError(error, 'fetchTransaksiHariIni');
			toastManager.showToastNotification('Gagal memuat halaman berikut', 'error');
		} finally {
			loadingMore = false;
		}
	}

	function confirmDeleteTransaksi(trx: HistoryItem) {
		transaksiToDelete = trx;
		showDeleteModal = true;
	}

	async function deleteTransaksi() {
		if (!transaksiToDelete) return;

		// Cek permission dulu
		if (!canDeleteTransaction()) {
			toastManager.showToastNotification(
				'Anda tidak memiliki izin untuk menghapus transaksi',
				'error'
			);
			return;
		}

		loading = true;

		try {
			if (transaksiToDelete.sumber === 'catat') {
				// Untuk transaksi manual/catat, hapus dari buku_kas saja
				await transactionService.deleteRows('buku_kas', { id: transaksiToDelete.id });
			} else if (transaksiToDelete.sumber === 'pos') {
				// Transaksi POS: satu call atomik. Server (DELETE /api/transaksi-kasir)
				// reverse ringkasan + restore stok produk/bahan + hapus transaksi_kasir
				// DAN buku_kas dalam satu batch. Jangan panggil buku_kas terpisah.
				const transactionId = transaksiToDelete.transaction_id || transaksiToDelete.id;
				await transactionService.deleteRows('transaksi_kasir', { transaction_id: transactionId });
			} else {
				// Fallback: hapus berdasarkan ID langsung
				await transactionService.deleteRows('buku_kas', { id: transaksiToDelete.id });
			}

			showDeleteModal = false;
			toastManager.showToastNotification('Transaksi berhasil dihapus.', 'success');
		} catch (error) {
			const err = error as Error;
			ErrorHandler.logError(err, 'deleteTransaksi');
			const message = err?.message || 'Unknown error';
			toastManager.showToastNotification(`Gagal menghapus transaksi: ${message}`, 'error');
		} finally {
			await fetchTransaksiHariIni();
			loading = false;
		}
	}

	function refreshManual() {
		if (!loading) fetchTransaksiHariIni();
	}

	function openDetail(trx: HistoryItem) {
		selectedTransaksi = { ...trx };
		showDetailModal = true;
	}

	async function updatePaymentMethod(newMethod: string) {
		if (!selectedTransaksi) return;
		const currentNormalized =
			selectedTransaksi.metode_bayar === 'qris' || selectedTransaksi.metode_bayar === 'non-tunai'
				? 'non-tunai'
				: 'tunai';
		const targetNormalized =
			newMethod === 'qris' || newMethod === 'non-tunai' ? 'non-tunai' : 'tunai';
		if (currentNormalized === targetNormalized) return;

		// Baris POS di-guard server dengan revisi saat ini; baris manual wajib membawa revisi yang tampil (CAS).
		const isPos = selectedTransaksi.sumber === 'pos';
		if (!isPos && selectedTransaksi.revision == null) {
			toastManager.showToastNotification(
				'Data transaksi usang. Muat ulang lalu coba lagi.',
				'error'
			);
			return;
		}
		const payload = isPos
			? { metode_bayar: targetNormalized }
			: { metode_bayar: targetNormalized, revision: selectedTransaksi.revision };

		loading = true;
		try {
			await transactionService.updateRows('buku_kas', payload, { id: selectedTransaksi.id });
			selectedTransaksi = {
				...selectedTransaksi,
				metode_bayar: targetNormalized,
				revision: isPos ? selectedTransaksi.revision : (selectedTransaksi.revision ?? 0) + 1
			};
			toastManager.showToastNotification('Jenis pembayaran berhasil diubah.', 'success');
			await fetchTransaksiHariIni();
		} catch (e) {
			ErrorHandler.logError(e, 'updatePaymentMethod');
			toastManager.showToastNotification('Gagal mengubah jenis pembayaran', 'error');
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (userRole.value !== 'pemilik') {
			goto('/unauthorized');
		}
	});

	async function printStrukDariRiwayat() {
		if (!selectedTransaksi) return;

		loading = true;
		try {
			await printRiwayatStruk(selectedTransaksi);
		} catch (error) {
			ErrorHandler.logError(error as Error, 'printStrukDariRiwayat');
			toastManager.showToastNotification('Gagal mencetak struk', 'error');
		} finally {
			loading = false;
		}
	}

	// Cek role sebelum delete
	function canDeleteTransaction() {
		const currentRole = userRole.value;
		return currentRole === 'pemilik';
	}

	let aiHandler: EventListener;
	let offRiwayat: () => void;

	onMount(async () => {
		if (typeof window !== 'undefined') {
			document.body.classList.add('hide-nav');
		}
		await fetchTransaksiHariIni();
		// pollingInterval = setInterval(fetchTransaksiHariIni, 5000); // HAPUS polling otomatis
		// Dengarkan event global agar riwayat auto-refresh ketika rekomendasi AI diterapkan
		aiHandler = async () => {
			await fetchTransaksiHariIni();
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('ai-recommendations-applied', aiHandler);
			// Ekspor refresher global untuk dipanggil langsung
			offRiwayat = refreshBus.on('riwayat', async () => {
				await fetchTransaksiHariIni();
			});
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.body.classList.remove('hide-nav');
		}
		// clearInterval(pollingInterval); // HAPUS polling otomatis
		if (typeof window !== 'undefined' && aiHandler) {
			window.removeEventListener('ai-recommendations-applied', aiHandler);
			if (offRiwayat) offRiwayat();
		}
	});
</script>

<div class="page-content bg-canvas flex min-h-dvh flex-col pb-12">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan/pemilik" label="Kembali ke Pengaturan Pemilik">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				{filterRentang === '7-hari' ? 'Riwayat Transaksi 7 Hari' : 'Riwayat Transaksi Hari Ini'}
			</h1>
			<HeaderBackButton label="Refresh" onclick={refreshManual}>
				<RefreshCw class="h-5 w-5 {loading ? 'animate-spin' : ''}" />
			</HeaderBackButton>
		</div>
	</PageHeader>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<RiwayatFilterCard
			bind:searchKeyword
			bind:filterPayment
			bind:filterRentang
			onchange={fetchTransaksiHariIni}
		/>

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
					Transaksi POS dan operasional akan muncul di sini.
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3">
				{#each transaksiHariIni as trx (trx.id)}
					<RiwayatTransactionCard
						{trx}
						onOpen={openDetail}
						onHapus={canDeleteTransaction() ? confirmDeleteTransaksi : null}
					/>
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

	<AppModal
		open={showDeleteModal}
		label="Hapus Transaksi?"
		size="xs"
		align="center"
		zClass="z-alert"
		backdropClose={false}
		panelClass="relative items-center bg-white p-6"
	>
		<div class="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-red-100">
			<Trash class="h-8 w-8 text-red-500" />
		</div>
		<h2 class="mb-2 text-center text-lg font-bold text-slate-800">Hapus Transaksi?</h2>
		<p class="mb-6 text-center text-sm text-slate-500">
			Transaksi yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus transaksi ini?
		</p>
		<div class="flex w-full gap-3">
			<button
				class="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-50"
				onclick={() => (showDeleteModal = false)}>Batal</button
			>
			<button
				class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
				onclick={deleteTransaksi}>Hapus</button
			>
		</div>
	</AppModal>

	<DetailTransaksiModal
		open={showDetailModal}
		transaksi={selectedTransaksi}
		readonly={false}
		isPrinting={loading}
		{paymentOptions}
		onClose={() => (showDetailModal = false)}
		onPrint={printStrukDariRiwayat}
		onUpdatePaymentMethod={updatePaymentMethod}
	/>

	{#if toastManager.showToast}
		<ToastNotification
			show={toastManager.showToast}
			message={toastManager.toastMessage}
			type={toastManager.toastType}
			position="top"
		/>
	{/if}
</div>
