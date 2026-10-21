<script lang="ts">
	import Home from '@lucide/svelte/icons/home';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import FileText from '@lucide/svelte/icons/file-text';
	import Book from '@lucide/svelte/icons/book';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Settings from '@lucide/svelte/icons/settings';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import { page } from '$app/state';
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
		/** Hanya tampil di sidebar (md+); disembunyikan dari bilah bawah HP. */
		sidebarOnly?: boolean;
	};

	const berandaNav: NavItem = { label: 'Beranda', icon: Home, path: '/' };
	const catatNav: NavItem = { label: 'Catat', icon: Book, path: '/catat' };
	const antreanNav: NavItem = { label: 'Antrean', icon: ClipboardList, path: '/antrean' };
	const kasirNav: NavItem = { label: 'Kasir', icon: ShoppingBag, path: '/pos', isHero: true };
	const stokNav: NavItem = { label: 'Stok', icon: Boxes, path: '/stok' };
	const laporanNav: NavItem = { label: 'Laporan', icon: FileText, path: '/laporan' };
	const settingsNav: NavItem = { label: 'Pengaturan', icon: Settings, path: '/pengaturan' };

	// Kasir hero selalu tepat di tengah bilah bawah: 7 tujuan saat stok aktif, 5 saat nonaktif.
	// Saat stok nonaktif, Pengaturan di HP lewat Beranda (tidak memakan slot bilah bawah); di
	// sidebar md+ ia tetap selalu ada karena slot di sana tidak terbatas.
	const navs = $derived(
		stockPolicyState.ignored
			? [
					berandaNav,
					catatNav,
					kasirNav,
					antreanNav,
					laporanNav,
					{ ...settingsNav, sidebarOnly: true }
				]
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

<!--
	Satu <nav> dua bentuk, daftar tujuan dan badge dipakai bersama:
	- < md (HP): bilah bawah penuh lebar, Kasir menonjol di tengah.
	- md+ (tablet/desktop): sidebar setinggi layar menempel di tepi kiri; lg+ melebar dengan
	  label di samping ikon.
	Lebar sidebar datang dari --app-nav-width (app.css) dan dipakai layout root sebagai
	padding konten, jadi halaman tidak perlu tahu ukurannya.
-->
<nav
	aria-label="Navigasi utama"
	class="z-fab sticky bottom-0 flex h-[64px] w-full items-center justify-around overflow-visible border-t border-slate-100/90 bg-white/95 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl md:fixed md:inset-y-0 md:left-0 md:h-auto md:w-(--app-nav-width) md:flex-col md:items-stretch md:justify-start md:gap-1 md:overflow-y-auto md:border-t-0 md:border-r md:border-slate-200 md:bg-white md:px-1.5 md:py-4 md:shadow-none lg:px-3"
>
	{#each navs as nav}
		{@const Icon = nav.icon}
		{@const isActive = isPathActive(nav.path, page.url.pathname)}

		{#if nav.isHero}
			<!-- Tombol Kasir: menonjol di tengah bilah bawah, kartu biasa di rel samping -->
			<a
				class="group relative -mt-6 flex min-h-[44px] w-14 min-w-[44px] flex-none cursor-pointer flex-col items-center justify-center rounded-2xl focus-visible:ring-2 focus-visible:ring-pink-500/60 focus-visible:outline-none md:mt-0 md:w-full md:py-1.5 md:transition-colors lg:flex-row lg:justify-start lg:gap-3 lg:px-3.5 lg:py-2.5 {isActive
					? 'md:bg-pink-50'
					: 'md:hover:bg-slate-50'}"
				aria-label={nav.label}
				aria-current={isActive ? 'page' : undefined}
				href={nav.path}
				data-sveltekit-preload-data="hover"
			>
				<div
					class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 group-active:scale-90 min-[330px]:h-13 min-[330px]:w-13 md:h-12 md:w-12 md:ring-0 lg:h-9 lg:w-9 {isActive
						? 'scale-105 bg-gradient-to-tr from-pink-500 via-rose-500 to-pink-600 text-white shadow-xl ring-4 shadow-pink-500/40 ring-white md:scale-100'
						: 'bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-lg ring-4 shadow-pink-500/25 ring-white hover:scale-105'} {posCart.totalItems >
						0 && !isActive
						? 'shadow-pink-500/40 ring-pink-400/80'
						: ''}"
				>
					<ShoppingBag class="h-5.5 w-5.5 stroke-[2.3] md:h-6 md:w-6" />

					{#if posCart.totalItems > 0}
						<span
							class="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-black text-white shadow-md ring-2 ring-white"
							in:scale={{ duration: 200 }}
							out:scale={{ duration: 150 }}
						>
							{posCart.totalItems}
						</span>
					{/if}
				</div>
				<span
					class="mt-1 text-[11px] font-bold transition-colors duration-150 lg:mt-0 lg:text-sm {isActive
						? 'text-pink-600'
						: 'text-slate-500 group-hover:text-pink-600'}"
				>
					{nav.label}
				</span>
			</a>
		{:else}
			<!-- Tab biasa -->
			<a
				class="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-center self-stretch rounded-2xl py-1 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-pink-500/60 focus-visible:outline-none active:scale-95 md:h-auto md:w-full md:flex-none md:py-2.5 lg:flex-row lg:justify-start lg:gap-3 lg:px-3.5 {nav.sidebarOnly
					? 'max-md:hidden'
					: ''} {isActive
					? 'text-pink-600 md:bg-pink-50'
					: 'text-slate-400 hover:text-slate-600 md:hover:bg-slate-50'}"
				aria-label={nav.label}
				aria-current={isActive ? 'page' : undefined}
				href={nav.path}
				data-sveltekit-preload-data="hover"
			>
				<!-- lg:h-9 w-9 = lebar kolom ikon yang sama dengan lingkaran Kasir, supaya label sejajar -->
				<div class="relative mb-0.5 flex items-center justify-center lg:mb-0 lg:h-9 lg:w-9">
					<Icon
						class="h-5 w-5 stroke-[1.8] transition-transform duration-150 group-hover:scale-105 md:h-6 md:w-6 {isActive
							? 'scale-105 stroke-[2.2] text-pink-600'
							: 'text-slate-400'}"
					/>
					{#if nav.path === '/antrean' && (orderQueueBadge.countSource !== 'server' || orderQueueBadge.count > 0)}
						<span
							role="status"
							aria-label={orderQueueBadge.countSource === 'unknown'
								? 'Jumlah antrean belum diketahui'
								: orderQueueBadge.countSource === 'cached'
									? `${orderQueueBadge.count} pesanan belum selesai dari data perangkat`
									: `${orderQueueBadge.count} pesanan belum selesai`}
							class="absolute -top-1.5 -right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-black text-white shadow ring-2 ring-white lg:top-0 lg:-right-0.5"
						>
							{orderQueueBadge.countSource === 'unknown'
								? '?'
								: orderQueueBadge.count > 99
									? '99+'
									: orderQueueBadge.count}
						</span>
					{/if}
				</div>
				<span
					class="text-[11px] leading-tight transition-colors duration-150 lg:text-sm {isActive
						? 'font-bold text-pink-600'
						: 'font-medium text-slate-500'}"
				>
					{#if nav.path === '/pengaturan'}
						<span class="hidden min-[420px]:inline">Pengaturan</span><span
							class="min-[420px]:hidden">Atur</span
						>
					{:else}
						{nav.label}
					{/if}
				</span>
				{#if isActive}
					<span
						class="absolute bottom-1 h-1 w-4 rounded-full bg-gradient-to-r from-pink-500 to-rose-500 md:hidden"
					></span>
				{/if}
			</a>
		{/if}
	{/each}
</nav>
