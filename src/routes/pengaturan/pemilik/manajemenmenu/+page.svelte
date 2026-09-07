<script lang="ts">
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';
	import { formatRupiah } from '$lib/utils/currency';
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

	// [CATATAN]: Modal
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import CropperDialog from '$lib/components/shared/cropperDialog.svelte';

	const s = createManajemenmenuState();

	const currentPorsiRecipes = $derived(
		s.recipeItems.filter((r) => (r.porsi || 'reguler') === s.activeRecipePorsi)
	);

	const totalCurrentRecipeCost = $derived(
		currentPorsiRecipes.reduce((sum, item) => {
			const ingredient = s.bahanList.find((b) => b.id === item.bahan_id);
			const unitCost = Number(ingredient?.biaya_per_satuan || 0);
			const baseQty = Number(item.jumlah_dasar_per_item ?? item.jumlah_per_item ?? 0);
			return sum + unitCost * baseQty;
		}, 0)
	);

	const selectedDraftBahan = $derived(
		s.bahanList.find((b) => String(b.id) === String(s.recipeDraft.bahan_id))
	);

	const draftCompatibleUnits = $derived(
		selectedDraftBahan ? getCompatibleUnits(selectedDraftBahan.satuan) : []
	);

	const selectedEkstraBahan = $derived(
		s.bahanList.find((b) => String(b.id) === String(s.ekstraForm.bahan_id))
	);

	const ekstraCompatibleUnits = $derived(
		selectedEkstraBahan ? getCompatibleUnits(selectedEkstraBahan.satuan) : []
	);

	const ekstraModalHpp = $derived.by(() => {
		if (!selectedEkstraBahan || !s.ekstraForm.jumlah_bahan) return 0;
		const qty = parseFloat(s.ekstraForm.jumlah_bahan) || 0;
		const unit = s.ekstraForm.satuan_resep || selectedEkstraBahan.satuan || 'gram';
		const baseUnit = selectedEkstraBahan.satuan || 'gram';
		const packSize = selectedEkstraBahan.isi_per_kemasan || 1;
		const baseQty = safeConvertToBaseUnit(qty, unit, baseUnit, packSize);
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
	<div
		class="relative mb-3 w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-8 shadow-xl shadow-pink-500/15"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<a
				href="/pengaturan/pemilik"
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali ke Menu Pemilik"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</a>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Manajemen Menu</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Navigasi Tab Menu/Kategori/Ekstra/Bahan/HPP -->
	<div class="mx-auto mb-3 max-w-5xl px-4 md:px-6">
		<div class="flex gap-2.5 overflow-x-auto py-1 md:gap-3">
			<button
				type="button"
				class="min-h-[44px] shrink-0 cursor-pointer rounded-full px-5.5 py-2.5 text-sm font-bold transition-colors duration-150 md:px-6 md:text-base {s.activeTab ===
				'menu'
					? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
					: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
				onclick={() => (s.activeTab = 'menu')}>Menu</button
			>
			<button
				type="button"
				class="min-h-[44px] shrink-0 cursor-pointer rounded-full px-5.5 py-2.5 text-sm font-bold transition-colors duration-150 md:px-6 md:text-base {s.activeTab ===
				'kategori'
					? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
					: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
				onclick={() => (s.activeTab = 'kategori')}>Kategori</button
			>
			<button
				type="button"
				class="min-h-[44px] shrink-0 cursor-pointer rounded-full px-5.5 py-2.5 text-sm font-bold transition-colors duration-150 md:px-6 md:text-base {s.activeTab ===
				'ekstra'
					? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
					: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
				onclick={() => (s.activeTab = 'ekstra')}>Tambahan</button
			>
			<button
				type="button"
				class="min-h-[44px] shrink-0 cursor-pointer rounded-full px-5.5 py-2.5 text-sm font-bold transition-colors duration-150 md:px-6 md:text-base {s.activeTab ===
				'bahan'
					? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
					: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
				onclick={() => (s.activeTab = 'bahan')}>Bahan</button
			>
			<button
				type="button"
				class="min-h-[44px] shrink-0 cursor-pointer rounded-full px-5.5 py-2.5 text-sm font-bold transition-colors duration-150 md:px-6 md:text-base {s.activeTab ===
				'hpp'
					? 'border border-pink-200/80 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/15'
					: 'border border-slate-200/80 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
				onclick={() => (s.activeTab = 'hpp')}>HPP</button
			>
		</div>
	</div>

	<!-- Floating Action Button (FAB) untuk tambah data sesuai tab aktif -->
	{#if s.activeTab === 'menu'}
		<div class="z-fab fixed right-4 bottom-6 sm:right-6">
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
		<div class="z-fab fixed right-4 bottom-6 sm:right-6">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openKategoriForm(null)}
				aria-label="Tambah Kategori"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Kategori</span>
			</button>
		</div>
	{:else if s.activeTab === 'ekstra'}
		<div class="z-fab fixed right-4 bottom-6 sm:right-6">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openEkstraForm()}
				aria-label="Tambah Tambahan"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Tambahan</span>
			</button>
		</div>
	{:else if s.activeTab === 'bahan'}
		<div class="z-fab fixed right-4 bottom-6 sm:right-6">
			<button
				class="group flex cursor-pointer items-center gap-2.5 rounded-full border border-white/40 bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 pr-5 pl-3.5 text-white shadow-xl shadow-pink-500/30 backdrop-blur-md transition-all duration-200 hover:scale-105 hover:shadow-2xl hover:shadow-pink-500/40 active:scale-95"
				onclick={() => s.openBahanForm()}
				aria-label="Tambah Bahan"
			>
				<div class="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 shadow-2xs">
					<Plus class="h-4 w-4 stroke-[2.8] text-white" />
				</div>
				<span class="drop-shadow-2xs text-xs font-black tracking-wide sm:text-sm">Tambah Bahan</span>
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

	<!-- Modal untuk tambah/edit menu -->
	{#if s.showMenuForm}
		<div
			class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeMenuForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeMenuForm()}
			onkeypress={(e) => e.key === 'Enter' && s.closeMenuForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				role="document"
			>
				<!-- Header -->
				<div
					class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
				>
					<div>
						<h2 class="text-lg font-black tracking-tight text-slate-900">
							{s.editMenuId ? 'Edit Menu' : 'Tambah Menu Baru'}
						</h2>
						<p class="text-xs font-medium text-slate-500">
							{s.editMenuId
								? 'Perbarui informasi dan resep produk'
								: 'Lengkapi detail produk menu baru'}
						</p>
					</div>
					<button
						type="button"
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-90"
						onclick={s.closeMenuForm}
						aria-label="Tutup modal"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				<!-- Scrollable Form Content -->
				<form
					id="menu-form"
					class="flex flex-1 flex-col gap-5 overflow-y-auto p-6"
					onsubmit={(e) => {
						e.preventDefault();
						s.saveMenu(e);
					}}
					autocomplete="off"
				>
					<!-- Preview Gambar Menu -->
					<div class="flex flex-col gap-2">
						<label
							for="menu-image"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase">Gambar Menu</label
						>
						<div class="w-full">
							<button
								type="button"
								class="group relative w-full cursor-pointer"
								onclick={() => s.fileInputEl?.click()}
							>
								{#if s.menuForm.gambar}
									<div
										class="relative w-full overflow-hidden rounded-2xl border border-slate-200 shadow-xs"
									>
										<img
											src={s.menuForm.gambar}
											alt="Preview Menu"
											class="aspect-square w-full object-cover"
										/>
										<!-- Floating Delete Button -->
										<div
											class="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-rose-500/90 text-white shadow-md backdrop-blur-xs transition-all hover:bg-rose-600 active:scale-90"
											role="button"
											tabindex="0"
											aria-label="Hapus gambar"
											onclick={(e) => {
												e.stopPropagation();
												s.removeImage();
											}}
											onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), s.removeImage())}
											onkeypress={(e) =>
												e.key === 'Enter' && (e.stopPropagation(), s.removeImage())}
										>
											<Trash2 class="h-4 w-4" />
										</div>
										<div
											class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 backdrop-blur-[2px] transition-all duration-200 group-hover:opacity-100"
										>
											<span
												class="rounded-xl bg-white/90 px-3.5 py-1.5 text-xs font-bold text-slate-900 shadow-sm"
											>
												Klik untuk Ubah Gambar
											</span>
										</div>
									</div>
								{:else}
									<div
										class="flex aspect-square w-full items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/60 transition-all duration-200 group-hover:border-pink-300 group-hover:bg-pink-50/20"
									>
										<div class="flex flex-col items-center p-4 text-center">
											<div
												class="mb-2.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-xs ring-1 ring-slate-200/80 transition-transform group-hover:scale-105 group-hover:text-pink-500"
											>
												<svg
													class="h-6 w-6"
													fill="none"
													stroke="currentColor"
													stroke-width="1.8"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
													/>
												</svg>
											</div>
											<span class="text-xs font-bold text-slate-700 group-hover:text-pink-600">
												Klik untuk Upload Gambar
											</span>
											<p class="mt-1 text-[11px] font-medium text-slate-400">
												PNG, JPG, atau GIF (Max. 5MB)
											</p>
										</div>
									</div>
								{/if}
							</button>
						</div>
						<input
							type="file"
							accept="image/*"
							class="hidden"
							bind:this={s.fileInputEl}
							onchange={s.handleFileChange}
						/>
					</div>

					<!-- Nama Menu -->
					<div class="flex flex-col gap-1.5">
						<label for="menu-name" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
							>Nama Menu</label
						>
						<input
							type="text"
							id="menu-name"
							class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
							bind:value={s.menuForm.nama}
							required
							placeholder="Contoh: Es Teh Manis"
						/>
					</div>

					<!-- Harga Reguler & Harga Jumbo -->
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
						<div class="flex flex-col gap-1.5">
							<label
								for="menu-harga"
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
								>Harga Reguler</label
							>
							<div class="relative">
								<span
									class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
									>Rp</span
								>
								<input
									type="text"
									id="menu-harga"
									class="w-full rounded-xl border border-slate-200/90 bg-white py-3 pr-4 pl-10 text-sm font-bold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
									bind:value={s.menuForm.harga}
									oninput={s.handleRupiahInput(s.menuForm, 'harga')}
									required
									placeholder="0"
								/>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<label
								for="menu-harga-jumbo"
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
							>
								Harga Jumbo <span class="text-[11px] font-normal text-slate-400 lowercase"
									>(opsional)</span
								>
							</label>
							<div class="relative">
								<span
									class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
									>Rp</span
								>
								<input
									type="text"
									id="menu-harga-jumbo"
									class="w-full rounded-xl border border-slate-200/90 bg-white py-3 pr-4 pl-10 text-sm font-bold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
									bind:value={s.menuForm.harga_jumbo}
									oninput={s.handleRupiahInput(s.menuForm, 'harga_jumbo')}
									placeholder="Sama jika kosong"
								/>
							</div>
						</div>
					</div>

					<!-- Opsi Metode Pelacakan Stok -->
					<div
						class="flex flex-col gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/60 p-4.5 shadow-xs"
					>
						<div>
							<span class="text-xs font-bold tracking-wider text-slate-700 uppercase">
								Metode Pengurangan Stok
							</span>
							<p class="mt-0.5 text-xs text-slate-500">
								Pilih bagaimana stok produk ini dikelola saat terjadi transaksi di kasir.
							</p>
						</div>

						<div class="flex flex-col gap-3">
							<!-- 1. BLOK RESEP BAHAN BAKU -->
							<div
								class="overflow-hidden rounded-2xl border transition-all duration-200 {s.menuForm
									.lacak_bahan
									? 'border-pink-500/80 bg-pink-50/30 shadow-xs ring-2 ring-pink-500/20'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<!-- Card Header / Toggle Area -->
								<div
									class="flex cursor-pointer items-center justify-between gap-3 p-3.5"
									onclick={() => s.setTrackIngredients(!s.menuForm.lacak_bahan)}
									role="button"
									tabindex="0"
									onkeydown={(e) =>
										e.key === 'Enter' && s.setTrackIngredients(!s.menuForm.lacak_bahan)}
								>
									<div class="flex items-center gap-2.5">
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors {s
												.menuForm.lacak_bahan
												? 'bg-pink-500 text-white shadow-xs shadow-pink-500/30'
												: 'bg-slate-100 text-slate-500'}"
										>
											<UtensilsCrossed class="h-4.5 w-4.5 stroke-[2.2]" />
										</div>
										<div>
											<span class="text-sm font-bold text-slate-900">Resep Bahan Baku</span>
											<p class="text-xs text-slate-500">Otomatis potong stok bahan baku.</p>
										</div>
									</div>

									<!-- Custom Animated Toggle Switch -->
									<div
										class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {s
											.menuForm.lacak_bahan
											? 'bg-pink-600'
											: 'bg-slate-200'}"
									>
										<span
											class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out {s
												.menuForm.lacak_bahan
												? 'translate-x-4'
												: 'translate-x-0'}"
										></span>
									</div>
								</div>

								<!-- Expandable Recipe Builder (Directly Underneath Resep Bahan Card) -->
								{#if s.menuForm.lacak_bahan}
									<div class="border-t border-pink-200/70 bg-white/90 p-4">
										<!-- Porsi Segmented Control (Minimalist & Crisp) -->
										<div class="mb-3.5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
											<button
												type="button"
												class="flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors duration-150 {s.activeRecipePorsi ===
												'reguler'
													? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
													: 'text-slate-500 hover:text-slate-800'}"
												onclick={() => (s.activeRecipePorsi = 'reguler')}
											>
												<span>Resep Reguler</span>
												<span
													class="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors {s.activeRecipePorsi ===
													'reguler'
														? 'bg-slate-100 text-slate-700'
														: 'bg-slate-200/70 text-slate-500'}"
												>
													{s.recipeItems.filter((r) => (r.porsi || 'reguler') === 'reguler').length}
												</span>
											</button>
											<button
												type="button"
												class="flex cursor-pointer items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition-colors duration-150 {s.activeRecipePorsi ===
												'jumbo'
													? 'bg-white text-slate-900 shadow-xs ring-1 ring-slate-900/5'
													: 'text-slate-500 hover:text-slate-800'}"
												onclick={() => (s.activeRecipePorsi = 'jumbo')}
											>
												<span>Resep Jumbo</span>
												<span
													class="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors {s.activeRecipePorsi ===
													'jumbo'
														? 'bg-slate-100 text-slate-700'
														: 'bg-slate-200/70 text-slate-500'}"
												>
													{s.recipeItems.filter((r) => (r.porsi || 'reguler') === 'jumbo').length}
												</span>
											</button>
										</div>

										<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
											<div class="flex items-center gap-2">
												<span
													class="text-xs font-extrabold tracking-wider text-slate-800 uppercase"
												>
													Komposisi {s.activeRecipePorsi === 'jumbo' ? 'Jumbo' : 'Reguler'}
												</span>
												<span
													class="inline-flex shrink-0 items-center rounded-full bg-pink-100 px-2.5 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-pink-700"
												>
													{currentPorsiRecipes.length} bahan
												</span>
											</div>

											{#if currentPorsiRecipes.length > 0}
												<div class="shrink-0 text-xs font-bold whitespace-nowrap text-slate-500">
													Modal Bahan: <span class="font-extrabold text-pink-700"
														>Rp {formatRupiah(Math.round(totalCurrentRecipeCost))}</span
													>
												</div>
											{/if}
										</div>

										<!-- Add Ingredient Row (Neat 2-row layout on mobile/desktop) -->
										<div
											class="mb-3 flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3"
										>
											<!-- 1. Dropdown Pilih Bahan Baku -->
											<div class="relative w-full">
												<select
													class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2.5 pr-9 pl-3 text-xs font-bold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
													bind:value={s.recipeDraft.bahan_id}
													onchange={() => {
														const found = s.bahanList.find(
															(b) => String(b.id) === String(s.recipeDraft.bahan_id)
														);
														if (found) {
															s.recipeDraft.satuan_resep = found.satuan;
														}
													}}
												>
													<option value="">-- Pilih Bahan Baku --</option>
													{#each s.bahanList as bahan}
														<option value={bahan.id}>
															{bahan.nama} ({bahan.satuan}) {bahan.kategori
																? `• ${bahan.kategori}`
																: ''}
														</option>
													{/each}
												</select>
												<ChevronDown
													class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400"
												/>
											</div>

											<!-- 2. Takaran + Satuan + Tombol Tambah (Responsive grid, no clipping on mobile) -->
											<div class="grid grid-cols-2 gap-2 sm:grid-cols-12">
												<!-- Takaran Input -->
												<div class="col-span-1 sm:col-span-4">
													<input
														type="number"
														min="0"
														step="0.01"
														class="w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2.5 text-xs font-bold text-slate-800 placeholder:font-normal placeholder:text-slate-400 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
														bind:value={s.recipeDraft.jumlah_per_item}
														placeholder="Takaran"
													/>
												</div>

												<!-- Satuan Resep Dropdown -->
												<div class="relative col-span-1 sm:col-span-4">
													<select
														class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2.5 pr-7 pl-2.5 text-xs font-bold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
														bind:value={s.recipeDraft.satuan_resep}
													>
														{#if draftCompatibleUnits.length > 0}
															{#each draftCompatibleUnits as unit}
																<option value={unit.value}>{unit.label}</option>
															{/each}
														{:else}
															<option value={selectedDraftBahan?.satuan || 'gram'}>
																{selectedDraftBahan?.satuan || 'Satuan'}
															</option>
														{/if}
													</select>
													<ChevronDown
														class="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
													/>
												</div>

												<!-- Tombol Tambah (Full width on mobile 2-col span, fits beside on desktop) -->
												<button
													type="button"
													class="col-span-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-2.5 text-xs font-bold text-white shadow-xs shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] sm:col-span-4"
													onclick={s.addRecipeItem}
												>
													<Plus class="h-4 w-4 stroke-[2.5]" />
													<span>Tambah Bahan</span>
												</button>
											</div>
										</div>

										<!-- Recipe Items List -->
										{#if currentPorsiRecipes.length === 0}
											<div
												class="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-3 text-center text-xs text-slate-400"
											>
												Belum ada bahan untuk resep {s.activeRecipePorsi}. Pilih bahan dan masukkan
												takaran di atas.
											</div>
										{:else}
											<div class="flex flex-col gap-1.5">
												{#each currentPorsiRecipes as recipe}
													{@const ing = s.bahanList.find((b) => b.id === recipe.bahan_id)}
													{@const baseQty = Number(
														recipe.jumlah_dasar_per_item ?? recipe.jumlah_per_item ?? 0
													)}
													{@const cost = Number(ing?.biaya_per_satuan || 0) * baseQty}
													<div
														class="flex items-center justify-between gap-2.5 rounded-xl border border-slate-200/70 bg-white p-3 text-xs shadow-2xs transition-all hover:border-pink-200"
													>
														<div class="min-w-0 flex-1">
															<div class="flex flex-wrap items-center gap-1.5">
																<span class="truncate font-black text-slate-900">
																	{s.getBahanName(recipe.bahan_id)}
																</span>
																{#if ing?.kategori && ing.kategori.toLowerCase() !== 'kategori'}
																	<span
																		class="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600"
																	>
																		{ing.kategori}
																	</span>
																{/if}
															</div>
															<div
																class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500"
															>
																<span
																	>Takaran: <span class="font-bold text-slate-800"
																		>{recipe.jumlah_per_item}
																		{recipe.satuan_resep || ing?.satuan || ''}</span
																	></span
																>
																{#if recipe.satuan_resep && recipe.satuan_resep !== ing?.satuan}
																	<span class="text-slate-400">
																		(setara {formatQuantity(baseQty)}
																		{ing?.satuan})
																	</span>
																{/if}
																{#if cost > 0}
																	<span class="text-slate-300">•</span>
																	<span class="font-semibold text-pink-700"
																		>Modal: Rp {formatRupiah(Math.round(cost))}</span
																	>
																{/if}
															</div>
														</div>

														<button
															type="button"
															class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-slate-50 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-90"
															onclick={() =>
																s.removeRecipeItem(recipe.bahan_id, s.activeRecipePorsi)}
															aria-label="Hapus bahan dari resep"
														>
															<Trash2 class="h-4 w-4" />
														</button>
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<!-- 2. BLOK STOK BARANG JADI -->
							<div
								class="overflow-hidden rounded-2xl border transition-all duration-200 {s.menuForm
									.lacak_stok
									? 'border-pink-500/80 bg-pink-50/30 shadow-xs ring-2 ring-pink-500/20'
									: 'border-slate-200 bg-white hover:border-slate-300'}"
							>
								<!-- Card Header / Toggle Area -->
								<div
									class="flex cursor-pointer items-center justify-between gap-3 p-3.5"
									onclick={() => s.setTrackStock(!s.menuForm.lacak_stok)}
									role="button"
									tabindex="0"
									onkeydown={(e) => e.key === 'Enter' && s.setTrackStock(!s.menuForm.lacak_stok)}
								>
									<div class="flex items-center gap-2.5">
										<div
											class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors {s
												.menuForm.lacak_stok
												? 'bg-pink-500 text-white shadow-xs shadow-pink-500/30'
												: 'bg-slate-100 text-slate-500'}"
										>
											<Package class="h-4.5 w-4.5 stroke-[2.2]" />
										</div>
										<div>
											<span class="text-sm font-bold text-slate-900">Stok Barang Jadi</span>
											<p class="text-xs text-slate-500">Potong langsung stok produk jadi.</p>
										</div>
									</div>

									<!-- Custom Animated Toggle Switch -->
									<div
										class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out {s
											.menuForm.lacak_stok
											? 'bg-pink-600'
											: 'bg-slate-200'}"
									>
										<span
											class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out {s
												.menuForm.lacak_stok
												? 'translate-x-4'
												: 'translate-x-0'}"
										></span>
									</div>
								</div>

								<!-- Expandable Stock Input (Directly Underneath Barang Jadi Card) -->
								{#if s.menuForm.lacak_stok}
									<div class="border-t border-pink-200/70 bg-white/90 p-4">
										<label for="menu-stok" class="block text-xs font-bold text-slate-700">
											Jumlah Stok Fisik Siap Jual
										</label>
										<div class="relative mt-1.5">
											<input
												type="number"
												id="menu-stok"
												min="0"
												step="1"
												class="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pr-14 pl-3.5 text-sm font-bold text-slate-900 transition-all focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
												bind:value={s.menuForm.stok}
												placeholder="0"
											/>
											<span
												class="absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
											>
												pcs
											</span>
										</div>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Tipe Menu -->
					<div class="flex flex-col gap-1.5">
						<span class="text-xs font-bold tracking-wider text-slate-700 uppercase">Tipe Menu</span>
						<div class="flex gap-2.5">
							<button
								type="button"
								class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors duration-150 {s
									.menuForm.tipe === 'minuman'
									? 'border-pink-500 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
									: 'border-slate-200/80 bg-white text-slate-600 hover:border-pink-200 hover:bg-slate-50'}"
								onclick={() => s.setMenuType('minuman')}
							>
								<CupIcon class="h-4 w-4" strokeWidth={2.2} />
								<span>Minuman</span>
							</button>
							<button
								type="button"
								class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors duration-150 {s
									.menuForm.tipe === 'makanan'
									? 'border-pink-500 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
									: 'border-slate-200/80 bg-white text-slate-600 hover:border-pink-200 hover:bg-slate-50'}"
								onclick={() => s.setMenuType('makanan')}
							>
								<Pizza class="h-4 w-4 stroke-[2.2]" />
								<span>Makanan</span>
							</button>
						</div>
					</div>

					<!-- Kategori -->
					<div class="flex flex-col gap-1.5">
						<span class="text-xs font-bold tracking-wider text-slate-700 uppercase">Kategori</span>
						<div class="scrollbar-hide flex gap-1.5 overflow-x-auto pb-1">
							{#each s.kategoriList as kat}
								<button
									type="button"
									class="flex-shrink-0 cursor-pointer rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors duration-150 {s
										.menuForm.kategori_id === kat.id
										? 'border-pink-500 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
										: 'border-slate-200/80 bg-white text-slate-600 hover:border-pink-200 hover:bg-slate-50'}"
									onclick={() =>
										s.setMenuKategori(s.menuForm.kategori_id === kat.id ? null : kat.id)}
								>
									{kat.nama}
								</button>
							{/each}
						</div>
					</div>

					<!-- Tambahan -->
					<div class="flex flex-col gap-1.5">
						<span class="text-xs font-bold tracking-wider text-slate-700 uppercase"
							>Tambahan (Opsional)</span
						>
						<div class="grid grid-cols-2 gap-2">
							{#each s.ekstraList as ekstra}
								<button
									type="button"
									class="cursor-pointer rounded-xl border p-2.5 text-left transition-all active:scale-[0.98] {s.menuForm.ekstra_ids.includes(
										ekstra.id
									)
										? 'border-pink-500 bg-pink-50/70 shadow-xs ring-2 ring-pink-500/20'
										: 'border-slate-200/80 bg-white hover:border-pink-200 hover:bg-slate-50'}"
									onclick={() => s.toggleEkstra(ekstra.id)}
								>
									<div class="truncate text-xs font-bold text-slate-800">{ekstra.nama}</div>
									<div class="mt-0.5 text-[11px] font-bold text-pink-600">
										+Rp {s.formatRupiah(ekstra.harga)}
									</div>
								</button>
							{/each}
						</div>
					</div>
				</form>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-5">
					<button
						type="submit"
						form="menu-form"
						disabled={s.isSavingMenu}
						onclick={(e) => {
							e.preventDefault();
							s.saveMenu(e);
						}}
						class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{#if s.isSavingMenu}
							<svg
								class="h-4 w-4 animate-spin text-white"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							<span>Menyimpan...</span>
						{:else}
							<span>{s.editMenuId ? 'Update Menu' : 'Simpan Menu'}</span>
						{/if}
					</button>
					<button
						type="button"
						disabled={s.isSavingMenu}
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
						onclick={s.closeMenuForm}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal untuk tambah/edit kategori -->
	{#if s.showKategoriDetailModal}
		<div
			class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeKategoriDetailModal()}
			onkeydown={(e) => e.key === 'Escape' && s.closeKategoriDetailModal()}
			onkeypress={(e) => e.key === 'Enter' && s.closeKategoriDetailModal()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				role="document"
			>
				<!-- Header -->
				<div
					class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
				>
					<div>
						<h2 class="text-lg font-black tracking-tight text-slate-900">
							{s.kategoriDetail ? 'Edit Kategori' : 'Tambah Kategori'}
						</h2>
						<p class="text-xs font-medium text-slate-500">Kelompokkan menu agar rapi di kasir</p>
					</div>
					<button
						type="button"
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-90"
						onclick={s.closeKategoriDetailModal}
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
							s.saveKategoriDetail();
						}}
						autocomplete="off"
					>
						<!-- Nama Kategori -->
						<div class="flex flex-col gap-1.5">
							<label
								for="kategori-name"
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
								>Nama Kategori</label
							>
							<input
								type="text"
								id="kategori-name"
								class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.kategoriDetailName}
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
								{#if s.selectedMenuIds.length > 0}
									{#each s.menus.filter( (menu) => s.selectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex max-w-[220px] cursor-pointer items-center truncate rounded-full bg-pink-100/90 px-3.5 py-1.5 text-xs font-bold text-pink-700 shadow-2xs transition-all hover:-translate-y-0.5 hover:bg-pink-200 hover:shadow-xs active:scale-95"
											title={menu.nama}
											onclick={() => s.toggleMenuInKategoriRealtime(menu.id)}
											in:fly={{ y: 16, duration: 180 }}
											out:fly={{ y: 16, duration: 180 }}
										>
											{menu.nama}
										</button>
									{/each}
								{:else}
									<span class="text-xs text-slate-400 italic"
										>Belum ada menu dalam kategori ini</span
									>
								{/if}
							</div>
						</div>

						<!-- Menu non Kategori -->
						<div class="flex flex-col gap-1.5">
							<label
								for="menu-non-kategori"
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
								>Menu non Kategori</label
							>
							<div
								class="flex min-h-[44px] flex-wrap gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
							>
								{#if s.unselectedMenuIds.length > 0}
									{#each s.menus.filter( (menu) => s.unselectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex max-w-[220px] cursor-pointer items-center truncate rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 shadow-2xs transition-all hover:-translate-y-0.5 hover:border-pink-300 hover:bg-pink-50/50 hover:text-pink-600 active:scale-95"
											title={menu.nama}
											onclick={() => s.toggleMenuInKategoriRealtime(menu.id)}
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
						class="flex-1 cursor-pointer rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-95"
					>
						{s.kategoriDetail ? 'Update Kategori' : 'Simpan Kategori'}
					</button>
					<button
						type="button"
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.closeKategoriDetailModal}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal untuk tambah/edit ekstra -->
	{#if s.showEkstraForm}
		<div
			class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeEkstraForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeEkstraForm()}
			onkeypress={(e) => e.key === 'Enter' && s.closeEkstraForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				role="document"
			>
				<!-- Header -->
				<div
					class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
				>
					<div>
						<h2 class="text-lg font-black tracking-tight text-slate-900">
							{s.editEkstraId ? 'Edit Tambahan' : 'Tambah Tambahan'}
						</h2>
						<p class="text-xs font-medium text-slate-500">Topping atau add-on ekstra pesanan</p>
					</div>
					<button
						type="button"
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-90"
						onclick={() => s.closeEkstraForm()}
						aria-label="Tutup modal"
					>
						<X class="h-4 w-4" />
					</button>
				</div>

				<form
					id="ekstra-form"
					class="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
					onsubmit={(e) => {
						e.preventDefault();
						s.saveEkstra();
					}}
					autocomplete="off"
				>
					<div class="flex flex-col gap-1.5">
						<label
							for="ekstra-name"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase">Nama Tambahan</label
						>
						<input
							type="text"
							id="ekstra-name"
							class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
							bind:value={s.ekstraForm.nama}
							required
							placeholder="Contoh: Bubble Boba, Extra Shot"
						/>
					</div>
					<div class="flex flex-col gap-1.5">
						<label
							for="ekstra-harga"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase"
							>Harga Tambahan</label
						>
						<div class="relative">
							<span
								class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
								>Rp</span
							>
							<input
								id="ekstra-harga"
								type="text"
								class="w-full rounded-xl border border-slate-200/90 bg-white py-3 pr-4 pl-10 text-sm font-bold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.ekstraForm.harga}
								oninput={s.handleRupiahInput(s.ekstraForm, 'harga')}
								required
								placeholder="0"
							/>
						</div>
					</div>

					<!-- Section Lacak Bahan & HPP Topping (Opsional) -->
					<div class="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5">
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-bold tracking-wider text-slate-700 uppercase">
								Lacak Bahan & Potong Stok (Opsional)
							</span>
							{#if selectedEkstraBahan}
								<button
									type="button"
									class="cursor-pointer text-[11px] font-bold text-rose-500 hover:text-rose-700"
									onclick={() => {
										s.ekstraForm.bahan_id = '';
										s.ekstraForm.jumlah_bahan = '';
										s.ekstraForm.satuan_resep = '';
									}}
								>
									Hapus Link
								</button>
							{/if}
						</div>

						<div class="relative">
							<select
								class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2.5 pr-9 pl-3 text-xs font-semibold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.ekstraForm.bahan_id}
								onchange={() => {
									if (selectedEkstraBahan) {
										s.ekstraForm.satuan_resep = selectedEkstraBahan.satuan;
									}
								}}
							>
								<option value="">-- Tanpa Bahan Baku (Add-on Saja) --</option>
								{#each s.bahanList.filter((b) => b.is_active !== false) as bahan}
									<option value={String(bahan.id)}>
										{bahan.nama} ({bahan.satuan})
									</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-400"
							/>
						</div>

						{#if selectedEkstraBahan}
							<div class="mt-3 grid grid-cols-2 gap-2">
								<div>
									<label
										for="ekstra-takaran"
										class="mb-1 block text-[11px] font-bold text-slate-600"
									>
										Takaran per Porsi
									</label>
									<input
										id="ekstra-takaran"
										type="number"
										step="any"
										class="w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs font-bold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
										placeholder="0"
										bind:value={s.ekstraForm.jumlah_bahan}
										required
									/>
								</div>
								<div>
									<label
										for="ekstra-satuan"
										class="mb-1 block text-[11px] font-bold text-slate-600"
									>
										Satuan
									</label>
									<div class="relative">
										<select
											id="ekstra-satuan"
											class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2 pr-7 pl-2.5 text-xs font-semibold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
											bind:value={s.ekstraForm.satuan_resep}
										>
											{#each ekstraCompatibleUnits as unit}
												<option value={unit.value}>{unit.label}</option>
											{/each}
										</select>
										<ChevronDown
											class="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
										/>
									</div>
								</div>
							</div>

							{#if ekstraModalHpp > 0}
								<div
									class="mt-3 flex items-center justify-between rounded-xl border border-pink-100 bg-pink-50/80 px-3 py-2 text-xs text-pink-900"
								>
									<span class="font-medium text-slate-600">Estimasi Modal Bahan:</span>
									<span class="font-extrabold text-pink-700"
										>Rp {formatRupiah(Math.round(ekstraModalHpp))}</span
									>
								</div>
							{/if}
						{/if}
					</div>
				</form>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-5">
					<button
						type="submit"
						form="ekstra-form"
						class="flex-1 cursor-pointer rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-95"
					>
						{s.editEkstraId ? 'Update Tambahan' : 'Simpan Tambahan'}
					</button>
					<button
						type="button"
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={() => s.closeEkstraForm()}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if s.showBahanForm}
		<div
			class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeBahanForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeBahanForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				role="document"
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
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-90"
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
						<label
							for="bahan-name"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase">Nama Bahan</label
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
									<span class="mt-0.5 text-[10px] font-medium text-slate-400"
										>({cat.defaultBase})</span
									>
								</button>
							{/each}
						</div>
					</div>

					<!-- Kategori Bahan (Bahan Baku / Topping / Kemasan) -->
					<div class="flex flex-col gap-1.5">
						<label
							for="bahan-kategori"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase"
							>Kategori Bahan</label
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
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
								>Satuan Simpan</label
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
							<label
								for="bahan-stock"
								class="text-xs font-bold tracking-wider text-slate-700 uppercase"
								>Stok Siap Pakai</label
							>
							<input
								id="bahan-stock"
								type="text"
								class="w-full rounded-xl border border-slate-200/90 bg-slate-50/60 px-4 py-3 text-sm font-bold text-slate-900 transition-all hover:border-pink-300 hover:bg-white focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={s.bahanForm.stok_saat_ini}
								oninput={s.handleRupiahInput(s.bahanForm, 'stok_saat_ini')}
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
								oninput={s.handleRupiahInput(s.bahanForm, 'isi_per_kemasan')}
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
							oninput={s.handleRupiahInput(s.bahanForm, 'ambang_stok')}
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
										oninput={s.handleRupiahInput(s.bahanForm, 'jumlah_beli_terakhir')}
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
												class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
												onclick={() => (s.bahanForm.yield_persen = '70')}
											>
												Alpukat/Mangga (70%)
											</button>
											<button
												type="button"
												class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
												onclick={() => (s.bahanForm.yield_persen = '45')}
											>
												Nanas (45%)
											</button>
											<button
												type="button"
												class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
												onclick={() => (s.bahanForm.yield_persen = '50')}
											>
												Jeruk (50%)
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/if}

						{#if Number(String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0) > 0}
							{@const numQty = Number(
								String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0
							)}
							{@const numCost = Number(
								String(s.bahanForm.biaya_beli_terakhir).replace(/\./g, '') || 0
							)}
							{@const packSize = Number(
								String(s.bahanForm.isi_per_kemasan).replace(/\./g, '') || 1
							)}
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
						class="flex-1 cursor-pointer rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-95"
					>
						{s.editBahanId ? 'Update Bahan' : 'Simpan Bahan'}
					</button>
					<button
						type="button"
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.closeBahanForm}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if s.showMutasiBahanForm}
		<div
			class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeMutasiBahanForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeMutasiBahanForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
				role="document"
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
						class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl bg-slate-100 text-slate-400 transition-all hover:bg-slate-200 hover:text-slate-700 active:scale-90"
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
						<label
							for="mutasi-delta"
							class="text-xs font-bold tracking-wider text-slate-700 uppercase"
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
						class="flex-1 cursor-pointer rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-95"
					>
						Simpan
					</button>
					<button
						type="button"
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.closeMutasiBahanForm}
					>
						Batal
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus menu -->
	{#if s.showDeleteModal}
		<div
			class="z-alert fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		>
			<div
				class="animate-slideUpModal relative mx-4 flex w-full max-w-xs flex-col items-center overflow-hidden rounded-2xl bg-white p-6 shadow-2xl"
			>
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-200/60"
				>
					<Trash2 class="h-6 w-6 stroke-[2.2]" />
				</div>
				<h2 class="mb-1.5 text-center text-base font-black text-slate-900">Hapus Menu?</h2>
				<p class="mb-5 text-center text-xs font-medium text-slate-500">
					Menu yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus menu ini?
				</p>
				<div class="flex w-full gap-2.5">
					<button
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.cancelDeleteMenu}>Batal</button
					>
					<button
						class="flex-1 cursor-pointer rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-95"
						onclick={s.doDeleteMenu}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus kategori -->
	{#if s.showDeleteKategoriModal}
		<div
			class="z-alert fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		>
			<div
				class="animate-slideUpModal relative mx-4 flex w-full max-w-xs flex-col items-center overflow-hidden rounded-2xl bg-white p-6 shadow-2xl"
			>
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-200/60"
				>
					<Trash2 class="h-6 w-6 stroke-[2.2]" />
				</div>
				<h2 class="mb-1.5 text-center text-base font-black text-slate-900">Hapus Kategori?</h2>
				<p class="mb-5 text-center text-xs font-medium text-slate-500">
					Kategori yang dihapus tidak dapat dikembalikan. Menu dalam kategori ini akan menjadi tanpa
					kategori.
				</p>
				<div class="flex w-full gap-2.5">
					<button
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.cancelDeleteKategori}>Batal</button
					>
					<button
						class="flex-1 cursor-pointer rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-95"
						onclick={s.doDeleteKategori}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus ekstra -->
	{#if s.showDeleteEkstraModal}
		<div
			class="z-alert fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		>
			<div
				class="animate-slideUpModal relative mx-4 flex w-full max-w-xs flex-col items-center overflow-hidden rounded-2xl bg-white p-6 shadow-2xl"
			>
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-200/60"
				>
					<Trash2 class="h-6 w-6 stroke-[2.2]" />
				</div>
				<h2 class="mb-1.5 text-center text-base font-black text-slate-900">Hapus Ekstra?</h2>
				<p class="mb-5 text-center text-xs font-medium text-slate-500">
					Ekstra yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus ekstra ini?
				</p>
				<div class="flex w-full gap-2.5">
					<button
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.cancelDeleteEkstra}>Batal</button
					>
					<button
						class="flex-1 cursor-pointer rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-95"
						onclick={s.doDeleteEkstra}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if s.showDeleteBahanModal}
		<div
			class="z-alert fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		>
			<div
				class="animate-slideUpModal relative mx-4 flex w-full max-w-xs flex-col items-center overflow-hidden rounded-2xl bg-white p-6 shadow-2xl"
			>
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-200/60"
				>
					<Trash2 class="h-6 w-6 stroke-[2.2]" />
				</div>
				<h2 class="mb-1.5 text-center text-base font-black text-slate-900">Hapus Bahan?</h2>
				<p class="mb-5 text-center text-xs font-medium text-slate-500">
					Bahan tidak bisa dihapus kalau masih dipakai resep menu.
				</p>
				<div class="flex w-full gap-2.5">
					<button
						class="flex-1 cursor-pointer rounded-xl bg-slate-100 py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-200 active:scale-95"
						onclick={s.cancelDeleteBahan}>Batal</button
					>
					<button
						class="flex-1 cursor-pointer rounded-xl bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-95"
						onclick={s.doDeleteBahan}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

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

<style>
	@keyframes slideUpModal {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
