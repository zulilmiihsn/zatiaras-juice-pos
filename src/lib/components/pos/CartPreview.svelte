<script lang="ts">
	import { fly } from 'svelte/transition';
	import ShoppingCart from 'lucide-svelte/icons/shopping-cart';
	import { formatRupiah } from '$lib/utils/currency';

	let {
		cart = [],
		totalItems = 0,
		totalHarga = 0,
		onOpenCart,
		onGoToBayar,
		onClearCart
	} = $props<{
		cart: unknown[];
		totalItems: number;
		totalHarga: number;
		onOpenCart: () => void;
		onGoToBayar: (e: Event) => void;
		onClearCart: () => void;
	}>();

	let cartPreviewRef = $state<HTMLDivElement | null>(null);
	let cartPreviewStartX = $state(0);
	let cartPreviewX = $state(0);
	let cartPreviewDragging = $state(false);

	function handleCartPreviewTouchStart(e: TouchEvent) {
		cartPreviewStartX = e.touches[0].clientX;
		cartPreviewDragging = true;
	}

	function handleCartPreviewTouchMove(e: TouchEvent) {
		if (!cartPreviewDragging) return;
		const currentX = e.touches[0].clientX;
		const diff = currentX - cartPreviewStartX;
		if (diff < 0) {
			cartPreviewX = diff;
		}
	}

	function handleCartPreviewTouchEnd() {
		cartPreviewDragging = false;
		if (cartPreviewX < -100) {
			cartPreviewX = -window.innerWidth;
			setTimeout(() => {
				onClearCart();
				cartPreviewX = 0;
			}, 300);
		} else {
			cartPreviewX = 0;
		}
	}
</script>

{#if cart.length > 0}
	<!-- Swipe-to-clear is optional; explicit cart and payment controls remain keyboard accessible. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={cartPreviewRef}
		class="fixed right-3 bottom-16 left-3 z-20 flex min-h-[68px] items-center justify-between rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-3 text-base font-medium text-white shadow-xl shadow-pink-500/30 md:right-6 md:left-6"
		style="transform: translateX({cartPreviewX}px); transition: {cartPreviewDragging
			? 'none'
			: 'transform 0.25s cubic-bezier(.4,0,.2,1)'}; touch-action: pan-y;"
		ontouchstart={handleCartPreviewTouchStart}
		ontouchmove={handleCartPreviewTouchMove}
		ontouchend={handleCartPreviewTouchEnd}
		transition:fly={{ x: -64, duration: 320, opacity: 0.9 }}
	>
		<div
			class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 select-none"
			onclick={onOpenCart}
			onkeydown={(e) => e.key === 'Enter' && onOpenCart()}
			role="button"
			tabindex="0"
			aria-label="Buka keranjang belanja"
			style="min-width:0;"
		>
			<div class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/20">
				<ShoppingCart class="h-5 w-5 text-white" />
			</div>
			<div class="min-w-0">
				<div class="truncate text-xs font-semibold tracking-wide text-pink-100 uppercase">
					{totalItems} item pesanan
				</div>
				<div class="truncate text-xl font-bold text-white">
					Rp {formatRupiah(totalHarga ?? 0)}
				</div>
			</div>
		</div>
		<div class="ml-4 flex items-center justify-center">
			<button
				class="flex items-center justify-center rounded-xl bg-white px-6 py-3 text-base font-bold text-pink-600 shadow-sm transition-all duration-200 hover:bg-pink-50 active:scale-[0.98]"
				onclick={onGoToBayar}>Bayar</button
			>
		</div>
	</div>
{/if}
