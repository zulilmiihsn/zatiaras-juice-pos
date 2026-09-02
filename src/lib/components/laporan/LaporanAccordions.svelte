<script lang="ts">
	import { slide } from 'svelte/transition';
	import type { BukuKasRecord } from '$lib/types/laporan';
	import { formatRupiah } from '$lib/utils/currency';

	let {
		isLoadingReport,
		totalQrisPemasukan,
		totalTunaiPemasukan,
		totalQrisPengeluaran,
		totalTunaiPengeluaran,
		pemasukanUsahaQris,
		pemasukanUsahaTunai,
		pemasukanLainQris,
		pemasukanLainTunai,
		bebanUsahaQris,
		bebanUsahaTunai,
		bebanLainQris,
		bebanLainTunai
	}: {
		isLoadingReport: boolean;
		totalQrisPemasukan: number;
		totalTunaiPemasukan: number;
		totalQrisPengeluaran: number;
		totalTunaiPengeluaran: number;
		pemasukanUsahaQris: BukuKasRecord[];
		pemasukanUsahaTunai: BukuKasRecord[];
		pemasukanLainQris: BukuKasRecord[];
		pemasukanLainTunai: BukuKasRecord[];
		bebanUsahaQris: BukuKasRecord[];
		bebanUsahaTunai: BukuKasRecord[];
		bebanLainQris: BukuKasRecord[];
		bebanLainTunai: BukuKasRecord[];
	} = $props();

	// [CATATAN]: Local states for accordions
	let showPemasukan = $state(true);
	let showPendapatanUsaha = $state(true);
	let showPemasukanLain = $state(true);
	let showPengeluaran = $state(true);
	let showBebanUsaha = $state(true);
	let showBebanLain = $state(true);

	// [CATATAN]: Track expanded items
	let expandedItems = $state(new Set<string>());

	function toggleExpand(name: string) {
		if (expandedItems.has(name)) {
			expandedItems.delete(name);
		} else {
			expandedItems.add(name);
		}
		expandedItems = new Set(expandedItems);
	}

	function groupAndSumByName(items: BukuKasRecord[]): { nama: string; total: number }[] {
		if (!items || items.length === 0) return [];
		const groups = items.reduce((acc: Record<string, number>, item) => {
			const name = item.deskripsi?.trim() || item.catatan?.trim() || 'Lain-lain';
			acc[name] = (acc[name] || 0) + (item.nominal || 0);
			return acc;
		}, {});
		return Object.entries(groups).map(([name, total]) => ({ nama: name, total }));
	}
</script>

