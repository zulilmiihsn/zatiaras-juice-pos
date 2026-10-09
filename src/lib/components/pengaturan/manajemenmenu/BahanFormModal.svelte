<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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
		ALL_UNITS,
		getCompatibleUnits,
		safeConvertToBaseUnit,
		formatQuantity,
		type UnitCategory
	} from '$lib/utils/unitConversion';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';

	// KENAPA: form tambah/edit bahan satu unit dengan kategori/ekstra (satu
	// state store + kalkulator kulakan); terima store utuh agar diff nol.
	let { s }: { s: ReturnType<typeof createManajemenmenuState> } = $props();
</script>

<!-- Modal tambah/edit bahan -->
<AppModal
	open={s.showBahanForm}
	label={s.editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
	size="sm"
	align="center"
	panelClass="bg-white"
	onClose={s.closeBahanForm}
>
	<!-- Header -->
	<div
		class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
	>
		<div>
			<h2 class="text-lg font-black tracking-tight text-slate-900">
				{s.editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
			</h2>
			<p class="text-xs font-medium text-slate-500">Kelola master bahan baku dan biaya pembelian</p>
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
			<label for="bahan-kategori" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
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
				<label for="bahan-satuan" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
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
