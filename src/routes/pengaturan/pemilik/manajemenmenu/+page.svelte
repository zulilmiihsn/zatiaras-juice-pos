<script lang="ts">
	import { onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';
	import { formatRupiah, parseQuantityInput } from '$lib/utils/currency';
	import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';

	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Plus from '@lucide/svelte/icons/plus';
	import Pizza from '@lucide/svelte/icons/pizza';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import {
		getCompatibleUnits,
		UNIT_CATEGORIES,
		ALL_UNITS,
		convertToBaseUnit,
		safeConvertToBaseUnit,
		formatQuantity,
		type UnitCategory
	} from '$lib/utils/unitConversion';

	// [CATATAN]: Sub Komponen Tab
	import MenuTab from '$lib/components/pengaturan/manajemenmenu/MenuTab.svelte';
	import KategoriTab from '$lib/components/pengaturan/manajemenmenu/KategoriTab.svelte';
	import EkstraTab from '$lib/components/pengaturan/manajemenmenu/EkstraTab.svelte';
	import BahanTab from '$lib/components/pengaturan/manajemenmenu/BahanTab.svelte';
	import HppTab from '$lib/components/pengaturan/manajemenmenu/HppTab.svelte';
	import KategoriFormModal from '$lib/components/pengaturan/manajemenmenu/KategoriFormModal.svelte';
	import EkstraFormModal from '$lib/components/pengaturan/manajemenmenu/EkstraFormModal.svelte';
	import MenuFormModal from '$lib/components/pengaturan/manajemenmenu/MenuFormModal.svelte';

	// [CATATAN]: Modal
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import CropperDialog from '$lib/components/shared/cropperDialog.svelte';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import DeleteConfirmDialog from '$lib/components/shared/DeleteConfirmDialog.svelte';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';

	const s = createManajemenmenuState();
	onDestroy(() => s.dispose());

	const selectedEkstraBahan = $derived(
		s.bahanList.find((b) => String(b.id) === String(s.ekstraForm.bahan_id))
	);

	const ekstraCompatibleUnits = $derived(
		selectedEkstraBahan ? getCompatibleUnits(selectedEkstraBahan.satuan) : []
	);

	const ekstraModalHpp = $derived.by(() => {
		if (!selectedEkstraBahan || !s.ekstraForm.jumlah_bahan) return 0;
		const qty = parseQuantityInput(s.ekstraForm.jumlah_bahan) || 0;
		const unit = s.ekstraForm.satuan_resep || selectedEkstraBahan.satuan || 'gram';
		const baseUnit = selectedEkstraBahan.satuan || 'gram';
		const packSize = selectedEkstraBahan.isi_per_kemasan || 1;
		const baseQty = safeConvertToBaseUnit(qty, unit, baseUnit, packSize);
		if (!Number.isFinite(baseQty)) return 0;
		const unitCost = Number(selectedEkstraBahan.biaya_per_satuan || 0);
		return baseQty * unitCost;
	});
</script>

{#if s.toastManager.showToast}
	<ToastNotification
		show={s.toastManager.showToast}
		message={s.toastManager.toastMessage}
		type={s.toastManager.toastType}
		position="top"
	/>
{/if}

<div class="page-content min-h-[100dvh] bg-[#faf7f8] pb-24">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div class="page-header relative mb-3 w-full px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan/pemilik" label="Kembali ke Menu Pemilik">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Manajemen Menu</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Navigasi Tab Menu/Kategori/Ekstra/Bahan/HPP & Action Button -->
	<div class="mx-auto mb-3 max-w-5xl px-4 md:px-6">
		<div class="flex items-center justify-between gap-3">
			<div class="flex gap-2 overflow-x-auto py-1 sm:gap-2.5">
				<button
					type="button"
					class="min-h-[42px] shrink-0 cursor-pointer rounded-full px-4.5 py-2 text-xs font-extrabold transition-all duration-150 active:scale-95 sm:min-h-[44px] sm:px-5.5 sm:py-2.5 sm:text-sm md:text-base {s.activeTab ===
					'menu'
						? 'bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600 focus:border-slate-200/80 focus:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/30'}"
					onclick={() => (s.activeTab = 'menu')}>Menu</button
				>
				<button
					type="button"
					class="min-h-[42px] shrink-0 cursor-pointer rounded-full px-4.5 py-2 text-xs font-extrabold transition-all duration-150 active:scale-95 sm:min-h-[44px] sm:px-5.5 sm:py-2.5 sm:text-sm md:text-base {s.activeTab ===
					'kategori'
						? 'bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600 focus:border-slate-200/80 focus:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/30'}"
					onclick={() => (s.activeTab = 'kategori')}>Kategori</button
				>
				<button
					type="button"
					class="min-h-[42px] shrink-0 cursor-pointer rounded-full px-4.5 py-2 text-xs font-extrabold transition-all duration-150 active:scale-95 sm:min-h-[44px] sm:px-5.5 sm:py-2.5 sm:text-sm md:text-base {s.activeTab ===
					'ekstra'
						? 'bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600 focus:border-slate-200/80 focus:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/30'}"
					onclick={() => (s.activeTab = 'ekstra')}>Tambahan</button
				>
				<button
					type="button"
					class="min-h-[42px] shrink-0 cursor-pointer rounded-full px-4.5 py-2 text-xs font-extrabold transition-all duration-150 active:scale-95 sm:min-h-[44px] sm:px-5.5 sm:py-2.5 sm:text-sm md:text-base {s.activeTab ===
					'bahan'
						? 'bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600 focus:border-slate-200/80 focus:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/30'}"
					onclick={() => (s.activeTab = 'bahan')}>Bahan</button
				>
				<button
					type="button"
					class="min-h-[42px] shrink-0 cursor-pointer rounded-full px-4.5 py-2 text-xs font-extrabold transition-all duration-150 active:scale-95 sm:min-h-[44px] sm:px-5.5 sm:py-2.5 sm:text-sm md:text-base {s.activeTab ===
					'hpp'
						? 'bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
						: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600 focus:border-slate-200/80 focus:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/30'}"
					onclick={() => (s.activeTab = 'hpp')}>HPP</button
				>
			</div>

			<!-- Desktop Action Button (Visible on sm/tablet/desktop) -->
			<div class="hidden shrink-0 items-center sm:flex">
				{#if s.activeTab === 'menu'}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2 rounded-full border border-pink-200/80 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all duration-200 hover:scale-105 active:scale-95 md:text-sm"
						onclick={() => s.openMenuForm()}
					>
						<Plus class="h-4 w-4 stroke-[2.8]" />
						<span>Tambah Menu</span>
					</button>
				{:else if s.activeTab === 'kategori'}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2 rounded-full border border-pink-200/80 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all duration-200 hover:scale-105 active:scale-95 md:text-sm"
						onclick={() => s.openKategoriForm(null)}
					>
						<Plus class="h-4 w-4 stroke-[2.8]" />
						<span>Tambah Kategori</span>
					</button>
				{:else if s.activeTab === 'ekstra'}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2 rounded-full border border-pink-200/80 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all duration-200 hover:scale-105 active:scale-95 md:text-sm"
						onclick={() => s.openEkstraForm()}
					>
						<Plus class="h-4 w-4 stroke-[2.8]" />
						<span>Tambah Tambahan</span>
					</button>
				{:else if s.activeTab === 'bahan'}
					<button
						type="button"
						class="flex cursor-pointer items-center gap-2 rounded-full border border-pink-200/80 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all duration-200 hover:scale-105 active:scale-95 md:text-sm"
						onclick={() => s.openBahanForm()}
					>
						<Plus class="h-4 w-4 stroke-[2.8]" />
						<span>Tambah Bahan</span>
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Floating Action Button (FAB) khusus mobile (sm:hidden) -->
	{#if s.activeTab === 'menu'}
		<div class="z-fab fixed right-4 bottom-6 sm:hidden">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openMenuForm()}
				aria-label="Tambah Menu"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Menu</span>
			</button>
		</div>
	{:else if s.activeTab === 'kategori'}
		<div class="z-fab fixed right-4 bottom-6 sm:hidden">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openKategoriForm(null)}
				aria-label="Tambah Kategori"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm"
					>Tambah Kategori</span
				>
			</button>
		</div>
	{:else if s.activeTab === 'ekstra'}
		<div class="z-fab fixed right-4 bottom-6 sm:hidden">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openEkstraForm()}
				aria-label="Tambah Tambahan"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm"
					>Tambah Tambahan</span
				>
			</button>
		</div>
	{:else if s.activeTab === 'bahan'}
		<div class="z-fab fixed right-4 bottom-6 sm:hidden">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openBahanForm()}
				aria-label="Tambah Bahan"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Bahan</span
				>
			</button>
		</div>
	{/if}

	<!-- Konten tab dengan transisi geser -->
	<div class="relative min-h-[50vh]">
		{#if s.activeTab === 'menu'}
			<MenuTab
				bind:searchKeyword={s.searchKeyword}
				bind:selectedKategori={s.selectedKategori}
				bind:isGridView={s.isGridView}
				isLoadingKategori={s.isLoadingKategori}
				isLoadingMenus={s.isLoadingMenus}
				kategoriList={s.kategoriList}
				filteredMenus={s.filteredMenus}
				openMenuForm={s.openMenuForm}
				confirmDeleteMenu={s.confirmDeleteMenu}
				handleImgError={s.handleImgError}
			/>
		{:else if s.activeTab === 'kategori'}
			<KategoriTab
				bind:searchKategoriKeyword={s.searchKategoriKeyword}
				isLoadingKategori={s.isLoadingKategori}
				kategoriList={s.kategoriList}
				menus={s.menus}
				openKategoriForm={s.openKategoriForm}
				confirmDeleteKategori={s.confirmDeleteKategori}
			/>
		{:else if s.activeTab === 'ekstra'}
			<EkstraTab
				bind:searchEkstra={s.searchEkstra}
				isLoadingEkstra={s.isLoadingEkstra}
				ekstraList={s.ekstraList}
				openEkstraForm={s.openEkstraForm}
				confirmDeleteEkstra={s.confirmDeleteEkstra}
			/>
		{:else if s.activeTab === 'bahan'}
			<BahanTab
				bind:searchBahan={s.searchBahan}
				isLoadingBahan={s.isLoadingBahan}
				bahanList={s.bahanList}
				openBahanForm={s.openBahanForm}
				openMutasiBahanForm={s.openMutasiBahanForm}
				confirmDeleteBahan={s.confirmDeleteBahan}
			/>
		{:else if s.activeTab === 'hpp'}
			<HppTab
				bind:hppForm={s.hppForm}
				hppSettings={s.hppSettings}
				menus={s.menus}
				getOverheadMonthly={s.getOverheadMonthly}
				getOverheadPerItem={s.getOverheadPerItem}
				getProductRecipeCost={s.getProductRecipeCost}
				getProductHpp={s.getProductHpp}
				getProductMargin={s.getProductMargin}
				addHppExpenseItem={s.addHppExpenseItem}
				removeHppExpenseItem={s.removeHppExpenseItem}
				saveHppSettings={s.saveHppSettings}
			/>
		{/if}
	</div>

	<!-- Modal tambah/edit menu -->
	<MenuFormModal {s} />
	<!-- Modal untuk tambah/edit kategori -->
	<KategoriFormModal
		open={s.showKategoriDetailModal}
		kategoriDetail={s.kategoriDetail}
		bind:kategoriDetailName={s.kategoriDetailName}
		menus={s.menus}
		selectedMenuIds={s.selectedMenuIds}
		unselectedMenuIds={s.unselectedMenuIds}
		toggleMenuInKategoriRealtime={s.toggleMenuInKategoriRealtime}
		saveKategoriDetail={s.saveKategoriDetail}
		closeKategoriDetailModal={s.closeKategoriDetailModal}
	/>

	<!-- Modal untuk tambah/edit ekstra -->
	<EkstraFormModal
		open={s.showEkstraForm}
		editEkstraId={s.editEkstraId}
		bind:ekstraForm={s.ekstraForm}
		bahanList={s.bahanList}
		{selectedEkstraBahan}
		{ekstraCompatibleUnits}
		{ekstraModalHpp}
		handleRupiahInput={s.handleRupiahInput}
		saveEkstra={s.saveEkstra}
		closeEkstraForm={s.closeEkstraForm}
	/>

	<AppModal
		open={s.showBahanForm}
		label={s.editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
		size="sm"
		align="center"
		panelClass="bg-white"
		onClose={s.closeBahanForm}
	>
		>
		<!-- Header -->
		<div
			class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
		>
			<div>
				<h2 class="text-lg font-black tracking-tight text-slate-900">
					{s.editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
				</h2>
				<p class="text-xs font-medium text-slate-500">
					Kelola master bahan baku dan biaya pembelian
				</p>
			</div>
			<button
				type="button"
				class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-all hover:bg-pink-100 hover:text-pink-700 active:scale-90"
				onclick={s.closeBahanForm}
				aria-label="Tutup modal"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
		<form
			id="bahan-form"
			class="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
			onsubmit={(e) => {
				e.preventDefault();
				s.saveBahan();
			}}
			autocomplete="off"
		>
			<!-- Nama Bahan -->
			<div class="flex flex-col gap-1.5">
				<label for="bahan-name" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Nama Bahan</label
				>
				<input
					id="bahan-name"
					type="text"
					class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={s.bahanForm.nama}
					required
					placeholder="Contoh: Alpukat Mentega, Gula Pasir, Susu SKM, Cup 16oz"
				/>
			</div>

			<!-- Tipe Satuan / Sifat Bahan -->
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Tipe Takaran / Sifat Bahan</span
				>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each UNIT_CATEGORIES as cat}
						<button
							type="button"
							class="flex cursor-pointer flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all {s
								.bahanForm.tipe_satuan === cat.value
								? 'border-pink-500 bg-pink-50/80 font-bold text-pink-700 shadow-xs ring-2 ring-pink-500/20'
								: 'border-slate-200/80 bg-slate-50/40 text-slate-600 hover:border-pink-200 hover:bg-white'}"
							onclick={() => {
								s.bahanForm.tipe_satuan = cat.value;
								s.bahanForm.satuan = cat.defaultBase;
								if (cat.value === 'berat') s.bahanForm.satuan_beli = 'kg';
								else if (cat.value === 'cairan') s.bahanForm.satuan_beli = 'liter';
								else if (cat.value === 'kemasan') s.bahanForm.satuan_beli = 'pack';
								else s.bahanForm.satuan_beli = 'buah';
							}}
						>
							<span class="text-xs font-bold capitalize">{cat.value}</span>
							<span class="mt-0.5 text-[10px] font-medium text-slate-400">({cat.defaultBase})</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Kategori Bahan (Bahan Baku / Topping / Kemasan) -->
			<div class="flex flex-col gap-1.5">
				<label
					for="bahan-kategori"
					class="text-xs font-bold tracking-wider text-slate-700 uppercase">Kategori Bahan</label
				>
				<div class="relative">
					<select
						id="bahan-kategori"
						class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-slate-50/60 py-3 pr-10 pl-4 text-sm font-semibold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
						bind:value={s.bahanForm.kategoriSelect}
					>
						{#each s.availableCategoryOptions as cat}
							<option value={cat}>{cat}</option>
						{/each}
						<option value="__new__">+ Buat Kategori Baru...</option>
					</select>
					<ChevronDown
						class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
					/>
				</div>
				{#if s.bahanForm.kategoriSelect === '__new__'}
					<input
						type="text"
						class="w-full rounded-xl border border-pink-300 bg-pink-50/50 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-all focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
						bind:value={s.bahanForm.customKategori}
						placeholder="Ketik kategori baru (contoh: Kemasan, Buah)"
						required
					/>
				{/if}
			</div>

			<!-- Satuan Dasar & Stok Siap Pakai -->
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<label
						for="bahan-satuan"
						class="text-xs font-bold tracking-wider text-slate-700 uppercase">Satuan Simpan</label
					>
					<div class="relative">
						<select
							id="bahan-satuan"
							class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-slate-50/60 py-3 pr-10 pl-4 text-sm font-semibold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
							bind:value={s.bahanForm.satuan}
						>
							{#if s.bahanForm.tipe_satuan === 'cairan'}
								<option value="ml">Mililiter (ml)</option>
								<option value="liter">Liter (L)</option>
								<option value="cup">Cup (200ml)</option>
							{:else if s.bahanForm.tipe_satuan === 'berat'}
								<option value="gram">Gram (g)</option>
								<option value="kg">Kilogram (kg)</option>
								<option value="ons">Ons (100g)</option>
							{:else if s.bahanForm.tipe_satuan === 'kemasan'}
								<option value="pcs">Pcs / Lembar</option>
								<option value="pack">Pack / Bungkus</option>
							{:else}
								<option value="buah">Buah</option>
								<option value="porsi">Porsi</option>
								<option value="pcs">Pcs</option>
								<option value="biji">Biji</option>
							{/if}
						</select>
						<ChevronDown
							class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
						/>
					</div>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="bahan-stock" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
						>Stok Siap Pakai</label
					>
					<input
						id="bahan-stock"
						type="text"
						class="w-full rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-3 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
						bind:value={s.bahanForm.stok_saat_ini}
						oninput={s.handleQuantityInput(s.bahanForm, 'stok_saat_ini')}
						onblur={() => s.formatQuantityField(s.bahanForm, 'stok_saat_ini')}
						placeholder="0"
					/>
				</div>
			</div>

			{#if s.bahanForm.tipe_satuan === 'kemasan'}
				<div class="flex flex-col gap-1.5">
					<label
						for="bahan-isi-kemasan"
						class="text-xs font-bold tracking-wider text-slate-700 uppercase"
						>1 Pack/Bungkus Isi Berapa Pcs?</label
					>
					<input
						id="bahan-isi-kemasan"
						type="text"
						class="w-full rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-3 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
						bind:value={s.bahanForm.isi_per_kemasan}
						oninput={s.handleQuantityInput(s.bahanForm, 'isi_per_kemasan')}
						onblur={() => s.formatQuantityField(s.bahanForm, 'isi_per_kemasan')}
						placeholder="Contoh: 50"
					/>
				</div>
			{/if}

			<!-- Batas Peringatan Habis -->
			<div class="flex flex-col gap-1.5">
				<label for="bahan-low" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Batas Peringatan Habis ({s.bahanForm.satuan})</label
				>
				<input
					id="bahan-low"
					type="text"
					class="w-full rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-3 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={s.bahanForm.ambang_stok}
					oninput={s.handleQuantityInput(s.bahanForm, 'ambang_stok')}
					onblur={() => s.formatQuantityField(s.bahanForm, 'ambang_stok')}
					placeholder="0"
				/>
			</div>

			<!-- Pembelian / Kulakan Grosir -->
			<div class="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5">
				<div class="mb-2 text-xs font-extrabold tracking-wider text-slate-800 uppercase">
					Kalkulator Kulakan / Pembelian Grosir
				</div>
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<label for="bahan-purchase-jumlah" class="text-[11px] font-bold text-slate-600"
							>Jumlah Beli</label
						>
						<div class="flex gap-2">
							<input
								id="bahan-purchase-jumlah"
								type="text"
								class="w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.bahanForm.jumlah_beli_terakhir}
								oninput={s.handleQuantityInput(s.bahanForm, 'jumlah_beli_terakhir')}
								onblur={() => s.formatQuantityField(s.bahanForm, 'jumlah_beli_terakhir')}
								placeholder="1"
							/>
							<div class="relative w-28">
								<select
									class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2.5 pr-7 pl-2.5 text-xs font-semibold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
									bind:value={s.bahanForm.satuan_beli}
								>
									{#if s.bahanForm.tipe_satuan === 'berat'}
										<option value="kg">kg</option>
										<option value="gram">gram</option>
										<option value="ons">ons</option>
									{:else if s.bahanForm.tipe_satuan === 'cairan'}
										<option value="liter">Liter</option>
										<option value="ml">ml</option>
									{:else if s.bahanForm.tipe_satuan === 'kemasan'}
										<option value="pack">Pack / bks</option>
										<option value="slop">Slop</option>
										<option value="dus">Dus</option>
										<option value="pcs">pcs</option>
									{:else}
										<option value="buah">buah</option>
										<option value="porsi">porsi</option>
										<option value="biji">biji</option>
									{/if}
								</select>
								<ChevronDown
									class="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
								/>
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="bahan-purchase-cost" class="text-[11px] font-bold text-slate-600"
							>Total Harga Beli</label
						>
						<div class="relative">
							<span
								class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
								>Rp</span
							>
							<input
								id="bahan-purchase-cost"
								type="text"
								class="w-full rounded-xl border border-slate-200/90 bg-white py-2.5 pr-4 pl-10 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.bahanForm.biaya_beli_terakhir}
								oninput={s.handleRupiahInput(s.bahanForm, 'biaya_beli_terakhir')}
								placeholder="18.000"
							/>
						</div>
					</div>
				</div>

				<!-- Hitung Susut Kulit/Biji (Hanya untuk Buah Segar / Tipe Berat & Unit) -->
				{#if s.bahanForm.tipe_satuan === 'berat' || s.bahanForm.tipe_satuan === 'unit'}
					<div class="mt-3 flex flex-col gap-2 border-t border-slate-200/60 pt-3">
						<div class="flex items-center justify-between">
							<label
								class="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700 select-none"
							>
								<input
									type="checkbox"
									class="h-4 w-4 rounded border-slate-300 text-pink-600 focus:ring-pink-500/20"
									checked={Number(s.bahanForm.yield_persen || 100) < 100}
									onchange={(e) => {
										s.bahanForm.yield_persen = e.currentTarget.checked ? '70' : '100';
									}}
								/>
								<span>Hitung Susut Kulit/Biji (Khusus Buah Utuh)</span>
							</label>
							{#if Number(s.bahanForm.yield_persen || 100) < 100}
								<span class="text-xs font-black text-pink-600"
									>{s.bahanForm.yield_persen}% Bersih</span
								>
							{/if}
						</div>

						{#if Number(s.bahanForm.yield_persen || 100) < 100}
							<div class="flex flex-col gap-2 pt-1">
								<div class="relative">
									<input
										id="bahan-yield"
										type="number"
										min="1"
										max="100"
										class="w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
										bind:value={s.bahanForm.yield_persen}
										placeholder="70"
									/>
									<span
										class="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
										>% Daging Bersih</span
									>
								</div>
								<!-- Quick Preset Buttons -->
								<div class="flex flex-wrap items-center gap-1.5 pt-0.5">
									<span class="text-[10px] font-semibold text-slate-400">Pilihan Cepat:</span>
									<button
										type="button"
										class="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300 active:scale-95"
										onclick={() => (s.bahanForm.yield_persen = '70')}
									>
										Alpukat/Mangga (70%)
									</button>
									<button
										type="button"
										class="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300 active:scale-95"
										onclick={() => (s.bahanForm.yield_persen = '45')}
									>
										Nanas (45%)
									</button>
									<button
										type="button"
										class="cursor-pointer rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300 active:scale-95"
										onclick={() => (s.bahanForm.yield_persen = '50')}
									>
										Jeruk (50%)
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}

				{#if parseQuantityInput(s.bahanForm.jumlah_beli_terakhir) > 0}
					{@const numQty = parseQuantityInput(s.bahanForm.jumlah_beli_terakhir)}
					{@const numCost = Number(String(s.bahanForm.biaya_beli_terakhir).replace(/\./g, '') || 0)}
					{@const packSize = parseQuantityInput(s.bahanForm.isi_per_kemasan) || 1}
					{@const baseQty = safeConvertToBaseUnit(
						numQty,
						s.bahanForm.satuan_beli || s.bahanForm.satuan,
						s.bahanForm.satuan,
						packSize
					)}
					{@const isFruitYield =
						(s.bahanForm.tipe_satuan === 'berat' || s.bahanForm.tipe_satuan === 'unit') &&
						Number(s.bahanForm.yield_persen || 100) < 100}
					{@const numYield = isFruitYield
						? Math.min(100, Math.max(1, Number(s.bahanForm.yield_persen || 100)))
						: 100}
					{@const netBaseQty = (baseQty * numYield) / 100}
					{@const effectiveUnitCost =
						netBaseQty > 0 ? calculateEffectiveUnitCost(numCost, netBaseQty) : 0}

					<div
						class="mt-3 rounded-xl border border-pink-100 bg-pink-50/80 p-2.5 text-xs text-slate-700"
					>
						<div class="flex flex-wrap items-center justify-between gap-1 font-bold">
							<span class="text-slate-600">
								{#if isFruitYield}
									Daging Bersih: <span class="text-slate-900"
										>{formatQuantity(netBaseQty)} {s.bahanForm.satuan}</span
									>
									<span class="text-[10px] font-normal text-slate-400">
										(dari {formatQuantity(baseQty)} {s.bahanForm.satuan} utuh)</span
									>
								{:else}
									Total: <span class="text-slate-900"
										>{formatQuantity(baseQty)} {s.bahanForm.satuan}</span
									>
								{/if}
							</span>
							<span class="text-pink-700">
								Modal: Rp {formatRupiah(Math.round(effectiveUnitCost))} / {s.bahanForm.satuan}
							</span>
						</div>
					</div>
				{/if}
			</div>
		</form>

		<!-- Fixed Action Buttons -->
		<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-5">
			<button
				type="submit"
				form="bahan-form"
				class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
			>
				{s.editBahanId ? 'Update Bahan' : 'Simpan Bahan'}
			</button>
			<button
				type="button"
				class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
				onclick={s.closeBahanForm}
			>
				Batal
			</button>
		</div>
	</AppModal>

	<AppModal
		open={s.showMutasiBahanForm}
		label="Ubah Stok Bahan"
		size="sm"
		align="center"
		panelClass="bg-white"
		onClose={s.closeMutasiBahanForm}
	>
		<!-- Header -->
		<div
			class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
		>
			<div>
				<h2 class="text-lg font-black tracking-tight text-slate-900">Ubah Stok Bahan</h2>
				<p class="text-xs font-medium text-slate-500">Koreksi stok masuk atau keluar</p>
			</div>
			<button
				type="button"
				class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-all hover:bg-pink-100 hover:text-pink-700 active:scale-90"
				onclick={s.closeMutasiBahanForm}
				aria-label="Tutup modal"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
		<form
			id="mutasi-form"
			class="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
			onsubmit={(e) => {
				e.preventDefault();
				s.saveMutasiBahan();
			}}
			autocomplete="off"
		>
			<div class="flex flex-col gap-1.5">
				<label for="mutasi-delta" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Jumlah Perubahan</label
				>
				<input
					id="mutasi-delta"
					type="number"
					step="0.01"
					class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-bold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={s.mutasiBahanForm.delta_jumlah}
					required
					placeholder="Contoh: 500 atau -100"
				/>
				<p class="text-[11px] font-medium text-slate-400">
					Angka positif untuk stok masuk, negatif untuk koreksi keluar.
				</p>
			</div>
			<div class="flex flex-col gap-1.5">
				<label
					for="mutasi-catatan"
					class="text-xs font-bold tracking-wider text-slate-700 uppercase">Catatan</label
				>
				<input
					id="mutasi-catatan"
					type="text"
					class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={s.mutasiBahanForm.catatan}
					placeholder="Belanja bahan / koreksi opname"
				/>
			</div>
		</form>

		<!-- Fixed Action Buttons -->
		<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-5">
			<button
				type="submit"
				form="mutasi-form"
				class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
			>
				Simpan
			</button>
			<button
				type="button"
				class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
				onclick={s.closeMutasiBahanForm}
			>
				Batal
			</button>
		</div>
	</AppModal>

	<!-- Modal konfirmasi hapus menu -->
	<DeleteConfirmDialog
		open={s.showDeleteModal}
		title="Hapus Menu?"
		description="Menu yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus menu ini?"
		onCancel={s.cancelDeleteMenu}
		onConfirm={s.doDeleteMenu}
	/>

	<!-- Modal konfirmasi hapus kategori -->
	<DeleteConfirmDialog
		open={s.showDeleteKategoriModal}
		title="Hapus Kategori?"
		description="Kategori yang dihapus tidak dapat dikembalikan. Menu dalam kategori ini akan menjadi tanpa kategori."
		onCancel={s.cancelDeleteKategori}
		onConfirm={s.doDeleteKategori}
	/>

	<!-- Modal konfirmasi hapus ekstra -->
	<DeleteConfirmDialog
		open={s.showDeleteEkstraModal}
		title="Hapus Ekstra?"
		description="Ekstra yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus ekstra ini?"
		onCancel={s.cancelDeleteEkstra}
		onConfirm={s.doDeleteEkstra}
	/>

	<DeleteConfirmDialog
		open={s.showDeleteBahanModal}
		title="Hapus Bahan?"
		description="Bahan tidak bisa dihapus kalau masih dipakai resep menu."
		onCancel={s.cancelDeleteBahan}
		onConfirm={s.doDeleteBahan}
	/>

	<!-- Notifikasi floating (toast) -->
	{#if s.showNotifModal}
		<ToastNotification
			show={s.showNotifModal}
			message={s.notifModalMsg}
			type={s.notifModalType === 'error' ? 'error' : 'success'}
			position="top"
		/>
	{/if}

	<!-- Komponen upload/crop gambar menu -->
	{#if s.showCropperDialog}
		<CropperDialog
			src={s.cropperDialogImage}
			bind:open={s.showCropperDialog}
			onDone={s.handleCropperDone}
			onCancel={s.handleCropperCancel}
		/>
	{/if}
</div>
