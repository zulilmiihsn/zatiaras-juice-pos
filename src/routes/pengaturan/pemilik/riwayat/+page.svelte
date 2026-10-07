<script lang="ts">
	import { refreshBus } from '$lib/utils/refreshBus';
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { userRole } from '$lib/stores/userRole.svelte';
	import DropdownSheet from '$lib/components/shared/dropdownSheet.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { ErrorHandler } from '$lib/utils/errorHandling';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { transactionService } from '$lib/services/transactionService';
	import type { HistoryItem } from '$lib/types/laporan';
	type IconComponent = typeof import('@lucide/svelte/icons/trash').default;
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
	let Trash = $state<IconComponent | null>(null);

	let showDetailModal = $state(false);
	let selectedTransaksi = $state<HistoryItem | null>(null);
	let showDropdownPayment = $state(false);
	const paymentOptions = [
		{ value: 'tunai', label: 'Tunai' },
		{ value: 'qris', label: 'QRIS/Non-Tunai' }
	];

	// [CATATAN]: Toast management
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

		// [CATATAN]: Cek permission dulu
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
				// [CATATAN]: Untuk transaksi manual/catat, hapus dari buku_kas saja
				await transactionService.deleteRows('buku_kas', { id: transaksiToDelete.id });
			} else if (transaksiToDelete.sumber === 'pos') {
				// [CATATAN]: Transaksi POS: satu call atomik. Server (DELETE /api/transaksi-kasir)
				// [CATATAN]: reverse ringkasan + restore stok produk/bahan + hapus transaksi_kasir
				// [CATATAN]: DAN buku_kas dalam satu batch. Jangan panggil buku_kas terpisah.
				const transactionId = transaksiToDelete.transaction_id || transaksiToDelete.id;
				await transactionService.deleteRows('transaksi_kasir', { transaction_id: transactionId });
			} else {
				// [CATATAN]: Fallback: hapus berdasarkan ID langsung
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

		loading = true;
		try {
			await transactionService.updateRows(
				'buku_kas',
				{ metode_bayar: targetNormalized },
				{ id: selectedTransaksi.id }
			);
			selectedTransaksi = { ...selectedTransaksi, metode_bayar: targetNormalized };
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

	// [CATATAN]: Cek role sebelum delete
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
		Trash = (await import('@lucide/svelte/icons/trash')).default;
		// [CATATAN]: pollingInterval = setInterval(fetchTransaksiHariIni, 5000); // HAPUS polling otomatis
		// [CATATAN]: Dengarkan event global agar riwayat auto-refresh ketika rekomendasi AI diterapkan
		aiHandler = async () => {
			await fetchTransaksiHariIni();
		};
		if (typeof window !== 'undefined') {
			window.addEventListener('ai-recommendations-applied', aiHandler);
			// [CATATAN]: Ekspor refresher global untuk dipanggil langsung
			offRiwayat = refreshBus.on('riwayat', async () => {
				await fetchTransaksiHariIni();
			});
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			document.body.classList.remove('hide-nav');
		}
		// [CATATAN]: clearInterval(pollingInterval); // HAPUS polling otomatis
		if (typeof window !== 'undefined' && aiHandler) {
			window.removeEventListener('ai-recommendations-applied', aiHandler);
			if (offRiwayat) offRiwayat();
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
			<HeaderBackButton onclick={() => goto('/pengaturan/pemilik')}>
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
		<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Transaksi?</h2>
		<p class="mb-6 text-center text-sm text-gray-500">
			Transaksi yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus transaksi ini?
		</p>
		<div class="flex w-full gap-3">
			<button
				class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
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
