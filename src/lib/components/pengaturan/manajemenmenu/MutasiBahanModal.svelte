<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import X from '@lucide/svelte/icons/x';
	import { createManajemenmenuState } from '$lib/stores/manajemenmenuState.svelte';

	// KENAPA: dialog koreksi stok kecil; terima store utuh agar diff nol.
	let { s }: { s: ReturnType<typeof createManajemenmenuState> } = $props();
</script>

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
			<label for="mutasi-catatan" class="text-xs font-bold tracking-wider text-slate-700 uppercase"
				>Catatan</label
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
