<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onDestroy, onMount } from 'svelte';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import Boxes from '@lucide/svelte/icons/boxes';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Edit3 from '@lucide/svelte/icons/edit-3';
	import Search from '@lucide/svelte/icons/search';
	import { formatRupiah } from '$lib/utils/currency';
	import LowStockAlertBanner from '$lib/components/shared/LowStockAlertBanner.svelte';
	import { formatSmartStock } from '$lib/utils/unitConversion';
	import { getStockHealth } from '$lib/utils/stockHealth';
	import { createStokState } from '$lib/stores/stokState.svelte';
	import BahanDialog from '$lib/components/stok/BahanDialog.svelte';
	import MutasiDialog from '$lib/components/stok/MutasiDialog.svelte';
	import HapusBahanDialog from '$lib/components/stok/HapusBahanDialog.svelte';

	const s = createStokState();
	onMount(s.mount);
	onDestroy(s.destroy);
</script>

<div class="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<PageHeader
		title="Stok & Bahan Baku"
		subtitle="Pantau ketersediaan buah, gula, susu, dan perlengkapan"
	>
		<!-- Search Bar (Rounded-Full Glass Pill on the Wave) -->
		<div class="relative z-10 mx-auto w-full max-w-sm md:max-w-md">
			<div
				class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400"
			>
				<Search class="h-4 w-4" />
			</div>
			<input
				type="text"
				bind:value={s.searchKeyword}
				placeholder="Cari buah, gula, susu, cup..."
				class="w-full rounded-full border border-white/80 bg-white/95 py-2.5 pr-4 pl-10 text-sm text-slate-900 shadow-md backdrop-blur-md transition-all placeholder:text-slate-400 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 focus:outline-none md:text-base"
			/>
		</div>
	</PageHeader>

	<!-- Main Content Area -->
	<main
		aria-label="Halaman stok dan inventaris"
		class="page-content relative z-20 -mt-6 min-h-0 w-full max-w-full flex-1 overflow-x-hidden px-4 pb-24 md:pb-28"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col pb-8 md:pb-12">
			<LowStockAlertBanner
				lowStockItems={s.lowStockItems}
				onFilterClick={() => (s.selectedCategory = 'low_stock')}
				isSticky={true}
			/>

			<!-- Summary Cards (Glassmorphic Cards) -->
			<div class="mb-4 grid grid-cols-2 gap-3">
				<div
					class="glass-card flex flex-col justify-between rounded-[24px] bg-white/90 p-4 shadow-lg backdrop-blur-sm"
				>
					<div class="mb-1 flex items-center justify-between text-slate-400">
						<span class="text-[11px] font-bold tracking-wider text-pink-700 uppercase"
							>Total Bahan</span
						>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-2xl bg-pink-100/80 text-pink-700"
						>
							<Boxes class="h-4 w-4 stroke-[2.2]" />
						</div>
					</div>
					<div class="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
						{s.bahanList.length}
					</div>
					<span class="text-xs font-medium text-slate-500">item terdaftar</span>
				</div>

				<div
					class="glass-card flex flex-col justify-between rounded-[24px] bg-white/90 p-4 shadow-lg backdrop-blur-sm"
				>
					<div class="mb-1 flex items-center justify-between">
						<span
							class="text-[11px] font-extrabold tracking-wider uppercase {s.lowStockItems.length > 0
								? 'text-rose-700'
								: 'text-emerald-700'}"
						>
							Stok Menipis
						</span>
						<div
							class="flex h-8 w-8 items-center justify-center rounded-2xl {s.lowStockItems.length >
							0
								? 'bg-rose-100 text-rose-600'
								: 'bg-emerald-100 text-emerald-600'}"
						>
							<AlertTriangle class="h-4 w-4 stroke-[2.2]" />
						</div>
					</div>
					<div
						class="text-2xl font-black tracking-tight sm:text-3xl {s.lowStockItems.length > 0
							? 'text-rose-600'
							: 'text-slate-900'}"
					>
						{s.lowStockItems.length}
					</div>
					<span
						class="text-xs {s.lowStockItems.length > 0
							? 'font-semibold text-rose-600'
							: 'font-medium text-emerald-600'}"
					>
						{s.lowStockItems.length > 0 ? 'Perlu belanja segera!' : 'Semua stok aman'}
					</span>
				</div>
			</div>

			<!-- Category Filter Pills Bar (Scrollable) -->
			<div class="no-scrollbar -mx-4 mb-3.5 flex items-center gap-2 overflow-x-auto px-4 py-1">
				<button
					type="button"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {s.selectedCategory ===
					'all'
						? 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-md shadow-pink-500/20'
						: 'border border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50'}"
					onclick={() => (s.selectedCategory = 'all')}
				>
					<span>Semua</span>
					<span
						class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {s.selectedCategory ===
						'all'
							? 'bg-white/25 text-white'
							: 'bg-slate-100 text-slate-600'}"
					>
						{s.bahanList.length}
					</span>
				</button>

				<button
					type="button"
					class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {s.selectedCategory ===
					'low_stock'
						? 'bg-gradient-to-r from-rose-600 to-red-500 text-white shadow-md shadow-rose-500/20'
						: 'border border-rose-100/90 bg-rose-50/60 text-rose-700 hover:bg-rose-100/60'}"
					onclick={() => (s.selectedCategory = 'low_stock')}
				>
					<span>Stok Menipis</span>
					{#if s.lowStockItems.length > 0}
						<span
							class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {s.selectedCategory ===
							'low_stock'
								? 'bg-white/25 text-white'
								: 'bg-rose-200/80 text-rose-800'}"
						>
							{s.lowStockItems.length}
						</span>
					{/if}
				</button>

				{#each s.dynamicCategories as cat (cat)}
					{@const count = s.getCategoryCount(cat)}
					<button
						type="button"
						class="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-150 {s.selectedCategory ===
						cat
							? 'bg-gradient-to-r from-pink-600 to-rose-500 text-white shadow-md shadow-pink-500/20'
							: 'border border-slate-200/90 bg-white/90 text-slate-700 hover:bg-slate-50'}"
						onclick={() => (s.selectedCategory = cat)}
					>
						<span>{cat}</span>
						<span
							class="py-0.2 rounded-full px-1.5 text-[10px] font-extrabold {s.selectedCategory ===
							cat
								? 'bg-white/25 text-white'
								: 'bg-slate-100 text-slate-600'}"
						>
							{count}
						</span>
					</button>
				{/each}
			</div>

			<!-- List of Ingredients -->
			<div class="flex-1" id="stok-list-container">
				{#if s.isLoading}
					<div class="flex flex-col gap-2.5">
						{#each Array(4) as _}
							<div class="h-24 animate-pulse rounded-3xl bg-white/70"></div>
						{/each}
					</div>
				{:else if s.filteredBahan.length === 0}
					<div
						class="pointer-events-none flex min-h-[40vh] flex-col items-center justify-center py-12 text-center"
					>
						<div
							class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-pink-50 text-pink-500 shadow-sm"
						>
							<Boxes class="h-7 w-7" />
						</div>
						<div class="text-base font-bold text-slate-800">Belum Ada Stok Bahan</div>
						<div class="mt-1 max-w-xs text-xs text-slate-500">
							Tambahkan bahan baku kios seperti buah, gula pasir, susu, atau cup untuk mulai
							memantau stok.
						</div>
					</div>
				{:else}
					<div
						class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-2 md:gap-3.5 lg:grid-cols-3 xl:grid-cols-4"
					>
						{#each s.filteredBahan as bahan (bahan.id)}
							{@const health = getStockHealth(bahan)}
							<div
								class="soft-float-card group relative flex flex-col justify-between gap-3 border bg-white/95 p-4.5 shadow-[0_2px_14px_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-200 hover:shadow-md active:scale-[0.995] {health.cardBg}"
							>
								<!-- Top Row: Name + Health Badge -->
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0 flex-1">
										<div class="flex flex-wrap items-center gap-1.5">
											<h3 class="truncate text-base font-black tracking-tight text-slate-900">
												{bahan.nama}
											</h3>
											<span
												class="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-100/90 px-2 py-0.5 text-[10px] font-black tracking-wider text-slate-600 uppercase"
											>
												{bahan.kategori || 'Bahan Baku'}
											</span>
										</div>
									</div>

									<!-- Health Badge -->
									<span
										class="inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[11px] font-black tracking-wide {health.badgeClass}"
									>
										{health.label}
									</span>
								</div>

								<!-- Modal Asli Row: Never breaks awkwardly across lines -->
								<div
									class="-mt-1 flex flex-wrap items-baseline gap-1 text-xs font-medium text-slate-500"
								>
									<span class="whitespace-nowrap text-slate-400">Modal Asli:</span>
									<span class="font-extrabold whitespace-nowrap text-pink-700">
										Rp&nbsp;{formatRupiah(Math.round(Number(bahan.biaya_per_satuan || 0)))}
									</span>
									<span class="whitespace-nowrap text-slate-400">/&nbsp;{bahan.satuan}</span>
								</div>

								<!-- Middle Section: Stock Metrics & Visual Progress Bar -->
								<div class="rounded-2xl border border-slate-100/90 bg-slate-50/85 p-3">
									<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
										<div class="flex items-baseline gap-1.5">
											<span class="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
												{formatSmartStock(bahan.stok_saat_ini, bahan.satuan)}
											</span>
										</div>

										<div class="flex items-center gap-1 text-xs">
											{#if Number(bahan.ambang_stok || 0) > 0}
												<span class="text-slate-400">Min:</span>
												<span class="font-bold text-slate-700">
													{formatSmartStock(bahan.ambang_stok || 0, bahan.satuan)}
												</span>
											{:else}
												<span class="font-medium text-slate-400">Batas: -</span>
											{/if}
										</div>
									</div>

									<!-- Progress Bar -->
									<div class="space-y-1">
										<div
											class="relative h-2.5 w-full overflow-hidden rounded-full {health.trackBg}"
										>
											<div
												class="h-full rounded-full transition-all duration-500 ease-out {health.barGradient}"
												style="width: {health.percent}%"
											></div>
										</div>
										<div
											class="flex items-center justify-between text-[10px] font-bold text-slate-400"
										>
											<span>0</span>
											<span class="{health.textColor} font-extrabold"
												>{health.percent}% Kapasitas</span
											>
											<span
												>{Number(bahan.ambang_stok || 0) > 0
													? `${formatRupiah(bahan.ambang_stok || 0)} min`
													: 'Maks'}</span
											>
										</div>
									</div>
								</div>

								<!-- Action Buttons: Mobile Layout (Single Row) -->
								<div class="flex shrink-0 items-center gap-2 pt-1 md:hidden">
									<button
										class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-pink-50/90 px-4 py-2.5 text-xs font-black text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
										onclick={() => s.openMutasi(bahan, 'tambah')}
									>
										<Plus class="h-4 w-4 stroke-[2.5]" />
										<span>Masuk</span>
									</button>
									<button
										class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-rose-50/90 px-4 py-2.5 text-xs font-black text-rose-700 transition-all hover:bg-rose-100 active:scale-95"
										onclick={() => s.openMutasi(bahan, 'kurang')}
									>
										<span class="text-base leading-none font-black">−</span>
										<span>Keluar</span>
									</button>
									<button
										class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-slate-100/80 text-slate-600 transition-all hover:bg-slate-200/80 active:scale-95"
										onclick={() => s.openEditModal(bahan)}
										aria-label="Edit bahan"
									>
										<Edit3 class="h-4.5 w-4.5" />
									</button>
									<button
										class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-rose-50/80 text-rose-500 transition-all hover:bg-rose-100 active:scale-95"
										onclick={() => s.openDeleteConfirm(bahan.id)}
										aria-label="Hapus bahan"
									>
										<Trash2 class="h-4.5 w-4.5" />
									</button>
								</div>

								<!-- Action Buttons: Tablet Layout (2 Spacious Normal-Sized Rows) -->
								<div class="hidden shrink-0 flex-col gap-2 pt-1 md:flex">
									<div class="grid grid-cols-2 gap-2">
										<button
											class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-pink-50/90 py-2.5 text-xs font-black text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
											onclick={() => s.openMutasi(bahan, 'tambah')}
										>
											<Plus class="h-4 w-4 stroke-[2.5]" />
											<span>Masuk</span>
										</button>
										<button
											class="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-rose-50/90 py-2.5 text-xs font-black text-rose-700 transition-all hover:bg-rose-100 active:scale-95"
											onclick={() => s.openMutasi(bahan, 'kurang')}
										>
											<span class="text-base leading-none font-black">−</span>
											<span>Keluar</span>
										</button>
									</div>
									<div class="flex items-center gap-2">
										<button
											class="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-100 active:scale-95"
											onclick={() => s.openEditModal(bahan)}
										>
											<Edit3 class="h-3.5 w-3.5" />
											<span>Ubah</span>
										</button>
										<button
											class="flex cursor-pointer items-center justify-center rounded-xl border border-rose-100/80 bg-rose-50/80 px-3 py-2 text-rose-500 transition-all hover:bg-rose-100 active:scale-95"
											onclick={() => s.openDeleteConfirm(bahan.id)}
											aria-label="Hapus bahan"
										>
											<Trash2 class="h-3.5 w-3.5" />
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</main>

	<!-- Floating Action Button (FAB) -->
	<div class="z-fab fixed right-4 bottom-20 sm:right-6 sm:bottom-24">
		<button
			class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
			onclick={s.openAddModal}
			aria-label="Tambah Bahan Baku"
		>
			<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
				<Plus class="h-4 w-4 stroke-[2.8] text-white" />
			</div>
			<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Bahan</span>
		</button>
	</div>
</div>

<BahanDialog {s} />

<MutasiDialog {s} />

<HapusBahanDialog {s} />

<!-- Toast Notification -->
<ToastNotification
	show={s.toastManager.showToast}
	message={s.toastManager.toastMessage}
	type={s.toastManager.toastType}
	position="top"
/>
