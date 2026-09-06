<script lang="ts">
	import { slide } from 'svelte/transition';
	import PackageOpen from '@lucide/svelte/icons/package-open';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import { getProductStockAvailability } from '$lib/services/stockAlertService';
	import type { PosCategory, PosProduct } from '$lib/stores/posState.svelte';
	import type { Ingredient } from '$lib/types/product';
	import type { PosRecipeItem } from '$lib/types/posCatalog';

	let {
		posGridView,
		isLoadingProducts,
		skeletonCount = 6,
		filteredProducts = [],
		categories = [],
		ingredients = [],
		recipes = [],
		imageError = {},
		loadError = '',
		strictStockMode = false,
		onSelectProduct,
		onImgError,
		onRetry
	} = $props<{
		posGridView: boolean;
		isLoadingProducts: boolean;
		skeletonCount?: number;
		filteredProducts: PosProduct[];
		categories: PosCategory[];
		ingredients?: Ingredient[];
		recipes?: PosRecipeItem[];
		imageError: Record<string, boolean>;
		loadError?: string;
		strictStockMode?: boolean;
		onSelectProduct: (product: PosProduct) => void;
		onImgError: (id: string | number) => void;
		onRetry?: () => void;
	}>();

	function getKategoriNameById(id: string | number): string {
		const kat = categories.find((c: PosCategory) => String(c.id) === String(id));
		return kat ? kat.nama : '';
	}
</script>

