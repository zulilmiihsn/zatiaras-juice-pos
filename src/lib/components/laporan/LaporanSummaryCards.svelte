<script lang="ts">
	import type { LaporanSummary } from '$lib/types/laporan';
	import { formatRupiah } from '$lib/utils/currency';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ArrowDownCircle from '@lucide/svelte/icons/arrow-down-circle';
	import ArrowUpCircle from '@lucide/svelte/icons/arrow-up-circle';

	let {
		isLoadingReport = false,
		summary,
		totalQrisAll = 0,
		totalTunaiAll = 0
	}: {
		isLoadingReport?: boolean;
		summary: LaporanSummary;
		totalQrisAll?: number;
		totalTunaiAll?: number;
	} = $props();
</script>

<!-- Ringkasan Keuangan (Glassmorphic Hero + Soft Float Cards) -->
<div class="mb-4 flex flex-col gap-3">
	<!-- Hero Laba Bersih (Frosted Glass Card) -->
	<div
		class="glass-card relative overflow-hidden rounded-[32px] p-5.5 transition-all duration-200 active:scale-[0.99]"
	>
		<!-- Ambient gradient glow -->
		<div
			class="pointer-events-none absolute -right-6 -bottom-6 h-28 w-28 rounded-full bg-gradient-to-br from-pink-400/20 to-rose-400/20 blur-xl"
		></div>

		<div class="relative z-10 flex items-center justify-between">
			<div>
				<span class="text-[11px] font-bold tracking-wider text-pink-700 uppercase"
					>Laba (Rugi) Bersih</span
				>
				<div
					class="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl {Number(
						summary?.saldo || 0
					) >= 0
						? 'text-slate-900'
						: 'text-rose-600'}"
				>
					Rp {summary?.saldo !== null && summary?.saldo !== undefined
						? formatRupiah(summary.saldo)
						: '0'}
				</div>
			</div>
			<div
				class="flex h-12 w-12 items-center justify-center rounded-[20px] bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
			>
				<Wallet class="h-6 w-6 stroke-[2.2]" />
			</div>
		</div>

		<!-- QRIS & Tunai Pill Row inside Hero Glass Card -->
		<div
			class="relative z-10 mt-3.5 flex items-center justify-between border-t border-slate-200/60 pt-3 text-xs"
		>
			<span class="font-bold text-slate-700">
				QRIS: <span class="font-bold text-pink-700">Rp {formatRupiah(totalQrisAll)}</span>
			</span>
			<span class="font-bold text-slate-700">
				Tunai: <span class="font-bold text-emerald-700">Rp {formatRupiah(totalTunaiAll)}</span>
			</span>
		</div>
	</div>

	<!-- 2-Grid Pemasukan & Pengeluaran (Soft Float Cards) -->
	<div class="grid grid-cols-2 gap-3">
		<!-- Pemasukan -->
		<div
			class="soft-float-card flex flex-col justify-between p-4 transition-all duration-200 active:scale-[0.98]"
		>
			<div class="flex items-center justify-between gap-1">
				<span
					class="truncate text-[11px] font-extrabold tracking-wider whitespace-nowrap text-slate-400 uppercase sm:text-xs"
					>Pemasukan</span
				>
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] border border-emerald-100 bg-emerald-50 text-emerald-600"
				>
					<ArrowDownCircle class="h-4.5 w-4.5 stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
				Rp {summary?.pendapatan !== null && summary?.pendapatan !== undefined
					? formatRupiah(summary.pendapatan)
					: '0'}
			</div>
		</div>

		<!-- Pengeluaran -->
		<div
			class="soft-float-card flex flex-col justify-between p-4 transition-all duration-200 active:scale-[0.98]"
		>
			<div class="flex items-center justify-between gap-1">
				<span
					class="truncate text-[11px] font-extrabold tracking-wider whitespace-nowrap text-slate-400 uppercase sm:text-xs"
					>Pengeluaran</span
				>
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px] border border-rose-100 bg-rose-50 text-rose-600"
				>
					<ArrowUpCircle class="h-4.5 w-4.5 stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
				Rp {summary?.pengeluaran !== null && summary?.pengeluaran !== undefined
					? formatRupiah(summary.pengeluaran)
					: '0'}
			</div>
		</div>
	</div>
</div>
