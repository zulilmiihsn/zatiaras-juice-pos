<script lang="ts">
	import { fly } from 'svelte/transition';
	import X from '@lucide/svelte/icons/x';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import type { Product, Category } from '$lib/types/product';

	// KENAPA: form tambah/edit kategori adalah unit mandiri (satu state + satu
	// submit); keluar dari halaman 1800+ baris agar diff halaman kecil dan
	// contracted via props seperti Tab bersaudara.
	let {
		open,
		kategoriDetail,
		kategoriDetailName = $bindable(),
		menus,
		selectedMenuIds,
		unselectedMenuIds,
		toggleMenuInKategoriRealtime,
		saveKategoriDetail,
		closeKategoriDetailModal
	}: {
		open: boolean;
		kategoriDetail: Category | null;
		kategoriDetailName: string;
		menus: Product[];
		selectedMenuIds: Array<string | number>;
		unselectedMenuIds: Array<string | number>;
		toggleMenuInKategoriRealtime: (id: string | number) => void;
		saveKategoriDetail: () => void;
		closeKategoriDetailModal: () => void;
	} = $props();
</script>

<AppModal
	{open}
	label={kategoriDetail ? 'Edit Kategori' : 'Tambah Kategori'}
	size="md"
	align="center"
	panelClass="bg-white"
	onClose={closeKategoriDetailModal}
>
	<!-- Header -->
	<div
		class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
	>
		<div>
			<h2 class="text-lg font-black tracking-tight text-slate-900">
				{kategoriDetail ? 'Edit Kategori' : 'Tambah Kategori'}
			</h2>
			<p class="text-xs font-medium text-slate-500">Kelompokkan menu agar rapi di kasir</p>
		</div>
		<button
			type="button"
			class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-all hover:bg-pink-100 hover:text-pink-700 active:scale-90"
			onclick={closeKategoriDetailModal}
			aria-label="Tutup modal"
		>
			<X class="h-4 w-4" />
		</button>
	</div>

	<!-- Content -->
	<div class="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
		<form
			id="kategori-form"
			class="flex flex-col gap-5"
			onsubmit={(e) => {
				e.preventDefault();
				saveKategoriDetail();
			}}
			autocomplete="off"
		>
			<!-- Nama Kategori -->
			<div class="flex flex-col gap-1.5">
				<label for="kategori-name" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Nama Kategori</label
				>
				<input
					type="text"
					id="kategori-name"
					class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={kategoriDetailName}
					required
					placeholder="Masukkan nama kategori (contoh: Minuman)"
				/>
			</div>

			<!-- Menu dalam Kategori -->
			<div class="flex flex-col gap-1.5">
				<label
					for="menu-dalam-kategori"
					class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Menu dalam Kategori</label
				>
				<div
					class="flex min-h-[44px] flex-wrap gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
				>
					{#if selectedMenuIds.length > 0}
						{#each menus.filter((menu) => selectedMenuIds.includes(menu.id)) as menu (menu.id)}
							<button
								type="button"
								class="inline-flex max-w-[220px] cursor-pointer items-center truncate rounded-full bg-pink-100/90 px-3.5 py-1.5 text-xs font-bold text-pink-700 shadow-2xs transition-all hover:-translate-y-0.5 hover:bg-pink-200 hover:shadow-xs active:scale-95"
								title={menu.nama}
								onclick={() => toggleMenuInKategoriRealtime(menu.id)}
								in:fly={{ y: 16, duration: 180 }}
								out:fly={{ y: 16, duration: 180 }}
							>
								{menu.nama}
							</button>
						{/each}
					{:else}
						<span class="text-xs text-slate-400 italic">Belum ada menu dalam kategori ini</span>
					{/if}
				</div>
			</div>

			<!-- Menu non Kategori -->
			<div class="flex flex-col gap-1.5">
				<label
					for="menu-non-kategori"
					class="text-xs font-bold tracking-wider text-slate-700 uppercase">Menu non Kategori</label
				>
				<div
					class="flex min-h-[44px] flex-wrap gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
				>
					{#if unselectedMenuIds.length > 0}
						{#each menus.filter((menu) => unselectedMenuIds.includes(menu.id)) as menu (menu.id)}
							<button
								type="button"
								class="inline-flex max-w-[220px] cursor-pointer items-center truncate rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-pink-300 hover:bg-pink-50/50 hover:text-pink-600 active:scale-95"
								title={menu.nama}
								onclick={() => toggleMenuInKategoriRealtime(menu.id)}
								in:fly={{ y: 16, duration: 180 }}
								out:fly={{ y: 16, duration: 180 }}
							>
								{menu.nama}
							</button>
						{/each}
					{:else}
						<span class="text-xs text-slate-400 italic">Semua menu sudah masuk kategori</span>
					{/if}
				</div>
			</div>
		</form>
	</div>

	<!-- Fixed Action Buttons -->
	<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-5">
		<button
			type="submit"
			form="kategori-form"
			class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
		>
			{kategoriDetail ? 'Update Kategori' : 'Simpan Kategori'}
		</button>
		<button
			type="button"
			class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
			onclick={closeKategoriDetailModal}
		>
			Batal
		</button>
	</div>
</AppModal>
