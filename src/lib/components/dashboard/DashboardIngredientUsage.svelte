<!-- Pemakaian bahan teratas dan peringatan stok menipis. -->
<script lang="ts">
	import Crown from '@lucide/svelte/icons/crown';
	import RankMedal from '$lib/components/dashboard/RankMedal.svelte';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Boxes from '@lucide/svelte/icons/boxes';
	import type { createDashboardState } from '$lib/stores/dashboardState.svelte';

	type Dashboard = ReturnType<typeof createDashboardState>;

	let {
		dashboard
	}: {
		dashboard: Dashboard;
	} = $props();

	function formatStok(val: number): string {
		if (val === undefined || val === null || isNaN(val)) return '0';
		const rounded = Math.round(Number(val) * 100) / 100;
		return rounded.toString();
	}
</script>

<!-- Ranking Penggunaan Bahan Baku Hari Ini -->
<div>
	<div class="mb-2.5 flex items-center justify-between px-1">
		<div>
			<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
				Inventaris Harian
			</div>
			<div class="text-sm font-bold text-slate-900 sm:text-base">Pemakaian Bahan</div>
		</div>
		<a
			href="/stok"
			class="flex items-center gap-1 text-xs font-bold whitespace-nowrap text-pink-600 transition-colors hover:text-pink-700"
		>
			<span>Semua Stok</span>
			<ArrowRight size={13} class="stroke-[2.5]" />
		</a>
	</div>

	{#if dashboard.lowStockCount > 0}
		<a
			href="/stok"
			class="mb-2.5 flex items-center justify-between rounded-2xl border border-rose-200/90 bg-rose-50/80 p-3 text-rose-950 shadow-2xs transition-all hover:bg-rose-100/70 active:scale-[0.99]"
		>
			<div class="flex min-w-0 items-center gap-2.5">
				<div
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white"
				>
					<AlertTriangle size={15} class="stroke-[2.5]" />
				</div>
				<div class="truncate text-xs font-bold">
					<span>{dashboard.lowStockCount} Bahan Menipis:</span>
					<span class="font-medium text-rose-700"> {dashboard.lowStockNames.join(', ')}</span>
				</div>
			</div>
			<span class="shrink-0 text-xs font-bold text-rose-600 underline">Restock</span>
		</a>
	{/if}

	{#if dashboard.topIngredients.length === 0}
		<div class="rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-xs">
			<Boxes class="mx-auto mb-2 h-8 w-8 stroke-[1.8] text-slate-300" />
			<div class="text-xs font-bold text-slate-700">Belum Ada Data Bahan</div>
			<div class="mt-0.5 text-[11px] text-slate-400">
				Tambahkan bahan baku di menu Stok untuk tracking pemakaian
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-2.5">
			{#each dashboard.topIngredients as ing, i}
				<div
					class="soft-float-card relative flex items-center justify-between overflow-visible p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] {ing.is_low
						? 'border border-rose-200/80 bg-rose-50/20'
						: ''}"
				>
					{#if i === 0}
						<!-- Crown Gimmick -->
						<div
							class="pointer-events-none absolute -top-3.5 -left-2 z-10 flex h-7 w-7 -rotate-[18deg] items-center justify-center drop-shadow-sm"
							title="Peringkat 1 Pemakaian"
						>
							<Crown size={22} class="fill-amber-400 stroke-[2.2] text-amber-500" />
						</div>
					{/if}

					<div class="flex min-w-0 items-center gap-3">
						<!-- Rank Medal -->
						<RankMedal rank={i + 1} />

						<!-- Ingredient Icon Box -->
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl {ing.is_low
								? 'border border-rose-200/70 bg-rose-50 text-rose-600'
								: 'border border-pink-100/60 bg-pink-50/70 text-pink-600'}"
						>
							{#if ing.is_low}
								<AlertTriangle size={20} class="stroke-[2.2]" />
							{:else}
								<Boxes size={20} class="stroke-[2.2]" />
							{/if}
						</div>

						<!-- Title & Usage -->
						<div class="min-w-0 flex-1">
							<h4 class="truncate text-sm leading-tight font-bold text-slate-900">
								{ing.nama}
							</h4>
							<div class="mt-0.5 text-[11px] font-medium text-slate-400">
								{#if ing.terpakai > 0}
									Terpakai hari ini: <span class="font-bold text-slate-700"
										>{formatStok(ing.terpakai)} {ing.satuan}</span
									>
								{:else}
									<span>Belum ada pemakaian</span>
								{/if}
							</div>
						</div>
					</div>

					<!-- Remaining Stock Pill -->
					<div class="shrink-0 pl-2">
						<span
							class="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold {ing.is_low
								? 'border border-rose-200 bg-rose-100 text-rose-800'
								: 'border border-emerald-100 bg-emerald-50 text-emerald-800'}"
						>
							{ing.is_low ? 'Menipis · ' : ''}Sisa {formatStok(ing.stok_saat_ini)}
							{ing.satuan}
						</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
