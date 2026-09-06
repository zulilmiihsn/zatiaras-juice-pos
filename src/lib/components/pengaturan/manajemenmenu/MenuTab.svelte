<script lang="ts">
	import { fade } from 'svelte/transition';
	import Utensils from '@lucide/svelte/icons/utensils';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import List from '@lucide/svelte/icons/list';
	import Search from '@lucide/svelte/icons/search';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import type { Product, Category } from '$lib/types/product';

	let {
		searchKeyword = $bindable(),
		selectedKategori = $bindable(),
		isGridView = $bindable(),
		isLoadingKategori,
		isLoadingMenus,
		kategoriList,
		filteredMenus,
		openMenuForm,
		confirmDeleteMenu,
		handleImgError
	}: {
		searchKeyword: string;
		selectedKategori: string | number;
		isGridView: boolean;
		isLoadingKategori: boolean;
		isLoadingMenus: boolean;
		kategoriList: Category[];
		filteredMenus: Product[];
		openMenuForm: (menu?: Product | null) => void;
		confirmDeleteMenu: (id: string | number) => void;
		handleImgError: (menuId: string | number) => void;
	} = $props();
</script>

<div in:fade={{ duration: 150 }} class="flex min-h-0 flex-1 flex-col">
	<!-- Fixed Controls Section -->
	<div class="flex-shrink-0 bg-transparent">
		<!-- Search & View Toggle in One Row -->
		<div class="mx-auto max-w-5xl px-4 pb-2.5 md:px-6">
			<div class="flex items-center gap-2">
				<div class="relative flex-1">
					<Search class="absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						placeholder="Cari menu..."
						class="min-h-[44px] w-full rounded-full border border-slate-200/80 bg-white/95 py-2.5 pr-4 pl-11 text-sm text-slate-900 shadow-xs backdrop-blur-md transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 md:text-base"
						bind:value={searchKeyword}
					/>
				</div>
				<button
					type="button"
					class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-700 shadow-xs backdrop-blur-md transition-all duration-200 hover:bg-white hover:text-pink-600 active:scale-95"
					onclick={() => (isGridView = !isGridView)}
					aria-label={isGridView ? 'Tampilkan List' : 'Tampilkan Grid'}
				>
					{#if isGridView}
						<List class="h-5 w-5 stroke-[2.2]" />
					{:else}
						<LayoutGrid class="h-5 w-5 stroke-[2.2]" />
					{/if}
				</button>
			</div>
		</div>

		<!-- Category Filter Pills -->
		<div class="mx-auto flex max-w-5xl items-center gap-2.5 overflow-x-auto px-4 pb-3.5 md:px-6">
			{#if isLoadingKategori}
				{#each Array(4) as _, i (i)}
					<div
						class="h-[44px] min-w-[88px] flex-shrink-0 animate-pulse rounded-full bg-white/80"
					></div>
				{/each}
			{:else}
				<button
					type="button"
					class="min-h-[44px] min-w-[88px] shrink-0 cursor-pointer rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-200 active:scale-[0.98] md:text-base {selectedKategori ===
					'Semua'
						? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
					onclick={() => (selectedKategori = 'Semua')}
				>
					Semua
				</button>
				{#each kategoriList as kat (kat.id)}
					<button
						type="button"
						class="min-h-[44px] min-w-[96px] shrink-0 cursor-pointer rounded-full px-5 py-2.5 text-sm font-bold transition-all duration-200 active:scale-[0.98] md:text-base {selectedKategori ==
						kat.id
							? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
							: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
						onclick={() => (selectedKategori = kat.id)}
					>
						{kat.nama}
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Scrollable Menu Content -->
	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-5xl px-4 pb-24 md:px-6">
			{#if isLoadingMenus}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
					{#each Array(8) as _, i (i)}
						<div class="aspect-[3/4] animate-pulse rounded-2xl bg-zinc-100 p-4"></div>
					{/each}
				</div>
			{:else if filteredMenus.length === 0}
				<div
					class="pointer-events-none flex min-h-[40vh] flex-col items-center justify-center py-12 text-center"
				>
					<div
						class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400"
					>
						<Utensils class="h-6 w-6" />
					</div>
					<div class="text-sm font-semibold text-zinc-700 md:text-base">Belum ada Menu</div>
					<div class="mt-1 text-xs text-zinc-400 md:text-sm">
						Tekan tombol (+) di pojok kanan bawah untuk menambah menu.
					</div>
				</div>
			{:else if isGridView}
				<div
					class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4"
					transition:fade={{ duration: 120 }}
				>
					{#each filteredMenus as menu (menu.id)}
						<div
							class="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md active:scale-[0.98] md:p-4"
							role="button"
							tabindex="0"
							onclick={() => openMenuForm(menu)}
							onkeydown={(e) => e.key === 'Enter' && openMenuForm(menu)}
						>
							<!-- Delete Button -->
							<div class="absolute top-2 right-2 z-10">
								<button
									class="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-zinc-400 shadow-sm ring-1 ring-zinc-900/10 backdrop-blur-xs transition-colors hover:bg-red-50 hover:text-red-600 md:h-8 md:w-8"
									onclick={(e) => {
										e.stopPropagation();
										confirmDeleteMenu(menu.id);
									}}
									aria-label="Hapus Menu"
								>
									<Trash2 class="h-3.5 w-3.5 md:h-4 md:w-4" />
								</button>
							</div>

							<!-- Image Thumbnail -->
							<div
								class="mb-2.5 flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-pink-100/50 bg-pink-50/50"
							>
								{#if menu.gambar}
									<img
										src={menu.gambar}
										alt={menu.nama}
										class="h-full w-full object-cover transition-transform group-hover:scale-105"
										onerror={() => handleImgError(menu.id)}
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center text-pink-400">
										<CupIcon class="h-10 w-10 text-pink-400" strokeWidth={2} />
									</div>
								{/if}
							</div>

							<!-- Info -->
							<div class="min-w-0">
								<div class="truncate text-sm font-bold text-zinc-900 md:text-base">
									{menu.nama}
								</div>
								<div class="mt-0.5 truncate text-xs text-zinc-400 md:text-sm">
									{kategoriList.find((k) => k.id === menu.kategori_id)?.nama || 'Tanpa Kategori'}
								</div>
								<div class="mt-1.5 text-sm font-extrabold text-pink-600 md:text-base">
									Rp {formatRupiah(menu.harga)}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- List View -->
				<div class="flex flex-col gap-2" transition:fade={{ duration: 120 }}>
					{#each filteredMenus as menu (menu.id)}
						<div
							class="group flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-zinc-200/80 bg-white p-3.5 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md active:scale-[0.99] md:p-4"
							role="button"
							tabindex="0"
							onclick={() => openMenuForm(menu)}
							onkeydown={(e) => e.key === 'Enter' && openMenuForm(menu)}
						>
							<!-- Image -->
							<div
								class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-pink-100/50 bg-pink-50/50 md:h-16 md:w-16"
							>
								{#if menu.gambar}
									<img
										src={menu.gambar}
										alt={menu.nama}
										class="h-full w-full object-cover"
										onerror={() => handleImgError(menu.id)}
									/>
								{:else}
									<div class="flex h-full w-full items-center justify-center text-pink-400">
										<CupIcon class="h-7 w-7 text-pink-400 md:h-8 md:w-8" strokeWidth={2} />
									</div>
								{/if}
							</div>

							<!-- Details -->
							<div class="min-w-0 flex-1">
								<div class="truncate text-sm font-bold text-zinc-900 md:text-base">{menu.nama}</div>
								<div class="mt-0.5 truncate text-xs text-zinc-400 md:text-sm">
									{kategoriList.find((k) => k.id === menu.kategori_id)?.nama || 'Tanpa Kategori'}
								</div>
								<div class="mt-1 text-sm font-extrabold text-pink-600 md:text-base">
									Rp {formatRupiah(menu.harga)}
								</div>
							</div>

							<!-- Delete -->
							<button
								class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-50 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 md:h-9 md:w-9"
								onclick={(e) => {
									e.stopPropagation();
									confirmDeleteMenu(menu.id);
								}}
								aria-label="Hapus Menu"
							>
								<Trash2 class="h-4 w-4 md:h-4.5 md:w-4.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
