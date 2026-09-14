<script lang="ts">
	import { fade } from 'svelte/transition';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Search from '@lucide/svelte/icons/search';
	import type { Product, Category } from '$lib/types/product';

	let {
		searchKategoriKeyword = $bindable(),
		isLoadingKategori,
		kategoriList,
		menus,
		openKategoriForm,
		confirmDeleteKategori
	}: {
		searchKategoriKeyword: string;
		isLoadingKategori: boolean;
		kategoriList: Category[];
		menus: Product[];
		openKategoriForm: (kat: Category | null) => void;
		confirmDeleteKategori: (id: string | number) => void;
	} = $props();
</script>

<div in:fade={{ duration: 150 }} class="flex min-h-0 flex-1 flex-col">
	<!-- Fixed Header Section -->
	<div class="flex-shrink-0 bg-transparent">
		<!-- Search Bar -->
		<div class="mx-auto max-w-5xl px-4 pb-2.5 md:px-6">
			<div class="relative flex items-center">
				<span
					class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400"
				>
					<Search class="h-4.5 w-4.5" />
				</span>
				<input
					type="text"
					class="min-h-[44px] w-full rounded-full border border-slate-200/80 bg-white/95 py-2.5 pr-4 pl-10 text-sm text-slate-900 shadow-xs backdrop-blur-md transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 md:text-base"
					placeholder="Cari kategori..."
					bind:value={searchKategoriKeyword}
				/>
			</div>
		</div>
	</div>

	<!-- Scrollable Kategori List -->
	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto max-w-5xl px-4 pb-24 md:px-6">
			{#if isLoadingKategori}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-3.5 lg:grid-cols-3">
					{#each Array(6) as _}
						<div class="h-20 animate-pulse rounded-2xl bg-zinc-100"></div>
					{/each}
				</div>
			{:else if kategoriList.length === 0}
				<div
					class="pointer-events-none flex min-h-[40vh] flex-col items-center justify-center py-12 text-center"
				>
					<div
						class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-pink-50 text-pink-600 ring-1 ring-pink-100"
					>
						<FolderOpen class="h-6 w-6" />
					</div>
					<div class="text-sm font-bold text-zinc-800 md:text-base">Belum ada Kategori</div>
					<div class="mt-1 text-xs text-zinc-400 md:text-sm">
						Gunakan tombol Tambah Kategori untuk menambahkan kategori menu.
					</div>
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-3.5 lg:grid-cols-3">
					{#each kategoriList.filter((kat) => kat.nama
							.toLowerCase()
							.includes(searchKategoriKeyword.trim().toLowerCase())) as kat}
						<div
							class="group relative flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs transition-all hover:border-pink-200 hover:shadow-md active:scale-[0.99]"
							role="button"
							tabindex="0"
							onclick={() => openKategoriForm(kat)}
							onkeydown={(e) => e.key === 'Enter' && openKategoriForm(kat)}
						>
							<div class="flex min-w-0 flex-1 items-center gap-3">
								<div
									class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink-50 text-pink-600 ring-1 ring-pink-100 transition-transform group-hover:scale-105"
								>
									<FolderOpen class="h-5 w-5 stroke-[2]" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate text-sm font-bold text-slate-900 md:text-base">
										{kat.nama}
									</div>
									<div class="mt-0.5 truncate text-xs font-medium text-slate-400">
										{menus.filter((m) => m.kategori_id === kat.id).length} menu terdaftar
									</div>
								</div>
							</div>
							<button
								class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200/60 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 active:scale-90"
								onclick={(e) => {
									e.stopPropagation();
									confirmDeleteKategori(kat.id);
								}}
								aria-label="Hapus Kategori"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
