<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import NotifModal from '$lib/components/shared/NotifModal.svelte';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { formatRupiah } from '$lib/utils/currency';
	import { PAYMENT } from '$lib/constants/ui';
	import { formatOrderDetails } from '$lib/utils/orderDetails';
	import Banknote from 'lucide-svelte/icons/banknote';
	import CreditCard from 'lucide-svelte/icons/credit-card';
	import ReceiptText from 'lucide-svelte/icons/receipt-text';
	import ShoppingBag from 'lucide-svelte/icons/shopping-bag';
	import UserRound from 'lucide-svelte/icons/user-round';
	import WifiOff from 'lucide-svelte/icons/wifi-off';
	import { createBayarState } from '$lib/stores/bayarState.svelte';

	const s = createBayarState();

	const paymentOptions = [
		{ id: 'tunai', label: 'Tunai' },
		{ id: 'qris', label: 'QRIS' }
	];
	const cashTemplates = PAYMENT.QUICK_AMOUNTS;
	const keypad = [
		[1, 2, 3],
		[4, 5, 6],
		[7, 8, 9],
		['⌫', 0, 'C']
	];

	onMount(() => {
		const updateConnectionState = () => {
			s.setOffline(!navigator.onLine);
		};
		updateConnectionState();
		window.addEventListener('online', updateConnectionState);
		window.addEventListener('offline', updateConnectionState);
		s.init();
		return () => {
			window.removeEventListener('online', updateConnectionState);
			window.removeEventListener('offline', updateConnectionState);
		};
	});
</script>

