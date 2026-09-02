<script lang="ts">
	import { fade } from 'svelte/transition';
	import Calculator from '@lucide/svelte/icons/calculator';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import Target from '@lucide/svelte/icons/target';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TrendingDown from '@lucide/svelte/icons/trending-down';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import Scale from '@lucide/svelte/icons/scale';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Info from '@lucide/svelte/icons/info';
	import Save from '@lucide/svelte/icons/save';
	import { formatRupiah, handleRupiahInput } from '$lib/utils/currency';
	import type { Product, HppSettings } from '$lib/types/product';

	let {
		hppForm = $bindable(),
		hppSettings,
		menus,
		getOverheadMonthly,
		getOverheadPerItem,
		getProductRecipeCost,
		getProductHpp,
		getProductMargin,
		addHppExpenseItem,
		removeHppExpenseItem,
		saveHppSettings
	}: {
		hppForm: {
			rincian_biaya: Array<{ id: string; nama: string; nominal: string }>;
			sewa_bulanan: string;
			listrik_bulanan: string;
			air_bulanan: string;
			gaji_bulanan: string;
			lainnya_bulanan: string;
			target_item_bulanan: string;
		};
		hppSettings: HppSettings | null;
		menus: Product[];
		getOverheadMonthly: () => number;
		getOverheadPerItem: () => number;
		getProductRecipeCost: (productId: string | number, porsi?: 'reguler' | 'jumbo') => number;
		getProductHpp: (menu: Product, porsi?: 'reguler' | 'jumbo') => number;
		getProductMargin: (menu: Product, porsi?: 'reguler' | 'jumbo') => number;
		addHppExpenseItem: () => void;
		removeHppExpenseItem: (id: string) => void;
		saveHppSettings: (e?: Event) => void;
	} = $props();

	let activeHppSubTab: 'calculator' | 'operasional' = $state('calculator');
	let searchHppKeyword = $state('');
	let selectedPorsiView: 'all' | 'reguler' | 'jumbo' = $state('all');

	const recipeMenus = $derived(menus.filter((menu) => menu.lacak_bahan));

	const filteredHppMenus = $derived(
		recipeMenus.filter((menu) => {
			const matchKeyword =
				searchHppKeyword.trim() === '' ||
				menu.nama.toLowerCase().includes(searchHppKeyword.trim().toLowerCase());

			if (!matchKeyword) return false;
			if (selectedPorsiView === 'jumbo') {
				return Number(menu.harga_jumbo || 0) > 0;
			}
			return true;
		})
	);

	// Total Biaya Operasional dihitung langsung secara reaktif dari form rincian biaya
	const liveTotalOverhead = $derived.by(() => {
		if (hppForm?.rincian_biaya && hppForm.rincian_biaya.length > 0) {
			return hppForm.rincian_biaya.reduce((sum, item) => {
				const num = Number(String(item.nominal || 0).replace(/\./g, ''));
				return sum + (Number.isNaN(num) ? 0 : num);
			}, 0);
		}
		return Number(getOverheadMonthly() || 0);
	});

	const liveTargetPenjualan = $derived.by(() => {
		const target = Number(String(hppForm?.target_item_bulanan || 1000).replace(/\./g, ''));
		return Math.max(1, Number.isNaN(target) ? 1000 : target);
	});

	const liveOverheadPerItem = $derived(Math.round(liveTotalOverhead / liveTargetPenjualan));

	// BEP (Break-Even Point) Calculation
	const averageGrossMargin = $derived.by(() => {
		if (recipeMenus.length === 0) return 0;
		let totalMargin = 0;
		let count = 0;
		for (const menu of recipeMenus) {
			const margin = Number(getProductMargin(menu, 'reguler') || 0);
			totalMargin += margin;
			count++;
		}
		return count > 0 ? totalMargin / count : 0;
	});

	const bepMonthlyCups = $derived(
		averageGrossMargin > 0 && liveTotalOverhead > 0
			? Math.ceil(liveTotalOverhead / averageGrossMargin)
			: 0
	);

	const bepDailyCups = $derived(bepMonthlyCups > 0 ? Math.ceil(bepMonthlyCups / 30) : 0);
</script>

