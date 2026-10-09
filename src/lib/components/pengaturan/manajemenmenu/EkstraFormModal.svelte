<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import type { Ingredient } from '$lib/types/product';
	import type { UnitOption } from '$lib/utils/unitConversion';

	// KENAPA: form tambah/edit ekstra satu unit dengan kategori (satu state +
	// satu submit); keluar dari halaman agar diff halaman kecil dan contracted
	// via props. Seluruh objek form di-bind sekaligus agar reset/inline edit
	// tetap satu sumber di store.
	// KENAPA: type (bukan interface) agar dapat index signature implisit untuk
	// helper input generik; lihat handleRupiahInput.
	export type EkstraFormDraft = {
		nama: string;
		harga: string;
		bahan_id: string;
		jumlah_bahan: string;
		satuan_resep: string;
	};

	let {
		open,
		editEkstraId,
		ekstraForm = $bindable(),
		bahanList,
		selectedEkstraBahan,
		ekstraCompatibleUnits,
		ekstraModalHpp,
		handleRupiahInput,
		saveEkstra,
		closeEkstraForm
	}: {
		open: boolean;
		editEkstraId: string | number | null;
		ekstraForm: EkstraFormDraft;
		bahanList: Ingredient[];
		selectedEkstraBahan: Ingredient | undefined;
		ekstraCompatibleUnits: UnitOption[];
		ekstraModalHpp: number;
		handleRupiahInput: typeof import('$lib/utils/currency').handleRupiahInput;
		saveEkstra: () => void;
		closeEkstraForm: () => void;
	} = $props();
</script>

<AppModal
	{open}
	label={editEkstraId ? 'Edit Tambahan' : 'Tambah Tambahan'}
	size="sm"
	align="center"
	panelClass="bg-white"
	onClose={() => closeEkstraForm()}
>
	<!-- Header -->
	<div
		class="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-6 py-4"
	>
		<div>
			<h2 class="text-lg font-black tracking-tight text-slate-900">
				{editEkstraId ? 'Edit Tambahan' : 'Tambah Tambahan'}
			</h2>
			<p class="text-xs font-medium text-slate-500">Topping atau add-on ekstra pesanan</p>
		</div>
		<button
			type="button"
			class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-all hover:bg-pink-100 hover:text-pink-700 active:scale-90"
			onclick={() => closeEkstraForm()}
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
			saveEkstra();
		}}
		autocomplete="off"
	>
		<div class="flex flex-col gap-1.5">
			<label for="ekstra-name" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
				>Nama Tambahan</label
			>
			<input
				type="text"
				id="ekstra-name"
				class="w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
				bind:value={ekstraForm.nama}
				required
				placeholder="Contoh: Bubble Boba, Extra Shot"
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<label for="ekstra-harga" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
				>Harga Tambahan</label
			>
			<div class="relative">
				<span class="absolute top-1/2 left-3.5 -translate-y-1/2 text-xs font-bold text-slate-400"
					>Rp</span
				>
				<input
					id="ekstra-harga"
					type="text"
					class="w-full rounded-xl border border-slate-200/90 bg-white py-3 pr-4 pl-10 text-sm font-bold text-slate-900 transition-all placeholder:font-normal placeholder:text-slate-400 hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={ekstraForm.harga}
					oninput={handleRupiahInput(ekstraForm, 'harga')}
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
							ekstraForm.bahan_id = '';
							ekstraForm.jumlah_bahan = '';
							ekstraForm.satuan_resep = '';
						}}
					>
						Hapus Link
					</button>
				{/if}
			</div>

			<div class="relative">
				<select
					class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2.5 pr-9 pl-3 text-xs font-semibold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
					bind:value={ekstraForm.bahan_id}
					onchange={() => {
						if (selectedEkstraBahan) {
							ekstraForm.satuan_resep = selectedEkstraBahan.satuan;
						}
					}}
				>
					<option value="">-- Tanpa Bahan Baku (Add-on Saja) --</option>
					{#each bahanList.filter((b) => b.is_active !== false) as bahan}
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
						<label for="ekstra-takaran" class="mb-1 block text-[11px] font-bold text-slate-600">
							Takaran per Porsi
						</label>
						<input
							id="ekstra-takaran"
							type="number"
							step="any"
							class="w-full rounded-xl border border-slate-200/90 bg-white px-3 py-2 text-xs font-bold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
							placeholder="0"
							bind:value={ekstraForm.jumlah_bahan}
							required
						/>
					</div>
					<div>
						<label for="ekstra-satuan" class="mb-1 block text-[11px] font-bold text-slate-600">
							Satuan
						</label>
						<div class="relative">
							<select
								id="ekstra-satuan"
								class="w-full cursor-pointer appearance-none rounded-xl border border-slate-200/90 bg-white py-2 pr-7 pl-2.5 text-xs font-semibold text-slate-800 transition-all hover:border-pink-300 focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 focus:outline-none"
								bind:value={ekstraForm.satuan_resep}
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
			class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
		>
			{editEkstraId ? 'Update Tambahan' : 'Simpan Tambahan'}
		</button>
		<button
			type="button"
			class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
			onclick={() => closeEkstraForm()}
		>
			Batal
		</button>
	</div>
</AppModal>
