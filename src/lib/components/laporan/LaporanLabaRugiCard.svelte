<script lang="ts">
	import type { LaporanSummary } from '$lib/types/laporan';
	import { formatRupiah } from '$lib/utils/currency';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let {
		isLoadingReport,
		summary
	}: {
		isLoadingReport: boolean;
		summary: LaporanSummary;
	} = $props();

	let showBreakdown = $state(false);
	let hasMultiTax = $derived((summary?.taxBreakdown?.length ?? 0) > 1);
</script>

<div class="flex flex-col gap-2.5 lg:flex-1 lg:gap-3">
	<!-- Laba (Rugi) Kotor -->
	<div
		class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-sm font-bold text-zinc-800 shadow-sm sm:text-base"
	>
		<span class="text-xs font-bold tracking-wider text-zinc-500 uppercase sm:text-sm"
			>Laba (Rugi) Kotor</span
		>
		<span class="font-extrabold text-zinc-900"
			>Rp {summary?.labaKotor !== null && summary?.labaKotor !== undefined
				? formatRupiah(summary.labaKotor)
				: '0'}</span
		>
	</div>

	<!-- Pajak Penghasilan / Pajak Aktif -->
	<div class="flex flex-col rounded-2xl border border-zinc-200/80 bg-white shadow-sm">
		{#if hasMultiTax}
			<button
				type="button"
				class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left text-sm font-bold text-zinc-800 transition-colors hover:bg-slate-50/50 sm:text-base"
				onclick={() => (showBreakdown = !showBreakdown)}
				aria-expanded={showBreakdown}
			>
				<div class="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
					<span class="truncate text-xs font-bold tracking-wider text-zinc-500 uppercase sm:text-sm"
						>{summary?.taxLabel || 'Pajak (0,5%)'}</span
					>
					<ChevronDown
						size={14}
						class="text-slate-400 transition-transform {showBreakdown ? 'rotate-180' : ''}"
					/>
				</div>
				<span class="shrink-0 font-extrabold text-zinc-900"
					>Rp {summary?.pajak !== null && summary?.pajak !== undefined
						? formatRupiah(summary.pajak)
						: '0'}</span
				>
			</button>
		{:else}
			<div
				class="flex items-center justify-between px-4 py-3 text-sm font-bold text-zinc-800 sm:text-base"
			>
				<span class="truncate text-xs font-bold tracking-wider text-zinc-500 uppercase sm:text-sm"
					>{summary?.taxLabel || 'Pajak (0,5%)'}</span
				>
				<span class="shrink-0 font-extrabold text-zinc-900"
					>Rp {summary?.pajak !== null && summary?.pajak !== undefined
						? formatRupiah(summary.pajak)
						: '0'}</span
				>
			</div>
		{/if}

		{#if hasMultiTax && showBreakdown && summary?.taxBreakdown}
			<div
				class="flex flex-col gap-1.5 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-600"
			>
				{#each summary.taxBreakdown as b}
					<div class="flex items-center justify-between text-[11px]">
						<span class="text-slate-500">↳ {b.nama} ({b.persentase}%):</span>
						<span class="font-bold text-slate-800">Rp {formatRupiah(b.nominal)}</span>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Laba (Rugi) Bersih -->
	<div
		class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 text-sm font-bold text-pink-600 shadow-sm sm:text-base"
	>
		<span class="text-xs font-bold tracking-wider text-zinc-500 uppercase sm:text-sm"
			>Laba (Rugi) Bersih</span
		>
		<span class="font-extrabold text-pink-600"
			>Rp {summary?.labaBersih !== null && summary?.labaBersih !== undefined
				? formatRupiah(summary.labaBersih)
				: '0'}</span
		>
	</div>
</div>
