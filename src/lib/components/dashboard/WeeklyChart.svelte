<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getLast7DaysLabelsWITA } from '$lib/utils/dateTime';
	import { formatRupiah } from '$lib/utils/currency';

	let { weeklyIncome = [], weeklyMax = 1 } = $props<{
		weeklyIncome: number[];
		weeklyMax: number;
	}>();

	let barsVisible = $state(false);
	let incomeChartRef = $state<HTMLDivElement | null>(null);

	let selectedBarIndex = $state<number | null>(null);
	let showBarInsight = $state(false);
	let barHoldTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	$effect(() => {
		if (incomeChartRef) {
			const observer = new window.IntersectionObserver(
				(entries) => {
					if (entries[0].isIntersecting) {
						barsVisible = true;
						observer.disconnect();
					}
				},
				{ threshold: 0.3 }
			);
			observer.observe(incomeChartRef);
			return () => observer.disconnect();
		}
	});

	function handleBarPointerDown(i: number) {
		barHoldTimeout = setTimeout(() => {
			selectedBarIndex = i;
			showBarInsight = true;
		}, 120);
	}

	function handleBarPointerUp() {
		if (barHoldTimeout) clearTimeout(barHoldTimeout);
		showBarInsight = false;
		selectedBarIndex = null;
	}

	function showBarValue(i: number) {
		selectedBarIndex = i;
		showBarInsight = true;
	}

	const totalWeekly = $derived(
		weeklyIncome.reduce((acc: number, curr: number) => acc + (curr || 0), 0)
	);

	onDestroy(() => {
		if (barHoldTimeout) clearTimeout(barHoldTimeout);
	});
</script>

<div
	class="soft-float-card flex flex-col p-4.5 transition-all duration-200 hover:shadow-md sm:p-5"
	bind:this={incomeChartRef}
>
	<div class="mb-3 flex items-center justify-between">
		<div>
			<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
				Grafik Penjualan 7 Hari
			</div>
			<div class="flex items-baseline gap-2">
				<span class="text-base font-extrabold text-slate-900 md:text-lg">
					Rp {formatRupiah(totalWeekly)}
				</span>
				<span class="text-[11px] font-semibold text-slate-400">Total Akumulasi</span>
			</div>
		</div>
	</div>

	<!-- Chart area with responsive container height and relative percentage bars -->
	<div class="relative flex h-36 w-full items-end gap-2 pt-6 pb-1 sm:h-44 md:h-64">
		{#if weeklyIncome.length === 0}
			<div class="relative flex h-full w-full items-end gap-2">
				{#each getLast7DaysLabelsWITA() as label (label)}
					<div class="flex flex-1 flex-col items-center gap-1.5">
						<div class="h-2 w-full max-w-[32px] rounded-t-lg bg-slate-100"></div>
						<span class="text-[11px] font-semibold text-slate-400">{label}</span>
					</div>
				{/each}
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<span
						class="rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400 shadow-2xs"
					>
						Belum ada data pendapatan
					</span>
				</div>
			</div>
		{:else}
			{#each weeklyIncome as income, i (i)}
				{@const pct =
					weeklyMax > 0 && income > 0 ? Math.max(Math.min((income / weeklyMax) * 100, 100), 8) : 0}
				<div class="group relative flex h-full flex-1 flex-col items-center justify-end">
					<!-- Bar Button -->
					<button
						type="button"
						class="w-full max-w-[36px] cursor-pointer rounded-t-lg transition-all duration-500 active:scale-95 {income >
						0
							? 'bg-gradient-to-t from-emerald-500 to-teal-400 shadow-xs shadow-emerald-500/20 group-hover:from-emerald-600 group-hover:to-teal-500'
							: 'bg-slate-100'}"
						aria-label="{getLast7DaysLabelsWITA()[i]}: Rp {formatRupiah(income)}"
						style="height: {barsVisible && income > 0 ? pct : 0}%; min-height: {barsVisible &&
						income > 0
							? '12px'
							: '4px'};"
						onpointerdown={() => handleBarPointerDown(i)}
						onpointerup={handleBarPointerUp}
						onpointerleave={handleBarPointerUp}
						onfocus={() => showBarValue(i)}
						onblur={handleBarPointerUp}
						ontouchstart={() => handleBarPointerDown(i)}
						ontouchend={handleBarPointerUp}
						ontouchcancel={handleBarPointerUp}
					></button>

					<!-- Day Label -->
					<span
						class="mt-1.5 text-[11px] font-bold transition-colors {selectedBarIndex === i
							? 'text-pink-600'
							: 'text-slate-500'}"
					>
						{getLast7DaysLabelsWITA()[i]}
					</span>

					<!-- Tooltip / Bubble Insight -->
					{#if (showBarInsight && selectedBarIndex === i) || (income > 0 && selectedBarIndex === i)}
						<div
							class="animate-fade-in pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-xl border border-pink-200/90 bg-white/95 px-3 py-1.5 text-center whitespace-nowrap shadow-lg backdrop-blur-md"
						>
							<div class="text-[10px] font-semibold text-slate-400">
								{getLast7DaysLabelsWITA()[i]}
							</div>
							<div class="text-xs font-black text-pink-600">Rp {formatRupiah(income)}</div>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
