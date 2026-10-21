<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import LowStockAlertBanner from '$lib/components/shared/LowStockAlertBanner.svelte';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import ProductGrid from '$lib/components/pos/ProductGrid.svelte';
	import CustomItemModal from '$lib/components/pos/CustomItemModal.svelte';
	import CartPreview from '$lib/components/pos/CartPreview.svelte';
	import { posGridView } from '$lib/stores/posGridView.svelte';
	import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import Search from '@lucide/svelte/icons/search';
	import LayoutGrid from '@lucide/svelte/icons/layout-grid';
	import LayoutList from '@lucide/svelte/icons/layout-list';
	import { createPosPageState } from '$lib/stores/posPageState.svelte';

	import PosCartPanel from '$lib/components/pos/PosCartPanel.svelte';
	import PosCartSheet from '$lib/components/pos/PosCartSheet.svelte';
	import PosProductSheet from '$lib/components/pos/PosProductSheet.svelte';

	const s = createPosPageState();
	onMount(s.mount);
	onDestroy(s.destroy);
</script>

<!-- Satu kolom di HP; md+ katalog di kiri dan keranjang menempel di tepi kanan sebagai kolom samping -->
<div
	class="flex w-full max-w-full flex-col overflow-x-clip bg-[#faf7f8] md:flex-row md:items-start"
>
	<main
		aria-label="Kasir POS"
		class="page-content flex min-h-[calc(100dvh-64px)] w-full max-w-full min-w-0 flex-col overflow-x-clip pb-32 md:min-h-dvh md:flex-1 md:pb-12"
	>
		<!-- Sticky kasir: search + kategori tetap di atas saat katalog digulir -->
		<div class="sticky top-0 z-10 w-full bg-[#faf7f8]">
			<PageHeader variant="compact">
				<!-- Search Bar & View Mode Toggle (Glass Pills on the Wave) -->
				<div class="flex w-full items-center gap-2.5">
					<div class="relative flex-1">
						<span class="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">
							<Search class="h-4.5 w-4.5" />
						</span>
						<input
							class="w-full rounded-full border border-white/80 bg-white/95 py-2.5 pr-4 pl-11 text-sm text-slate-900 shadow-md backdrop-blur-md transition-all duration-200 outline-none placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 md:text-base"
							type="text"
							placeholder="Cari menu jus buah, topping..."
							bind:value={s.search}
							autocomplete="off"
							oninput={(e) => s.handleSearchInput((e.target as HTMLInputElement).value)}
						/>
					</div>

					<!-- Button Toggle Tampilan Grid / List -->
					<button
						type="button"
						aria-label={posGridView.value ? 'Ganti ke Tampilan List' : 'Ganti ke Tampilan Grid'}
						title={posGridView.value ? 'Ganti ke Tampilan List' : 'Ganti ke Tampilan Grid'}
						class="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/80 bg-white/95 text-slate-700 shadow-md backdrop-blur-md transition-all duration-200 hover:bg-white hover:text-pink-600 active:scale-95"
						onclick={() => posGridView.toggle()}
					>
						{#if posGridView.value}
							<LayoutGrid class="h-5 w-5 stroke-[2.2] text-pink-600" />
						{:else}
							<LayoutList class="h-5 w-5 stroke-[2.2] text-slate-700" />
						{/if}
					</button>
				</div>
			</PageHeader>

			<!-- Category Filter Pills -->
			<div class="flex gap-2.5 overflow-x-auto px-4 pt-4 pb-3 md:px-5">
				<button
					class="min-h-[44px] min-w-[88px] shrink-0 cursor-pointer rounded-full border px-5 py-2.5 text-sm font-bold transition-colors duration-150 {s.selectedCategory ===
					'all'
						? 'border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
						: 'border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
					type="button"
					onclick={s.handleSelectCategoryAll}>Semua</button
				>
				{#if (s.categories ?? []).length === 0 && s.pos.isLoadingProducts}
					{#each Array(4) as _, i}
						<div
							class="h-[44px] min-w-[96px] shrink-0 animate-pulse rounded-full bg-white/80"
						></div>
					{/each}
				{:else if (s.categories ?? []).length === 0}
					<!-- Button Custom Item di samping 'Semua' jika tidak ada kategori -->
					<button
						class="flex min-h-[44px] min-w-[48px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-4 py-2.5 text-white shadow-sm shadow-pink-500/15 transition-colors duration-150"
						type="button"
						aria-label="Tambah item custom"
						onclick={s.handleShowCustomItemModal}
					>
						<Plus class="h-5 w-5 stroke-[2.5]" />
					</button>
				{:else}
					{#each s.categories ?? [] as c (c.id)}
						<button
							class="min-h-[44px] min-w-[96px] shrink-0 cursor-pointer rounded-full border px-5 py-2.5 text-sm font-bold transition-colors duration-150 {s.selectedCategory ===
							String(c.id)
								? 'border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
								: 'border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
							type="button"
							onclick={() => s.handleSelectCategory(c.id)}>{c.nama}</button
						>
					{/each}
					<!-- Button Custom Item di paling kanan -->
					<button
						class="flex min-h-[44px] min-w-[105px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-500 to-rose-400 px-5 py-2.5 text-sm font-bold text-white shadow-sm shadow-pink-500/15 transition-colors duration-150"
						type="button"
						onclick={s.handleShowCustomItemModal}
					>
						<Plus class="h-4.5 w-4.5 stroke-[2.5]" />
						<span>Kustom</span>
					</button>
				{/if}
			</div>
		</div>

		<div class="flex min-w-0 flex-1 flex-col">
			<ProductGrid
				posGridView={posGridView.value}
				isLoadingProducts={s.pos.isLoadingProducts}
				skeletonCount={s.skeletonCount}
				filteredProducts={s.filteredProducts}
				categories={s.categories}
				ingredients={s.pos.bahanData}
				recipes={s.pos.resepData}
				imageError={s.imageError}
				loadError={s.pos.posLoadError}
				strictStockMode={s.strictStockMode}
				onSelectProduct={s.handleOpenAddOnModal}
				onImgError={s.handleImgErrorId}
				onRetry={s.pos.retryLoadPOSData}
			/>
		</div>
		<!-- Low Stock Alert Banner -->
		{#if !stockPolicyState.ignored}
			<LowStockAlertBanner lowStockItems={s.lowStockIngredients} />
		{/if}
		<CustomItemModal bind:show={s.showCustomItemModal} onAdd={s.addCustomItemToCart} />

		<PosCartSheet {s} />

		<ToastNotification
			bind:show={s.showToast}
			message={s.toastMessage}
			type={s.toastType}
			position="top"
		/>

		<PosProductSheet {s} />
	</main>

	<PosCartPanel {s} />

	<CartPreview
		cart={s.cart.items}
		totalItems={s.totalItems}
		totalHarga={s.totalHarga}
		onOpenCart={s.openCartModal}
		onClearCart={s.clearCart}
	/>
</div>

<style>
	.animate-pulse {
		animation: pulse 1.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
