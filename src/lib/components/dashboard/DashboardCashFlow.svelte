<!-- Ringkasan laci kas shift yang sedang berjalan. -->
<script lang="ts">
	import { formatRupiah } from '$lib/utils/currency';

	let {
		modalAwal,
		sesiKasSummary,
		tokoAktifLocal,
		onOpenToko
	}: {
		modalAwal: number | null;
		sesiKasSummary: {
			modalAwal: number;
			totalPenjualan: number;
			pemasukanTunai: number;
			pemasukanNonTunai: number;
			pengeluaranTunai: number;
			uangKasir: number;
		};
		tokoAktifLocal: boolean;
		onOpenToko: () => void;
	} = $props();
</script>

<!-- Ringkasan Kas di Laci / Status Sesi Kasir -->
<div class="soft-float-card relative overflow-hidden p-4.5 sm:p-5">
	<div class="mb-3 flex items-center justify-between">
		<div>
			<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
				Arus Kas Fisik
			</div>
			<div class="text-sm font-bold text-slate-900 sm:text-base">Estimasi Kas di Laci</div>
		</div>
		<button
			type="button"
			onclick={onOpenToko}
			class="flex cursor-pointer items-center gap-1 rounded-full border border-pink-100 bg-pink-50 px-2.5 py-1 text-xs font-bold text-pink-700 transition-all hover:bg-pink-100 active:scale-95"
		>
			<span>{tokoAktifLocal ? 'Kelola Sesi ›' : 'Buka Kios →'}</span>
		</button>
	</div>

	<div class="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
		<div class="flex items-center justify-between text-xs">
			<span class="font-medium text-slate-500">Modal Kas Awal</span>
			<span class="font-bold text-slate-800">
				{modalAwal !== null ? `Rp ${formatRupiah(sesiKasSummary.modalAwal)}` : 'Rp 0'}
			</span>
		</div>
		<div class="mt-2 flex items-center justify-between text-xs">
			<span class="font-medium text-slate-500">Pemasukan Tunai</span>
			<span class="font-bold text-emerald-600">
				+ Rp {formatRupiah(sesiKasSummary.pemasukanTunai)}
			</span>
		</div>
		{#if sesiKasSummary.pengeluaranTunai > 0}
			<div class="mt-2 flex items-center justify-between text-xs">
				<span class="font-medium text-slate-500">Pengeluaran Tunai</span>
				<span class="font-bold text-rose-600">
					- Rp {formatRupiah(sesiKasSummary.pengeluaranTunai)}
				</span>
			</div>
		{/if}
		<div class="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-2.5">
			<span class="text-xs font-bold text-slate-900">Total Uang di Laci</span>
			<span class="text-base font-extrabold text-pink-700 sm:text-lg">
				Rp {formatRupiah(sesiKasSummary.uangKasir)}
			</span>
		</div>
	</div>
</div>
