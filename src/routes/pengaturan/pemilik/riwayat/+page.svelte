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
	import { formatRupiah } from '$lib/utils/currency';

	import type { HistoryItem, ReceiptSettings } from '$lib/types/laporan';
	type IconComponent = typeof import('@lucide/svelte/icons/trash').default;
	import { fetchTransaksiHariIni as fetchRiwayatHarian } from '$lib/services/riwayatService';
	import { buildReceiptHtml, printViaIntent, loadReceiptSettings } from '$lib/utils/receiptPrint';
	import { printReceiptUnified } from '$lib/services/printerEngine';

	let pengaturanStruk = $state<ReceiptSettings | null>(null);

	let transaksiHariIni = $state<HistoryItem[]>([]);
	let loading = $state(true);
	let showDeleteModal = $state(false);
	let transaksiToDelete = $state<HistoryItem | null>(null);
	let searchKeyword = $state('');
	let filterPayment = $state('all'); // 'all' | 'qris' | 'tunai'
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

	async function fetchTransaksiHariIni() {
		loading = true;
		try {
			transaksiHariIni = await fetchRiwayatHarian({ searchKeyword, filterPayment });
		} catch (error) {
			ErrorHandler.logError(error, 'fetchTransaksiHariIni');
			toastManager.showToastNotification('Gagal memuat data transaksi', 'error');
		} finally {
			loading = false;
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
		const currentMethod = selectedTransaksi.metode_bayar;
		const dbMethod = newMethod === 'qris' ? 'non-tunai' : newMethod;
		if (currentMethod === dbMethod) return;
		loading = true;
		try {
			await transactionService.updateRows(
				'buku_kas',
				{ metode_bayar: dbMethod },
				{ id: selectedTransaksi.id }
			);
			selectedTransaksi = { ...selectedTransaksi, metode_bayar: dbMethod };
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

	async function fetchPengaturanStruk() {
		pengaturanStruk = await loadReceiptSettings();
	}

	async function printStrukDariRiwayat() {
		if (!selectedTransaksi) return;

		loading = true;
		try {
			let items: Record<string, unknown>[] = [];
			if (selectedTransaksi.sumber === 'pos') {
				items = await transactionService.getRows('transaksi_kasir', {
					transaction_id: selectedTransaksi.transaction_id || selectedTransaksi.id
				});
			}

			const html = buildReceiptHtml(selectedTransaksi, pengaturanStruk, items);
			const escposData = {
				storeName: pengaturanStruk?.nama_toko || 'Zatiaras Juice',
				address: pengaturanStruk?.alamat,
				phone: pengaturanStruk?.telepon,
				instagram: pengaturanStruk?.instagram,
				customerName: selectedTransaksi.nama_pelanggan || '',
				dateTime: new Date(selectedTransaksi.waktu).toLocaleString('id-ID'),
				items:
					items.length > 0
						? items.map((item: any) => ({
								name: item.nama_kustom || item.produk?.nama || 'Produk Custom',
								qty: Number(item.jumlah || 1),
								price: Number(item.harga || 0) * Number(item.jumlah || 1)
							}))
						: [
								{
									name: selectedTransaksi.nama || 'Transaksi Kasir',
									qty: 1,
									price: Number(selectedTransaksi.nominal || 0)
								}
							],
				total: Number(selectedTransaksi.nominal || 0),
				paymentMethod: selectedTransaksi.metode_bayar || 'tunai',
				footerMessage: pengaturanStruk?.ucapan
			};
			await printReceiptUnified({ html, receiptData: escposData });
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
		await fetchPengaturanStruk();
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
			<button
				onclick={() => goto('/pengaturan/pemilik')}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</button>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Riwayat Transaksi Hari Ini
			</h1>
			<button
				onclick={refreshManual}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Refresh"
			>
				<RefreshCw class="h-5 w-5 {loading ? 'animate-spin' : ''}" />
			</button>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<!-- Search Bar dan Filter Payment Method -->
		<div class="soft-float-card mb-4 space-y-3 p-4 md:p-5">
			<input
				type="text"
				class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
				placeholder="Cari transaksi berdasarkan nama, nominal, atau catatan..."
				bind:value={searchKeyword}
				oninput={fetchTransaksiHariIni}
			/>
			<div class="flex gap-2">
				<button
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
					'all'
						? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200'}"
					onclick={() => {
						filterPayment = 'all';
						fetchTransaksiHariIni();
					}}>Semua</button
				>
				<button
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
					'qris'
						? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200'}"
					onclick={() => {
						filterPayment = 'qris';
						fetchTransaksiHariIni();
					}}>QRIS</button
				>
				<button
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
					'tunai'
						? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200'}"
					onclick={() => {
						filterPayment = 'tunai';
						fetchTransaksiHariIni();
					}}>Tunai</button
				>
			</div>
		</div>

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
					Belum Ada Transaksi Hari Ini
				</div>
				<p class="mt-1 text-xs text-slate-400 md:text-sm">
					Transaksi POS dan operasional akan muncul di sini.
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2 md:grid md:grid-cols-2 md:gap-3">
				{#each transaksiHariIni as trx (trx.id)}
					<div
						class="soft-float-card flex cursor-pointer items-start justify-between gap-3 p-4 transition-all hover:border-pink-200 hover:shadow-md md:p-4.5"
						onclick={() => openDetail(trx)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								openDetail(trx);
							}
						}}
						role="button"
						tabindex="0"
					>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-bold text-gray-900 md:text-base" title={trx.nama}>
								{trx.nama}
							</div>
							<div class="mb-1 flex items-center gap-2 text-xs text-gray-500 md:text-sm">
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold md:text-xs">
									{trx.sumber === 'pos' ? 'POS' : 'Manual'}
								</span>
								<span class="capitalize">
									{trx.tipe === 'in' ? 'Pemasukan' : 'Pengeluaran'}
								</span>
								<span class="font-bold text-pink-500 uppercase">
									{trx.metode_bayar === 'qris' || trx.metode_bayar === 'non-tunai'
										? 'QRIS'
										: 'Tunai'}
								</span>
							</div>
							<div class="text-xs text-gray-400">
								{new Date(trx.waktu).toLocaleTimeString('id-ID', {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</div>
						</div>
						<div class="flex flex-col items-end gap-2">
							<div class="text-base font-black text-pink-600 md:text-lg">
								Rp {formatRupiah(trx.nominal)}
							</div>
							{#if canDeleteTransaction()}
								<button
									class="rounded-xl bg-red-50 p-2 text-red-600 shadow-md transition-colors hover:bg-red-100 md:p-2.5"
									onclick={(e) => {
										e.stopPropagation();
										confirmDeleteTransaksi(trx);
									}}
									title="Hapus transaksi"
								>
									<Trash class="h-4.5 w-4.5 md:h-5 md:w-5" />
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if showDeleteModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
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
			</div>
		</div>
	{/if}

	{#if showDetailModal && selectedTransaksi}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm md:px-0"
		>
			<div
				class="animate-slideUpModal relative flex w-full max-w-md flex-col gap-3 rounded-2xl border border-pink-100 bg-white p-6 shadow-2xl md:p-8"
			>
				<button
					class="absolute top-3 right-3 rounded-full bg-gray-100 p-2 shadow-sm hover:bg-gray-200"
					onclick={() => (showDetailModal = false)}
					aria-label="Tutup"
				>
					<svg
						class="h-5 w-5 text-gray-500"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg
					>
				</button>
				<h2 class="mb-2 text-center text-xl font-bold text-pink-600">Detail Transaksi</h2>
				<div class="mb-1 flex flex-col gap-1">
					<span class="font-semibold text-gray-500">Deskripsi</span>
					<div
						class="rounded-lg bg-pink-50 px-3 py-2 text-base font-medium break-words whitespace-pre-line text-gray-800"
					>
						{selectedTransaksi.nama}
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-semibold text-gray-500">Customer</span>
					<div class="text-base text-gray-700">{selectedTransaksi.nama_pelanggan || '-'}</div>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-semibold text-gray-500">Waktu</span>
					<div class="text-base text-gray-700">
						{new Date(selectedTransaksi.waktu).toLocaleString('id-ID', {
							dateStyle: 'medium',
							timeStyle: 'short'
						})}
					</div>
				</div>
				<div class="flex flex-col gap-1">
					<span class="font-semibold text-gray-500">Nominal</span>
					<div class="text-lg font-bold text-pink-500">
						Rp {formatRupiah(selectedTransaksi.nominal)}
					</div>
				</div>
				<div class="mb-2 flex flex-col gap-1">
					<span class="font-semibold text-gray-500">Jenis Pembayaran</span>
					<button
						type="button"
						class="flex w-full items-center justify-between rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 font-medium text-pink-500 shadow-sm transition-colors hover:bg-pink-50"
						onclick={() => (showDropdownPayment = true)}
						style="user-select:none;"
					>
						<span class="truncate"
							>{paymentOptions.find(
								(opt) =>
									opt.value ===
									(selectedTransaksi?.metode_bayar === 'non-tunai'
										? 'qris'
										: selectedTransaksi?.metode_bayar)
							)?.label || 'Pilih'}</span
						>
						<svg
							class="ml-2 h-4 w-4 text-pink-400"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg
						>
					</button>
					<DropdownSheet
						open={showDropdownPayment}
						value={selectedTransaksi.metode_bayar === 'non-tunai'
							? 'qris'
							: selectedTransaksi.metode_bayar}
						options={paymentOptions}
						onClose={() => (showDropdownPayment = false)}
						onSelect={(value) => {
							showDropdownPayment = false;
							updatePaymentMethod(value);
						}}
					/>
				</div>
				<div class="mt-2 flex w-full gap-2">
					<button
						class="flex-1 rounded-xl bg-pink-100 py-3 text-base font-bold text-pink-600 transition-colors hover:bg-pink-200"
						onclick={printStrukDariRiwayat}>Cetak Struk</button
					>
					<button
						class="flex-1 rounded-xl bg-pink-500 py-3 text-base font-bold text-white shadow-lg shadow-pink-200/30 transition-colors hover:bg-pink-600"
						onclick={() => (showDetailModal = false)}>Tutup</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if toastManager.showToast}
		<ToastNotification
			show={toastManager.showToast}
			message={toastManager.toastMessage}
			type={toastManager.toastType}
			position="top"
		/>
	{/if}
</div>

<style>
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@keyframes slideUpModal {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes spin {
		100% {
			transform: rotate(360deg);
		}
	}
</style>
