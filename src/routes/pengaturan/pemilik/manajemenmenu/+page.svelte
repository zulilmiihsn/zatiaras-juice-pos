<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { goto } from '$app/navigation';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import {
		calculateEffectiveUnitCost,
		calculateUsableQuantity,
		isValidYieldPercent,
		normalizeYieldPercent
	} from '$lib/utils/ingredientCost';

	// Komponen Icon
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Plus from 'lucide-svelte/icons/plus';
	import Pizza from 'lucide-svelte/icons/pizza';
	import CupSoda from 'lucide-svelte/icons/cup-soda';

	// Sub Komponen Tab
	import MenuTab from '$lib/components/pengaturan/manajemenmenu/MenuTab.svelte';
	import KategoriTab from '$lib/components/pengaturan/manajemenmenu/KategoriTab.svelte';
	import EkstraTab from '$lib/components/pengaturan/manajemenmenu/EkstraTab.svelte';
	import BahanTab from '$lib/components/pengaturan/manajemenmenu/BahanTab.svelte';
	import HppTab from '$lib/components/pengaturan/manajemenmenu/HppTab.svelte';

	// Modal
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import CropperDialog from '$lib/components/shared/cropperDialog.svelte';

	const s = createManajemenmenuState();
</script>

{#if s.toastManager.showToast}
	<ToastNotification
		show={s.toastManager.showToast}
		message={s.toastManager.toastMessage}
		type={s.toastManager.toastType}
		position="top"
	/>
{/if}

<div transition:fly={{ y: 32, duration: 320, easing: cubicOut }}>
	<!-- Custom Top Bar -->
	<div
		class="sticky top-0 z-40 mb-0 flex items-center border-b border-gray-200 bg-white px-4 py-4 shadow-sm"
	>
		<button
			onclick={() => goto('/pengaturan/pemilik')}
			class="mr-2 rounded-xl bg-gray-100 p-2 transition-colors hover:bg-gray-200"
		>
			<ArrowLeft class="h-5 w-5 text-gray-600" />
		</button>
		<h1 class="text-xl font-bold text-gray-800">Manajemen Menu</h1>
	</div>

	<!-- Navigasi Tab Menu/Kategori/Ekstra/Bahan -->
	<div class="mx-auto max-w-4xl px-4 pt-3">
		<div
			class="relative mb-3 flex overflow-hidden rounded-xl border border-gray-100 bg-white p-1 shadow md:h-16 md:gap-6 md:text-lg"
		>
			<!-- Sliding Background -->
			<div
				class="absolute top-1 bottom-1 rounded-lg transition-all duration-300 ease-out {s.activeTab ===
				'menu'
					? 'left-1 w-[calc(20%-0.25rem)] bg-pink-500'
					: s.activeTab === 'kategori'
						? 'left-[calc(20%+0.125rem)] w-[calc(20%-0.25rem)] bg-blue-500'
						: s.activeTab === 'ekstra'
							? 'left-[calc(40%+0.125rem)] w-[calc(20%-0.25rem)] bg-green-500'
							: s.activeTab === 'bahan'
								? 'left-[calc(60%+0.125rem)] w-[calc(20%-0.25rem)] bg-amber-500'
								: 'left-[calc(80%+0.125rem)] w-[calc(20%-0.25rem)] bg-gray-700'}"
			></div>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all focus:outline-none sm:text-xs md:text-base {s.activeTab ===
				'menu'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (s.activeTab = 'menu')}>Menu</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all focus:outline-none sm:text-xs md:text-base {s.activeTab ===
				'kategori'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (s.activeTab = 'kategori')}>Kategori</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all focus:outline-none sm:text-xs md:text-base {s.activeTab ===
				'ekstra'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (s.activeTab = 'ekstra')}>Tambahan</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all focus:outline-none sm:text-xs md:text-base {s.activeTab ===
				'bahan'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (s.activeTab = 'bahan')}>Bahan</button
			>
			<button
				class="relative z-10 flex-1 rounded-lg py-2 text-[11px] font-semibold transition-all focus:outline-none sm:text-xs md:text-base {s.activeTab ===
				'hpp'
					? 'text-white'
					: 'text-gray-700'} md:px-8 md:py-4"
				onclick={() => (s.activeTab = 'hpp')}>HPP</button
			>
		</div>
	</div>

	<!-- Floating Action Button (FAB) bulat untuk tambah data sesuai tab aktif -->
	{#if s.activeTab === 'menu'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-pink-500 text-white shadow-lg transition-colors hover:bg-pink-600"
			onclick={() => s.openMenuForm()}
			aria-label="Tambah Menu"
		>
			<Plus class="h-8 w-8" />
		</button>
	{:else if s.activeTab === 'kategori'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-blue-500 text-white shadow-lg transition-colors hover:bg-blue-600"
			onclick={() => s.openKategoriForm(null)}
			aria-label="Tambah Kategori"
		>
			<Plus class="h-8 w-8" />
		</button>
	{:else if s.activeTab === 'ekstra'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lg transition-colors hover:bg-green-600"
			onclick={() => s.openEkstraForm()}
			aria-label="Tambah Tambahan"
		>
			<Plus class="h-8 w-8" />
		</button>
	{:else if s.activeTab === 'bahan'}
		<button
			class="fixed right-6 bottom-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500 text-white shadow-lg transition-colors hover:bg-amber-600"
			onclick={() => s.openBahanForm()}
			aria-label="Tambah Bahan"
		>
			<Plus class="h-8 w-8" />
		</button>
	{/if}

	<!-- Konten tab dengan transisi geser -->
	<div class="relative min-h-screen">
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
				bind:hppPurchaseText={s.hppPurchaseText}
				hppSettings={s.hppSettings}
				hppParsedItems={s.hppParsedItems}
				isParsingHpp={s.isParsingHpp}
				menus={s.menus}
				getOverheadMonthly={s.getOverheadMonthly}
				getOverheadPerItem={s.getOverheadPerItem}
				getProductRecipeCost={s.getProductRecipeCost}
				getProductHpp={s.getProductHpp}
				getProductMargin={s.getProductMargin}
				saveHppSettings={s.saveHppSettings}
				parseHppPurchaseText={s.parseHppPurchaseText}
				saveParsedHppItem={s.saveParsedHppItem}
			/>
		{/if}
	</div>

	<!-- Modal untuk tambah/edit menu -->
	{#if s.showMenuForm}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeMenuForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeMenuForm()}
			onkeypress={(e) => e.key === 'Enter' && s.closeMenuForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
				role="document"
			>
				<!-- Header -->
				<div class="flex-shrink-0 border-b border-gray-100 bg-white px-6 py-4">
					<h2 class="text-center text-xl font-bold text-gray-800">
						{s.editMenuId ? 'Edit Menu' : 'Tambah Menu Baru'}
					</h2>
				</div>

				<!-- Scrollable Form Content -->
				<form
					id="menu-form"
					class="flex flex-1 flex-col gap-6 overflow-y-auto p-6"
					onsubmit={s.saveMenu}
					autocomplete="off"
				>
					<!-- Preview Gambar Menu -->
					<div class="flex flex-col gap-3">
						<label for="menu-image" class="text-sm font-semibold text-gray-700">Gambar Menu</label>
						<div class="w-full">
							<button
								type="button"
								class="group relative w-full cursor-pointer"
								onclick={() => s.fileInputEl?.click()}
							>
								{#if s.menuForm.gambar}
									<div class="relative w-full">
										<img
											src={s.menuForm.gambar}
											alt="Preview Menu"
											class="aspect-square w-full rounded-xl border-2 border-gray-200 object-cover shadow-sm"
										/>
										<!-- Floating Delete Button -->
										<div
											class="absolute top-2 right-2 z-10 cursor-pointer rounded-full bg-red-500 p-2 text-white shadow-lg transition-all duration-200 hover:bg-red-600"
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
											<svg
												class="h-4 w-4"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/>
											</svg>
										</div>
										<div
											class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 opacity-0 transition-all duration-200 group-hover:opacity-100"
										>
											<div class="text-center">
												<svg
													class="mx-auto mb-2 h-8 w-8 text-white"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
													/>
												</svg>
												<span class="text-sm font-medium text-white">Klik untuk Ubah Gambar</span>
											</div>
										</div>
									</div>
								{:else}
									<div
										class="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 transition-all duration-200 group-hover:border-pink-300 group-hover:bg-gray-100"
									>
										<div class="text-center">
											<svg
												class="mx-auto mb-3 h-12 w-12 text-gray-400"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
												/>
											</svg>
											<span class="text-base font-medium text-gray-500"
												>Klik untuk Upload Gambar</span
											>
											<p class="mt-1 text-xs text-gray-400">PNG, JPG, atau GIF (Max. 5MB)</p>
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
					<div class="flex flex-col gap-2">
						<label for="menu-name" class="text-sm font-semibold text-gray-700">Nama Menu</label>
						<input
							type="text"
							id="menu-name"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
							bind:value={s.menuForm.nama}
							required
							placeholder="Contoh: Es Teh Manis"
						/>
					</div>

					<!-- Harga -->
					<div class="flex flex-col gap-2">
						<label for="menu-harga" class="text-sm font-semibold text-gray-700">Harga</label>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								type="text"
								id="menu-harga"
								class="w-full rounded-xl border border-gray-300 py-3 pr-4 pl-12 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
								bind:value={s.menuForm.harga}
								oninput={s.handleRupiahInput(s.menuForm, 'harga')}
								required
								placeholder="0"
							/>
						</div>
					</div>

					<!-- Stok Menu -->
					<div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
						<label class="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
							<span>
								<span class="block text-sm font-semibold text-gray-800">Stok barang jadi</span>
								<span class="mt-1 block text-xs text-gray-500"
									>Untuk snack, pudding, makanan siap jual.</span
								>
							</span>
							<input
								type="checkbox"
								class="h-5 w-5 rounded border-gray-300 text-pink-500 focus:ring-pink-500"
								bind:checked={s.menuForm.lacak_stok}
								onchange={(event) =>
									s.setTrackStock((event.currentTarget as HTMLInputElement).checked)}
							/>
						</label>
						{#if s.menuForm.lacak_stok}
							<div class="mt-4 flex flex-col gap-2">
								<label for="menu-stok" class="text-sm font-semibold text-gray-700"
									>Stok Saat Ini</label
								>
								<input
									type="number"
									id="menu-stok"
									min="0"
									step="1"
									class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-pink-500"
									bind:value={s.menuForm.stok}
									placeholder="0"
								/>
							</div>
						{/if}
						<label class="mt-4 flex items-center justify-between gap-4">
							<span>
								<span class="block text-sm font-semibold text-gray-800">Pakai resep bahan</span>
								<span class="mt-1 block text-xs text-gray-500"
									>Untuk jus made by order. Checkout potong stok buah, gula, susu, cup.</span
								>
							</span>
							<input
								type="checkbox"
								class="h-5 w-5 rounded border-gray-300 text-amber-500 focus:ring-amber-500"
								bind:checked={s.menuForm.lacak_bahan}
								onchange={(event) =>
									s.setTrackIngredients((event.currentTarget as HTMLInputElement).checked)}
							/>
						</label>
						{#if s.menuForm.lacak_bahan}
							<div class="mt-4 rounded-xl border border-amber-200 bg-white p-3">
								<div class="mb-3 grid grid-cols-[1fr_96px_auto] gap-2">
									<select
										class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
										bind:value={s.recipeDraft.bahan_id}
									>
										<option value="">Pilih bahan</option>
										{#each s.bahanList as bahan}
											<option value={bahan.id}>{bahan.nama} ({bahan.satuan})</option>
										{/each}
									</select>
									<input
										type="number"
										min="0"
										step="0.01"
										class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
										bind:value={s.recipeDraft.jumlah_per_item}
										placeholder="Takaran"
									/>
									<button
										type="button"
										class="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white"
										onclick={s.addRecipeItem}
									>
										Tambah
									</button>
								</div>
								{#if s.recipeItems.length === 0}
									<div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
										Belum ada bahan resep.
									</div>
								{:else}
									<div class="flex flex-col gap-2">
										{#each s.recipeItems as recipe}
											<div
												class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
											>
												<div class="min-w-0">
													<div class="truncate text-sm font-semibold text-gray-800">
														{s.getBahanName(recipe.bahan_id)}
													</div>
													<div class="text-xs text-gray-500">
														{s.formatRupiah(recipe.jumlah_per_item || 0)}
														{s.getBahanUnit(recipe.bahan_id)} per item
													</div>
												</div>
												<button
													type="button"
													class="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
													onclick={() => s.removeRecipeItem(recipe.bahan_id)}
												>
													Hapus
												</button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<!-- Tipe Menu -->
					<div class="flex flex-col gap-3">
						<label for="menu-type" class="text-sm font-semibold text-gray-700">Tipe Menu</label>
						<div class="flex gap-3">
							<button
								type="button"
								class="flex-1 rounded-xl border-2 px-4 py-3 font-medium transition-all duration-200 {s
									.menuForm.tipe === 'minuman'
									? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
									: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
								onclick={() => s.setMenuType('minuman')}
							>
								<div class="flex items-center justify-center gap-2">
									<CupSoda class="h-5 w-5" />
									<span class="text-sm">Minuman</span>
								</div>
							</button>
							<button
								type="button"
								class="flex-1 rounded-xl border-2 px-4 py-3 font-medium transition-all duration-200 {s
									.menuForm.tipe === 'makanan'
									? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
									: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
								onclick={() => s.setMenuType('makanan')}
							>
								<div class="flex items-center justify-center gap-2">
									<Pizza class="h-5 w-5" />
									<span class="text-sm">Makanan</span>
								</div>
							</button>
						</div>
					</div>

					<!-- Kategori -->
					<div class="flex flex-col gap-3">
						<label for="menu-kategori" class="text-sm font-semibold text-gray-700">Kategori</label>
						<div class="scrollbar-hide flex gap-2 overflow-x-auto pb-2">
							{#each s.kategoriList as kat}
								<button
									type="button"
									class="flex-shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-200 {s
										.menuForm.kategori_id === kat.id
										? 'border-pink-500 bg-pink-500 text-white shadow-lg shadow-pink-200'
										: 'border-gray-200 bg-white text-gray-700 hover:border-pink-300 hover:bg-pink-50'}"
									onclick={() =>
										s.setMenuKategori(s.menuForm.kategori_id === kat.id ? null : kat.id)}
								>
									{kat.nama}
								</button>
							{/each}
						</div>
					</div>

					<!-- Tambahan -->
					<div class="flex flex-col gap-3">
						<label for="menu-tambahan" class="text-sm font-semibold text-gray-700">Tambahan</label>
						<div class="grid grid-cols-2 gap-3">
							{#each s.ekstraList as ekstra}
								<button
									type="button"
									class="rounded-xl border-2 p-3 text-left transition-all duration-200 {s.menuForm.ekstra_ids.includes(
										ekstra.id
									)
										? 'border-pink-500 bg-pink-50 shadow-lg shadow-pink-100'
										: 'border-gray-200 bg-white hover:border-pink-300 hover:bg-pink-50'}"
									onclick={() => s.toggleEkstra(ekstra.id)}
								>
									<div class="mb-0.5 text-sm font-medium text-gray-800">{ekstra.nama}</div>
									<div class="text-xs font-semibold text-pink-600">
										+Rp {s.formatRupiah(ekstra.harga)}
									</div>
								</button>
							{/each}
						</div>
					</div>
				</form>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-gray-100 bg-white p-6">
					<button
						type="submit"
						form="menu-form"
						class="flex-1 rounded-xl bg-pink-500 py-3 font-semibold text-white shadow-lg shadow-pink-200 transition-all duration-200 hover:bg-pink-600 active:bg-pink-700"
					>
						{s.editMenuId ? 'Update Menu' : 'Simpan Menu'}
					</button>
					<button
						type="button"
						class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
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
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeKategoriDetailModal()}
			onkeydown={(e) => e.key === 'Escape' && s.closeKategoriDetailModal()}
			onkeypress={(e) => e.key === 'Enter' && s.closeKategoriDetailModal()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
				role="document"
			>
				<!-- Header -->
				<div class="flex-shrink-0 border-b border-gray-100 p-6">
					<h2 class="text-center text-xl font-bold text-gray-800">
						{s.kategoriDetail ? 'Edit Kategori' : 'Tambah Kategori'}
					</h2>
				</div>

				<!-- Content -->
				<div class="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
					<form
						id="kategori-form"
						class="flex flex-col gap-6"
						onsubmit={s.saveKategoriDetail}
						autocomplete="off"
					>
						<!-- Nama Kategori -->
						<div class="flex flex-col gap-2">
							<label for="kategori-name" class="mb-1 text-sm font-semibold text-gray-700"
								>Nama Kategori</label
							>
							<input
								type="text"
								id="kategori-name"
								class="w-full rounded-xl border border-blue-200 bg-white px-5 py-3 text-base placeholder-gray-400 shadow-sm transition-all focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
								bind:value={s.kategoriDetailName}
								required
								placeholder="Masukkan nama kategori"
							/>
						</div>

						<!-- Menu dalam Kategori -->
						<div class="flex flex-col gap-2">
							<label for="menu-dalam-kategori" class="mb-1 text-sm font-semibold text-gray-700"
								>Menu dalam Kategori</label
							>
							<div class="flex min-h-[48px] flex-wrap gap-2">
								{#if s.selectedMenuIds.length > 0}
									{#each s.menus.filter( (menu) => s.selectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex items-center rounded-full bg-blue-100 px-4 py-2 font-medium text-blue-700 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:ring-2 focus:ring-blue-200 focus:outline-none"
											style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
											title={menu.nama}
											onclick={() => s.toggleMenuInKategoriRealtime(menu.id)}
											in:fly={{ y: 16, duration: 180 }}
											out:fly={{ y: 16, duration: 180 }}
										>
											{menu.nama}
										</button>
									{/each}
								{:else}
									<span class="text-sm text-gray-400 italic">Belum ada menu dalam kategori ini</span
									>
								{/if}
							</div>
						</div>

						<!-- Menu non Kategori -->
						<div class="flex flex-col gap-2">
							<label for="menu-non-kategori" class="mb-1 text-sm font-semibold text-gray-700"
								>Menu non Kategori</label
							>
							<div class="flex min-h-[48px] flex-wrap gap-2">
								{#if s.unselectedMenuIds.length > 0}
									{#each s.menus.filter( (menu) => s.unselectedMenuIds.includes(menu.id) ) as menu (menu.id)}
										<button
											type="button"
											class="inline-flex items-center rounded-full border border-blue-200 bg-white px-4 py-2 font-medium text-blue-500 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-md focus:ring-2 focus:ring-blue-100 focus:outline-none"
											style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
											title={menu.nama}
											onclick={() => s.toggleMenuInKategoriRealtime(menu.id)}
											in:fly={{ y: 16, duration: 180 }}
											out:fly={{ y: 16, duration: 180 }}
										>
											{menu.nama}
										</button>
									{/each}
								{:else}
									<span class="text-sm text-gray-400 italic">Semua menu sudah masuk kategori</span>
								{/if}
							</div>
						</div>
					</form>
				</div>

				<!-- Fixed Action Buttons -->
				<div class="flex flex-shrink-0 gap-3 border-t border-gray-100 bg-white p-6">
					<button
						type="submit"
						form="kategori-form"
						class="flex-1 rounded-xl bg-blue-500 py-3 font-semibold text-white shadow-lg shadow-blue-200 transition-all duration-200 hover:bg-blue-600 active:bg-blue-700"
					>
						{s.kategoriDetail ? 'Update Kategori' : 'Simpan Kategori'}
					</button>
					<button
						type="button"
						class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
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
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeEkstraForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeEkstraForm()}
			onkeypress={(e) => e.key === 'Enter' && s.closeEkstraForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal relative mx-4 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
				role="document"
			>
				<h2 class="mb-4 text-center text-lg font-bold text-gray-800">
					{s.editEkstraId ? 'Edit Tambahan' : 'Tambah Tambahan'}
				</h2>
				<form class="flex flex-col gap-4" onsubmit={s.saveEkstra} autocomplete="off">
					<div class="flex flex-col gap-2">
						<label for="ekstra-name" class="font-semibold text-gray-700">Nama Tambahan</label>
						<input
							type="text"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-green-500"
							bind:value={s.ekstraForm.nama}
							required
							placeholder="Contoh: Es Teh Manis"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="ekstra-harga" class="font-semibold text-gray-700">Harga Tambahan</label>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								type="text"
								class="w-full rounded-xl border border-gray-300 py-3 pr-4 pl-12 text-base transition-all focus:border-transparent focus:ring-2 focus:ring-green-500"
								bind:value={s.ekstraForm.harga}
								oninput={s.handleRupiahInput(s.ekstraForm, 'harga')}
								required
								placeholder="0"
							/>
						</div>
					</div>
					<div class="mt-4 flex gap-2">
						<button
							type="submit"
							class="flex-1 rounded-xl bg-green-500 py-3 font-semibold text-white shadow-lg shadow-green-200 transition-all duration-200 hover:bg-green-600 active:bg-green-700"
							>Simpan</button
						>
						<button
							type="button"
							class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-all duration-200 hover:bg-gray-200 active:bg-gray-300"
							onclick={() => s.closeEkstraForm()}>Batal</button
						>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if s.showBahanForm}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeBahanForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeBahanForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				role="document"
			>
				<h2 class="mb-4 text-center text-lg font-bold text-gray-800">
					{s.editBahanId ? 'Edit Bahan' : 'Tambah Bahan'}
				</h2>
				<form class="flex flex-col gap-4" onsubmit={s.saveBahan} autocomplete="off">
					<div class="flex flex-col gap-2">
						<label for="bahan-name" class="font-semibold text-gray-700">Nama Bahan</label>
						<input
							id="bahan-name"
							type="text"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
							bind:value={s.bahanForm.nama}
							required
							placeholder="Contoh: Alpukat"
						/>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div class="flex flex-col gap-2">
							<label for="bahan-satuan" class="font-semibold text-gray-700">Satuan</label>
							<select
								id="bahan-satuan"
								class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
								bind:value={s.bahanForm.satuan}
							>
								<option value="gram">gram</option>
								<option value="ml">ml</option>
								<option value="pcs">pcs</option>
								<option value="buah">buah</option>
							</select>
						</div>
						<div class="flex flex-col gap-2">
							<label for="bahan-stock" class="font-semibold text-gray-700">Stok Siap Pakai</label>
							<input
								id="bahan-stock"
								type="text"
								class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
								bind:value={s.bahanForm.stok_saat_ini}
								oninput={s.handleRupiahInput(s.bahanForm, 'stok_saat_ini')}
								placeholder="0"
							/>
						</div>
					</div>
					<div class="flex flex-col gap-2">
						<label for="bahan-low" class="font-semibold text-gray-700">Minimum Stok</label>
						<input
							id="bahan-low"
							type="text"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
							bind:value={s.bahanForm.ambang_stok}
							oninput={s.handleRupiahInput(s.bahanForm, 'ambang_stok')}
							placeholder="0"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<label for="bahan-yield" class="font-semibold text-gray-700">Yield Siap Pakai</label>
						<div class="relative">
							<input
								id="bahan-yield"
								type="text"
								inputmode="decimal"
								class="w-full rounded-xl border border-gray-300 py-3 pr-12 pl-4 text-base focus:ring-2 focus:ring-amber-300"
								bind:value={s.bahanForm.yield_persen}
								required
								placeholder="100"
							/>
							<span class="absolute top-1/2 right-4 -translate-y-1/2 font-semibold text-gray-400"
								>%</span
							>
						</div>
						<p class="text-xs leading-relaxed text-gray-500">
							Persentase bahan setelah kulit, biji, batang, atau bagian terbuang. Gunakan 100% untuk
							bahan tanpa susut.
						</p>
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div class="flex flex-col gap-2">
							<label for="bahan-purchase-jumlah" class="font-semibold text-gray-700"
								>Jumlah Beli Kotor</label
							>
							<input
								id="bahan-purchase-jumlah"
								type="text"
								class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
								bind:value={s.bahanForm.jumlah_beli_terakhir}
								oninput={s.handleRupiahInput(s.bahanForm, 'jumlah_beli_terakhir')}
								placeholder="Contoh: 1.000"
							/>
						</div>
						<div class="flex flex-col gap-2">
							<label for="bahan-purchase-cost" class="font-semibold text-gray-700"
								>Harga Beli Total</label
							>
							<div class="relative">
								<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
									>Rp</span
								>
								<input
									id="bahan-purchase-cost"
									type="text"
									class="w-full rounded-xl border border-gray-300 py-3 pr-4 pl-12 text-base focus:ring-2 focus:ring-amber-300"
									bind:value={s.bahanForm.biaya_beli_terakhir}
									oninput={s.handleRupiahInput(s.bahanForm, 'biaya_beli_terakhir')}
									placeholder="18.000"
								/>
							</div>
						</div>
					</div>
					{#if Number(String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0) > 0 && isValidYieldPercent(s.bahanForm.yield_persen)}
						<div class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
							<div class="font-semibold">
								Siap dipakai {formatRupiah(
									calculateUsableQuantity(
										Number(String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0),
										normalizeYieldPercent(s.bahanForm.yield_persen)
									)
								)}
								{s.bahanForm.satuan}
							</div>
							<div class="mt-1 font-bold text-amber-800">
								HPP efektif Rp {formatRupiah(
									Math.round(
										calculateEffectiveUnitCost(
											Number(String(s.bahanForm.biaya_beli_terakhir).replace(/\./g, '') || 0),
											Number(String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0),
											normalizeYieldPercent(s.bahanForm.yield_persen)
										)
									)
								)} per {s.bahanForm.satuan}
							</div>
						</div>
					{:else if Number(String(s.bahanForm.jumlah_beli_terakhir).replace(/\./g, '') || 0) > 0}
						<div class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
							Yield harus lebih dari 0% dan maksimal 100%.
						</div>
					{/if}
					<div class="mt-4 flex gap-2">
						<button
							type="submit"
							class="flex-1 rounded-xl bg-amber-500 py-3 font-semibold text-white transition-colors hover:bg-amber-600"
							>Simpan</button
						>
						<button
							type="button"
							class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200"
							onclick={s.closeBahanForm}>Batal</button
						>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if s.showMutasiBahanForm}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
			role="dialog"
			aria-modal="true"
			onclick={(e) => e.target === e.currentTarget && s.closeMutasiBahanForm()}
			onkeydown={(e) => e.key === 'Escape' && s.closeMutasiBahanForm()}
			tabindex="-1"
		>
			<div
				class="animate-slideUpModal relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
				role="document"
			>
				<h2 class="mb-4 text-center text-lg font-bold text-gray-800">Ubah Stok Bahan</h2>
				<form class="flex flex-col gap-4" onsubmit={s.saveMutasiBahan} autocomplete="off">
					<div class="flex flex-col gap-2">
						<label for="mutasi-delta" class="font-semibold text-gray-700">Jumlah</label>
						<input
							id="mutasi-delta"
							type="number"
							step="0.01"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
							bind:value={s.mutasiBahanForm.delta_jumlah}
							required
							placeholder="Contoh: 500 atau -100"
						/>
						<p class="text-xs text-gray-500">
							Angka positif untuk stok masuk, negatif untuk koreksi keluar.
						</p>
					</div>
					<div class="flex flex-col gap-2">
						<label for="mutasi-catatan" class="font-semibold text-gray-700">Catatan</label>
						<input
							id="mutasi-catatan"
							type="text"
							class="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:ring-2 focus:ring-amber-300"
							bind:value={s.mutasiBahanForm.catatan}
							placeholder="Belanja bahan / koreksi opname"
						/>
					</div>
					<div class="mt-4 flex gap-2">
						<button
							type="submit"
							class="flex-1 rounded-xl bg-amber-500 py-3 font-semibold text-white transition-colors hover:bg-amber-600"
							>Simpan</button
						>
						<button
							type="button"
							class="flex-1 rounded-xl bg-gray-100 py-3 font-semibold text-gray-700 transition-colors hover:bg-gray-200"
							onclick={s.closeMutasiBahanForm}>Batal</button
						>
					</div>
				</form>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus menu -->
	{#if s.showDeleteModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Menu?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Menu yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus menu ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={s.cancelDeleteMenu}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={s.doDeleteMenu}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus kategori -->
	{#if s.showDeleteKategoriModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Kategori?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Kategori yang dihapus tidak dapat dikembalikan. Menu dalam kategori ini akan menjadi tanpa
					kategori. Yakin ingin menghapus kategori ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={s.cancelDeleteKategori}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={s.doDeleteKategori}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal konfirmasi hapus ekstra -->
	{#if s.showDeleteEkstraModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Ekstra?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Ekstra yang dihapus tidak dapat dikembalikan. Yakin ingin menghapus ekstra ini?
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={s.cancelDeleteEkstra}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
						onclick={s.doDeleteEkstra}>Hapus</button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if s.showDeleteBahanModal}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div
				class="animate-slideUpModal relative flex w-full max-w-xs flex-col items-center rounded-2xl bg-white p-6 shadow-xl"
			>
				<h2 class="mb-2 text-center text-lg font-bold text-gray-800">Hapus Bahan?</h2>
				<p class="mb-6 text-center text-sm text-gray-500">
					Bahan tidak bisa dihapus kalau masih dipakai resep menu.
				</p>
				<div class="flex w-full gap-3">
					<button
						class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
						onclick={s.cancelDeleteBahan}>Batal</button
					>
					<button
						class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
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