<div class="w-full flex-1">
	{#if !posGridView}
		<!-- List View -->
		<div
			class="flex flex-col gap-2.5 px-4 pb-4 md:px-2 md:pb-6"
			transition:slide={{ duration: 250 }}
		>
			{#if isLoadingProducts}
				{#each Array(skeletonCount) as _, i}
					<div
						class="flex h-20 w-full animate-pulse items-center justify-between rounded-2xl bg-white/70 p-3.5 shadow-xs"
					></div>
				{/each}
			{:else if loadError}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border border-red-100 bg-red-50 p-6 text-center"
				>
					<RefreshCw class="mb-2 h-7 w-7 text-red-500" />
					<div class="text-sm font-bold text-slate-800">Gagal memuat produk</div>
					<div class="mt-1 mb-3 text-xs text-slate-500">{loadError}</div>
					<button
						type="button"
						class="cursor-pointer rounded-full bg-pink-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs"
						onclick={() => onRetry?.()}>Coba lagi</button
					>
				</div>
			{:else if filteredProducts.length === 0}
				<div
					class="pointer-events-none flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center"
				>
					<PackageOpen class="mb-3 h-10 w-10 text-slate-400" />
					<div class="mb-1 text-base font-bold text-slate-800">Menu belum tersedia</div>
					<div class="text-xs text-slate-500">Tambah menu atau ubah filter kategori.</div>
				</div>
			{:else}
				{#each filteredProducts as p (p.id)}
					{@const availability = getProductStockAvailability(p, 'reguler', ingredients, recipes)}
					{@const isOut = strictStockMode && availability.isOutOfStock}
					<button
						type="button"
						class="group flex w-full items-center justify-between rounded-2xl border border-pink-100/70 bg-white/95 p-3 text-left shadow-[0_2px_12px_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-200 hover:border-pink-300 hover:shadow-md active:scale-[0.98] {isOut
							? 'bg-slate-100/70 opacity-60'
							: 'cursor-pointer'}"
						onclick={() => onSelectProduct(p)}
						aria-label="Pilih {p.nama}"
					>
						<div class="flex min-w-0 flex-1 items-center gap-3">
							<!-- Product Thumbnail -->
							<div
								class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-pink-100/80 bg-gradient-to-br from-pink-50 via-rose-50/50 to-pink-100/60 {isOut
									? 'grayscale'
									: ''}"
							>
								{#if p.gambar && !imageError[String(p.id)]}
									<img
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
										src={p.gambar}
										alt={p.nama}
										loading="lazy"
										onerror={() => onImgError(p.id)}
									/>
								{:else}
									<CupIcon class="h-7 w-7 text-pink-500" strokeWidth={2.2} />
								{/if}
							</div>

							<!-- Title & Category -->
							<div class="min-w-0 flex-1">
								<span
									class="inline-flex w-fit items-center rounded-md bg-pink-50/90 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-pink-600 uppercase ring-1 ring-pink-200/50"
								>
									{getKategoriNameById(p.kategori_id || '') || 'Menu'}
								</span>
								<div class="mt-0.5 flex items-center gap-2">
									<h3
										class="truncate text-sm font-extrabold sm:text-base {isOut
											? 'text-slate-500 line-through'
											: 'text-slate-900 transition-colors group-hover:text-pink-600'}"
									>
										{p.nama}
									</h3>
									{#if isOut}
										<span
											class="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-700"
											>Habis</span
										>
									{/if}
								</div>
							</div>
						</div>

						<!-- Price Tag & Action -->
						<div class="flex items-center pl-3">
							<span
								class="text-sm font-black whitespace-nowrap sm:text-base {isOut
									? 'text-slate-400'
									: 'text-pink-600'}"
							>
								Rp {formatRupiah(p.harga ?? 0)}
							</span>
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		<!-- Grid View: Responsive Grid POS Tiles -->
		<div
			class="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 sm:gap-4 md:grid-cols-3 md:gap-4 md:px-2 md:pb-6 lg:grid-cols-3"
			transition:slide={{ duration: 250 }}
		>
			{#if isLoadingProducts}
				{#each Array(skeletonCount) as _, i}
					<div
						class="flex aspect-[4/5] animate-pulse flex-col items-center justify-between rounded-3xl bg-white/70 p-3.5 shadow-xs"
					></div>
				{/each}
			{:else if loadError}
				<div
					class="col-span-2 flex flex-col items-center justify-center rounded-3xl border border-red-100 bg-red-50 px-5 py-8 text-center sm:col-span-3"
				>
					<RefreshCw class="mb-3 h-8 w-8 text-red-500" />
					<div class="mb-1 text-base font-bold text-slate-900">Produk gagal dimuat</div>
					<div class="mb-4 max-w-xs text-xs text-slate-500">{loadError}</div>
					<button
						type="button"
						class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-5 py-2 text-xs font-bold text-white shadow-md transition-transform duration-200 active:scale-[0.98]"
						onclick={() => onRetry?.()}>Coba lagi</button
					>
				</div>
			{:else if filteredProducts.length === 0}
				<div
					class="pointer-events-none col-span-2 flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/60 p-8 text-center sm:col-span-3"
				>
					<PackageOpen class="mb-3 h-10 w-10 text-slate-400" />
					<div class="mb-1 text-base font-bold text-slate-800">Menu belum tersedia</div>
					<div class="text-xs text-slate-500">Tambah menu atau ubah filter kategori.</div>
				</div>
			{:else}
				{#each filteredProducts as p (p.id)}
					{@const availability = getProductStockAvailability(p, 'reguler', ingredients, recipes)}
					{@const isOut = strictStockMode && availability.isOutOfStock}
					<button
						type="button"
						class="group relative flex flex-col justify-between overflow-hidden rounded-[24px] border border-pink-100/80 bg-white p-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-1 hover:border-pink-300 hover:shadow-[0_12px_28px_-6px_rgba(219,39,119,0.15)] active:scale-[0.97] sm:p-3.5 {isOut
							? 'bg-slate-100/70 opacity-60'
							: 'cursor-pointer'}"
						onclick={() => onSelectProduct(p)}
						aria-label="Pilih {p.nama}"
					>
						<!-- Product Thumbnail Box -->
						<div
							class="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[18px] border border-pink-100/70 bg-gradient-to-br from-pink-50/90 via-rose-50/50 to-pink-100/60 {isOut
								? 'grayscale'
								: ''}"
						>
							<!-- Status Tag Top Right -->
							{#if isOut}
								<span
									class="absolute top-2.5 right-2.5 z-10 rounded-lg bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white shadow-xs"
								>
									Habis
								</span>
							{/if}

							{#if p.gambar && !imageError[String(p.id)]}
								<img
									class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									src={p.gambar}
									alt={p.nama}
									loading="lazy"
									onerror={() => onImgError(p.id)}
								/>
							{:else}
								<!-- Refined Icon Orb Backdrop -->
								<div
									class="flex h-14 w-14 items-center justify-center rounded-full border border-pink-100/90 bg-white/85 shadow-xs transition-transform duration-300 group-hover:scale-105 sm:h-16 sm:w-16"
								>
									<CupIcon class="h-8 w-8 text-pink-500 sm:h-9 sm:w-9" strokeWidth={2.2} />
								</div>
							{/if}
						</div>

						<!-- Product Title & Category -->
						<div class="mt-2.5 flex w-full flex-col">
							<span
								class="inline-flex w-fit items-center rounded-md bg-pink-50/90 px-1.5 py-0.5 text-[9px] font-black tracking-wider text-pink-600 uppercase ring-1 ring-pink-200/50"
							>
								{getKategoriNameById(p.kategori_id || '') || 'Menu'}
							</span>
							<h3
								class="mt-1 w-full truncate text-sm font-black tracking-tight text-slate-800 transition-colors group-hover:text-pink-600 sm:text-base {isOut
									? 'text-slate-400 line-through'
									: ''}"
							>
								{p.nama}
							</h3>
						</div>

						<!-- Price Row -->
						<div class="mt-2 flex w-full items-center">
							<span
								class="text-sm font-black tracking-tight sm:text-base {isOut
									? 'text-slate-400'
									: 'text-pink-600'}"
							>
								Rp {formatRupiah(p.harga ?? 0)}
							</span>
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
