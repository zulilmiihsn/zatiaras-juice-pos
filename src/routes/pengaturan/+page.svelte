<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import { createPengaturanState } from '$lib/stores/pengaturanState.svelte';
	import AppModal from '$lib/components/shared/AppModal.svelte';

	const s = createPengaturanState();
	const isOwner = $derived(s.currentUserRole === 'admin' || s.currentUserRole === 'pemilik');

	onMount(async () => {
		await s.init();
	});
</script>

<main
	aria-label="Pengaturan Sistem"
	class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12"
>
	<!-- Fluid Wave Header for Pengaturan (Full-width edge-to-edge) -->
	<div class="page-header relative w-full px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<HeaderBackButton href="/">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Sistem</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

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
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#b5496b] text-white"
					>
						{#if s.roleIcon}
							{@const RoleIcon = s.roleIcon}
							<RoleIcon class="h-6 w-6 stroke-[2.2]" aria-hidden="true" />
						{:else}
							<span
								class="block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
							></span>
						{/if}
					</div>
					<div class="min-w-0">
						{#if isOwner}
							<h2 class="text-lg font-black text-slate-900">Pemilik Kios</h2>
							<p class="mt-1 text-xs leading-relaxed font-medium text-slate-500 md:text-sm">
								Akses penuh ke seluruh operasional & laporan
							</p>
						{:else if s.currentUserRole === 'kasir'}
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
						class="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#b5496b] px-4 py-3 text-sm font-bold text-white transition duration-200 ease-out hover:bg-[#a13f5e] focus-visible:ring-2 focus-visible:ring-[#b5496b] focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:shrink-0"
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
			<button
				type="button"
				class="settings-menu-item soft-float-card disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
				onclick={() => goto('/pengaturan/antrean')}
				disabled={s.currentUserRole !== 'kasir' && s.currentUserRole !== 'pemilik'}
			>
				<span class="settings-menu-icon">
					<BellRing class="h-5 w-5 stroke-[2.2]" aria-hidden="true" />
				</span>
				<span class="min-w-0 flex-1 md:flex-none">
					<span class="block text-sm font-bold text-slate-900 md:text-base">Antrean</span>
					<span class="mt-1 block text-xs font-medium text-slate-500">Notifikasi</span>
				</span>
				<ChevronRight class="h-4 w-4 shrink-0 text-stone-400 md:hidden" aria-hidden="true" />
			</button>

			<!-- Box Printer (Draft Struk) -->
			<button
				type="button"
				class="settings-menu-item soft-float-card"
				onclick={() => goto('/pengaturan/printer')}
			>
				<span class="settings-menu-icon">
					{#if s.Printer}
						{@const PrinterIcon = s.Printer}
						<PrinterIcon class="h-5 w-5 stroke-[2.2]" aria-hidden="true" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-[#ecd5dd] border-t-[#b5496b]"
						></span>
					{/if}
				</span>
				<span class="min-w-0 flex-1 md:flex-none">
					<span class="block text-sm font-bold text-slate-900 md:text-base">Draft Struk</span>
					<span class="mt-1 block text-xs font-medium text-slate-500">Thermal</span>
				</span>
				<ChevronRight class="h-4 w-4 shrink-0 text-stone-400 md:hidden" aria-hidden="true" />
			</button>

			<!-- Box Riwayat Transaksi -->
			<button
				type="button"
				class="settings-menu-item soft-float-card"
				onclick={() => goto('/pengaturan/riwayat')}
			>
				<span class="settings-menu-icon">
					{#if s.History}
						{@const HistoryIcon = s.History}
						<HistoryIcon class="h-5 w-5 stroke-[2.2]" aria-hidden="true" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-[#ecd5dd] border-t-[#b5496b]"
						></span>
					{/if}
				</span>
				<span class="min-w-0 flex-1 md:flex-none">
					<span class="block text-sm font-bold text-slate-900 md:text-base">Riwayat</span>
					<span class="mt-1 block text-xs font-medium text-slate-500">Hari Ini</span>
				</span>
				<ChevronRight class="h-4 w-4 shrink-0 text-stone-400 md:hidden" aria-hidden="true" />
			</button>

			<!-- Box Install PWA -->
			<button
				type="button"
				class="settings-menu-item soft-float-card disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
				onclick={s.handleInstallPWA}
				disabled={!s.isPwaLibraryLoaded}
				aria-busy={!s.isPwaLibraryLoaded}
			>
				<span class="settings-menu-icon">
					{#if s.Download}
						{@const DownloadIcon = s.Download}
						<DownloadIcon class="h-5 w-5 stroke-[2.2]" aria-hidden="true" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-[#ecd5dd] border-t-[#b5496b]"
						></span>
					{/if}
				</span>
				<span class="min-w-0 flex-1 md:flex-none">
					<span class="block text-sm font-bold text-slate-900 md:text-base">Install PWA</span>
					<span class="mt-1 block text-xs font-medium text-slate-500">App Offline</span>
				</span>
				<ChevronRight class="h-4 w-4 shrink-0 text-stone-400 md:hidden" aria-hidden="true" />
			</button>
		</nav>

		<!-- Logout Section -->
		<div
			class="mt-2 mb-4 flex flex-wrap items-center justify-between gap-4 border-t border-stone-200/70 px-1 pt-5"
		>
			<div>
				<h2 class="text-sm font-bold text-slate-900">Keluar dari Akun</h2>
				<p class="mt-1 text-xs font-medium text-slate-500">Akhiri sesi di perangkat ini</p>
			</div>
			<button
				type="button"
				onclick={s.handleLogout}
				class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#ecd5dd] px-4 py-2 text-sm font-bold text-[#b5496b] transition duration-200 ease-out hover:bg-[#f8edf1] focus-visible:ring-2 focus-visible:ring-[#b5496b] focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
			>
				{#if s.LogOut}
					{@const LogOutIcon = s.LogOut}
					<LogOutIcon class="h-4 w-4" aria-hidden="true" />
				{/if}
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
				{#if s.LogOut}
					{@const LogOutIcon = s.LogOut}
					<LogOutIcon class="h-5 w-5 text-red-600" />
				{:else}
					<div class="flex h-5 w-5 items-center justify-center">
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-red-200 border-t-red-600"
						></span>
					</div>
				{/if}
			</div>
			<div>
				<h3 class="font-semibold text-gray-800">Konfirmasi Logout</h3>
				<p class="text-sm text-gray-600">Apakah Anda yakin ingin keluar?</p>
			</div>
		</div>
		<div class="flex gap-3">
			<button
				onclick={s.cancelLogout}
				class="flex-1 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50"
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

	<!-- PWA Installed Toast -->
	{#if s.showPwaInstalledToast}
		<div
			class="animate-fade-in z-toast fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-green-500 px-6 py-3 text-sm font-semibold text-white shadow-lg"
		>
			Aplikasi berhasil terpasang di Home Screen!
		</div>
	{/if}

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

	<!-- Custom styling for PWA install dialog -->
	<style>
		.settings-menu-item {
			display: flex;
			min-height: 5rem;
			cursor: pointer;
			align-items: center;
			gap: 0.875rem;
			padding: 1rem;
			text-align: left;
			transition:
				box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1),
				transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
		}

		.settings-menu-item:hover:not(:disabled) {
			box-shadow: 0 8px 24px -4px rgba(181, 73, 107, 0.12);
		}

		.settings-menu-item:focus-visible {
			outline: 2px solid #b5496b;
			outline-offset: 3px;
		}

		.settings-menu-item:active:not(:disabled) {
			transform: scale(0.98);
		}

		.settings-menu-icon {
			display: flex;
			width: 2.75rem;
			height: 2.75rem;
			flex-shrink: 0;
			align-items: center;
			justify-content: center;
			border: 1px solid #ecd5dd;
			border-radius: 1rem;
			background: #f8edf1;
			color: #b5496b;
		}

		@media (min-width: 48rem) {
			.settings-menu-item {
				min-height: 9rem;
				flex-direction: column;
				justify-content: center;
				gap: 0.75rem;
				padding: 1.25rem;
				text-align: center;
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.settings-menu-item {
				transition: none;
			}
		}

		:global(pwa-install) {
			--pwa-install-dialog-header-color: #ffb6c1 !important;
			--header-color: #ffb6c1 !important;
		}
		:global(pwa-install::part(header)) {
			background-color: #ffb6c1 !important;
		}
	</style>

	{#if s.showNotification}
		<div class="z-toast pointer-events-none fixed inset-x-0 top-20 flex justify-center px-4">
			<div
				class="rounded-2xl bg-amber-500 px-6 py-3 text-center font-bold text-white shadow-xl shadow-amber-950/20 backdrop-blur-md"
				in:fly={{ y: -20, duration: 240, easing: cubicOut }}
				out:fade={{ duration: 160 }}
			>
				{s.notificationMessage}
			</div>
		</div>
	{/if}
</main>

<!-- App Info -->
<div class="py-4 text-center">
	<p class="text-xs text-gray-500">ZatiarasPOS v1.0</p>
	<p class="mt-1 text-xs text-gray-400">© 2024 Zatiaras Juice.</p>
</div>
