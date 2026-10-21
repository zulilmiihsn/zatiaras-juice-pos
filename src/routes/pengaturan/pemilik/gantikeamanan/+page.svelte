<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onDestroy, onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createSecuritySettingsState } from '$lib/stores/securitySettingsState.svelte';

	import CredentialsCard from '$lib/components/pengaturan/keamanan/CredentialsCard.svelte';
	import PinCard from '$lib/components/pengaturan/keamanan/PinCard.svelte';
	import LockedPagesCard from '$lib/components/pengaturan/keamanan/LockedPagesCard.svelte';

	const s = createSecuritySettingsState();
	onMount(s.mount);
	onDestroy(s.destroy);
</script>

<div class="page-content flex min-h-dvh flex-col bg-[#faf7f8] pb-20">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan/pemilik" label="Kembali ke Pengaturan Pemilik">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Keamanan & Hak Akses
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</PageHeader>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col px-4 md:px-6">
		<div class="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-start md:gap-5">
			<!-- ========================================== -->
			<!-- COLUMN 1: Kredensial Login (Pemilik / Kasir) -->
			<!-- ========================================== -->
			<div class="flex flex-col gap-4 md:col-span-6 lg:col-span-7">
				<CredentialsCard {s} />
			</div>

			<!-- ========================================== -->
			<!-- COLUMN 2: PIN & Proteksi Halaman Terkunci  -->
			<!-- ========================================== -->
			<div class="flex flex-col gap-4 md:col-span-6 lg:col-span-5">
				<PinCard {s} />

				<LockedPagesCard {s} />
			</div>
		</div>
	</div>
</div>

<!-- Toast Notification -->
{#if s.toastManager.showToast}
	<ToastNotification
		show={s.toastManager.showToast}
		message={s.toastManager.toastMessage}
		type={s.toastManager.toastType}
		position="top"
	/>
{/if}
