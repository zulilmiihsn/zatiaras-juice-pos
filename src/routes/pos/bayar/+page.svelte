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
	import Banknote from '@lucide/svelte/icons/banknote';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import UserRound from '@lucide/svelte/icons/user-round';
	import WifiOff from '@lucide/svelte/icons/wifi-off';
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

<main class="page-content min-h-[100dvh] flex-1 overflow-y-auto bg-[#faf7f8] pb-28">
	<!-- [CATATAN]: Fluid Wave Header for Payment -->
	<div
		class="relative overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 pt-4 pb-12 shadow-xl shadow-pink-500/15"
	>
		<!-- [CATATAN]: Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mb-3 text-center">
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Konfirmasi Pembayaran
			</h1>
			<p class="text-xs font-medium text-white/80">Selesaikan transaksi kasir dan cetak struk</p>
		</div>

		<!-- [CATATAN]: Hero Total Card Floating on Wave -->
		<div
			class="relative z-10 mx-auto max-w-sm rounded-full border border-white/40 bg-white/25 px-6 py-2.5 text-center text-white shadow-sm backdrop-blur-xl"
		>
			<span class="text-[11px] font-bold tracking-wider text-white/90 uppercase"
				>Total Pembayaran</span
			>
			<div class="text-2xl font-black tracking-tight drop-shadow-xs sm:text-3xl">
				Rp {formatRupiah(s.totalHarga)}
			</div>
		</div>
	</div>

	<div class="relative z-20 mx-auto -mt-6 max-w-lg px-4">
		{#if s.cart.length === 0}
			<div
				class="glass-card flex min-h-[50vh] flex-col items-center justify-center rounded-[32px] p-8 text-center shadow-lg"
			>
				<ShoppingBag class="mb-4 h-12 w-12 text-slate-400" />
				<div class="mb-2 text-xl font-bold text-slate-900">Keranjang Masih Kosong</div>
				<div class="mb-5 max-w-xs text-xs font-medium text-slate-500">
					Pilih menu dari layar kasir sebelum melanjutkan ke pembayaran.
				</div>
				<button
					class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-all duration-200 active:scale-95"
					type="button"
					onclick={() => {
						s.clearCartStorage();
						goto('/pos');
					}}>Kembali ke Kasir</button
				>
			</div>
		{:else}
			<div class="flex flex-col gap-3.5 pb-8">
				{#if s.isOffline}
					<div
						class="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950 shadow-xs"
					>
						<WifiOff class="mt-0.5 h-5 w-5 shrink-0" />
						<div>
							<div class="text-xs font-bold">Mode Offline Aktif</div>
							<div class="mt-0.5 text-xs text-amber-800">
								Pembayaran tunai akan disimpan lokal sampai koneksi internet kembali.
							</div>
						</div>
					</div>
				{/if}

				<!-- [CATATAN]: 1. Nama Pelanggan (Soft Float Card) -->
				<div class="soft-float-card p-4 transition-all duration-200">
					<label
						class="mb-2 flex items-center gap-2 text-xs font-bold tracking-wider text-slate-500 uppercase"
						for="nama"
					>
						<UserRound class="h-4 w-4 text-pink-600" />
						Nama Pelanggan
					</label>
					<input
						id="nama"
						type="text"
						class="w-full rounded-full border border-slate-200/90 bg-slate-50/60 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
						placeholder="Contoh: Kak Sarah / Meja 02..."
						bind:value={s.customerName}
						maxlength="50"
					/>
				</div>

				<!-- [CATATAN]: 2. Pesanan Ringkasan (Glassmorphic Card) -->
				<div class="glass-card rounded-[28px] p-4.5 shadow-lg">
					<div class="mb-3 flex items-center justify-between">
						<div
							class="flex items-center gap-2 text-xs font-bold tracking-wider text-slate-700 uppercase"
						>
							<ReceiptText class="h-4 w-4 text-pink-600" />
							Rincian Pesanan
						</div>
						<div
							class="rounded-full bg-pink-100/80 px-3 py-0.5 text-[11px] font-bold text-pink-800"
						>
							{s.totalQty} item
						</div>
					</div>
					<ul class="divide-y divide-slate-100">
						{#each s.cart as item (s.cartItemKey(item))}
							{@const isJumbo = item.porsi === 'jumbo'}
							{@const basePrice = isJumbo
								? (item.product.harga_jumbo ?? item.product.harga ?? 0)
								: (item.product.harga ?? 0)}
							<li class="flex flex-col gap-1 py-2.5">
								<div class="flex items-start justify-between gap-3">
									<div class="min-w-0">
										<div
											class="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900"
										>
											<span class="truncate">{item.product.nama}</span>
											{#if isJumbo}
												<span
													class="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600 ring-1 ring-rose-200/70"
												>
													Jumbo
												</span>
											{/if}
										</div>
										<div class="mt-0.5 text-xs font-semibold text-slate-400">
											{item.jumlah}x @ Rp {formatRupiah(basePrice)}
										</div>
									</div>
									<span class="shrink-0 text-sm font-bold text-pink-700"
										>Rp {formatRupiah(basePrice * item.jumlah)}</span
									>
								</div>
								{#if item.addOns && item.addOns.length > 0}
									<div
										class="mt-1 flex flex-col gap-0.5 rounded-xl bg-slate-50/80 px-3 py-1.5 text-xs"
									>
										{#each item.addOns as ekstra}
											<div class="flex justify-between gap-3 font-medium text-slate-600">
												<span class="truncate">+ {ekstra.nama}</span>
												<span class="shrink-0 font-bold"
													>Rp {formatRupiah((ekstra.harga ?? 0) * item.jumlah)}</span
												>
											</div>
										{/each}
									</div>
								{/if}
								{#if (item.gula && item.gula !== 'normal') || (item.es && item.es !== 'normal') || (item.catatan && item.catatan.trim())}
									<div class="text-[11px] font-medium text-slate-400">
										{formatOrderDetails(item)}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				</div>

				<!-- [CATATAN]: 3. Metode Pembayaran (Pill Buttons) -->
				<div class="soft-float-card p-4.5">
					<div class="mb-3 text-xs font-bold tracking-wider text-slate-500 uppercase">
						Pilih Metode Pembayaran
					</div>
					<div class="grid grid-cols-2 gap-3">
						{#each paymentOptions as opt}
							<button
								type="button"
								class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-3.5 transition-all duration-200 active:scale-[0.98] {s.paymentMethod ===
								opt.id
									? 'border-pink-500 bg-pink-50/80 text-pink-700 shadow-md shadow-pink-500/10'
									: 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'} {s.isOffline &&
								opt.id !== 'tunai'
									? 'cursor-not-allowed opacity-45'
									: ''}"
								onclick={() => s.handleSetPaymentMethod(opt.id)}
								disabled={s.isOffline && opt.id !== 'tunai'}
							>
								<div
									class="flex h-10 w-10 items-center justify-center rounded-xl {s.paymentMethod ===
									opt.id
										? 'bg-pink-500 text-white'
										: 'bg-slate-100 text-slate-500'}"
								>
									{#if opt.id === 'tunai'}
										<Banknote class="h-5 w-5" />
									{:else}
										<CreditCard class="h-5 w-5" />
									{/if}
								</div>
								<span class="text-xs font-bold"
									>{opt.label}{s.isOffline && opt.id !== 'tunai' ? ' (online)' : ''}</span
								>
							</button>
						{/each}
					</div>
				</div>

				<!-- [CATATAN]: 4. Konfirmasi & Batalkan Buttons -->
				<div class="mt-2 flex flex-col gap-2.5">
					<button
						class="w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-4 text-base font-bold text-white shadow-xl shadow-pink-500/25 transition-all duration-200 hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
						onclick={s.handleBayar}
						disabled={!s.canPay}
					>
						Konfirmasi & Proses Transaksi
					</button>
					{#if !s.canPay}
						<div class="text-center text-xs font-bold text-rose-500">
							{#if !s.paymentMethod && !s.customerName.trim()}
								Mohon isi nama pelanggan & pilih metode pembayaran
							{:else if !s.paymentMethod}
								Mohon pilih metode pembayaran
							{:else}
								Mohon isi nama pelanggan
							{/if}
						</div>
					{/if}
					<button
						class="mx-auto block w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-extrabold text-slate-500 shadow-xs transition-all duration-200 hover:bg-slate-50 active:scale-[0.98]"
						type="button"
						onclick={s.handleCancel}
					>
						Batalkan Transaksi
					</button>
				</div>
			</div>
		{/if}
	</div>
</main>

{#if s.showCancelModal}
	<div class="z-alert fixed inset-0 flex items-end justify-center bg-slate-900/45 backdrop-blur-xs">
		<div
			class="animate-slideUpModal mx-auto w-full max-w-sm rounded-t-[28px] border-t border-slate-100 bg-white p-6 pb-6 shadow-xl"
		>
			<div class="mb-2 text-center text-lg font-extrabold text-slate-900">Batalkan Pembayaran?</div>
			<div class="mb-6 text-center text-xs font-medium text-slate-500">
				Apakah Anda yakin ingin membatalkan pembayaran dan kembali ke kasir?
			</div>
			<div class="flex flex-col gap-2.5">
				<button
					class="min-h-[46px] w-full cursor-pointer rounded-full bg-rose-500 py-3 text-sm font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-[0.98]"
					onclick={s.confirmCancel}>Ya, Batalkan</button
				>
				<button
					class="min-h-[46px] w-full cursor-pointer rounded-full bg-slate-100 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200 active:scale-[0.98]"
					onclick={s.closeModal}>Tutup</button
				>
			</div>
		</div>
	</div>
{/if}

{#if s.showCashModal}
	<ModalSheet open={s.showCashModal} title="Pembayaran Tunai" onClose={s.closeCashModal}>
		<div class="pb-6 md:min-h-[60vh] md:pb-8">
			<div class="mb-4 text-center text-xs font-semibold text-slate-500 md:mb-6 md:text-sm">
				Masukkan jumlah uang diterima dari pelanggan
			</div>
			<input
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				class="mb-3.5 w-full rounded-2xl border-2 border-pink-200/90 bg-pink-50/40 px-4 py-3 text-center text-2xl font-black text-slate-900 transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15 md:mb-5 md:py-4 md:text-3xl"
				value={s.formattedCashReceived}
				oninput={(e) => {
					const target = e.target as HTMLInputElement;
					const raw = target.value.replace(/\D/g, '');
					s.cashReceived = raw;
				}}
				placeholder="0"
			/>
			<div class="mb-4 flex flex-wrap justify-center gap-2 md:mb-6 md:gap-3">
				<button
					type="button"
					class="min-h-[44px] cursor-pointer rounded-full border border-pink-500 bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-pink-500/20 transition-all hover:brightness-105 active:scale-95 md:px-6 md:text-sm"
					onclick={() => s.handleSetExactCash()}
				>
					Uang Pas (Rp {formatRupiah(s.totalHarga)})
				</button>
				{#each cashTemplates as t}
					<button
						type="button"
						class="min-h-[44px] cursor-pointer rounded-full border border-pink-200/80 bg-pink-50/70 px-4 py-2 text-xs font-extrabold text-pink-600 shadow-2xs transition-all hover:border-pink-300 hover:bg-pink-100 active:scale-95 md:px-6 md:text-sm"
						onclick={() => s.handleAddCashTemplate(t)}
					>
						+ Rp {formatRupiah(t)}
					</button>
				{/each}
			</div>
			<div class="mx-auto grid w-full grid-cols-3 gap-2.5 md:gap-4">
				{#each keypad as row}
					{#each row as key}
						<button
							type="button"
							class="flex min-h-[50px] w-full cursor-pointer items-center justify-center rounded-2xl bg-slate-100/90 py-3 text-lg font-bold text-slate-800 shadow-2xs transition-all hover:bg-slate-200 active:scale-95 md:py-6 md:text-2xl {key ===
							'⌫'
								? 'col-span-1 text-pink-600'
								: ''} {key === 'C' ? 'text-rose-500' : ''}"
							onclick={() => s.handleKeypadButton(key)}>{key}</button
						>
					{/each}
				{/each}
			</div>
		</div>
		{#snippet footer()}
			<div class="flex flex-col gap-2.5">
				<div
					class="mb-1 flex items-center justify-between px-2 text-xs font-bold text-slate-700 sm:text-sm"
				>
					<span>Kembalian:</span>
					<span
						class="text-base font-extrabold {s.kembalian < 0
							? 'text-rose-500'
							: 'text-emerald-600'}">Rp {s.kembalian >= 0 ? formatRupiah(s.kembalian) : '0'}</span
					>
				</div>
				<button
					class="min-h-[48px] w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
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
	<div class="z-alert fixed inset-0 flex items-end justify-center bg-slate-900/45 backdrop-blur-xs">
		<div
			class="animate-slideUpModal qris-warning-modal mx-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-t-[28px] border-t border-slate-100 bg-white p-8 pb-6 shadow-xl"
		>
			<div
				class="animate-bounceIn warning-icon mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600"
			>
				<svg width="36" height="36" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#fde047" opacity="0.18" /><path
						d="M12 8v4m0 4h.01"
						stroke="#d97706"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="warning-title text-center text-lg font-extrabold text-slate-900">
				Periksa Pembayaran QRIS
			</div>
			<div class="text-center text-xs leading-relaxed text-slate-600">
				Pastikan kasir sudah <span class="font-bold text-pink-600">memeriksa nama merchant</span>
				dan <span class="font-bold text-pink-600">nominal pembayaran</span> di aplikasi konsumen sebelum
				melanjutkan.
			</div>
			<button
				class="warning-btn mt-2 min-h-[46px] w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:brightness-105 active:scale-[0.98]"
				onclick={s.confirmQrisChecked}>Sudah Diperiksa</button
			>
		</div>
	</div>
{/if}

{#if s.showSuccessModal}
	<div class="z-alert fixed inset-0 flex items-end justify-center bg-slate-900/45 backdrop-blur-xs">
		<div
			class="animate-slideUpModal mx-auto flex w-full max-w-sm flex-col items-center gap-3.5 rounded-t-[28px] border-t border-slate-100 bg-white p-6 pb-6 shadow-xl"
		>
			<div
				class="animate-bounceIn mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
			>
				<svg width="40" height="40" fill="none" viewBox="0 0 24 24"
					><circle cx="12" cy="12" r="12" fill="#4ade80" opacity="0.18" /><path
						d="M7 13l3 3 7-7"
						stroke="#16a34a"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			</div>
			<div class="text-center text-xl font-black text-slate-900">
				{s.transactionQueuedOffline ? 'Transaksi Tersimpan' : 'Transaksi Berhasil!'}
			</div>
			<div class="text-center text-xs leading-relaxed text-slate-600">
				{#if s.transactionQueuedOffline}
					Tersimpan di perangkat dan menunggu sinkronisasi.<br />
				{:else}
					Pembayaran {s.paymentMethod === 'tunai' ? 'tunai' : s.paymentMethod.toUpperCase()} telah diterima.<br
					/>
				{/if}
				{#if s.customerName.trim()}
					<span class="font-bold text-pink-600">{s.customerName.trim()}</span><br />
				{/if}
			</div>
			<div
				class="flex w-full flex-col gap-1.5 rounded-2xl border border-slate-100/90 bg-slate-50 p-3.5 text-xs"
			>
				<div class="flex justify-between font-medium text-slate-500">
					<span>Total Tagihan</span><span class="font-extrabold text-pink-600"
						>Rp {formatRupiah(s.totalHarga)}</span
					>
				</div>
				<div class="flex justify-between font-medium text-slate-500">
					<span>Dibayar</span><span class="font-bold text-slate-800"
						>Rp {s.cashReceived ? formatRupiah(parseInt(s.cashReceived)) : '0'}</span
					>
				</div>
				<div
					class="flex justify-between border-t border-slate-200/60 pt-1 font-medium text-slate-500"
				>
					<span>Kembalian</span><span class="font-extrabold text-emerald-600"
						>Rp {s.kembalian >= 0 ? formatRupiah(s.kembalian) : '0'}</span
					>
				</div>
			</div>
			<div class="flex w-full flex-col gap-2.5 pt-1">
				<button
					class="min-h-[46px] w-full cursor-pointer rounded-full bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/20 transition-all hover:bg-emerald-700 active:scale-[0.98]"
					onclick={s.printStrukViaEscPosService}>Cetak Struk</button
				>
				<button
					class="min-h-[46px] w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-sm font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:brightness-105 active:scale-[0.98]"
					onclick={s.handleBackToKasir}>Kembali ke Kasir</button
				>
			</div>
		</div>
	</div>
{/if}

{#if s.showErrorNotification}
	<div class="z-toast pointer-events-none fixed inset-x-0 top-20 flex justify-center px-4">
		<div
			class="rounded-2xl bg-rose-600 px-6 py-3 text-center font-bold text-white shadow-xl shadow-rose-950/20 backdrop-blur-md"
			in:fly={{ y: -20, duration: 240, easing: cubicOut }}
			out:fade={{ duration: 160 }}
		>
			{s.errorNotificationMessage}
		</div>
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
