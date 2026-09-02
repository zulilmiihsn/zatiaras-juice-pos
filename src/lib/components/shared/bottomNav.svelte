<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import FileText from '@lucide/svelte/icons/file-text';
	import Book from '@lucide/svelte/icons/book';
	import Boxes from '@lucide/svelte/icons/boxes';
	import { page } from '$app/stores';
	import { posCart } from '$lib/stores/posCart.svelte';
	import { scale } from 'svelte/transition';

	const navs = [
		{ label: 'Beranda', icon: Home, path: '/' },
		{ label: 'Catat', icon: Book, path: '/catat' },
		{ label: 'Kasir', icon: ShoppingBag, path: '/pos', isHero: true },
		{ label: 'Stok', icon: Boxes, path: '/stok' },
		{ label: 'Laporan', icon: FileText, path: '/laporan' }
	];

	function isPathActive(path: string, currentPath: string): boolean {
		if (path === '/') return currentPath === '/';
		return currentPath === path || currentPath.startsWith(path + '/');
	}
</script>

<nav
	class="relative mx-auto flex h-[64px] w-full items-center justify-around overflow-visible border-t border-slate-100/90 bg-white/95 px-2 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl md:mb-4 md:h-[76px] md:max-w-2xl md:rounded-[32px] md:border md:border-slate-200/80 md:px-6 md:shadow-[0_16px_40px_-8px_rgba(219,39,119,0.14),0_6px_20px_rgba(0,0,0,0.06)]"
>
	{#each navs as nav}
		{@const Icon = nav.icon}
		{@const isActive = isPathActive(nav.path, $page.url.pathname)}

		{#if nav.isHero}
			<!-- Center Hero Button (Kasir) -->
			<a
				class="group relative -mt-6 flex cursor-pointer flex-col items-center justify-center focus:outline-none md:-mt-8"
				aria-label={nav.label}
				href={nav.path}
				data-sveltekit-preload-data="hover"
			>
				<div
					class="relative flex h-13 w-13 items-center justify-center rounded-full transition-all duration-200 group-active:scale-90 md:h-16 md:w-16 {isActive
						? 'scale-105 bg-gradient-to-tr from-pink-500 via-rose-500 to-pink-600 text-white shadow-xl ring-4 shadow-pink-500/40 ring-white md:scale-110 md:ring-6'
						: 'bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-lg ring-4 shadow-pink-500/25 ring-white hover:scale-105 md:ring-6'} {posCart.totalItems >
						0 && !isActive
						? 'shadow-pink-500/40 ring-pink-400/80'
						: ''}"
				>
					<ShoppingBag class="h-5.5 w-5.5 stroke-[2.3] md:h-7 md:w-7" />

					{#if posCart.totalItems > 0}
						<span
							class="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-black text-white shadow-md ring-2 ring-white md:-top-1 md:-right-1 md:h-5.5 md:min-w-[22px] md:text-xs"
							in:scale={{ duration: 200 }}
							out:scale={{ duration: 150 }}
						>
							{posCart.totalItems}
						</span>
					{/if}
				</div>
				<span
					class="mt-1 text-[11px] font-bold transition-colors duration-150 md:mt-1.5 md:text-xs {isActive
						? 'text-pink-600'
						: 'text-slate-500 group-hover:text-pink-600'}"
				>
					{nav.label}
				</span>
			</a>
		{:else}
			<!-- Regular Nav Tab -->
			<a
				class="group relative flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center py-1 transition-all duration-150 active:scale-95 md:py-2 {isActive
					? 'text-pink-600'
					: 'text-slate-400 hover:text-slate-600'}"
				aria-label={nav.label}
				href={nav.path}
				data-sveltekit-preload-data="hover"
			>
				<div class="relative mb-0.5 flex items-center justify-center md:mb-1">
					<Icon
						class="h-5 w-5 stroke-[1.8] transition-transform duration-150 group-hover:scale-105 md:h-6 md:w-6 {isActive
							? 'scale-105 stroke-[2.2] text-pink-600'
							: 'text-slate-400'}"
					/>
				</div>
				<span
					class="text-[11px] transition-colors duration-150 md:text-xs {isActive
						? 'font-bold text-pink-600'
						: 'font-medium text-slate-500'}"
				>
					{nav.label}
				</span>
				{#if isActive}
					<span
						class="absolute bottom-0.5 h-1 w-4 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 md:bottom-1 md:h-1.5 md:w-6"
					></span>
				{/if}
			</a>
		{/if}
	{/each}
</nav>
