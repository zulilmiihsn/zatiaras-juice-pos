<!-- Pintasan ke halaman yang paling sering dipakai. -->
<script lang="ts">
	import Boxes from '@lucide/svelte/icons/boxes';
	import BookOpen from '@lucide/svelte/icons/book-open';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';
</script>

<!-- Quick Action Panel for Tablet POS (Aksi Cepat Kasir) -->
<div
	class="rounded-[28px] border border-slate-200/70 bg-white/90 p-4.5 shadow-2xs backdrop-blur-md"
>
	<div class="mb-3 flex items-center justify-between">
		<span class="text-xs font-bold tracking-wider text-slate-400 uppercase">Pintasan Cepat</span>
		<span class="text-[11px] font-semibold text-slate-400">Aksi Kios</span>
	</div>
	<div class="grid grid-cols-3 gap-3">
		<a
			href="/pos"
			class="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#db2777] via-[#ec4899] to-[#f43f5e] px-3 py-3 text-xs font-extrabold text-white shadow-md shadow-pink-500/20 transition-all hover:opacity-95 active:scale-[0.98]"
		>
			<ShoppingBagIcon size={16} class="stroke-[2.2]" />
			<span>Buka Kasir</span>
		</a>
		<a
			href="/catat"
			class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.98]"
		>
			<BookOpen size={16} class="stroke-[2.2] text-pink-600" />
			<span>Catat Kas</span>
		</a>
		{#if !stockPolicyState.ignored}
			<a
				href="/stok"
				class="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3 py-3 text-xs font-bold text-slate-700 shadow-2xs transition-all hover:bg-slate-50 active:scale-[0.98]"
			>
				<Boxes size={16} class="stroke-[2.2] text-emerald-600" />
				<span>Kelola Stok</span>
			</a>
		{/if}
	</div>
</div>
