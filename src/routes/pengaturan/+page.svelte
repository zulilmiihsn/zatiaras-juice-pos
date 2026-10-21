<script lang="ts">
	import { isOwnerRole, isKasirRole, isStaffRole } from '$lib/utils/roles';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import Download from '@lucide/svelte/icons/download';
	import History from '@lucide/svelte/icons/history';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Printer from '@lucide/svelte/icons/printer';
	import { createPengaturanState } from '$lib/stores/pengaturanState.svelte';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';

	const s = createPengaturanState();
	const isOwner = $derived(isOwnerRole(s.currentUserRole));
	const RoleIcon = $derived(s.roleIcon);

	const ITEM_BASE =
		'soft-float-card flex min-h-20 items-center gap-3.5 p-4 text-left md:min-h-36 md:flex-col md:justify-center md:gap-3 md:p-5 md:text-center';
	const ITEM_INTERACTIVE =
		'cursor-pointer not-disabled:hover:shadow-[0_8px_24px_-4px_rgba(236,72,153,0.12)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-pink-500 not-disabled:active:scale-[0.98] motion-reduce:transition-none';

	const menuItems = $derived([
		{
			label: 'Antrean',
			sub: 'Notifikasi',
			icon: BellRing,
			iconClass: 'border-pink-100 bg-pink-50 text-pink-600',
			href: '/pengaturan/antrean',
			allowed: isStaffRole(s.currentUserRole)
		},
		{
			label: 'Draft Struk',
			sub: 'Thermal',
			icon: Printer,
			iconClass: 'border-emerald-100 bg-emerald-50 text-emerald-600',
			href: '/pengaturan/printer',
			allowed: true
		},
		{
			label: 'Riwayat',
			sub: 'Hari Ini',
			icon: History,
			iconClass: 'border-amber-100 bg-amber-50 text-amber-600',
			href: '/pengaturan/riwayat',
			allowed: true
		},
		{
			label: 'Install PWA',
			sub: 'App Offline',
			icon: Download,
			iconClass: 'border-pink-100 bg-pink-50 text-pink-600',
			onclick: s.handleInstallPWA,
			busy: !s.isPwaLibraryLoaded,
			allowed: true
		}
	]);

	onMount(async () => {
		await s.init();
	});
</script>

