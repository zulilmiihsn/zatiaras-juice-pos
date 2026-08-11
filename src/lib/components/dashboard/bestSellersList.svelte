<script lang="ts">
	export let isLoadingBestSellers = true;
	export let errorBestSellers = '';
	export let bestSellers: { name: string; image?: string; total_qty: number }[] = [];

	let imageError: Record<number, boolean> = {};

	function handleImgError(index: number) {
		imageError[index] = true;
	}
</script>

<div class="mt-6 md:mt-12">
	<div
		class="mt-2 mb-2 text-base font-medium text-pink-500 md:mt-0 md:mb-6 md:text-2xl md:text-lg md:font-bold md:tracking-tight"
	>
		Menu Terlaris
	</div>
	{#if isLoadingBestSellers}
		<div class="flex flex-col gap-3 md:gap-4 md:space-y-0 md:divide-y md:divide-pink-100">
			{#each Array(3) as _, i}
				<div
					class="relative flex animate-pulse items-center gap-3 rounded-xl bg-gray-100 p-3 shadow-md md:min-h-[88px] md:items-center md:gap-6 md:rounded-2xl md:bg-white md:p-6 md:shadow-none"
				>
					<div class="h-12 w-12 rounded-lg bg-gray-200 md:h-16 md:w-16"></div>
					<div class="min-w-0 flex-1">
						<div class="mb-2 h-4 w-24 rounded bg-gray-200 md:mb-3 md:w-32"></div>
						<div class="h-3 w-16 rounded bg-gray-200 md:w-24"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if errorBestSellers}
		<div class="py-6 text-center text-base text-red-400 md:text-lg">{errorBestSellers}</div>
	{:else if bestSellers.length === 0}
		<div class="py-6 text-center text-base text-gray-400 md:text-lg">
			Belum ada data menu terlaris
		</div>
	{:else}
		<div class="flex flex-col gap-3 md:gap-4 md:space-y-0 md:divide-y md:divide-pink-100">
			{#each bestSellers.slice(0, 3) as m, i}
				<div
					class="relative flex items-center gap-3 rounded-xl bg-white p-3 shadow-md md:min-h-[88px] md:items-center md:gap-6 md:rounded-2xl md:border md:border-pink-200 md:bg-white md:p-6 md:shadow-none {i ===
					0
						? 'border-2 border-yellow-400 md:border-2 md:border-pink-200 md:border-yellow-400'
						: ''}"
				>
					{#if i === 0}
						<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
							>👑</span
						>
					{:else if i === 1}
						<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
							>🥈</span
						>
					{:else if i === 2}
						<span class="absolute -top-4 -left-3 text-2xl md:static md:mr-4 md:text-3xl"
							>🥉</span
						>
					{/if}
					{#if m.image && !imageError[i]}
						<img
							src={m.image}
							alt={m.name}
							class="h-12 w-12 rounded-lg object-cover md:h-16 md:w-16"
							onerror={() => handleImgError(i)}
						/>
					{:else}
						<div
							class="flex h-12 w-12 items-center justify-center rounded-lg bg-pink-100 text-pink-400 md:h-16 md:w-16"
						>
							🍹
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="truncate text-base font-semibold text-gray-800 md:text-lg">{m.name}</div>
						<div class="text-xs text-gray-500 md:text-sm">{m.total_qty} Terjual Hari ini</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
