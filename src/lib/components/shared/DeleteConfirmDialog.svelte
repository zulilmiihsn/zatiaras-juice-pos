<script lang="ts">
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import Trash2 from '@lucide/svelte/icons/trash-2';

	// KENAPA: dialog hapus di seluruh halaman punya struktur identik (ikon, judul,
	// deskripsi, Batal/Hapus); satu komponen mencegah varian visual dan handler
	// yang terlupa saat tambah entitas baru.
	interface Props {
		open: boolean;
		title: string;
		description: string;
		onCancel: () => void;
		onConfirm: () => void;
	}

	const { open, title, description, onCancel, onConfirm }: Props = $props();
</script>

<AppModal
	{open}
	label={title}
	size="xs"
	align="center"
	zClass="z-alert"
	backdropClose={false}
	panelClass="relative items-center bg-white p-6"
>
	<div
		class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 ring-1 ring-rose-200/60"
	>
		<Trash2 class="h-6 w-6 stroke-[2.2]" />
	</div>
	<h2 class="mb-1.5 text-center text-base font-black text-slate-900">{title}</h2>
	<p class="mb-5 text-center text-xs font-medium text-slate-500">{description}</p>
	<div class="flex w-full gap-2.5">
		<button
			class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-2.5 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-95"
			onclick={onCancel}>Batal</button
		>
		<button
			class="flex-1 cursor-pointer rounded-full bg-rose-500 py-2.5 text-xs font-bold text-white shadow-md shadow-rose-500/20 transition-all hover:bg-rose-600 active:scale-95"
			onclick={onConfirm}>Hapus</button
		>
	</div>
</AppModal>
