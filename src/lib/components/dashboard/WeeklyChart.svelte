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
		}, 120); // Sedikit delay agar tidak accidental tap
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

	onDestroy(() => {
		if (barHoldTimeout) clearTimeout(barHoldTimeout);
	});
</script>

<div
	class="flex flex-col rounded-xl bg-white p-4 shadow md:rounded-2xl md:border md:border-pink-100 md:p-8 md:shadow-none"
	bind:this={incomeChartRef}
>
	<div class="mt-1 mb-2 text-xs text-gray-500 md:text-sm">Pendapatan 7 Hari Terakhir</div>
	<div class="flex h-32 items-end gap-2 md:h-56 lg:h-64">
		{#if weeklyIncome.length === 0}
			<div class="relative flex h-32 w-full items-end gap-2 md:h-56 lg:h-64">
				{#each getLast7DaysLabelsWITA() as label (label)}
					<div class="flex flex-1 flex-col items-center">
						<div class="w-6 rounded-t bg-gray-100 md:w-8 lg:w-10" style="height: 8px;"></div>
						<div class="mt-1 text-xs text-gray-400 md:text-sm">{label}</div>
					</div>
				{/each}
				<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
					<span class="text-center text-base text-gray-400 md:text-lg"
						>Belum ada data grafik pendapatan</span
					>
				</div>
			</div>
		{:else}
			{#each weeklyIncome as income, i (i)}
				<div class="relative flex flex-1 flex-col items-center">
					<button
						type="button"
						class="w-6 cursor-pointer rounded-t bg-green-400 transition-all duration-700 md:w-8 lg:w-10"
						aria-label="{getLast7DaysLabelsWITA()[i]}: Rp {formatRupiah(income)}"
						style="height: {barsVisible && income > 0 && weeklyMax > 0
							? Math.max(Math.min((income / weeklyMax) * 96, 96), 4)
							: 0}px"
						onpointerdown={() => handleBarPointerDown(i)}
						onpointerup={handleBarPointerUp}
						onpointerleave={handleBarPointerUp}
						onfocus={() => showBarValue(i)}
						onblur={handleBarPointerUp}
						ontouchstart={() => handleBarPointerDown(i)}
						ontouchend={handleBarPointerUp}
						ontouchcancel={handleBarPointerUp}
					></button>
					<div class="mt-1 text-xs md:text-sm">{getLast7DaysLabelsWITA()[i]}</div>
					{#if showBarInsight && selectedBarIndex === i}
						<div
							class="animate-fade-in pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl border border-pink-200 bg-white px-4 py-2 text-center text-sm font-bold text-pink-600 shadow-lg"
						>
							<span class="font-normal text-gray-700">Rp {formatRupiah(income)}</span>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