{#snippet accordionGroup(
	judul: string,
	show: boolean,
	toggle: () => void,
	qrisData: BukuKasRecord[],
	tunaiData: BukuKasRecord[],
	isFirst: boolean
)}
	<button
		class="{isFirst
			? 'mb-1'
			: 'mt-2.5 mb-1'} flex w-full items-center justify-between rounded-xl bg-zinc-50 px-3.5 py-2 text-xs font-bold text-zinc-700 transition-colors hover:bg-zinc-100 sm:text-sm"
		onclick={toggle}
	>
		<span>{judul}</span>
		<svg
			class="h-4 w-4 text-zinc-400 transition-transform duration-200"
			viewBox="0 0 20 20"
			style="transform:rotate({show ? 0 : 180}deg)"
		>
			<polygon points="5,8 10,13 15,8" fill="currentColor" />
		</svg>
	</button>
	{#if show}
		<div class="flex flex-col gap-2 px-3 pt-1 pb-2" transition:slide|local>
			<div class="mt-1 text-[11px] font-bold tracking-wider text-pink-600 uppercase">QRIS</div>
			<ul class="flex flex-col gap-1.5">
				{#if qrisData.length === 0}
					<li class="py-1 text-xs text-zinc-400 italic">Tidak ada data</li>
				{/if}
				{#each groupAndSumByName(qrisData).sort((a, b) => b.total - a.total) as grouped}
					<li class="flex items-center justify-between text-xs text-zinc-700 sm:text-sm">
						<span
							class="{expandedItems.has(grouped.nama)
								? ''
								: 'max-w-[65%] truncate'} cursor-pointer hover:text-zinc-900"
							title={grouped.nama}
							onclick={() => toggleExpand(grouped.nama)}
							onkeydown={(e) => e.key === 'Enter' && toggleExpand(grouped.nama)}
							role="button"
							tabindex="0">{grouped.nama}</span
						>
						<span class="font-bold text-zinc-900">Rp {formatRupiah(grouped.total)}</span>
					</li>
				{/each}
			</ul>
			<div class="mt-2 text-[11px] font-bold tracking-wider text-pink-600 uppercase">Tunai</div>
			<ul class="flex flex-col gap-1.5">
				{#if tunaiData.length === 0}
					<li class="py-1 text-xs text-zinc-400 italic">Tidak ada data</li>
				{/if}
				{#each groupAndSumByName(tunaiData).sort((a, b) => b.total - a.total) as grouped}
					<li class="flex items-center justify-between text-xs text-zinc-700 sm:text-sm">
						<span
							class="{expandedItems.has(grouped.nama)
								? ''
								: 'max-w-[65%] truncate'} cursor-pointer hover:text-zinc-900"
							title={grouped.nama}
							onclick={() => toggleExpand(grouped.nama)}
							onkeydown={(e) => e.key === 'Enter' && toggleExpand(grouped.nama)}
							role="button"
							tabindex="0">{grouped.nama}</span
						>
						<span class="font-bold text-zinc-900">Rp {formatRupiah(grouped.total)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}

<div class="flex flex-col gap-3 md:grid md:grid-cols-2 md:items-start md:gap-4">
	<!-- Pemasukan Accordion -->
	<div
		class="overflow-hidden rounded-2xl border-2 border-emerald-100 bg-white p-3.5 shadow-sm transition-all sm:p-4"
	>
		<button
			class="flex w-full items-center justify-between rounded-xl py-0.5 text-sm font-black text-emerald-900 sm:text-base"
			onclick={() => (showPemasukan = !showPemasukan)}
		>
			<span class="flex items-center gap-2">
				<span class="inline-block h-3 w-3 rounded-full bg-emerald-500"></span>
				Pemasukan
			</span>
			<svg
				class="h-4 w-4 text-emerald-600 transition-transform duration-200"
				viewBox="0 0 20 20"
				style="transform:rotate({showPemasukan ? 0 : 180}deg)"
			>
				<polygon points="5,8 10,13 15,8" fill="currentColor" />
			</svg>
		</button>
		{#if showPemasukan}
			<div
				class="flex items-center gap-4 pt-2 pb-2 text-xs font-semibold text-emerald-800 sm:text-sm"
			>
				<span
					>QRIS: <span class="font-black text-emerald-950"
						>Rp {formatRupiah(totalQrisPemasukan)}</span
					></span
				>
				<span
					>Tunai: <span class="font-black text-emerald-950"
						>Rp {formatRupiah(totalTunaiPemasukan)}</span
					></span
				>
			</div>
			<div class="flex flex-col gap-1 pt-1" transition:slide|local>
				{@render accordionGroup(
					'Pendapatan Usaha',
					showPendapatanUsaha,
					() => (showPendapatanUsaha = !showPendapatanUsaha),
					pemasukanUsahaQris,
					pemasukanUsahaTunai,
					true
				)}
				{@render accordionGroup(
					'Pemasukan Lainnya',
					showPemasukanLain,
					() => (showPemasukanLain = !showPemasukanLain),
					pemasukanLainQris,
					pemasukanLainTunai,
					false
				)}
			</div>
		{/if}
	</div>

	<!-- Pengeluaran Accordion -->
	<div
		class="overflow-hidden rounded-2xl border-2 border-rose-100 bg-white p-3.5 shadow-sm transition-all sm:p-4"
	>
		<button
			class="flex w-full items-center justify-between rounded-xl py-0.5 text-sm font-black text-rose-900 sm:text-base"
			onclick={() => (showPengeluaran = !showPengeluaran)}
		>
			<span class="flex items-center gap-2">
				<span class="inline-block h-3 w-3 rounded-full bg-rose-500"></span>
				Pengeluaran
			</span>
			<svg
				class="h-4 w-4 text-rose-600 transition-transform duration-200"
				viewBox="0 0 20 20"
				style="transform:rotate({showPengeluaran ? 0 : 180}deg)"
			>
				<polygon points="5,8 10,13 15,8" fill="currentColor" />
			</svg>
		</button>
		{#if showPengeluaran}
			<div class="flex items-center gap-4 pt-2 pb-2 text-xs font-semibold text-rose-800 sm:text-sm">
				<span
					>QRIS: <span class="font-black text-rose-950"
						>Rp {formatRupiah(totalQrisPengeluaran)}</span
					></span
				>
				<span
					>Tunai: <span class="font-black text-rose-950"
						>Rp {formatRupiah(totalTunaiPengeluaran)}</span
					></span
				>
			</div>
			<div class="flex flex-col gap-1 pt-1" transition:slide|local>
				{@render accordionGroup(
					'Beban Usaha',
					showBebanUsaha,
					() => (showBebanUsaha = !showBebanUsaha),
					bebanUsahaQris,
					bebanUsahaTunai,
					true
				)}
				{@render accordionGroup(
					'Beban Lainnya',
					showBebanLain,
					() => (showBebanLain = !showBebanLain),
					bebanLainQris,
					bebanLainTunai,
					false
				)}
			</div>
		{/if}
	</div>
</div>
