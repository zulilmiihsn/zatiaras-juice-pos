<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import FileText from '@lucide/svelte/icons/file-text';
	import Book from '@lucide/svelte/icons/book';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Settings from '@lucide/svelte/icons/settings';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import { page } from '$app/stores';
	import { posCart } from '$lib/stores/posCart.svelte';
	import { scale } from 'svelte/transition';
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import { stockPolicyState } from '$lib/stores/stockPolicyState.svelte';
	import { orderQueueBadge } from '$lib/stores/orderQueueState.svelte';

	type NavItem = {
		label: string;
		icon: Component;
		path: string;
		isHero?: boolean;
	};

	const berandaNav: NavItem = { label: 'Beranda', icon: Home, path: '/' };
	const catatNav: NavItem = { label: 'Catat', icon: Book, path: '/catat' };
	const antreanNav: NavItem = { label: 'Antrean', icon: ClipboardList, path: '/antrean' };
	const kasirNav: NavItem = { label: 'Kasir', icon: ShoppingBag, path: '/pos', isHero: true };
	const stokNav: NavItem = { label: 'Stok', icon: Boxes, path: '/stok' };
	const laporanNav: NavItem = { label: 'Laporan', icon: FileText, path: '/laporan' };
	const settingsNav: NavItem = { label: 'Pengaturan', icon: Settings, path: '/pengaturan' };

	// Kasir hero selalu tepat di tengah: 7 tujuan saat stok aktif, 5 saat nonaktif.
	// Saat stok nonaktif, Pengaturan lewat Beranda (tidak memakan slot navbar).
	const navs = $derived(
		stockPolicyState.ignored
			? [berandaNav, catatNav, kasirNav, antreanNav, laporanNav]
			: [berandaNav, catatNav, antreanNav, kasirNav, stokNav, laporanNav, settingsNav]
	);

	onMount(() => {
		void stockPolicyState.refresh();
		void orderQueueBadge.refresh();
	});

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
				class="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-center self-stretch py-1 transition-all duration-150 active:scale-95 md:py-2 {isActive
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
					{#if nav.path === '/antrean' && orderQueueBadge.count > 0}
						<span
							class="absolute -top-1.5 -right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white shadow ring-2 ring-white"
						>
							{orderQueueBadge.count > 99 ? '99+' : orderQueueBadge.count}
						</span>
					{/if}
				</div>
				<span
					class="text-[11px] leading-tight transition-colors duration-150 md:text-xs {isActive
						? 'font-bold text-pink-600'
						: 'font-medium text-slate-500'}"
				>
					{#if nav.path === '/pengaturan'}
						<span class="hidden min-[380px]:inline">Pengaturan</span><span
							class="min-[380px]:hidden">Atur</span
						>
					{:else}
						{nav.label}
					{/if}
				</span>
				{#if isActive}
					<span
						class="absolute bottom-1 h-1 w-4 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 md:bottom-1.5 md:h-1.5 md:w-6"
					></span>
				{/if}
			</a>
		{/if}
	{/each}
</nav>
