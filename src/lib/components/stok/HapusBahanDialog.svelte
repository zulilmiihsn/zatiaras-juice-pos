<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import type { StokState } from '$lib/stores/stokState.svelte';

	let { s }: { s: StokState } = $props();
</script>

<!-- Modal Konfirmasi Hapus -->
<AppModal
	open={s.showDeleteModal}
	labelledby="stok-hapus-title"
	size="xs"
	align="center"
	zClass="z-alert"
	panelClass="border border-rose-100/90 bg-white p-6 ring-1 ring-rose-500/10"
	onClose={s.closeDeleteConfirm}
>
	<div class="flex w-full flex-col items-center">
		<div
			class="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-600 shadow-2xs"
		>
			<Trash2 class="h-6 w-6 stroke-[2.2]" />
		</div>
		<h2 id="stok-hapus-title" class="mb-1 text-center text-lg font-black text-slate-900">
			Hapus Bahan Ini?
		</h2>
		<p class="mb-5 text-center text-xs font-medium text-slate-500 sm:text-sm">
			Bahan yang dihapus tidak dapat dipulihkan dan resep menu yang menggunakannya akan terpengaruh.
		</p>
		<div class="flex w-full gap-3">
			<button
				type="button"
				class="flex-1 rounded-2xl bg-slate-100 py-3 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
				onclick={s.closeDeleteConfirm}
			>
				Batal
			</button>
			<button
				type="button"
				class="flex-1 rounded-2xl bg-gradient-to-r from-rose-600 to-pink-600 py-3 text-sm font-black text-white shadow-md shadow-rose-600/25 transition-all hover:opacity-95 active:scale-95"
				onclick={s.handleDeleteBahan}
			>
				Ya, Hapus
			</button>
		</div>
	</div>
</AppModal>
