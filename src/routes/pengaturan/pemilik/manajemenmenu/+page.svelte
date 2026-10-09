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
	import BahanFormModal from '$lib/components/pengaturan/manajemenmenu/BahanFormModal.svelte';
	import MutasiBahanModal from '$lib/components/pengaturan/manajemenmenu/MutasiBahanModal.svelte';

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

	<!-- Modal tambah/edit bahan -->
	<BahanFormModal {s} />

	<MutasiBahanModal {s} />

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
