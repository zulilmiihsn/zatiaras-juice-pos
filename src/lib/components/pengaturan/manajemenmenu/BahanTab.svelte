<script lang="ts">
	import { fade } from 'svelte/transition';
	import Wheat from '@lucide/svelte/icons/wheat';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
	import { formatRupiah } from '$lib/utils/currency';
	import { formatSmartStock } from '$lib/utils/unitConversion';
	import type { Ingredient } from '$lib/types/product';

	let {
		searchBahan = $bindable(),
		isLoadingBahan,
		bahanList,
		openBahanForm,
		openMutasiBahanForm,
		confirmDeleteBahan
	}: {
		searchBahan: string;
		isLoadingBahan: boolean;
		bahanList: Ingredient[];
		openBahanForm: (bahan?: Ingredient | null) => void;
		openMutasiBahanForm: (bahan: Ingredient) => void;
		confirmDeleteBahan: (id: string | number) => void;
	} = $props();

	let selectedBahanCategory = $state('all');

	const defaultCategories = ['Bahan Baku', 'Buah Segar', 'Kemasan', 'Topping', 'Sirup & Susu'];

	const availableCategories = $derived.by(() => {
		const set = new Set<string>();
		for (const b of bahanList) {
			const cat = (b.kategori || 'Bahan Baku').trim();
			if (cat) set.add(cat);
		}
		// If empty or small, merge with defaults that have items
		for (const d of defaultCategories) {
			if (bahanList.some((b) => (b.kategori || '').toLowerCase() === d.toLowerCase())) {
				set.add(d);
			}
		}
		return Array.from(set);
	});

	function getCategoryCount(cat: string): number {
		if (cat === 'all') return bahanList.length;
		if (cat === 'low_stock') {
			return bahanList.filter(
				(b) =>
					Number(b.ambang_stok || 0) > 0 &&
					Number(b.stok_saat_ini || 0) <= Number(b.ambang_stok || 0)
			).length;
		}
		return bahanList.filter(
			(b) => (b.kategori || 'Bahan Baku').trim().toLowerCase() === cat.toLowerCase()
		).length;
	}

	const lowStockCount = $derived(getCategoryCount('low_stock'));

	const filteredBahan = $derived(
		bahanList.filter((bahan) => {
			const matchSearch =
				searchBahan.trim() === '' ||
				bahan.nama.toLowerCase().includes(searchBahan.trim().toLowerCase());
			if (!matchSearch) return false;

			if (selectedBahanCategory === 'all') return true;
			if (selectedBahanCategory === 'low_stock') {
				return (
					Number(bahan.ambang_stok || 0) > 0 &&
					Number(bahan.stok_saat_ini || 0) <= Number(bahan.ambang_stok || 0)
				);
			}
			return (
				(bahan.kategori || 'Bahan Baku').trim().toLowerCase() ===
				selectedBahanCategory.toLowerCase()
			);
		})
	);
</script>

