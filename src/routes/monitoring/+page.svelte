<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Activity from '@lucide/svelte/icons/activity';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import Database from '@lucide/svelte/icons/database';
	import Wifi from '@lucide/svelte/icons/wifi';
	import { getRealtimeHealth } from '$lib/realtime/durableObjectClient';

	let monitoringSummary = $state<any>(null);
	let realtimeHealth = $state(getRealtimeHealth());
	let isLoading = $state(true);
	let errorMessage = $state('');

	async function loadMonitoringSummary() {
		isLoading = true;
		errorMessage = '';
		realtimeHealth = getRealtimeHealth();
		try {
			const response = await fetch('/api/monitoring?windowMinutes=60', {
				credentials: 'include'
			});
			if (!response.ok) {
				errorMessage = 'Monitoring tidak dapat dimuat';
				return;
			}
			monitoringSummary = await response.json();
		} catch {
			errorMessage = 'Gagal membaca monitoring';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void loadMonitoringSummary();
	});
</script>

<svelte:head>
	<title>Monitoring Produksi - Zatiaras POS</title>
</svelte:head>

<div class="min-h-[100dvh] bg-gray-50 px-4 py-4 text-gray-900 md:px-8 md:py-8">
	<header class="mx-auto flex max-w-6xl items-center justify-between gap-4">
		<div class="flex items-center gap-3">
			<button
				type="button"
				class="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm transition-all active:scale-[0.98]"
				aria-label="Kembali"
				onclick={() => goto('/pengaturan')}
			>
				<ArrowLeft class="h-5 w-5" />
			</button>
			<div>
				<h1 class="text-xl font-bold tracking-normal md:text-2xl">Monitoring Produksi</h1>
				<p class="mt-1 text-sm text-gray-500">Window 60 menit</p>
			</div>
		</div>
		<button
			type="button"
			class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition-all active:scale-[0.98]"
			onclick={loadMonitoringSummary}
			disabled={isLoading}
		>
			<RefreshCw class="h-4 w-4 {isLoading ? 'animate-spin' : ''}" />
			<span>{isLoading ? 'Memuat' : 'Refresh'}</span>
		</button>
	</header>

	<main class="mx-auto mt-6 max-w-6xl space-y-4">
		{#if errorMessage}
			<div class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
				{errorMessage}
			</div>
		{/if}

		{#if monitoringSummary}
			{#if monitoringSummary.degraded}
				<div
					class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
				>
					Sebagian sumber monitoring tidak tersedia. Angka dari sumber tersebut tidak ditampilkan.
				</div>
			{/if}
			<section class="grid gap-3 md:grid-cols-4">
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<Activity class="h-5 w-5 text-pink-500" />
					<div class="mt-3 text-sm text-gray-500">API Avg</div>
					<div class="mt-1 text-2xl font-bold">
						{monitoringSummary.sources?.requestMetrics?.available
							? `${monitoringSummary.requests?.avgLatencyMs || 0} ms`
							: 'Tidak tersedia'}
					</div>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<Activity class="h-5 w-5 text-pink-500" />
					<div class="mt-3 text-sm text-gray-500">API P95</div>
					<div class="mt-1 text-2xl font-bold">
						{monitoringSummary.sources?.requestMetrics?.available
							? `${monitoringSummary.requests?.p95LatencyMs || 0} ms`
							: 'Tidak tersedia'}
					</div>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<AlertTriangle class="h-5 w-5 text-pink-500" />
					<div class="mt-3 text-sm text-gray-500">Error</div>
					<div class="mt-1 text-2xl font-bold">
						{monitoringSummary.sources?.errorEvents?.available
							? monitoringSummary.errors?.total || 0
							: 'Tidak tersedia'}
					</div>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<Wifi class="h-5 w-5 text-pink-500" />
					<div class="mt-3 text-sm text-gray-500">Realtime</div>
					<div class="mt-1 text-2xl font-bold">
						{realtimeHealth.connected ? `${realtimeHealth.latencyMs || 0} ms` : 'Offline'}
					</div>
				</div>
			</section>

			<section class="grid gap-4 md:grid-cols-[1.4fr_0.8fr]">
				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<div class="mb-3 flex items-center gap-2 text-base font-bold">
						<Activity class="h-5 w-5 text-pink-500" />
						<span>Endpoint Lambat</span>
					</div>
					{#if monitoringSummary.requests?.slowest?.length}
						<div class="divide-y divide-gray-100">
							{#each monitoringSummary.requests.slowest.slice(0, 10) as item}
								<div class="flex items-center justify-between gap-4 py-3 text-sm">
									<span class="min-w-0 truncate text-gray-600">{item.method} {item.path}</span>
									<span class="shrink-0 font-semibold">{item.duration_ms} ms</span>
								</div>
							{/each}
						</div>
					{:else}
						<div class="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">Belum ada sampel.</div>
					{/if}
				</div>

				<div class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
					<div class="mb-3 flex items-center gap-2 text-base font-bold">
						<Database class="h-5 w-5 text-pink-500" />
						<span>Backup D1</span>
					</div>
					{#if !monitoringSummary.sources?.backupRuns?.available}
						<div class="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
							Data backup tidak tersedia.
						</div>
					{:else if monitoringSummary.backups?.recent?.length}
						<div class="space-y-3">
							{#each monitoringSummary.backups.recent.slice(0, 5) as backup}
								<div class="rounded-lg bg-gray-50 p-3 text-sm">
									<div class="flex items-center justify-between gap-3">
										<span class="font-semibold">{backup.status}</span>
										<span class="text-xs text-gray-500">{backup.database_name}</span>
									</div>
									<div class="mt-1 truncate text-xs text-gray-500">
										{backup.finished_at || backup.started_at}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
							Belum ada backup tercatat.
						</div>
					{/if}
				</div>
			</section>
		{:else if isLoading}
			<section class="grid gap-3 md:grid-cols-4">
				{#each Array(4) as _}
					<div class="h-28 animate-pulse rounded-lg bg-white shadow-sm"></div>
				{/each}
			</section>
		{/if}
	</main>
</div>
