<script lang="ts">
	import { fly } from 'svelte/transition';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Plus from '@lucide/svelte/icons/plus';
	import Pizza from '@lucide/svelte/icons/pizza';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
	import Package from '@lucide/svelte/icons/package';
	import {
		formatRupiah,
		handleRupiahInput,
		handleQuantityInput,
		formatQuantityField,
		parseQuantityInput
	} from '$lib/utils/currency';
	import { calculateEffectiveUnitCost } from '$lib/utils/ingredientCost';
	import {
		UNIT_CATEGORIES,
		convertToBaseUnit,
		safeConvertToBaseUnit,
		getCompatibleUnits,
		formatQuantity,
		type UnitCategory,
		type UnitOption
	} from '$lib/utils/unitConversion';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';

	// KENAPA: form tambah/edit menu adalah blok terbesar halaman (resep +
	// stok + gambar + HPP); satu state store + satu submit. Terima store utuh
	// agar diff perilaku nol; derived resep pindah ikut modal.
	let { s }: { s: ReturnType<typeof createManajemenmenuState> } = $props();

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
</script>

<!-- Modal tambah/edit menu -->
<AppModal
	open={s.showMenuForm}
	label={s.editMenuId ? 'Edit Menu' : 'Tambah Menu Baru'}
	size="md"
	align="center"
	panelClass="bg-white"
	onClose={s.closeMenuForm}
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
				{s.editMenuId ? 'Perbarui informasi dan resep produk' : 'Lengkapi detail produk menu baru'}
			</p>
		</div>
		<button
			type="button"
			class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-all hover:bg-pink-100 hover:text-pink-700 active:scale-90"
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
			<label for="menu-image" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
				>Gambar Menu</label
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
								onkeypress={(e) => e.key === 'Enter' && (e.stopPropagation(), s.removeImage())}
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
				<label for="menu-harga" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
					>Harga Reguler</label
				>
				<div class="relative">
					<span class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
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
					<span class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
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
						onkeydown={(e) => e.key === 'Enter' && s.setTrackIngredients(!s.menuForm.lacak_bahan)}
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
									<span class="text-xs font-extrabold tracking-wider text-slate-800 uppercase">
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
												{bahan.nama} ({bahan.satuan}) {bahan.kategori ? `• ${bahan.kategori}` : ''}
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
										class="col-span-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-4 py-2.5 text-xs font-bold text-white shadow-xs shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98] sm:col-span-4"
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
												class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-slate-50 text-slate-400 ring-1 ring-slate-200/60 transition-all hover:bg-rose-50 hover:text-rose-600 hover:ring-rose-200 active:scale-90"
												onclick={() => s.removeRecipeItem(recipe.bahan_id, s.activeRecipePorsi)}
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
					class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border py-2.5 text-xs font-bold transition-all duration-150 active:scale-95 {s
						.menuForm.tipe === 'minuman'
						? 'border-pink-300 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
						: 'border-slate-200/80 bg-white text-slate-600 hover:border-pink-200 hover:bg-slate-50'}"
					onclick={() => s.setMenuType('minuman')}
				>
					<CupIcon class="h-4 w-4" strokeWidth={2.2} />
					<span>Minuman</span>
				</button>
				<button
					type="button"
					class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full border py-2.5 text-xs font-bold transition-all duration-150 active:scale-95 {s
						.menuForm.tipe === 'makanan'
						? 'border-pink-300 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
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
						class="flex-shrink-0 cursor-pointer rounded-full border px-4 py-2 text-xs font-bold transition-all duration-150 active:scale-95 {s
							.menuForm.kategori_id === kat.id
							? 'border-pink-300 bg-pink-50/80 text-pink-700 shadow-xs ring-2 ring-pink-500/20'
							: 'border-slate-200/80 bg-white text-slate-600 hover:border-pink-200 hover:bg-slate-50'}"
						onclick={() => s.setMenuKategori(s.menuForm.kategori_id === kat.id ? null : kat.id)}
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
			class="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
		>
			{#if s.isSavingMenu}
				<svg
					class="h-4 w-4 animate-spin text-white"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
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
			class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
			onclick={s.closeMenuForm}
		>
			Batal
		</button>
	</div>
</AppModal>

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
