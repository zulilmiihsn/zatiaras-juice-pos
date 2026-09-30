<script lang="ts">
	import { onMount } from 'svelte';
	import type { HistoryItem } from '$lib/types/laporan';
	import { formatRupiah } from '$lib/utils/currency';
	import NomorPesananLabel from '$lib/components/shared/NomorPesananLabel.svelte';

	type IconComponent = typeof import('@lucide/svelte/icons/trash').default;

	interface Props {
		trx: HistoryItem;
		onOpen: (trx: HistoryItem) => void;
		/** Bila diisi, tampil tombol hapus (dipakai halaman pemilik). */
		onHapus?: ((trx: HistoryItem) => void) | null;
	}

	let { trx, onOpen, onHapus = null }: Props = $props();

	// Ikon hapus dimuat malas seperti sebelumnya di halaman pemilik.
	let IkonHapus = $state<IconComponent | null>(null);
	onMount(async () => {
		if (onHapus) {
			IkonHapus = (await import('@lucide/svelte/icons/trash')).default;
		}
	});
</script>

<div
	class="soft-float-card flex cursor-pointer items-start justify-between gap-3 p-4 transition-all hover:border-pink-200 hover:shadow-md md:p-4.5"
	onclick={() => onOpen(trx)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onOpen(trx);
		}
	}}
	role="button"
	tabindex="0"
>
	<div class="min-w-0 flex-1">
		<NomorPesananLabel
			nomor={trx.nomor_harian}
			kelas="text-[11px] font-extrabold tracking-wide text-pink-600"
		/>
		<div class="truncate text-sm font-bold text-gray-900 md:text-base" title={trx.nama}>
			{trx.nama}
		</div>
		<div class="mb-1 flex items-center gap-1.5 text-xs text-gray-500 md:text-sm">
			<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold md:text-xs">
				{trx.sumber === 'pos' ? 'POS' : 'Manual'}
			</span>
			<span class="capitalize">
				{trx.tipe === 'in' ? 'Pemasukan' : 'Pengeluaran'}
			</span>
			<span class="font-bold text-pink-500 uppercase">
				{trx.metode_bayar === 'qris' || trx.metode_bayar === 'non-tunai' ? 'QRIS' : 'Tunai'}
			</span>
		</div>
		<div class="text-xs text-gray-400">
			{new Date(trx.waktu).toLocaleTimeString('id-ID', {
				hour: '2-digit',
				minute: '2-digit'
			})}
		</div>
	</div>
	<div class="flex shrink-0 flex-col items-end gap-1">
		<div
			class="text-base font-black md:text-lg {trx.tipe === 'out'
				? 'text-orange-600'
				: 'text-pink-600'}"
		>
			{trx.tipe === 'out' ? '-' : ''}Rp {formatRupiah(trx.nominal)}
		</div>
		{#if onHapus && IkonHapus}
			<button
				type="button"
				class="cursor-pointer rounded-xl bg-red-50 p-2 text-red-600 shadow-md transition-colors hover:bg-red-100 md:p-2.5"
				onclick={(e) => {
					e.stopPropagation();
					onHapus(trx);
				}}
				title="Hapus transaksi"
				aria-label="Hapus transaksi"
			>
				<IkonHapus class="h-4.5 w-4.5 md:h-5 md:w-5" />
			</button>
		{:else}
			<div class="text-xs text-gray-400">Tap untuk detail</div>
		{/if}
	</div>
</div>
