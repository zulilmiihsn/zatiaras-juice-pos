<script lang="ts">
	// [CATATAN]: Svelte Transitions & Animations
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';

	// [CATATAN]: Icons
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	// [CATATAN]: Utils & Types
	import { formatRupiah } from '$lib/utils/currency';
	import type { CartItem } from '$lib/types/cart';

	interface Props {
		cart: CartItem[];
		totalItems: number;
		totalHarga: number;
		onOpenCart: () => void;
		onClearCart?: () => void;
	}

	let { cart = [], totalItems = 0, totalHarga = 0, onOpenCart }: Props = $props();
</script>

{#if cart.length > 0}
	<!-- [CATATAN]: Floating Glass Cart Pill (Tersusun rapi di pojok kanan bawah, serasi dengan branding Zatiaras) -->
	<aside
		aria-label="Keranjang Belanja"
		class="z-fab pointer-events-none fixed right-3.5 bottom-[76px] sm:right-6 md:bottom-[90px] lg:hidden"
		in:scale={{ duration: 220, start: 0.8, easing: backOut }}
		out:scale={{ duration: 160, start: 0.8 }}
	>
		<button
			type="button"
			class="group pointer-events-auto relative flex cursor-pointer items-center gap-2.5 rounded-full border border-pink-200/90 bg-white/95 py-2 pr-3.5 pl-2 text-slate-800 shadow-[0_8px_24px_-4px_rgba(219,39,119,0.22),0_2px_8px_rgba(0,0,0,0.04)] ring-2 ring-pink-500/20 backdrop-blur-xl transition-all duration-200 hover:scale-105 hover:shadow-pink-500/30 active:scale-95"
			onclick={onOpenCart}
			aria-label={`Buka keranjang pesanan, ${totalItems} item, total Rp ${formatRupiah(totalHarga ?? 0)}`}
			aria-haspopup="dialog"
		>
			<!-- Pink Icon Container with Count Badge -->
			<div
				class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-sm shadow-pink-500/30"
			>
				<ShoppingBag class="h-4.5 w-4.5 stroke-[2.3]" />
				<span
					class="absolute -top-1 -right-1 flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white"
					in:scale={{ duration: 160 }}
				>
					{totalItems}
				</span>
			</div>

			<!-- Price & Action Text -->
			<div class="flex flex-col text-left">
				<span class="text-[10px] font-bold text-pink-600">
					{totalItems}
					{totalItems > 1 ? 'Items' : 'Item'}
				</span>
				<span class="text-xs font-black tracking-tight text-slate-900 sm:text-sm">
					Rp {formatRupiah(totalHarga)}
				</span>
			</div>

			<!-- Arrow Right -->
			<div
				class="flex h-6 w-6 items-center justify-center rounded-full bg-pink-50 text-pink-600 transition-transform duration-150 group-hover:translate-x-0.5"
			>
				<ArrowRight class="h-3.5 w-3.5 stroke-[2.6]" />
			</div>
		</button>
	</aside>
{/if}
