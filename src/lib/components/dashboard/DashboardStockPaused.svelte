<!-- Pemberitahuan saat monitoring stok cabang dinonaktifkan. -->
<script lang="ts">
	import Boxes from '@lucide/svelte/icons/boxes';
</script>

<!-- Monitoring stok dijeda: bukan angka metrik -->
<div>
	<div class="mb-2.5 flex items-center justify-between px-1">
		<div>
			<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
				Inventaris Harian
			</div>
			<div class="text-sm font-bold text-slate-900 sm:text-base">Monitoring Stok Dijeda</div>
		</div>
	</div>
	<div class="rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-xs">
		<Boxes class="mx-auto mb-2 h-8 w-8 stroke-[1.8] text-slate-300" />
		<div class="text-xs font-bold text-slate-700">Monitoring stok nonaktif</div>
		<div class="mt-0.5 text-[11px] text-slate-400">
			Penjualan tetap berjalan. Aktifkan kembali lewat pengaturan pemilik setelah rekonsiliasi
			fisik.
		</div>
	</div>
</div>
