<script lang="ts">
	import { fade } from 'svelte/transition';
	import Wheat from 'lucide-svelte/icons/wheat';
	import Trash from 'lucide-svelte/icons/trash';
	import { formatRupiah } from '$lib/utils/currency';
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
</script>

<div in:fade={{ duration: 150 }} class="flex min-h-0 flex-1 flex-col">
	<div class="flex-shrink-0 bg-white px-4">
		<div class="relative mb-3 flex items-center">
			<svg
				class="absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-gray-400"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				viewBox="0 0 24 24"
				><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg
			>
			<input
				type="text"
				class="w-full rounded-lg border border-gray-300 bg-white py-2.5 pr-3 pl-10 text-base text-gray-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
				placeholder="Cari bahan..."
				bind:value={searchBahan}
			/>
		</div>
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-lg font-bold text-gray-800">Stok Bahan</h2>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="px-4 pb-6">
			{#if isLoadingBahan}
				<div class="flex min-h-[60dvh] flex-col gap-2">
					{#each Array(4) as _, i}
						<div
							class="flex animate-pulse items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-md"
						></div>
					{/each}
				</div>
			{:else if bahanList.length === 0}
				<div
					class="pointer-events-none flex min-h-[30vh] flex-col items-center justify-center py-12 text-center"
				>
					<Wheat class="mb-4 h-12 w-12 text-amber-300" />
					<div class="mb-1 text-base font-semibold text-gray-700">Belum ada Bahan</div>
					<div class="text-sm text-gray-400">Tambahkan buah, gula, susu, cup, dan bahan lain.</div>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each bahanList.filter((bahan) => bahan.nama
							.toLowerCase()
							.includes(searchBahan.trim().toLowerCase())) as bahan}
						<div
							class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm transition-all hover:bg-amber-100"
						>
							<div class="flex items-start justify-between gap-3">
								<button
									type="button"
									class="min-w-0 flex-1 text-left"
									onclick={() => openBahanForm(bahan)}
								>
									<span class="mb-0.5 block truncate text-base font-semibold text-amber-950"
										>{bahan.nama}</span
									>
									<span class="block text-xs text-amber-800">
										Stok {formatRupiah(bahan.stok_saat_ini || 0)}
										{bahan.satuan}
										{#if Number(bahan.ambang_stok || 0) > 0}
											/ minimum {formatRupiah(bahan.ambang_stok || 0)}
											{bahan.satuan}
										{/if}
									</span>
									<span class="block text-xs text-amber-700">
										HPP efektif Rp {formatRupiah(Math.round(Number(bahan.biaya_per_satuan || 0)))} per
										{bahan.satuan}
									</span>
									<span class="block text-xs text-amber-700">
										Yield siap pakai {Number(bahan.yield_persen || 100).toLocaleString('id-ID')}%
									</span>
									{#if Number(bahan.ambang_stok || 0) > 0 && Number(bahan.stok_saat_ini || 0) <= Number(bahan.ambang_stok || 0)}
										<span
											class="mt-1 inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
										>
											Stok rendah
										</span>
									{/if}
								</button>
								<div class="flex shrink-0 gap-2">
									<button
										type="button"
										class="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800"
										onclick={() => openMutasiBahanForm(bahan)}
									>
										Stok
									</button>
									<button
										class="rounded-full border border-red-200 bg-red-50 p-3 hover:bg-red-100"
										onclick={() => confirmDeleteBahan(bahan.id)}
										aria-label="Hapus Bahan"
									>
										<Trash class="h-5 w-5 text-red-600" />
									</button>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
