<!-- Kartu menu terlaris hari ini. -->
<script lang="ts">
	import Crown from '@lucide/svelte/icons/crown';
	import CupIcon from '$lib/components/icons/CupIcon.svelte';
	import RankMedal from '$lib/components/dashboard/RankMedal.svelte';
	import type { createDashboardState } from '$lib/stores/dashboardState.svelte';

	type Dashboard = ReturnType<typeof createDashboardState>;

	let {
		dashboard
	}: {
		dashboard: Dashboard;
	} = $props();

	let imageError = $state<Record<number, boolean>>({});

	function handleImgError(index: number) {
		imageError[index] = true;
	}
</script>

<!-- Menu Terlaris (Peringkat Penjualan) -->
<div>
	<div class="mb-2.5 flex items-center justify-between px-1">
		<div>
			<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
				Peringkat Penjualan
			</div>
			<div class="text-sm font-bold text-slate-900 sm:text-base">Menu Terlaris</div>
		</div>
		{#if dashboard.bestSellers.length > 0}
			<span
				class="rounded-full border border-pink-100 bg-pink-50 px-2.5 py-0.5 text-[11px] font-bold text-pink-700"
			>
				{dashboard.bestSellers.length} Menu
			</span>
		{/if}
	</div>
	{#if dashboard.isLoadingBestSellers}
		<div class="flex flex-col gap-2.5">
			{#each Array(3) as _}
				<div
					class="flex animate-pulse items-center gap-3.5 rounded-[24px] bg-white p-3.5 shadow-xs"
				>
					<div class="h-12 w-12 rounded-2xl bg-slate-100"></div>
					<div class="min-w-0 flex-1">
						<div class="mb-2 h-4 w-32 rounded bg-slate-100"></div>
						<div class="h-3 w-20 rounded bg-slate-100"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if dashboard.errorBestSellers}
		<div
			class="glass-card rounded-[24px] py-6 text-center text-xs font-bold text-rose-500 shadow-sm"
		>
			{dashboard.errorBestSellers}
		</div>
	{:else if dashboard.bestSellers.length === 0}
		<div
			class="glass-card rounded-[24px] py-8 text-center text-xs font-medium text-slate-400 shadow-sm"
		>
			Belum ada data transaksi menu terlaris
		</div>
	{:else}
		<div class="flex flex-col gap-2.5">
			{#each dashboard.bestSellers.slice(0, 5) as m, i}
				<div
					class="soft-float-card relative flex items-center justify-between overflow-visible p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99]"
				>
					{#if i === 0}
						<!-- Crown Gimmick -->
						<div
							class="pointer-events-none absolute -top-3.5 -left-2 z-10 flex h-7 w-7 -rotate-[18deg] items-center justify-center drop-shadow-sm"
							title="Peringkat 1 Terlaris"
						>
							<Crown size={22} class="fill-amber-400 stroke-[2.2] text-amber-500" />
						</div>
					{/if}

					<div class="flex min-w-0 items-center gap-3">
						<!-- Rank Medal -->
						<RankMedal rank={i + 1} />

						<!-- Product Image / Icon -->
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-pink-100/60 bg-pink-50/70 text-2xl"
						>
							{#if m.image && !imageError[i]}
								<img
									class="h-full w-full object-cover"
									src={m.image}
									alt={m.nama}
									onerror={() => handleImgError(i)}
								/>
							{:else}
								<CupIcon class="h-6 w-6 text-pink-500" strokeWidth={2} />
							{/if}
						</div>

						<!-- Title -->
						<div class="min-w-0 flex-1">
							<h4 class="truncate text-sm leading-tight font-bold text-slate-900">
								{m.nama}
							</h4>
							<span class="text-[11px] font-medium text-slate-400">Favorit Pelanggan</span>
						</div>
					</div>

					<!-- Sold Count Pill -->
					<div class="shrink-0 pl-2">
						<span
							class="inline-flex items-center rounded-full border border-pink-100 bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700"
						>
							{m.total_qty ?? 0}
							<span class="ml-1 text-[10px] font-semibold text-slate-400">terjual</span>
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
