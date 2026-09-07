<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { HistoryItem } from '$lib/types/laporan';
	import { formatRupiah } from '$lib/utils/currency';
	import DropdownSheet from '$lib/components/shared/dropdownSheet.svelte';
	import X from '@lucide/svelte/icons/x';
	import Printer from '@lucide/svelte/icons/printer';
	import Calendar from '@lucide/svelte/icons/calendar';
	import User from '@lucide/svelte/icons/user';
	import Store from '@lucide/svelte/icons/store';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Eye from '@lucide/svelte/icons/eye';
	import Check from '@lucide/svelte/icons/check';
	import Receipt from '@lucide/svelte/icons/receipt';
	import CreditCard from '@lucide/svelte/icons/credit-card';

	let {
		open = false,
		transaksi = null,
		readonly = true,
		isPrinting = false,
		paymentOptions = [
			{ value: 'tunai', label: 'Tunai' },
			{ value: 'qris', label: 'QRIS' }
		],
		onClose,
		onPrint,
		onUpdatePaymentMethod
	}: {
		open?: boolean;
		transaksi?: HistoryItem | null;
		readonly?: boolean;
		isPrinting?: boolean;
		paymentOptions?: Array<{ value: string; label: string }>;
		onClose?: () => void;
		onPrint?: () => void;
		onUpdatePaymentMethod?: (method: string) => void | Promise<void>;
	} = $props();

	let showDropdownPayment = $state(false);

	function formatDateTime(isoString?: string): string {
		if (!isoString) return '-';
		try {
			return new Date(isoString).toLocaleString('id-ID', {
				dateStyle: 'medium',
				timeStyle: 'short'
			});
		} catch {
			return isoString;
		}
	}

	function getNormalizedPayment(method?: string): string {
		if (!method) return 'Tunai';
		const m = method.toLowerCase();
		if (m === 'qris' || m === 'non-tunai') return 'QRIS';
		if (m === 'tunai' || m === 'cash') return 'Tunai';
		return method.toUpperCase();
	}
</script>