<div
	in:fade={{ duration: 150 }}
	class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-12 md:px-8"
>
	<!-- Top Summary Bento Cards (Compact 2x2 on mobile, 4-col on desktop) -->
	<div class="mb-5 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
		<!-- Card 1: Total Beban Operasional -->
		<div
			class="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs transition-all hover:border-pink-200 hover:shadow-xs sm:rounded-2xl sm:p-4"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span
					class="truncate text-[10px] font-bold tracking-wider text-slate-500 uppercase sm:text-xs"
					>Beban Operasional</span
				>
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pink-50 text-pink-600 ring-1 ring-pink-100 transition-transform group-hover:scale-105 sm:h-8 sm:w-8 sm:rounded-xl"
				>
					<Calculator class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
				</div>
			</div>
			<div class="truncate text-lg font-black tracking-tight text-slate-900 sm:text-2xl">
				Rp {formatRupiah(Math.round(liveTotalOverhead))}
			</div>
			<p class="mt-0.5 truncate text-[10px] font-medium text-slate-400 sm:text-[11px]">
				Total pos biaya operasional/bln
			</p>
		</div>

		<!-- Card 2: Numpang Modal per Gelas -->
		<div
			class="group relative overflow-hidden rounded-xl border border-pink-100 bg-pink-50/40 p-3 shadow-2xs transition-all hover:border-pink-300 hover:shadow-xs sm:rounded-2xl sm:p-4"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span
					class="truncate text-[10px] font-bold tracking-wider text-pink-700 uppercase sm:text-xs"
					>Beban per Porsi</span
				>
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pink-500 text-white shadow-xs shadow-pink-500/30 transition-transform group-hover:scale-105 sm:h-8 sm:w-8 sm:rounded-xl"
				>
					<CupIcon class="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.2} />
				</div>
			</div>
			<div class="truncate text-lg font-black tracking-tight text-pink-600 sm:text-2xl">
				Rp {formatRupiah(Math.round(liveOverheadPerItem))}
			</div>
			<p class="mt-0.5 truncate text-[10px] font-medium text-pink-700/70 sm:text-[11px]">
				Beban tetap per gelas
			</p>
		</div>

		<!-- Card 3: Target Titik Impas (BEP) -->
		<div
			class="group relative overflow-hidden rounded-xl border border-amber-200/80 bg-amber-50/40 p-3 shadow-2xs transition-all hover:border-amber-300 hover:shadow-xs sm:rounded-2xl sm:p-4"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span
					class="truncate text-[10px] font-bold tracking-wider text-amber-800 uppercase sm:text-xs"
					>Target BEP (Impas)</span
				>
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-xs shadow-amber-500/30 transition-transform group-hover:scale-105 sm:h-8 sm:w-8 sm:rounded-xl"
				>
					<Scale class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
				</div>
			</div>
			<div
				class="flex items-baseline gap-1 truncate text-lg font-black tracking-tight text-amber-900 sm:text-2xl"
			>
				<span>{formatRupiah(bepDailyCups)}</span>
				<span class="text-[11px] font-bold text-amber-700">gelas/hari</span>
			</div>
			<p class="mt-0.5 truncate text-[10px] font-medium text-amber-800/70 sm:text-[11px]">
				Min. {formatRupiah(bepMonthlyCups)} gelas/bln
			</p>
		</div>

		<!-- Card 4: Target Penjualan Bulanan -->
		<div
			class="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3 shadow-2xs transition-all hover:border-pink-200 hover:shadow-xs sm:rounded-2xl sm:p-4"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span
					class="truncate text-[10px] font-bold tracking-wider text-slate-500 uppercase sm:text-xs"
					>Target Jual</span
				>
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700 ring-1 ring-slate-200/60 transition-transform group-hover:scale-105 sm:h-8 sm:w-8 sm:rounded-xl"
				>
					<Target class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
				</div>
			</div>
			<div
				class="flex items-baseline gap-1 truncate text-lg font-black tracking-tight text-slate-900 sm:text-2xl"
			>
				<span>{formatRupiah(liveTargetPenjualan)}</span>
				<span class="text-[11px] font-bold text-slate-500">porsi/bln</span>
			</div>
			<p class="mt-0.5 truncate text-[10px] font-medium text-slate-400 sm:text-[11px]">
				Estimasi laku per bulan
			</p>
		</div>
	</div>

	<!-- Sub-tab Navigation Switcher -->
	<div
		class="mb-5 flex flex-col items-start gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-center sm:justify-between"
	>
		<div
			class="grid w-full grid-cols-2 rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1.5 shadow-2xs sm:w-auto sm:min-w-[420px]"
		>
			<button
				type="button"
				class="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all active:scale-[0.98] sm:text-sm {activeHppSubTab ===
				'calculator'
					? 'bg-white text-pink-600 shadow-xs ring-1 ring-slate-200/60'
					: 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeHppSubTab = 'calculator')}
			>
				<Calculator class="h-4 w-4" />
				<span>Kalkulator HPP & Margin</span>
			</button>
			<button
				type="button"
				class="flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition-all active:scale-[0.98] sm:text-sm {activeHppSubTab ===
				'operasional'
					? 'bg-white text-pink-600 shadow-xs ring-1 ring-slate-200/60'
					: 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeHppSubTab = 'operasional')}
			>
				<ReceiptText class="h-4 w-4" />
				<span>Biaya Operasional & Target</span>
			</button>
		</div>
	</div>

	<!-- Sub-tab 1: Kalkulator HPP & Margin Menu -->
	{#if activeHppSubTab === 'calculator'}
		<div in:fade={{ duration: 120 }} class="flex flex-col gap-4">
			<!-- Controls: Full-width search and large touch target segmented buttons -->
			<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
				<!-- Search Filter -->
				<div class="relative w-full sm:max-w-xs">
					<Search
						class="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400"
					/>
					<input
						type="text"
						class="w-full rounded-2xl border border-slate-200/90 bg-white py-2.5 pr-4 pl-10 text-xs font-medium text-slate-900 shadow-2xs transition-all placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none sm:text-sm"
						placeholder="Cari menu resep..."
						bind:value={searchHppKeyword}
					/>
				</div>

				<!-- Segmented Control for Porsi Size (Full Width touch area) -->
				<div
					class="grid w-full grid-cols-3 rounded-2xl border border-slate-200/80 bg-slate-100/90 p-1.5 shadow-2xs sm:w-80"
				>
					<button
						type="button"
						class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all active:scale-[0.98] sm:py-2.5 sm:text-sm {selectedPorsiView ===
						'all'
							? 'bg-white text-pink-600 shadow-xs ring-1 ring-slate-200/60'
							: 'text-slate-600 hover:text-slate-900'}"
						onclick={() => (selectedPorsiView = 'all')}
					>
						<LayoutGrid class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
						<span>Semua</span>
					</button>
					<button
						type="button"
						class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all active:scale-[0.98] sm:py-2.5 sm:text-sm {selectedPorsiView ===
						'reguler'
							? 'bg-white text-pink-600 shadow-xs ring-1 ring-slate-200/60'
							: 'text-slate-600 hover:text-slate-900'}"
						onclick={() => (selectedPorsiView = 'reguler')}
					>
						<CupIcon class="h-3.5 w-3.5 sm:h-4 sm:w-4" strokeWidth={2.2} />
						<span>Reguler</span>
					</button>
					<button
						type="button"
						class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-all active:scale-[0.98] sm:py-2.5 sm:text-sm {selectedPorsiView ===
						'jumbo'
							? 'bg-white text-pink-600 shadow-xs ring-1 ring-slate-200/60'
							: 'text-slate-600 hover:text-slate-900'}"
						onclick={() => (selectedPorsiView = 'jumbo')}
					>
						<CupIcon class="h-4 w-4 sm:h-4.5 sm:w-4.5" strokeWidth={2.2} />
						<span>Jumbo</span>
					</button>
				</div>
			</div>

			<!-- Menu Grid List -->
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
				{#each filteredHppMenus as menu}
					{@const overhead = Math.round(Number(liveOverheadPerItem || 0))}
					{@const hasJumbo = Number(menu.harga_jumbo || 0) > 0}

					<!-- Reguler Calculations -->
					{@const regRecipeCost = Math.round(Number(getProductRecipeCost(menu.id, 'reguler') || 0))}
					{@const regTotalHpp = regRecipeCost + overhead}
					{@const regMargin = Number(menu.harga || 0) - regTotalHpp}
					{@const regMarginPct = menu.harga > 0 ? Math.round((regMargin / menu.harga) * 100) : 0}

					<!-- Jumbo Calculations -->
					{@const jumboPrice = Number(menu.harga_jumbo || 0)}
					{@const jumboRecipeCost = Math.round(Number(getProductRecipeCost(menu.id, 'jumbo') || 0))}
					{@const jumboTotalHpp = jumboRecipeCost + overhead}
					{@const jumboMargin = jumboPrice - jumboTotalHpp}
					{@const jumboMarginPct =
						jumboPrice > 0 ? Math.round((jumboMargin / jumboPrice) * 100) : 0}

					<div
						class="group flex flex-col gap-3.5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs transition-all hover:border-pink-200 hover:shadow-xs sm:p-5"
					>
						<!-- Header Menu -->
						<div class="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
							<span class="truncate text-base font-black text-slate-900">{menu.nama}</span>
							{#if hasJumbo}
								<span
									class="rounded-full bg-pink-100 px-2.5 py-0.5 text-[11px] font-extrabold text-pink-700"
								>
									2 Ukuran
								</span>
							{/if}
						</div>

						<!-- Section Porsi Reguler -->
						{#if selectedPorsiView === 'all' || selectedPorsiView === 'reguler'}
							<div
								class="flex flex-col justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-3.5 sm:flex-row sm:items-center"
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span
											class="flex items-center gap-1 text-xs font-bold text-slate-700 sm:text-sm"
										>
											<CupIcon class="h-4 w-4 text-pink-500" strokeWidth={2.2} />
											Reguler
										</span>
										<span class="text-xs font-extrabold text-slate-900 sm:text-sm"
											>Rp {formatRupiah(menu.harga)}</span
										>
									</div>
									<div
										class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500"
									>
										<span
											class="rounded-lg bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200/60"
											>Bahan: Rp {formatRupiah(regRecipeCost)}</span
										>
										<span>+</span>
										<span class="rounded-lg bg-pink-50 px-2 py-0.5 text-pink-700"
											>Beban: Rp {formatRupiah(overhead)}</span
										>
										<span>=</span>
										<span class="font-bold text-slate-900">HPP: Rp {formatRupiah(regTotalHpp)}</span
										>
									</div>
								</div>

								<div class="shrink-0 sm:text-right">
									<div
										class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold sm:text-sm {regMargin >=
										0
											? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
											: 'border border-rose-200 bg-rose-50 text-rose-700'}"
									>
										{#if regMargin >= 0}
											<TrendingUp class="h-3.5 w-3.5 text-emerald-600" />
											<span>Untung Rp {formatRupiah(regMargin)} ({regMarginPct}%)</span>
										{:else}
											<TrendingDown class="h-3.5 w-3.5 text-rose-600" />
											<span>Rugi Rp {formatRupiah(Math.abs(regMargin))} ({regMarginPct}%)</span>
										{/if}
									</div>
								</div>
							</div>
						{/if}

						<!-- Section Porsi Jumbo (Jika Ada) -->
						{#if hasJumbo && (selectedPorsiView === 'all' || selectedPorsiView === 'jumbo')}
							<div
								class="flex flex-col justify-between gap-3 rounded-2xl border border-pink-100 bg-pink-50/30 p-3.5 sm:flex-row sm:items-center"
							>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2">
										<span
											class="flex items-center gap-1 text-xs font-bold text-pink-900 sm:text-sm"
										>
											<CupIcon class="h-4.5 w-4.5 text-pink-600" strokeWidth={2.2} />
											Jumbo
										</span>
										<span class="text-xs font-extrabold text-pink-700 sm:text-sm"
											>Rp {formatRupiah(jumboPrice)}</span
										>
									</div>
									<div
										class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500"
									>
										<span
											class="rounded-lg bg-white px-2 py-0.5 text-slate-700 ring-1 ring-slate-200/60"
											>Bahan: Rp {formatRupiah(jumboRecipeCost)}</span
										>
										<span>+</span>
										<span class="rounded-lg bg-pink-100 px-2 py-0.5 text-pink-800"
											>Beban: Rp {formatRupiah(overhead)}</span
										>
										<span>=</span>
										<span class="font-bold text-slate-900"
											>HPP: Rp {formatRupiah(jumboTotalHpp)}</span
										>
									</div>
								</div>

								<div class="shrink-0 sm:text-right">
									<div
										class="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold sm:text-sm {jumboMargin >=
										0
											? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
											: 'border border-rose-200 bg-rose-50 text-rose-700'}"
									>
										{#if jumboMargin >= 0}
											<TrendingUp class="h-3.5 w-3.5 text-emerald-600" />
											<span>Untung Rp {formatRupiah(jumboMargin)} ({jumboMarginPct}%)</span>
										{:else}
											<TrendingDown class="h-3.5 w-3.5 text-rose-600" />
											<span>Rugi Rp {formatRupiah(Math.abs(jumboMargin))} ({regMarginPct}%)</span>
										{/if}
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if filteredHppMenus.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center shadow-2xs"
				>
					<div
						class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-pink-50 text-slate-400 shadow-xs ring-1 ring-pink-100"
					>
						<Calculator class="h-7 w-7 text-pink-500" />
					</div>
					{#if searchHppKeyword.trim()}
						<div class="text-base font-bold text-slate-800">Menu Tidak Ditemukan</div>
						<div class="mt-1 text-xs text-slate-400 sm:text-sm">
							Tidak ada menu resep yang cocok dengan kata kunci "{searchHppKeyword}".
						</div>
					{:else}
						<div class="text-base font-bold text-slate-800">Belum Ada Menu dengan Resep Bahan</div>
						<div class="mt-1 max-w-sm text-xs text-slate-400 sm:text-sm">
							Aktifkan "Metode Pengurangan Resep Bahan" pada menu di tab Menu untuk melihat rincian
							modal dan estimasi keuntungan.
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Sub-tab 2: Biaya Operasional & Target Penjualan -->
	{:else if activeHppSubTab === 'operasional'}
		<div in:fade={{ duration: 120 }} class="grid gap-6 lg:grid-cols-12 lg:items-start">
			<!-- Left Form: Rincian Pos Biaya (span 7) -->
			<div class="flex flex-col gap-5 lg:col-span-7">
				<form
					class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6"
					onsubmit={saveHppSettings}
				>
					<div
						class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4"
					>
						<div>
							<h2 class="text-base font-black tracking-tight text-slate-900 sm:text-lg">
								Pengeluaran Operasional Kios
							</h2>
							<p class="mt-0.5 text-xs text-slate-500 sm:text-sm">
								Daftar pos biaya rutin bulanan kios (Sewa, Listrik, Air, Gaji, dll).
							</p>
						</div>
						<button
							type="button"
							class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-pink-300 bg-pink-50/60 px-3.5 py-2 text-xs font-bold text-pink-700 transition-all hover:border-pink-400 hover:bg-pink-100 active:scale-[0.98] sm:text-sm"
							onclick={addHppExpenseItem}
						>
							<Plus class="h-4 w-4" />
							<span>Tambah Pos</span>
						</button>
					</div>

					<!-- Dynamic Expenses List -->
					<div class="flex flex-col gap-3">
						{#each hppForm.rincian_biaya as item, idx (item.id)}
							<div
								class="group flex flex-col items-stretch gap-2.5 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3 transition-all hover:border-pink-200 hover:bg-white hover:shadow-2xs sm:flex-row sm:items-center sm:p-3.5"
							>
								<!-- Nama Pos Biaya Input -->
								<div class="min-w-0 flex-1">
									<input
										type="text"
										class="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-800 transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none sm:text-sm"
										placeholder="Nama biaya (mis: Sewa, Listrik...)"
										bind:value={item.nama}
									/>
								</div>

								<!-- Nominal & Tombol Hapus Row -->
								<div class="flex items-center gap-2">
									<div class="relative flex-1 sm:w-44">
										<span
											class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-bold text-slate-400 sm:text-sm"
											>Rp</span
										>
										<input
											type="text"
											class="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-9 text-right text-xs font-extrabold text-slate-900 transition-all placeholder:font-medium placeholder:text-slate-400 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none sm:text-sm"
											placeholder="0"
											bind:value={item.nominal}
											oninput={handleRupiahInput(item, 'nominal')}
										/>
									</div>

									<!-- Tombol Hapus Pos Biaya -->
									<button
										type="button"
										class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-400 shadow-2xs transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 active:scale-95"
										onclick={() => removeHppExpenseItem(item.id)}
										aria-label="Hapus pos biaya"
										title="Hapus pos biaya ini"
									>
										<Trash2 class="h-4 w-4" />
									</button>
								</div>
							</div>
						{/each}

						{#if hppForm.rincian_biaya.length === 0}
							<div
								class="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400 sm:text-sm"
							>
								Belum ada pos biaya operasional. Klik tombol "Tambah Pos" di atas.
							</div>
						{/if}

						<div
							class="mt-2 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-100/80 p-4"
						>
							<span class="text-xs font-bold text-slate-700 sm:text-sm"
								>Total Pos Biaya Bulanan</span
							>
							<span class="text-base font-black text-slate-900 sm:text-lg">
								Rp {formatRupiah(Math.round(liveTotalOverhead))}
							</span>
						</div>
					</div>
				</form>
			</div>

			<!-- Right Column: Target Penjualan & Simpan Settings (span 5) -->
			<div class="flex flex-col gap-5 lg:col-span-5">
				<form
					class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs sm:p-6"
					onsubmit={saveHppSettings}
				>
					<div class="mb-5 border-b border-slate-100 pb-4">
						<h2 class="text-base font-black tracking-tight text-slate-900 sm:text-lg">
							Target Penjualan & Alokasi
						</h2>
						<p class="mt-0.5 text-xs text-slate-500 sm:text-sm">
							Target porsi per bulan untuk membagi rata beban operasional kios.
						</p>
					</div>

					<div class="flex flex-col gap-4">
						<!-- Target Penjualan Input -->
						<div class="flex flex-col gap-2">
							<label
								for="hpp-target-item-bulanan"
								class="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-700 uppercase sm:text-sm"
							>
								<Target class="h-4 w-4 text-slate-400" />
								Target Penjualan (Porsi/Bulan)
							</label>
							<div class="relative">
								<input
									id="hpp-target-item-bulanan"
									class="w-full rounded-2xl border border-slate-200/90 bg-slate-50/60 px-4 py-3 text-base font-bold text-slate-900 transition-all hover:border-pink-300 focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
									type="text"
									placeholder="1.000"
									bind:value={hppForm.target_item_bulanan}
									oninput={handleRupiahInput(hppForm, 'target_item_bulanan')}
								/>
								<span
									class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs font-bold text-slate-400 sm:text-sm"
								>
									porsi
								</span>
							</div>
						</div>

						<!-- Simulasi Box Beban per Gelas -->
						<div class="rounded-2xl border border-pink-100 bg-pink-50/50 p-4">
							<div class="flex items-center justify-between">
								<span class="text-xs font-bold text-pink-900 sm:text-sm"
									>Alokasi Beban per Porsi</span
								>
								<span class="text-base font-black text-pink-600 sm:text-lg">
									Rp {formatRupiah(Math.round(liveOverheadPerItem))}
								</span>
							</div>
							<p class="mt-1.5 text-xs leading-relaxed text-pink-700/80">
								Didapat dari: Rp {formatRupiah(Math.round(liveTotalOverhead))} ÷ {formatRupiah(
									liveTargetPenjualan
								)} porsi.
							</p>
						</div>

						<!-- Info Box -->
						<div
							class="flex items-start gap-2.5 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs text-slate-500"
						>
							<Info class="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
							<p class="leading-relaxed">
								Beban per porsi ini otomatis ditambahkan ke seluruh kalkulasi HPP produk resep di
								tab Kalkulator HPP.
							</p>
						</div>

						<!-- Tombol Simpan -->
						<button
							type="submit"
							class="flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 py-3.5 text-sm font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98]"
						>
							<Save class="h-4 w-4" />
							<span>Simpan Pengaturan HPP</span>
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</div>
