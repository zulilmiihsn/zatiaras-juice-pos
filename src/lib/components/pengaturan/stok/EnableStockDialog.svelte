<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';

	import type { OwnerStockState } from '$lib/stores/ownerStockState.svelte';

	let { s }: { s: OwnerStockState } = $props();
</script>

<AppModal
	open={s.showEnableConfirm && s.policyMode === 'ignored'}
	labelledby="enable-stock-title"
	size="sm"
	panelClass="border border-pink-100 bg-white p-5 text-xs text-slate-700 md:p-6"
	onClose={() => {
		if (!s.reconLoading) s.showEnableConfirm = false;
	}}
>
	<p id="enable-stock-title" class="text-sm font-bold text-slate-900 md:text-base">
		Aktifkan kembali monitoring stok?
	</p>
	<ul class="mt-2 list-disc space-y-1 pl-4">
		<li>Saldo lama dianggap basi dan tidak lagi mencerminkan kondisi gudang.</li>
		<li>Kamu wajib hitung fisik, simpan, lalu finalisasi.</li>
		<li>Monitoring aktif lagi hanya setelah finalisasi berhasil.</li>
	</ul>
	{#if s.enableError}
		<p class="mt-2 text-xs font-bold text-rose-600">{s.enableError}</p>
	{/if}
	<div class="mt-4 flex justify-end gap-2">
		<button
			type="button"
			bind:this={s.cancelEnableButton}
			disabled={s.reconLoading}
			onclick={() => (s.showEnableConfirm = false)}
			class="cursor-pointer rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 disabled:opacity-50"
		>
			Batal
		</button>
		<button
			type="button"
			disabled={s.reconLoading}
			onclick={s.confirmEnableStock}
			class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
		>
			{s.reconLoading ? 'Membuat…' : 'Ya, mulai rekonsiliasi'}
		</button>
	</div>
</AppModal>