<div in:fade={{ duration: 150 }} class="flex min-h-0 flex-1 flex-col">
	<!-- Fixed Header Section -->
	<div class="flex-shrink-0 bg-transparent px-4 pb-2.5 md:px-6">
		<div class="mx-auto flex max-w-5xl flex-col gap-3">
			<!-- Search Bar -->
			<div class="relative flex items-center">
				<span
					class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400"
				>
					<Search class="h-4.5 w-4.5" />
				</span>
				<input
					type="text"
					class="min-h-[44px] w-full rounded-full border border-slate-200/80 bg-white/95 py-2.5 pr-4 pl-10 text-sm text-slate-900 shadow-xs backdrop-blur-md transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 md:text-base"
					placeholder="Cari bahan baku, buah, kemasan..."
					bind:value={searchBahan}
				/>
			</div>

			<!-- Category Filter Chips -->
			<div class="scrollbar-hide -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1">
				<button
					type="button"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {selectedBahanCategory ===
					'all'
						? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200 hover:text-pink-600'}"
					onclick={() => (selectedBahanCategory = 'all')}
				>
					<span>Semua Bahan</span>
					<span
						class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold md:text-xs {selectedBahanCategory ===
						'all'
							? 'bg-white/25 text-white'
							: 'bg-slate-100 text-slate-600'}"
					>
						{bahanList.length}
					</span>
				</button>

				{#if lowStockCount > 0}
					<button
						type="button"
						class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {selectedBahanCategory ===
						'low_stock'
							? 'border border-rose-300 bg-rose-500 text-white shadow-xs shadow-rose-500/20'
							: 'border border-rose-200 bg-rose-50/80 text-rose-700 hover:bg-rose-100'}"
						onclick={() => (selectedBahanCategory = 'low_stock')}
					>
						<AlertTriangle class="h-3.5 w-3.5" />
						<span>Stok Menipis</span>
						<span
							class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold md:text-xs {selectedBahanCategory ===
							'low_stock'
								? 'bg-white/25 text-white'
								: 'bg-rose-200/70 text-rose-800'}"
						>
							{lowStockCount}
						</span>
					</button>
				{/if}

				{#each availableCategories as cat}
					{@const count = getCategoryCount(cat)}
					{#if count > 0}
						<button
							type="button"
							class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 md:px-5 md:py-2.5 md:text-sm {selectedBahanCategory ===
							cat
								? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20'
								: 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200 hover:text-pink-600'}"
							onclick={() => (selectedBahanCategory = cat)}
						>
							<span>{cat}</span>
							<span
								class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold md:text-xs {selectedBahanCategory ===
								cat
									? 'bg-white/25 text-white'
									: 'bg-slate-100 text-slate-600'}"
							>
								{count}
							</span>
						</button>
					{/if}
				{/each}
			</div>
		</div>
	</div>

	<!-- Scrollable Bahan List -->
	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-5xl px-4 pb-24 md:px-6">
			{#if isLoadingBahan}
				<div class="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-3">
					{#each Array(4) as _}
						<div class="h-24 animate-pulse rounded-2xl bg-slate-100"></div>
					{/each}
				</div>
			{:else if filteredBahan.length === 0}
				<div class="flex min-h-[40vh] flex-col items-center justify-center py-12 text-center">
					<div
						class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-pink-500 shadow-xs ring-1 ring-slate-200/60"
					>
						<Wheat class="h-6 w-6" />
					</div>
					{#if searchBahan.trim() || selectedBahanCategory !== 'all'}
						<div class="text-sm font-bold text-slate-800 md:text-base">Bahan Tidak Ditemukan</div>
						<div class="mt-1 text-xs text-slate-400 md:text-sm">
							Tidak ada bahan yang cocok dengan filter atau kata kunci pencarian.
						</div>
					{:else}
						<div class="text-sm font-bold text-slate-800 md:text-base">
							Belum Ada Master Bahan Baku
						</div>
						<div class="mt-1 text-xs text-slate-400 md:text-sm">
							Tekan tombol (+) di pojok kanan bawah untuk menambah buah, gula, susu, cup, dll.
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-3">
					{#each filteredBahan as bahan}
						{@const isLow =
							Number(bahan.ambang_stok || 0) > 0 &&
							Number(bahan.stok_saat_ini || 0) <= Number(bahan.ambang_stok || 0)}
						{@const yieldPct = Number(bahan.yield_persen ?? 100)}

						<div
							class="group flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-pink-200 hover:shadow-md active:scale-[0.99] md:p-4.5"
							role="button"
							tabindex="0"
							onclick={() => openBahanForm(bahan)}
							onkeydown={(e) => e.key === 'Enter' && openBahanForm(bahan)}
						>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<div class="truncate text-sm font-black text-slate-900 md:text-base">
										{bahan.nama}
									</div>
									<span
										class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600 md:text-xs"
									>
										{bahan.kategori || 'Bahan Baku'}
									</span>
									{#if yieldPct < 100}
										<span
											class="rounded-full border border-pink-100 bg-pink-50 px-2 py-0.5 text-[10px] font-extrabold text-pink-700 md:text-xs"
										>
											Bersih {yieldPct}%
										</span>
									{/if}
								</div>

								<div
									class="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 md:text-sm"
								>
									<span class="font-bold text-slate-800">
										Stok: {formatSmartStock(bahan.stok_saat_ini, bahan.satuan)}
									</span>
									{#if Number(bahan.ambang_stok || 0) > 0}
										<span class="text-slate-300">•</span>
										<span class="text-slate-400">
											Batas Min. {formatSmartStock(bahan.ambang_stok || 0, bahan.satuan)}
										</span>
									{/if}
								</div>

								<div class="mt-1 text-xs font-semibold text-slate-700 md:text-sm">
									Modal Bersih: <span class="font-bold text-pink-600"
										>Rp {formatRupiah(Math.round(Number(bahan.biaya_per_satuan || 0)))}</span
									>
									/ {bahan.satuan}
								</div>

								{#if isLow}
									<div class="mt-2">
										<span
											class="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 md:text-xs"
										>
											<AlertTriangle class="h-3 w-3" />
											Stok Menipis
										</span>
									</div>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-2">
								<button
									type="button"
									class="flex cursor-pointer items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:bg-pink-50 hover:text-pink-700 hover:ring-1 hover:ring-pink-200 active:scale-95 md:px-3.5 md:py-2 md:text-sm"
									onclick={(e) => {
										e.stopPropagation();
										openMutasiBahanForm(bahan);
									}}
									aria-label="Ubah Stok Bahan"
								>
									<ArrowUpDown class="h-3.5 w-3.5 md:h-4 md:w-4" />
									<span>Ubah Stok</span>
								</button>
								<button
									type="button"
									class="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600 hover:ring-1 hover:ring-rose-200 active:scale-95 md:h-9 md:w-9"
									onclick={(e) => {
										e.stopPropagation();
										confirmDeleteBahan(bahan.id);
									}}
									aria-label="Hapus Bahan Baku"
								>
									<Trash2 class="h-4 w-4 md:h-4.5 md:w-4.5" />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
