<script lang="ts">
	import { fly } from 'svelte/transition';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Ingredient } from '$lib/types/product';
	import { swipeDismiss, type SwipeDirection } from '$lib/utils/swipeDismiss';

	let {
		lowStockItems = [] as Ingredient[],
		onDismiss = () => {},
		onFilterClick = null as (() => void) | null,
		isSticky = true
	}: {
		lowStockItems: Ingredient[];
		onDismiss?: () => void;
		onFilterClick?: (() => void) | null;
		isSticky?: boolean;
	} = $props();

	let isDismissed = $state(false);

	// Gesture Swipe State (pembacaan gestur ada di swipeDismiss)
	const SWIPE_THRESHOLDS = { up: 25, left: 45, right: 45 };
	let isDragging = $state(false);
	let currentDeltaX = $state(0);
	let currentDeltaY = $state(0);
	let isSwipingOut = $state(false);
	let dismissDirection = $state<SwipeDirection>('up');

	function handleDismiss(direction: SwipeDirection = 'up') {
		dismissDirection = direction;
		isSwipingOut = true;
		setTimeout(() => {
			isDismissed = true;
			onDismiss();
		}, 200);
	}
</script>

{#if lowStockItems.length > 0 && !isDismissed}
	<div
		transition:fly={{ y: -30, duration: 250 }}
		class="z-fab pointer-events-none fixed inset-x-0 top-3 mx-auto w-full max-w-lg px-3 select-none sm:px-4"
	>
		<div
			role="region"
			aria-label="Peringatan Stok Menipis (Geser ke atas untuk menutup)"
			class="pointer-events-auto relative cursor-grab overflow-hidden rounded-[28px] border border-pink-100/90 bg-white/98 p-4 shadow-xl ring-1 shadow-pink-950/10 ring-pink-500/10 backdrop-blur-2xl active:cursor-grabbing sm:p-4.5"
			style="touch-action: none; transform: translate({isSwipingOut
				? dismissDirection === 'left'
					? -350
					: dismissDirection === 'right'
						? 350
						: currentDeltaX
				: currentDeltaX}px, {isSwipingOut
				? dismissDirection === 'up'
					? -120
					: currentDeltaY
				: currentDeltaY}px) scale({isDragging ? 0.98 : 1}); opacity: {isSwipingOut
				? 0
				: Math.max(
						0.2,
						1 - Math.abs(currentDeltaX) / 140 - Math.max(0, -currentDeltaY) / 60
					)}; transition: {isDragging
				? 'none'
				: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease'};"
			use:swipeDismiss={{
				thresholds: SWIPE_THRESHOLDS,
				onStart: () => {
					isDragging = true;
					currentDeltaX = 0;
					currentDeltaY = 0;
				},
				// Sedikit perlawanan ke bawah, bebas ke atas.
				onDrag: (deltaX, deltaY) => {
					currentDeltaX = deltaX;
					currentDeltaY = Math.min(10, deltaY);
				},
				onEnd: (direction) => {
					isDragging = false;
					if (direction) {
						handleDismiss(direction);
					} else {
						currentDeltaX = 0;
						currentDeltaY = 0;
					}
				}
			}}
		>
			<div class="flex items-center gap-3.5">
				<!-- Tactile Brand Icon -->
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-500 text-white shadow-md shadow-pink-500/20"
				>
					<AlertTriangle class="h-5 w-5 stroke-[2.2]" />
				</div>

				<!-- Title & Subtitle Info (Single-line hierarchy) -->
				<div class="min-w-0 flex-1">
					<div class="flex items-center gap-2 whitespace-nowrap">
						<span class="text-sm font-black tracking-tight text-slate-900"> Stok Menipis </span>
						<span
							class="inline-flex items-center rounded-full bg-pink-100 px-2.5 py-0.5 text-xs font-black text-pink-700"
						>
							{lowStockItems.length} Bahan
						</span>
					</div>
					<p class="mt-0.5 truncate text-xs font-medium text-slate-600">
						{#each lowStockItems.slice(0, 2) as item, i (item.id)}
							<span class="font-bold text-slate-800">{item.nama}</span> ({item.stok_saat_ini || 0}
							{item.satuan || ''}){i < Math.min(lowStockItems.length, 2) - 1 ? ', ' : ''}
						{/each}
						{#if lowStockItems.length > 2}
							<span class="text-slate-400"> +{lowStockItems.length - 2} lagi</span>
						{/if}
					</p>
				</div>

				<!-- Right Action Button (Brand Gradient) -->
				<div class="flex shrink-0 items-center">
					{#if onFilterClick}
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								onFilterClick();
							}}
							class="flex cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95 sm:text-sm"
						>
							<span>Lihat</span>
							<ChevronRight class="h-4 w-4 stroke-[2.5]" />
						</button>
					{:else}
						<a
							href="/stok"
							onclick={(e) => e.stopPropagation()}
							class="flex cursor-pointer items-center gap-1.5 rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-4.5 py-2.5 text-xs font-black text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95 sm:text-sm"
						>
							<span>Buka</span>
							<ChevronRight class="h-4 w-4 stroke-[2.5]" />
						</a>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
