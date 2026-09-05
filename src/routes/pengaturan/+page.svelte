<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { browser } from '$app/environment';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Crown from '@lucide/svelte/icons/crown';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import User from '@lucide/svelte/icons/user';
	import { createPengaturanState } from '$lib/stores/pengaturanState.svelte';

	const s = createPengaturanState();

	onMount(async () => {
		await s.init();
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<!-- Fluid Wave Header for Pengaturan (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<a
				href="/"
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</a>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Sistem</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 md:px-6">
		<!-- Box Informasi Role (Frosted Glass Card) -->
		{#if s.isLoading || !s.isProfileLoaded}
			<div
				class="glass-card flex w-full animate-pulse flex-col items-center gap-2 rounded-[28px] p-5 shadow-lg md:mx-auto md:max-w-md"
			>
				<div class="mb-1 h-12 w-12 rounded-2xl bg-white/60"></div>
				<div class="h-5 w-28 rounded-full bg-white/60"></div>
				<div class="h-3.5 w-36 rounded-full bg-white/40"></div>
			</div>
		{:else}
			<div
				class="glass-card flex w-full flex-col items-center gap-1.5 rounded-[28px] p-5 text-center shadow-lg transition-all md:mx-auto md:max-w-md"
			>
				<div
					class="mb-1 flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
				>
					{#if s.roleIcon}
						{@const RoleIcon = s.roleIcon}
						<RoleIcon class="h-6 w-6 stroke-[2.2]" />
					{:else}
						<span
							class="block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
						></span>
					{/if}
				</div>
				{#if s.currentUserRole === 'admin' || s.currentUserRole === 'pemilik'}
					<div class="text-lg font-black text-slate-900">Pemilik Kios</div>
					<div class="text-xs font-semibold text-slate-500">
						Akses penuh ke seluruh operasional & laporan
					</div>
				{:else if s.currentUserRole === 'kasir'}
					<div class="text-lg font-black text-slate-900">Kasir Kios</div>
					<div class="text-xs font-semibold text-slate-500">
						Akses transaksi POS & pencatatan keuangan
					</div>
				{/if}
			</div>
		{/if}

		<!-- Grid Menu Pengaturan (Soft Float Cards) -->
		<div class="grid w-full grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
			<!-- Box Pemilik -->
			<button
				class="soft-float-card flex aspect-square cursor-pointer flex-col items-center justify-center p-4 text-center transition-all duration-200 hover:shadow-lg active:scale-95 md:aspect-auto md:py-6 {s.currentUserRole ===
					'admin' || s.currentUserRole === 'pemilik'
					? ''
					: 'pointer-events-none opacity-50'}"
				onclick={() =>
					(s.currentUserRole === 'admin' || s.currentUserRole === 'pemilik') &&
					goto('/pengaturan/pemilik')}
				disabled={s.currentUserRole !== 'admin' && s.currentUserRole !== 'pemilik'}
			>
				<div
					class="mb-2.5 flex h-11 w-11 items-center justify-center rounded-[18px] border border-purple-100 bg-purple-50 text-purple-600 md:h-12 md:w-12"
				>
					<Crown class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
				</div>
				<div class="text-sm font-black text-slate-900 md:text-base">Pemilik</div>
				<span
					class="mt-1 inline-block rounded-full bg-purple-50 px-2.5 py-0.5 text-[10px] font-extrabold text-purple-700 md:text-xs"
					>Khusus Owner</span
				>
			</button>

			<!-- Box Install PWA -->
			<button
				class="soft-float-card flex aspect-square cursor-pointer flex-col items-center justify-center p-4 text-center transition-all duration-200 hover:shadow-lg active:scale-95 md:aspect-auto md:py-6"
				onclick={s.handleInstallPWA}
			>
				<div
					class="mb-2.5 flex h-11 w-11 items-center justify-center rounded-[18px] border border-pink-100 bg-pink-50 text-pink-600 md:h-12 md:w-12"
				>
					{#if s.Download}
						{@const DownloadIcon = s.Download}
						<DownloadIcon class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-300 border-t-pink-600"
						></span>
					{/if}
				</div>
				<div class="text-sm font-bold text-slate-900 md:text-base">Install PWA</div>
				<span
					class="mt-1 inline-block rounded-full bg-pink-50 px-2.5 py-0.5 text-[10px] font-bold text-pink-700 md:text-xs"
					>App Offline</span
				>
			</button>

			<!-- Box Printer (Draft Struk) -->
			<button
				class="soft-float-card flex aspect-square cursor-pointer flex-col items-center justify-center p-4 text-center transition-all duration-200 hover:shadow-lg active:scale-95 md:aspect-auto md:py-6"
				onclick={() => goto('/pengaturan/printer')}
			>
				<div
					class="mb-2.5 flex h-11 w-11 items-center justify-center rounded-[18px] border border-emerald-100 bg-emerald-50 text-emerald-600 md:h-12 md:w-12"
				>
					{#if s.Printer}
						{@const PrinterIcon = s.Printer}
						<PrinterIcon class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-600"
						></span>
					{/if}
				</div>
				<div class="text-sm font-black text-slate-900 md:text-base">Draft Struk</div>
				<span
					class="mt-1 inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-700 md:text-xs"
					>Thermal</span
				>
			</button>

			<!-- Box Riwayat Transaksi -->
			<button
				class="soft-float-card flex aspect-square cursor-pointer flex-col items-center justify-center p-4 text-center transition-all duration-200 hover:shadow-lg active:scale-95 md:aspect-auto md:py-6"
				onclick={() => goto('/pengaturan/riwayat')}
			>
				<div
					class="mb-2.5 flex h-11 w-11 items-center justify-center rounded-[18px] border border-amber-100 bg-amber-50 text-amber-600 md:h-12 md:w-12"
				>
					{#if s.History}
						{@const HistoryIcon = s.History}
						<HistoryIcon class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600"
						></span>
					{/if}
				</div>
				<div class="text-sm font-black text-slate-900 md:text-base">Riwayat</div>
				<span
					class="mt-1 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-700 md:text-xs"
					>Hari Ini</span
				>
			</button>
		</div>

		<!-- Logout Section -->
		<div class="soft-float-card mt-2 mb-6 overflow-hidden p-5 md:p-6">
			<div class="flex items-center justify-between gap-4">
				<div>
					<h3 class="text-sm font-black text-slate-900 md:text-base">Keluar dari Akun</h3>
					<p class="text-xs font-medium text-slate-500 md:text-sm">
						Akhiri sesi kasir atau pemilik saat ini
					</p>
				</div>
				<button
					onclick={s.handleLogout}
					class="flex cursor-pointer items-center gap-1.5 rounded-full border border-rose-100 bg-rose-50 px-4 py-2 text-xs font-black text-rose-600 transition-all hover:bg-rose-100 active:scale-95 md:px-5 md:py-2.5 md:text-sm"
				>
					{#if s.LogOut}
						{@const LogOutIcon = s.LogOut}
						<LogOutIcon class="h-4 w-4" />
					{/if}
					<span>Logout</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Logout Confirmation Modal -->
	{#if s.showLogoutModal}
		<div class="z-alert fixed inset-0 flex items-center justify-center bg-black/50 p-4">
			<div class="animate-slideUpModal w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
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
			</div>
		</div>
	{/if}

	<!-- PWA Installed Toast -->
	{#if s.showPwaInstalledToast}
		<div
			class="animate-fadeIn z-toast fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-green-500 px-6 py-3 text-sm font-semibold text-white shadow-lg"
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
</div>

<!-- App Info -->
<div class="py-4 text-center">
	<p class="text-xs text-gray-500">ZatiarasPOS v1.0</p>
	<p class="mt-1 text-xs text-gray-400">© 2024 Zatiaras Juice.</p>
</div>

<style>
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.animate-fadeIn {
		animation: fadeIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
	}
	@keyframes slideUpModal {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.animate-slideUpModal {
		animation: slideUpModal 0.32s cubic-bezier(0.4, 0, 0.2, 1);
	}
</style>
