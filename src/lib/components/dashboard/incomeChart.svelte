<script lang="ts">
	export let avgTransaksi: number | string = '--';
	export let jamRamai = '';
	export let weeklyIncome: number[] = [];
	export let weeklyMax = 1;
	export let barsVisible = false;

	export let getLast7DaysLabelsWITA: () => string[];

	let selectedBarIndex: number | null = null;
	let showBarInsight = false;
	let barHoldTimeout: ReturnType<typeof setTimeout> | null = null;

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
</script>

<div class="mt-6 md:mt-12">
	<div
		class="mt-2 mb-2 text-base font-medium text-pink-500 md:mt-0 md:mb-6 md:text-2xl md:text-lg md:font-bold md:tracking-tight"
	>
		Statistik
	</div>
	<div class="grid grid-cols-2 gap-3 md:mb-6 md:grid-cols-2 md:gap-6">
		<div
			class="flex flex-col items-center rounded-xl bg-white p-3 shadow md:rounded-2xl md:border md:border-pink-100 md:p-6 md:shadow-none"
		>
			<div class="text-xl font-bold text-pink-400 md:text-2xl lg:text-3xl">
				{avgTransaksi ?? '--'}
			</div>
			<div class="mt-1 text-xs text-gray-500 md:text-sm">Rata-rata transaksi</div>
		</div>
		<div
			class="flex flex-col items-center rounded-xl bg-white p-3 shadow md:rounded-2xl md:border md:border-pink-100 md:p-6 md:shadow-none"
		>
			<div class="text-xl font-bold text-pink-400 md:text-2xl lg:text-3xl">
				{#if jamRamai}
					{jamRamai}
				{:else}
					00.00
				{/if}
			</div>
			<div class="mt-1 text-xs text-gray-500 md:text-sm">Jam paling ramai</div>
		</div>
	</div>

	<!-- Grafik Pendapatan 7 Hari -->
	<div class="mt-3 md:mt-0">
		<div
			class="flex flex-col rounded-xl bg-white p-4 shadow md:rounded-2xl md:border md:border-pink-100 md:p-8 md:shadow-none"
		>
			<div class="mt-1 mb-2 text-xs text-gray-500 md:text-sm">
				Pendapatan 7 Hari Terakhir
			</div>
			<div class="flex h-32 items-end gap-2 md:h-56 lg:h-64">
				{#if weeklyIncome.length === 0}
					<div class="relative flex h-32 w-full items-end gap-2 md:h-56 lg:h-64">
						{#each getLast7DaysLabelsWITA() as label, i}
							<div class="flex flex-1 flex-col items-center">
								<div
									class="w-6 rounded-t bg-gray-100 md:w-8 lg:w-10"
									style="height: 8px;"
								></div>
								<div class="mt-1 text-xs text-gray-400 md:text-sm">{label}</div>
							</div>
						{/each}
						<div
							class="pointer-events-none absolute inset-0 flex items-center justify-center"
						>
							<span class="text-center text-base text-gray-400 md:text-lg"
								>Belum ada data grafik pendapatan</span
							>
						</div>
					</div>
				{:else}
					{#each weeklyIncome as income, i}
						<div class="relative flex flex-1 flex-col items-center">
							<div
								class="w-6 cursor-pointer rounded-t bg-green-400 transition-all duration-700 md:w-8 lg:w-10"
								style="height: {barsVisible && income > 0 && weeklyMax > 0
									? Math.max(Math.min((income / weeklyMax) * 96, 96), 4)
									: 0}px"
								onpointerdown={() => handleBarPointerDown(i)}
								onpointerup={handleBarPointerUp}
								onpointerleave={handleBarPointerUp}
								ontouchstart={() => handleBarPointerDown(i)}
								ontouchend={handleBarPointerUp}
								ontouchcancel={handleBarPointerUp}
							></div>
							<div class="mt-1 text-xs md:text-sm">{getLast7DaysLabelsWITA()[i]}</div>
							{#if showBarInsight && selectedBarIndex === i}
								<div
									class="animate-fade-in pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 rounded-xl border border-pink-200 bg-white px-4 py-2 text-center text-sm font-bold text-pink-600 shadow-lg"
								>
									<span class="font-normal text-gray-700"
										>Rp {income.toLocaleString('id-ID')}</span
									>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>