{#snippet itemContent(item: (typeof menuItems)[number])}
	<span
		class="flex size-11 shrink-0 items-center justify-center rounded-2xl border {item.iconClass}"
	>
		<item.icon class="h-5 w-5 stroke-[2.2]" aria-hidden="true" />
	</span>
	<span class="min-w-0 flex-1 md:flex-none">
		<span class="block text-sm font-bold text-slate-900 md:text-base">{item.label}</span>
		<span class="mt-1 block text-xs font-medium text-slate-500">{item.sub}</span>
	</span>
	<ChevronRight class="h-4 w-4 shrink-0 text-slate-400 md:hidden" aria-hidden="true" />
{/snippet}

<main aria-label="Pengaturan Sistem" class="page-content bg-canvas flex min-h-dvh flex-col pb-12">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Sistem</h1>
			<div class="h-10 w-10"></div>
		</div>
	</PageHeader>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 md:px-6">
		<!-- Box Informasi Role (Frosted Glass Card) -->
		{#if s.isLoading || !s.isProfileLoaded}
			<div
				class="glass-card flex w-full animate-pulse flex-col gap-5 rounded-[28px] p-5 shadow-lg sm:flex-row sm:items-center sm:justify-between md:p-6"
				aria-label="Memuat profil"
				aria-busy="true"
			>
				<div class="flex items-center gap-3.5">
					<div class="h-12 w-12 shrink-0 rounded-2xl bg-white/60"></div>
					<div class="space-y-2">
						<div class="h-5 w-28 rounded-full bg-white/60"></div>
						<div class="h-3.5 w-36 rounded-full bg-white/40"></div>
					</div>
				</div>
				{#if isOwner}
					<div class="h-11 rounded-xl bg-white/60 sm:w-36"></div>
				{/if}
			</div>
		{:else}
			<div
				class="glass-card flex w-full flex-col gap-5 rounded-[28px] p-5 shadow-lg sm:flex-row sm:items-center sm:justify-between md:p-6"
			>
				<div class="flex min-w-0 items-center gap-3.5">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
					>
						<RoleIcon class="h-6 w-6 stroke-[2.2]" aria-hidden="true" />
					</div>
					<div class="min-w-0">
						{#if isOwner}
							<h2 class="text-lg font-black text-slate-900">Pemilik Kios</h2>
							<p class="mt-1 text-xs leading-relaxed font-medium text-slate-500 md:text-sm">
								Akses penuh ke seluruh operasional & laporan
							</p>
						{:else if isKasirRole(s.currentUserRole)}
							<h2 class="text-lg font-black text-slate-900">Kasir Kios</h2>
							<p class="mt-1 text-xs leading-relaxed font-medium text-slate-500 md:text-sm">
								Akses transaksi POS & pencatatan keuangan
							</p>
						{/if}
					</div>
				</div>
				<!-- Box Pemilik -->
				{#if isOwner}
					<a
						href="/pengaturan/pemilik"
						class="btn-brand-primary gap-2 px-4 text-sm focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:shrink-0"
					>
						Kelola usaha
						<ChevronRight class="h-4 w-4" aria-hidden="true" />
					</a>
				{/if}
			</div>
		{/if}

		<!-- Grid Menu Pengaturan (Soft Float Cards) -->
		<nav
			aria-label="Menu pengaturan"
			class="grid w-full grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4"
		>
			{#each menuItems as item (item.label)}
				{#if !item.allowed}
					<div aria-disabled="true" class="{ITEM_BASE} cursor-not-allowed opacity-50">
						{@render itemContent(item)}
					</div>
				{:else if item.href}
					<a href={item.href} class="{ITEM_BASE} {ITEM_INTERACTIVE}">
						{@render itemContent(item)}
					</a>
				{:else}
					<button
						type="button"
						class="{ITEM_BASE} {ITEM_INTERACTIVE} disabled:cursor-wait disabled:opacity-60"
						onclick={item.onclick}
						disabled={item.busy}
						aria-busy={item.busy}
					>
						{@render itemContent(item)}
					</button>
				{/if}
			{/each}
		</nav>

		<!-- Logout Section -->
		<div
			class="mt-2 mb-4 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200/70 px-1 pt-5"
		>
			<div>
				<h2 class="text-sm font-bold text-slate-900">Keluar dari Akun</h2>
				<p class="mt-1 text-xs font-medium text-slate-500">Akhiri sesi di perangkat ini</p>
			</div>
			<button
				type="button"
				onclick={s.handleLogout}
				class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-pink-200 px-4 py-2 text-sm font-bold text-pink-600 transition duration-200 ease-out hover:bg-pink-50 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
			>
				<LogOut class="h-4 w-4" aria-hidden="true" />
				<span>Logout</span>
			</button>
		</div>
	</div>

	<!-- Logout Confirmation Modal -->
	<AppModal
		open={s.showLogoutModal}
		label="Konfirmasi Logout"
		size="sm"
		align="center"
		zClass="z-alert"
		panelClass="bg-white p-6"
		onClose={s.cancelLogout}
	>
		<div class="mb-4 flex items-center gap-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
				<LogOut class="h-5 w-5 text-red-600" aria-hidden="true" />
			</div>
			<div>
				<h3 class="font-semibold text-slate-800">Konfirmasi Logout</h3>
				<p class="text-sm text-slate-600">Apakah Anda yakin ingin keluar?</p>
			</div>
		</div>
		<div class="flex gap-3">
			<button
				onclick={s.cancelLogout}
				class="flex-1 rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-50"
			>
				Batal
			</button>
			<button
				onclick={s.confirmLogout}
				class="flex-1 rounded-xl bg-red-500 px-4 py-2 font-medium text-white transition-colors hover:bg-red-600"
			>
				Keluar
			</button>
		</div>
	</AppModal>

	<!-- PWA Install Web Component (SSR-safe) -->
	{#if browser && s.isPwaLibraryLoaded}
		<pwa-install
			manifest-url="/manifest.webmanifest"
			name="Zatiaras POS"
			deskripsi="Install aplikasi ini untuk akses lebih cepat dan pengalaman lebih baik"
			icon="/img/192x192.png"
			manual-apple="true"
			manual-chrome="true"
			disable-install-deskripsi="false"
		></pwa-install>
	{/if}

	<ToastNotification
		show={s.toastManager.showToast}
		message={s.toastManager.toastMessage}
		type={s.toastManager.toastType}
	/>

	<!-- App Info -->
	<div class="mt-auto py-4 text-center">
		<p class="text-xs text-slate-500">ZatiarasPOS v{__APP_VERSION__}</p>
		<p class="mt-1 text-xs text-slate-400">© {new Date().getFullYear()} Zatiaras Juice.</p>
	</div>
</main>

<!-- Custom styling for PWA install dialog -->
<style>
	:global(pwa-install) {
		--pwa-install-dialog-header-color: #ffb6c1 !important;
		--header-color: #ffb6c1 !important;
	}
	:global(pwa-install::part(header)) {
		background-color: #ffb6c1 !important;
	}
</style>
