<script lang="ts">
	import type { RentangRiwayat } from '$lib/services/riwayatService';

	interface Props {
		searchKeyword?: string;
		filterPayment?: string;
		filterRentang?: RentangRiwayat;
		onchange?: () => void;
	}

	let {
		searchKeyword = $bindable(''),
		filterPayment = $bindable('all'),
		filterRentang = $bindable('hari-ini'),
		onchange
	}: Props = $props();

	const pilas =
		'cursor-pointer rounded-full px-4 py-2 text-xs font-bold transition-all active:scale-95 md:px-5 md:py-2.5 md:text-sm';
	const pilAktif =
		'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-xs shadow-pink-500/20';
	const pilMati = 'border border-slate-200/80 bg-white text-slate-700 hover:border-pink-200';
</script>

<div class="soft-float-card mb-4 space-y-3 p-4 md:p-5">
	<input
		type="text"
		class="w-full rounded-xl border border-pink-100 bg-pink-50/30 px-4 py-2.5 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10 md:text-base"
		placeholder="Cari transaksi berdasarkan nama, nomor, nominal, atau catatan..."
		bind:value={searchKeyword}
		oninput={() => onchange?.()}
	/>
	<div class="flex gap-2" role="group" aria-label="Rentang tanggal">
		<button
			type="button"
			class="{pilas} {filterRentang === 'hari-ini' ? pilAktif : pilMati}"
			onclick={() => {
				filterRentang = 'hari-ini';
				onchange?.();
			}}>Hari ini</button
		>
		<button
			type="button"
			class="{pilas} {filterRentang === '7-hari' ? pilAktif : pilMati}"
			onclick={() => {
				filterRentang = '7-hari';
				onchange?.();
			}}>7 hari</button
		>
	</div>
	<div class="flex gap-2" role="group" aria-label="Metode pembayaran">
		<button
			type="button"
			class="{pilas} {filterPayment === 'all' ? pilAktif : pilMati}"
			onclick={() => {
				filterPayment = 'all';
				onchange?.();
			}}>Semua</button
		>
		<button
			type="button"
			class="{pilas} {filterPayment === 'qris' ? pilAktif : pilMati}"
			onclick={() => {
				filterPayment = 'qris';
				onchange?.();
			}}>QRIS</button
		>
		<button
			type="button"
			class="{pilas} {filterPayment === 'tunai' ? pilAktif : pilMati}"
			onclick={() => {
				filterPayment = 'tunai';
				onchange?.();
			}}>Tunai</button
		>
	</div>
</div>
