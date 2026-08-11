<script lang="ts">
	export let itemTerjual: number | string = '--';
	export let jumlahTransaksi: number | string = '--';
	export let omzet: number | null = null;
	export let modalAwal: number | null = null;

	export let ShoppingBagIcon: any = null;
	export let TrendingUpIcon: any = null;
	export let WalletIcon: any = null;
</script>

<div
	class="grid grid-cols-2 gap-3 md:grid-cols-2 md:grid-rows-2 md:gap-6 md:rounded-2xl md:border md:border-gray-100 md:bg-white md:p-6 md:shadow-lg"
>
	<div
		class="flex flex-col items-start rounded-xl bg-gradient-to-br from-sky-200 to-sky-400 p-4 shadow-md md:items-center md:justify-center md:gap-2 md:border md:border-sky-200 md:bg-transparent md:p-6 md:shadow-none lg:flex-col lg:items-center lg:justify-center"
	>
		{#if ShoppingBagIcon}
			<svelte:component
				this={ShoppingBagIcon}
				class="mb-2 h-6 w-6 text-sky-500 md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			/>
		{:else}
			<div
				class="mb-2 flex h-6 w-6 items-center justify-center md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			>
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="mb-1 text-xs font-medium text-gray-500 md:mb-0 md:text-center md:text-base">
			Item Terjual
		</div>
		<div class="text-xl font-bold text-sky-600 md:text-center md:text-3xl">
			{itemTerjual ?? '--'}
		</div>
	</div>
	<div
		class="flex flex-col items-start rounded-xl bg-gradient-to-br from-purple-200 to-purple-400 p-4 shadow-md md:items-center md:justify-center md:gap-2 md:border md:border-purple-200 md:bg-transparent md:p-6 md:shadow-none lg:flex-col lg:items-center lg:justify-center"
	>
		{#if TrendingUpIcon}
			<svelte:component
				this={TrendingUpIcon}
				class="mb-2 h-6 w-6 text-purple-500 md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			/>
		{:else}
			<div
				class="mb-2 flex h-6 w-6 items-center justify-center md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			>
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="mb-1 text-xs font-medium text-gray-500 md:mb-0 md:text-center md:text-base">
			Jumlah Transaksi
		</div>
		<div class="text-xl font-bold text-purple-600 md:text-center md:text-3xl">
			{jumlahTransaksi ?? '--'}
		</div>
	</div>
	<div
		class="flex hidden flex-col items-start rounded-xl bg-gradient-to-br from-green-200 to-green-400 p-4 shadow-md md:block md:items-center md:justify-center md:gap-2 md:border md:border-green-200 md:bg-transparent md:p-6 md:shadow-none lg:flex-col lg:items-center lg:justify-center"
	>
		{#if WalletIcon}
			<svelte:component
				this={WalletIcon}
				class="mb-2 h-6 w-6 text-green-900 md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			/>
		{:else}
			<div
				class="mb-2 flex h-6 w-6 items-center justify-center md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			>
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="text-sm font-medium text-green-900/80 md:text-center md:text-base">
			Pendapatan
		</div>
		<div class="text-xl font-bold text-green-900 md:text-center md:text-3xl">
			{omzet !== null ? `Rp ${omzet.toLocaleString('id-ID')}` : '--'}
		</div>
	</div>
	<div
		class="flex hidden flex-col items-start rounded-xl bg-gradient-to-br from-cyan-100 to-pink-200 p-4 shadow-md md:block md:items-center md:justify-center md:gap-2 md:border md:border-cyan-200 md:bg-transparent md:p-6 md:shadow-none lg:flex-col lg:items-center lg:justify-center"
	>
		{#if WalletIcon}
			<svelte:component
				this={WalletIcon}
				class="mb-2 h-6 w-6 text-cyan-900 md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			/>
		{:else}
			<div
				class="mb-2 flex h-6 w-6 items-center justify-center md:h-10 md:w-10 lg:mx-auto lg:mb-2"
			>
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="text-sm font-medium text-cyan-900/80 md:text-center md:text-base">
			Modal Awal
		</div>
		<div class="text-xl font-bold text-cyan-900 md:text-center md:text-3xl">
			{modalAwal !== null ? `Rp ${modalAwal.toLocaleString('id-ID')}` : 'Rp 0'}
		</div>
	</div>
</div>

<!-- Mobile income & initial capital box -->
<div class="flex flex-col gap-3 md:hidden">
	<div
		class="flex flex-col items-start rounded-xl bg-gradient-to-br from-green-200 to-green-400 p-4 shadow-md"
	>
		{#if WalletIcon}
			<svelte:component this={WalletIcon} class="mb-2 h-6 w-6 text-green-900" />
		{:else}
			<div class="mb-2 flex h-6 w-6 items-center justify-center">
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="text-sm font-medium text-green-900/80">Pendapatan</div>
		<div class="text-xl font-bold text-green-900">
			{omzet !== null ? `Rp ${omzet.toLocaleString('id-ID')}` : '--'}
		</div>
	</div>
	<div
		class="flex flex-col items-start rounded-xl bg-gradient-to-br from-cyan-100 to-pink-200 p-4 shadow-md"
	>
		{#if WalletIcon}
			<svelte:component this={WalletIcon} class="mb-2 h-6 w-6 text-cyan-900" />
		{:else}
			<div class="mb-2 flex h-6 w-6 items-center justify-center">
				<span
					class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
				></span>
			</div>
		{/if}
		<div class="text-sm font-medium text-cyan-900/80">Modal Awal</div>
		<div class="text-xl font-bold text-cyan-900">
			{modalAwal !== null ? `Rp ${modalAwal.toLocaleString('id-ID')}` : 'Rp 0'}
		</div>
	</div>
</div>
