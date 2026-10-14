<script lang="ts">
	import { previewBahanCost } from '$lib/utils/bahanForm';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import { formatRupiah, parseQuantityInput } from '$lib/utils/currency';
	import { UNIT_CATEGORIES, formatQuantity } from '$lib/utils/unitConversion';
	import type { StokState } from '$lib/stores/stokState.svelte';

	let { s }: { s: StokState } = $props();
</script>

<!-- Modal Tambah / Edit Bahan -->
<AppModal
	open={s.showBahanModal}
	labelledby="stok-bahan-title"
	size="sm"
	align="center"
	panelClass="border border-pink-100/90 bg-white ring-1 ring-pink-500/10"
	onClose={s.closeBahanModal}
>
	<div
		class="flex flex-shrink-0 items-center justify-between border-b border-pink-100/80 bg-gradient-to-r from-pink-50/90 via-rose-50/80 to-pink-50/90 px-6 py-4.5"
	>
		<div class="flex items-center gap-3.5">
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 text-white shadow-sm shadow-pink-500/25"
			>
				<Boxes class="h-5 w-5 stroke-[2.2]" />
			</div>
			<div>
				<h2 id="stok-bahan-title" class="text-lg font-black tracking-tight text-slate-900">
					{s.editBahanId ? 'Edit Bahan Baku' : 'Tambah Bahan Baku'}
				</h2>
				<p class="text-xs font-medium text-slate-500 sm:text-sm">
					{s.editBahanId
						? 'Perbarui data stok & kalkulator modal'
						: 'Daftarkan bahan baku & takaran saji baru'}
				</p>
			</div>
		</div>
		<button
			type="button"
			class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-pink-100/70 hover:text-slate-700 active:scale-95"
			onclick={s.closeBahanModal}
			aria-label="Tutup modal"
		>
			<X class="h-4 w-4 stroke-[2.2]" />
		</button>
	</div>

	<form
		id="stok-bahan-form"
		class="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
		onsubmit={s.handleSaveBahan}
		autocomplete="off"
	>
		<div class="flex flex-col gap-1.5">
			<label
				for="modal-bahan-nama"
				class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
			>
				Nama Bahan
			</label>
			<input
				id="modal-bahan-nama"
				type="text"
				class="w-full rounded-2xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
				bind:value={s.bahanForm.nama}
				required
				placeholder="Contoh: Alpukat Mentega, Gula Pasir, Cup 16oz"
			/>
		</div>

		<!-- Tipe Satuan / Sifat Bahan -->
		<div class="flex flex-col gap-1.5">
			<span class="text-xs font-bold tracking-wider text-zinc-700 uppercase">
				Tipe Takaran / Sifat Bahan
			</span>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{#each UNIT_CATEGORIES as cat}
					<button
						type="button"
						class="flex cursor-pointer flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all {s
							.bahanForm.tipe_satuan === cat.value
							? 'border-pink-500 bg-pink-50/80 font-bold text-pink-700 shadow-xs ring-2 ring-pink-500/20'
							: 'border-zinc-200/80 bg-zinc-50/50 text-zinc-600 hover:border-pink-200 hover:bg-white'}"
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
						<span class="mt-0.5 text-[10px] font-medium text-zinc-400">({cat.defaultBase})</span>
					</button>
				{/each}
			</div>
		</div>

		<div class="flex flex-col gap-1.5">
			<label
				for="modal-bahan-kategori"
				class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
			>
				Kategori Bahan
			</label>
			<div class="flex flex-col gap-2">
				<div class="relative">
					<select
						id="modal-bahan-kategori"
						class="w-full cursor-pointer appearance-none rounded-2xl border-0 bg-zinc-50 py-3 pr-10 pl-4 text-sm font-medium text-zinc-900 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
						bind:value={s.bahanForm.kategoriSelect}
					>
						{#each s.availableCategoryOptions as cat}
							<option value={cat}>{cat}</option>
						{/each}
						<option value="__new__">+ Buat Kategori Baru...</option>
					</select>
					<ChevronDown
						class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400"
					/>
				</div>

				{#if s.bahanForm.kategoriSelect === '__new__'}
					<input
						type="text"
						class="w-full rounded-2xl border-0 bg-pink-50/50 px-4 py-2.5 text-sm font-semibold text-zinc-900 ring-1 ring-pink-300 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
						bind:value={s.bahanForm.customKategori}
						placeholder="Ketik nama kategori baru (contoh: Kemasan, Buah Segar)"
						required
					/>
				{/if}
			</div>
		</div>

		<!-- Satuan Dasar & Stok Siap Pakai -->
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1.5">
				<label
					for="modal-bahan-satuan"
					class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
				>
					Satuan Simpan
				</label>
				<div class="relative">
					<select
						id="modal-bahan-satuan"
						class="w-full cursor-pointer appearance-none rounded-2xl border-0 bg-zinc-50 py-3 pr-10 pl-4 text-sm text-zinc-900 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:bg-white focus:ring-2 focus:ring-pink-500 focus:outline-none"
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
						class="pointer-events-none absolute top-1/2 right-3.5 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400"
					/>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<label
					for="modal-bahan-stok"
					class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
				>
					Stok Siap Pakai
				</label>
				<input
					id="modal-bahan-stok"
					type="text"
					class="w-full rounded-2xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
					bind:value={s.bahanForm.stok_saat_ini}
					oninput={(e) => s.handleRupiahFormat(e, 'stok_saat_ini')}
					onblur={() => s.handleQuantityBlur('stok_saat_ini')}
					placeholder="0"
				/>
			</div>
		</div>

		{#if s.bahanForm.tipe_satuan === 'kemasan'}
			<div class="flex flex-col gap-1.5">
				<label
					for="modal-bahan-isi-kemasan"
					class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
				>
					1 Pack/Bungkus Isi Berapa Pcs?
				</label>
				<input
					id="modal-bahan-isi-kemasan"
					type="text"
					class="w-full rounded-2xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
					bind:value={s.bahanForm.isi_per_kemasan}
					oninput={(e) => s.handleRupiahFormat(e, 'isi_per_kemasan')}
					onblur={() => s.handleQuantityBlur('isi_per_kemasan')}
					placeholder="Contoh: 50"
				/>
			</div>
		{/if}

		<div class="flex flex-col gap-1.5">
			<label
				for="modal-bahan-ambang"
				class="text-xs font-bold tracking-wider text-zinc-700 uppercase"
			>
				Batas Peringatan Habis ({s.bahanForm.satuan})
			</label>
			<input
				id="modal-bahan-ambang"
				type="text"
				class="w-full rounded-2xl border-0 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
				bind:value={s.bahanForm.ambang_stok}
				oninput={(e) => s.handleRupiahFormat(e, 'ambang_stok')}
				onblur={() => s.handleQuantityBlur('ambang_stok')}
				placeholder="Contoh: 5"
			/>
			<p class="text-xs text-zinc-400">
				Jika stok di bawah angka ini, muncul status peringatan stok.
			</p>
		</div>

		<!-- Pembelian / Kulakan Grosir -->
		<div class="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-3.5">
			<div class="mb-2 text-xs font-extrabold tracking-wider text-zinc-800 uppercase">
				Kalkulator Kulakan / Pembelian Grosir
			</div>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<label for="modal-bahan-beli-qty" class="text-[11px] font-bold text-zinc-600">
						Jumlah Beli
					</label>
					<div class="flex gap-2">
						<input
							id="modal-bahan-beli-qty"
							type="text"
							class="w-full rounded-2xl border-0 bg-white px-3.5 py-2.5 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
							bind:value={s.bahanForm.jumlah_beli_terakhir}
							oninput={(e) => s.handleRupiahFormat(e, 'jumlah_beli_terakhir')}
							onblur={() => s.handleQuantityBlur('jumlah_beli_terakhir')}
							placeholder="1"
						/>
						<div class="relative w-28">
							<select
								class="w-full cursor-pointer appearance-none rounded-2xl border-0 bg-white py-2.5 pr-7 pl-2.5 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 transition-all ring-inset hover:ring-pink-300 focus:ring-2 focus:ring-pink-500 focus:outline-none"
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
								class="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
							/>
						</div>
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="modal-bahan-beli-cost" class="text-[11px] font-bold text-zinc-600">
						Total Harga Beli
					</label>
					<div class="relative">
						<span class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-zinc-400"
							>Rp</span
						>
						<input
							id="modal-bahan-beli-cost"
							type="text"
							class="w-full rounded-2xl border-0 bg-white py-2.5 pr-3 pl-9 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
							bind:value={s.bahanForm.biaya_beli_terakhir}
							oninput={(e) => s.handleRupiahFormat(e, 'biaya_beli_terakhir')}
							placeholder="35.000"
						/>
					</div>
				</div>
			</div>

			<!-- Hitung Susut Kulit/Biji (Hanya untuk Buah Segar / Tipe Berat & Unit) -->
			{#if s.bahanForm.tipe_satuan === 'berat' || s.bahanForm.tipe_satuan === 'unit'}
				<div class="mt-3 flex flex-col gap-2 border-t border-zinc-200/60 pt-3">
					<div class="flex items-center justify-between">
						<label
							class="flex cursor-pointer items-center gap-2 text-xs font-bold text-zinc-700 select-none"
						>
							<input
								type="checkbox"
								class="h-4 w-4 rounded border-zinc-300 text-pink-600 focus:ring-pink-500/20"
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
									id="modal-bahan-yield"
									type="number"
									min="1"
									max="100"
									class="w-full rounded-2xl border-0 bg-white px-3.5 py-2 text-sm font-bold text-zinc-900 ring-1 ring-zinc-200 ring-inset focus:bg-white focus:ring-2 focus:ring-pink-500"
									bind:value={s.bahanForm.yield_persen}
									placeholder="70"
								/>
								<span
									class="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs font-bold text-zinc-400"
									>% Daging Bersih</span
								>
							</div>
							<!-- Quick Preset Buttons -->
							<div class="flex flex-wrap items-center gap-1.5 pt-0.5">
								<span class="text-[10px] font-semibold text-zinc-400">Pilihan Cepat:</span>
								<button
									type="button"
									class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
									onclick={() => (s.bahanForm.yield_persen = '70')}
								>
									Alpukat/Mangga (70%)
								</button>
								<button
									type="button"
									class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
									onclick={() => (s.bahanForm.yield_persen = '45')}
								>
									Nanas (45%)
								</button>
								<button
									type="button"
									class="cursor-pointer rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 ring-1 ring-zinc-200 transition-all hover:bg-pink-50 hover:text-pink-600 hover:ring-pink-300"
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
				{@const preview = previewBahanCost(s.bahanForm, s.editingBahan) ?? {
					baseQty: 0,
					netQty: 0,
					yieldPercent: 100,
					unitCost: 0
				}}
				{@const isFruitYield = preview.yieldPercent < 100}
				{@const baseQty = preview.baseQty}
				{@const netBaseQty = preview.netQty}
				{@const effectiveUnitCost = preview.unitCost}

				<div
					class="mt-3 rounded-xl border border-pink-100 bg-pink-50/80 p-2.5 text-xs text-zinc-700"
				>
					<div class="flex flex-wrap items-center justify-between gap-1 font-bold">
						<span class="text-zinc-600">
							{#if isFruitYield}
								Daging Bersih: <span class="text-zinc-900"
									>{formatQuantity(netBaseQty)} {s.bahanForm.satuan}</span
								>
								<span class="text-[10px] font-normal text-zinc-400">
									(dari {formatQuantity(baseQty)} {s.bahanForm.satuan} utuh)</span
								>
							{:else}
								Total: <span class="text-zinc-900"
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
	<div class="flex flex-shrink-0 gap-3 border-t border-slate-100 bg-white p-4 sm:p-5">
		<button
			type="button"
			class="flex-1 cursor-pointer rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
			onclick={s.closeBahanModal}
		>
			Batal
		</button>
		<button
			type="submit"
			form="stok-bahan-form"
			class="flex-2 cursor-pointer rounded-2xl bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3.5 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98]"
		>
			{s.editBahanId ? 'Simpan Perubahan' : 'Tambah Bahan'}
		</button>
	</div>
</AppModal>
