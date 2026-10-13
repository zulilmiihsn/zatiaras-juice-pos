<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';

	import type { OwnerStockState } from '$lib/stores/ownerStockState.svelte';

	let { s }: { s: OwnerStockState } = $props();
</script>

<AppModal
	open={s.showDisableConfirm && s.policyMode === 'tracked'}
	labelledby="disable-stock-title"
	size="sm"
	panelClass="border border-rose-200 bg-white p-5 text-xs text-slate-700 md:p-6"
	onClose={() => {
		if (!s.policyToggling) s.showDisableConfirm = false;
	}}
>
	<p id="disable-stock-title" class="text-sm font-bold text-slate-900 md:text-base">
		Nonaktifkan monitoring stok?
	</p>
	<ul class="mt-2 list-disc space-y-1 pl-4">
		<li>Penjualan tetap berjalan normal.</li>
		<li>Stok tidak berkurang otomatis dan peringatan berhenti.</li>
		<li>Data stok lama tidak dihapus.</li>
		<li>Aktivasi ulang membutuhkan rekonsiliasi fisik.</li>
		<li>Pastikan antrean offline semua perangkat sudah tersinkron.</li>
	</ul>
	<div class="mt-4 flex justify-end gap-2">
		<button
			type="button"
			bind:this={s.cancelDisableButton}
			disabled={s.policyToggling}
			onclick={() => (s.showDisableConfirm = false)}
			class="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 disabled:opacity-50"
		>
			Batal
		</button>
		<button
			type="button"
			disabled={s.policyToggling}
			onclick={s.confirmDisableStock}
			class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
		>
			{s.policyToggling ? 'Menyimpan…' : 'Ya, nonaktifkan'}
		</button>
	</div>
</AppModal>