<main class="page-content min-h-[100dvh] flex-1 overflow-y-auto bg-white px-4 pt-4 pb-28">
	<div class="mx-auto max-w-4xl">
		{#if s.cart.length === 0}
			<div
				class="flex min-h-[62dvh] flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center shadow-sm"
			>
				<ShoppingBag class="mb-4 h-12 w-12 text-stone-400" />
				<div class="mb-2 text-xl font-bold text-stone-950">Keranjang kosong</div>
				<div class="mb-5 max-w-xs text-sm text-stone-500">
					Tambah menu dari layar kasir sebelum lanjut pembayaran.
				</div>
				<button
					class="rounded-xl bg-pink-500 px-5 py-3 text-sm font-bold text-white shadow transition-all duration-200 active:scale-[0.98]"
					type="button"
					onclick={() => goto('/pos')}>Kembali ke Kasir</button
				>
			</div>
		{:else}
			<div class="mx-auto flex max-w-lg flex-col gap-4 pb-8">
				{#if s.isOffline}
					<div
						class="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"
					>
						<WifiOff class="mt-0.5 h-5 w-5 shrink-0" />
						<div>
							<div class="text-sm font-bold">Mode offline</div>
							<div class="mt-0.5 text-xs leading-5 text-amber-800">
								Pembayaran tunai akan disimpan lokal sampai koneksi kembali.
							</div>
						</div>
					</div>
				{/if}

				<!-- 1. Nama Pelanggan -->
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<label
						class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
						for="nama"
					>
						<UserRound class="h-4 w-4 text-pink-500" />
						Nama Pelanggan
					</label>
					<input
						id="nama"
						type="text"
						class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-3 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
						placeholder="Masukkan nama pelanggan..."
						bind:value={s.customerName}
						maxlength="50"
					/>
				</div>

				<!-- 2. Pesanan & 3. Total Tagihan -->
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<div class="mb-3 flex items-center justify-between">
						<div class="flex items-center gap-2 font-semibold text-stone-900">
							<ReceiptText class="h-5 w-5 text-pink-500" />
							Pesanan
						</div>
						<div class="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">
							{s.totalQty} item
						</div>
					</div>
					<ul class="divide-y divide-stone-100">
						{#each s.cart as item (s.cartItemKey(item))}
							<li class="flex flex-col gap-1 py-3">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<div class="truncate font-semibold text-stone-950">{item.product.nama}</div>
										<div class="mt-0.5 text-xs font-semibold text-stone-500">x{item.jumlah}</div>
									</div>
									<span class="shrink-0 font-bold text-pink-500"
										>Rp {formatRupiah((item.product.harga ?? 0) * item.jumlah)}</span
									>
								</div>
								{#if item.addOns && item.addOns.length > 0}
									<div class="mt-1 flex flex-col gap-0.5 rounded-lg bg-stone-50 px-3 py-2">
										{#each item.addOns as ekstra}
											<div class="flex justify-between gap-3 text-xs font-medium text-stone-600">
												<span class="truncate">+ {ekstra.nama}</span>
												<span class="shrink-0"
													>Rp {formatRupiah((ekstra.harga ?? 0) * item.jumlah)}</span
												>
											</div>
										{/each}
									</div>
								{/if}
								{#if (item.gula && item.gula !== 'normal') || (item.es && item.es !== 'normal') || (item.catatan && item.catatan.trim())}
									<div class="text-xs font-medium text-stone-500">
										{formatOrderDetails(item)}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					<!-- Total Tagihan -->
					<div
						class="mt-2 flex items-end justify-between border-t border-dashed border-stone-200 pt-4 pb-1"
					>
						<div class="text-sm font-semibold text-stone-500">Total Tagihan</div>
						<div class="text-2xl font-bold tracking-tight text-stone-900">
							Rp {formatRupiah(s.totalHarga)}
						</div>
					</div>
				</div>

				<!-- 4. Metode Pembayaran -->
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<div class="mb-3 text-sm font-semibold text-stone-700">Metode Pembayaran</div>
					<div class="grid grid-cols-2 gap-3">
						{#each paymentOptions as opt}
							<button
								type="button"
								class="flex flex-col items-center justify-center gap-2 rounded-xl border px-4 py-4 text-base font-semibold transition-all duration-200 active:scale-[0.98] {s.paymentMethod ===
								opt.id
									? 'border-pink-500 bg-pink-50 text-pink-500 shadow-sm'
									: 'border-pink-100 bg-white text-stone-700'} {s.isOffline && opt.id !== 'tunai'
									? 'cursor-not-allowed opacity-45'
									: ''}"
								onclick={() => s.handleSetPaymentMethod(opt.id)}
								disabled={s.isOffline && opt.id !== 'tunai'}
							>
								{#if opt.id === 'tunai'}
									<Banknote class="h-5 w-5" />
								{:else}
									<CreditCard class="h-5 w-5" />
								{/if}
								{opt.label}{s.isOffline && opt.id !== 'tunai' ? ' (online)' : ''}
							</button>
						{/each}
					</div>
				</div>

				<!-- 5. Konfirmasi & Batalkan Buttons -->
				<div class="mt-2 flex flex-col gap-3">
					<button
						class="w-full rounded-xl bg-pink-500 py-3.5 text-base font-bold text-white shadow-lg shadow-pink-500/20 transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:border-[1.5px] disabled:border-pink-100 disabled:bg-pink-50 disabled:text-pink-300 disabled:shadow-none"
						onclick={s.handleBayar}
						disabled={!s.canPay}
					>
						Konfirmasi & Bayar
					</button>
					{#if !s.canPay}
						<div class="text-center text-xs text-red-500">
							{#if !s.paymentMethod && !s.customerName.trim()}
								Isi nama pelanggan dan pilih metode pembayaran dulu
							{:else if !s.paymentMethod}
								Pilih metode pembayaran dulu
							{:else}
								Isi nama pelanggan dulu
							{/if}
						</div>
					{/if}
					<button
						class="mx-auto block w-full rounded-xl border-[1.5px] border-stone-200 bg-white py-3 text-sm font-bold text-stone-500 shadow-sm transition-all duration-200 hover:border-pink-200 hover:bg-pink-50 hover:text-pink-600 active:scale-[0.98]"
						type="button"
						onclick={s.handleCancel}
					>
						Batalkan pembayaran
					</button>
				</div>
			</div>
		{/if}
	</div>
</main>

{#if s.showCancelModal}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal mx-auto w-full max-w-sm rounded-t-2xl bg-white p-6 pb-4 shadow-lg"
		>
			<div class="mb-2 text-center text-lg font-bold text-gray-800">Batalkan Pembayaran?</div>
			<div class="mb-6 text-center text-gray-500">
				Apakah Anda yakin ingin membatalkan pembayaran dan kembali ke kasir?
			</div>
			<div class="flex flex-col gap-2">
				<button
					class="w-full rounded-lg bg-red-500 py-3 text-base font-bold text-white active:bg-red-600"
					onclick={s.confirmCancel}>Ya, batalkan</button
				>
				<button
					class="w-full rounded-lg bg-gray-100 py-3 text-base font-semibold text-gray-500"
					onclick={s.closeModal}>Tutup</button
				>
			</div>
		</div>
	</div>
{/if}

{#if s.showCashModal}
	<ModalSheet open={s.showCashModal} title="Pembayaran Tunai" onClose={s.closeCashModal}>
		<div class="pb-6 md:min-h-[60vh] md:pb-8">
			<div class="mb-4 text-center text-gray-500 md:mb-6 md:text-lg">
				Masukkan jumlah uang diterima
			</div>
			<input
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				class="mb-3 w-full rounded-lg border-2 border-pink-200 px-2 py-3 text-center text-xl font-bold outline-none focus:border-pink-400 md:mb-5 md:py-5 md:text-2xl"
				value={s.formattedCashReceived}
				oninput={(e) => {
					const target = e.target as HTMLInputElement;
					const raw = target.value.replace(/\D/g, '');
					s.cashReceived = raw;
				}}
				placeholder="0"
			/>
			<div class="mb-4 flex flex-wrap justify-center gap-2 md:mb-6 md:gap-4">
				{#each cashTemplates as t}
					<button
						type="button"
						class="rounded-lg bg-pink-100 px-4 py-2 text-base font-bold text-pink-500 md:px-8 md:py-3 md:text-lg"
						onclick={() => s.handleAddCashTemplate(t)}
					>
						Rp {formatRupiah(t)}
					</button>
				{/each}
			</div>
			<div class="mx-auto grid w-full grid-cols-3 gap-2 md:gap-6">
				{#each keypad as row}
					{#each row as key}
						<button
							type="button"
							class="w-full rounded-xl bg-gray-100 py-3 text-xl font-bold text-gray-700 transition-all active:bg-pink-100 md:py-8 md:text-3xl {key ===
							'⌫'
								? 'col-span-1 text-pink-500'
								: ''} {key === 'C' ? 'text-red-500' : ''}"
							onclick={() => s.handleKeypadButton(key)}>{key}</button
						>
					{/each}
				{/each}
			</div>
		</div>
		{#snippet footer()}
			<div class="flex flex-col gap-2 md:gap-4">
				<div class="mb-2 text-center text-gray-700 md:mb-4 md:text-lg">
					Kembalian:
					<span class="font-bold {s.kembalian < 0 ? 'text-red-500' : 'text-green-500'}"
						>Rp {s.kembalian >= 0 ? formatRupiah(s.kembalian) : '0'}</span
					>
				</div>
				<button
					class="w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white active:bg-pink-600 disabled:opacity-50 md:py-5 md:text-xl"
					onclick={s.finishCash}
					disabled={s.kembalian < 0 || !s.cashReceived}
				>
					Selesai
				</button>
			</div>
		{/snippet}
	</ModalSheet>
{/if}

{#if s.showQrisWarning}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal qris-warning-modal mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-t-2xl bg-white p-8 pb-6 shadow-lg"
		>
			<div
				class="animate-bounceIn warning-icon mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100"
			>
				<svg width="40" height="40" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#fde047" opacity="0.18" /><path
						d="M12 8v4m0 4h.01"
						stroke="#f59e42"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="warning-title mb-1 text-center text-xl font-bold text-yellow-600">
				Periksa Pembayaran QRIS
			</div>
			<div class="mb-2 text-center text-gray-700">
				Pastikan kasir sudah <span class="font-semibold text-pink-500">memeriksa nama merchant</span
				>
				dan <span class="font-semibold text-pink-500">nominal pembayaran</span> di aplikasi konsumen
				sebelum melanjutkan.
			</div>
			<button
				class="warning-btn mt-2 w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white transition-all active:bg-pink-600"
				onclick={s.confirmQrisChecked}>Sudah Diperiksa</button
			>
		</div>
	</div>
{/if}

{#if s.showSuccessModal}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
		<div
			class="animate-slideUpModal mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-t-2xl bg-white p-8 pb-6 shadow-lg"
		>
			<div
				class="animate-bounceIn mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-green-100"
			>
				<svg width="48" height="48" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#4ade80" opacity="0.18" /><path
						d="M7 13l3 3 7-7"
						stroke="#22c55e"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="mb-1 text-center text-2xl font-bold text-green-600">
				{s.transactionQueuedOffline ? 'Transaksi Tersimpan' : 'Transaksi Berhasil!'}
			</div>
			<div class="mb-2 text-center text-gray-700">
				{#if s.transactionQueuedOffline}
					Tersimpan di perangkat dan menunggu sinkronisasi.<br />
				{:else}
					Pembayaran {s.paymentMethod === 'tunai' ? 'tunai' : s.paymentMethod.toUpperCase()} telah diterima.<br
					/>
				{/if}
				{#if s.customerName.trim()}
					<span class="font-semibold text-pink-500">{s.customerName.trim()}</span><br />
				{/if}
				Kembalian:
				<span class="font-bold text-pink-500"
					>Rp {s.kembalian >= 0 ? formatRupiah(s.kembalian) : '0'}</span
				>
			</div>
			<div class="mb-2 flex w-full flex-col gap-1 rounded-lg bg-pink-50 p-3">
				<div class="flex justify-between text-sm text-gray-500">
					<span>Total</span><span class="font-bold text-pink-500"
						>Rp {formatRupiah(s.totalHarga)}</span
					>
				</div>
				<div class="flex justify-between text-sm text-gray-500">
					<span>Dibayar</span><span class="font-bold text-green-600"
						>Rp {s.cashReceived ? formatRupiah(parseInt(s.cashReceived)) : '0'}</span
					>
				</div>
				<div class="flex justify-between text-sm text-gray-500">
					<span>Kembalian</span><span class="font-bold text-green-600"
						>Rp {s.kembalian >= 0 ? formatRupiah(s.kembalian) : '0'}</span
					>
				</div>
			</div>
			<div class="flex w-full flex-col gap-2">
				<button
					class="w-full rounded-lg bg-green-500 py-3 text-base font-bold text-white transition-all active:bg-green-600"
					onclick={s.printStrukViaEscPosService}>Cetak Struk</button
				>
				<button
					class="w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white transition-all active:bg-pink-600"
					onclick={s.handleBackToKasir}>Kembali ke Kasir</button
				>
			</div>
		</div>
	</div>
{/if}

{#if s.showErrorNotification}
	<div
		class="fixed top-20 left-1/2 z-50 rounded-xl bg-red-500 px-6 py-3 text-white shadow-lg transition-all duration-300 ease-out"
		style="transform: translateX(-50%);"
		in:fly={{ y: -32, duration: 300, easing: cubicOut }}
		out:fade={{ duration: 200 }}
	>
		{s.errorNotificationMessage}
	</div>
{/if}

<NotifModal
	show={s.showNotifModal}
	message={s.notifModalMsg}
	type={s.notifModalType}
	onClose={s.closeNotifModal}
/>

<style>
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
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@keyframes bounceIn {
		0% {
			transform: scale(0.7);
			opacity: 0;
		}
		60% {
			transform: scale(1.1);
			opacity: 1;
		}
		100% {
			transform: scale(1);
		}
	}
	.animate-bounceIn {
		animation: bounceIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@media (min-width: 768px) {
		.qris-warning-modal {
			padding: 3rem 2.5rem 2.5rem 2.5rem !important;
		}
		.qris-warning-modal .warning-icon {
			width: 88px !important;
			height: 88px !important;
			min-width: 88px;
			min-height: 88px;
		}
		.qris-warning-modal .warning-title {
			font-size: 2rem !important;
		}
		.qris-warning-modal .warning-btn {
			font-size: 1.25rem !important;
			padding-top: 1.25rem !important;
			padding-bottom: 1.25rem !important;
		}
	}
</style>