{#if open && transaksi}
	<div
		class="z-modal fixed inset-0 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && onClose?.()}
		onkeydown={(e) => e.key === 'Escape' && onClose?.()}
		transition:fade={{ duration: 180 }}
	>
		<div
			class="relative flex w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-slate-200/90 bg-white shadow-2xl transition-all duration-200"
			transition:scale={{ duration: 200, start: 0.95, easing: cubicOut }}
		>
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
				<div class="flex items-center gap-3">
					<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-pink-100 bg-pink-50 text-pink-600 shadow-2xs">
						<Receipt class="h-4.5 w-4.5 stroke-[2.3]" />
					</div>
					<div>
						<h2 class="text-base font-bold tracking-tight text-slate-900">Detail Transaksi</h2>
						<div class="flex items-center gap-1.5 mt-0.5">
							{#if readonly}
								<span class="inline-flex items-center gap-1 rounded-md border border-slate-200/80 bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
									<Eye class="h-3 w-3 stroke-[2.2]" />
									Hanya Lihat
								</span>
							{:else}
								<span class="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
									<Check class="h-3 w-3 stroke-[2.4]" />
									Dapat Diubah
								</span>
							{/if}
						</div>
					</div>
				</div>

				<button
					type="button"
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 active:scale-95"
					onclick={() => onClose?.()}
					aria-label="Tutup"
				>
					<X class="h-4 w-4 stroke-[2.5]" />
				</button>
			</div>

			<!-- Body Konten -->
			<div class="space-y-3 p-5 overflow-y-auto max-h-[75vh]">
				<!-- Kartu Utama Nominal & Deskripsi -->
				<div class="rounded-2xl border border-pink-100/90 bg-gradient-to-br from-pink-50/60 via-white to-rose-50/40 p-4 shadow-2xs">
					<div class="flex items-center justify-between">
						<span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total Transaksi</span>
						<span class="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider {getNormalizedPayment(transaksi.metode_bayar) === 'QRIS' ? 'bg-sky-100 text-sky-700 border border-sky-200/80' : 'bg-emerald-100 text-emerald-700 border border-emerald-200/80'}">
							{getNormalizedPayment(transaksi.metode_bayar)}
						</span>
					</div>
					<div class="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
						Rp {formatRupiah(transaksi.nominal)}
					</div>

					<div class="mt-3 border-t border-slate-100 pt-2.5">
						<span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Deskripsi</span>
						<p class="mt-0.5 text-xs sm:text-sm font-semibold text-slate-800 break-words">
							{transaksi.nama || 'Transaksi Kasir'}
						</p>
					</div>
				</div>

				<!-- Grid Metadata Detail -->
				<div class="grid grid-cols-2 gap-2.5">
					<!-- Pelanggan -->
					<div class="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
						<div class="flex items-center gap-1.5 text-slate-400 mb-1">
							<User class="h-3.5 w-3.5 stroke-[2.2]" />
							<span class="text-[10px] font-bold uppercase tracking-wider">Pelanggan</span>
						</div>
						<div class="text-xs sm:text-sm font-bold text-slate-800 truncate" title={transaksi.nama_pelanggan || '-'}>
							{transaksi.nama_pelanggan || 'Pelanggan Umum'}
						</div>
					</div>

					<!-- Sumber -->
					<div class="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
						<div class="flex items-center gap-1.5 text-slate-400 mb-1">
							<Store class="h-3.5 w-3.5 stroke-[2.2]" />
							<span class="text-[10px] font-bold uppercase tracking-wider">Sumber</span>
						</div>
						<div class="text-xs sm:text-sm font-bold text-slate-800">
							{transaksi.sumber === 'pos' ? 'POS (Kasir)' : 'Input Manual'}
						</div>
					</div>
				</div>

				<!-- Waktu Transaksi -->
				<div class="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
					<div class="flex items-center gap-1.5 text-slate-400 mb-1">
						<Calendar class="h-3.5 w-3.5 stroke-[2.2]" />
						<span class="text-[10px] font-bold uppercase tracking-wider">Waktu Transaksi</span>
					</div>
					<div class="text-xs sm:text-sm font-semibold text-slate-800">
						{formatDateTime(transaksi.waktu)}
					</div>
				</div>

				<!-- Metode Pembayaran (Readonly vs Editable) -->
				<div class="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3">
					<div class="flex items-center justify-between mb-1.5">
						<div class="flex items-center gap-1.5 text-slate-400">
							<CreditCard class="h-3.5 w-3.5 stroke-[2.2]" />
							<span class="text-[10px] font-bold uppercase tracking-wider">Jenis Pembayaran</span>
						</div>
						{#if !readonly}
							<span class="text-[10px] font-medium text-pink-600">Ketuk untuk ubah</span>
						{/if}
					</div>

					{#if readonly}
						<!-- Readonly Display -->
						<div class="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white px-3.5 py-2.5">
							<span class="text-xs font-bold text-slate-800">
								{getNormalizedPayment(transaksi.metode_bayar)}
							</span>
							<span class="text-[10px] font-semibold text-slate-400">Terkunci</span>
						</div>
					{:else}
						<!-- Editable Dropdown Trigger -->
						<button
							type="button"
							class="flex w-full cursor-pointer items-center justify-between rounded-xl border border-pink-200/90 bg-white px-3.5 py-2.5 text-left text-xs font-bold text-slate-900 shadow-2xs transition-all hover:bg-pink-50/30 hover:border-pink-300 active:scale-[0.99]"
							onclick={() => (showDropdownPayment = true)}
						>
							<span class="text-pink-700">
								{paymentOptions.find(
									(opt) =>
										opt.value ===
										(transaksi.metode_bayar === 'non-tunai' ? 'qris' : transaksi.metode_bayar)
								)?.label || getNormalizedPayment(transaksi.metode_bayar)}
							</span>
							<ChevronDown class="h-4 w-4 text-pink-500 stroke-[2.5]" />
						</button>

						<DropdownSheet
							open={showDropdownPayment}
							value={transaksi.metode_bayar === 'non-tunai' ? 'qris' : transaksi.metode_bayar}
							options={paymentOptions}
							onClose={() => (showDropdownPayment = false)}
							onSelect={(value) => {
								showDropdownPayment = false;
								onUpdatePaymentMethod?.(value);
							}}
						/>
					{/if}
				</div>
			</div>

			<!-- Footer Tombol Aksi -->
			<div class="flex items-center gap-2.5 border-t border-slate-100 bg-slate-50/70 p-4">
				<button
					type="button"
					class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 px-4 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50 active:scale-95"
					onclick={() => onPrint?.()}
					disabled={isPrinting}
				>
					<Printer class="h-4 w-4 stroke-[2.2] {isPrinting ? 'animate-spin' : ''}" />
					<span>{isPrinting ? 'Memproses...' : 'Cetak Struk'}</span>
				</button>
				<button
					type="button"
					class="flex flex-1 cursor-pointer items-center justify-center rounded-xl bg-slate-900 py-2.5 px-4 text-xs font-bold text-white shadow-xs transition-all hover:bg-slate-800 active:scale-95"
					onclick={() => onClose?.()}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
