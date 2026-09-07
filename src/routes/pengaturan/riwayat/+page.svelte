<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import { createToastManager } from '$lib/utils/ui';
	import { ErrorHandler } from '$lib/utils/errorHandling';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { transactionService } from '$lib/services/transactionService';
	import { formatRupiah } from '$lib/utils/currency';
	import type { HistoryItem, ReceiptSettings } from '$lib/types/laporan';
	import { fetchTransaksiHariIni as fetchRiwayatHarian } from '$lib/services/riwayatService';
	import { buildReceiptHtml, printViaIntent, loadReceiptSettings } from '$lib/utils/receiptPrint';
	import { printReceiptUnified } from '$lib/services/printerEngine';
	import DetailTransaksiModal from '$lib/components/shared/DetailTransaksiModal.svelte';

	// [CATATAN]: ─── State ─────────────────────────────────────────────────────────────
	let pengaturanStruk = $state<ReceiptSettings | null>(null);
	let transaksiHariIni = $state<HistoryItem[]>([]);
	let loading = $state(true);
	let searchKeyword = $state('');
	let filterPayment = $state('all');
	let showDetailModal = $state(false);
	let selectedTransaksi = $state<HistoryItem | null>(null);

	const toastManager = createToastManager();

	// [CATATAN]: ─── Helpers ───────────────────────────────────────────────────────────
	async function fetchTransaksiHariIni() {
		loading = true;
		try {
			transaksiHariIni = await fetchRiwayatHarian({ searchKeyword, filterPayment });
		} catch (err) {
			ErrorHandler.logError(err, 'fetchTransaksiHariIni (riwayat kasir)');
			toastManager.showToastNotification('Gagal memuat data transaksi', 'error');
			transaksiHariIni = [];
		} finally {
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

	// [CATATAN]: ─── Fetch pengaturan struk ────────────────────────────────────────────
	async function fetchPengaturanStruk() {
		pengaturanStruk = await loadReceiptSettings();
	}

	// [CATATAN]: ─── Cetak struk ──────────────────────────────────────────────────────
	async function printStruk() {
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
		await fetchPengaturanStruk();
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
				onclick={() => goto('/pengaturan')}
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
		<!-- Search & Filter Card -->
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
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
					'all'
						? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200'}"
					onclick={() => {
						filterPayment = 'all';
						fetchTransaksiHariIni();
					}}>Semua</button
				>
				<button
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
					'qris'
						? 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200'}"
					onclick={() => {
						filterPayment = 'qris';
						fetchTransaksiHariIni();
					}}>QRIS</button
				>
				<button
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {filterPayment ===
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
					Belum Ada Transaksi Hari Ini
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
						<!-- Info kiri -->
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-bold text-gray-900 md:text-base" title={trx.nama}>
								{trx.nama}
							</div>
							<div class="mb-1 flex items-center gap-1.5 text-xs text-gray-500 md:text-sm">
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

						<!-- Nominal kanan -->
						<div class="flex shrink-0 flex-col items-end gap-1">
							<div
								class="text-base font-black md:text-lg {trx.tipe === 'in'
									? 'text-pink-600'
									: 'text-orange-600'}"
							>
								{trx.tipe === 'out' ? '-' : ''}Rp {formatRupiah(trx.nominal)}
							</div>
							<div class="text-xs text-gray-400">Tap untuk detail</div>
						</div>
					</div>
				{/each}
			</div>
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


