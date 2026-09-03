<script lang="ts">
	import { onMount } from 'svelte';
	import { formatRupiah } from '$lib/utils/currency';
	type IconComponent = typeof import('@lucide/svelte/icons/wallet').default;

	let {
		itemTerjual = null as number | null,
		jumlahTransaksi = null as number | null,
		omzet = null as number | null,
		modalAwal = null as number | null,
		avgTransaksi = null as number | null,
		jamRamai = '' as string
	} = $props();

	// [CATATAN]: Lazy load icons
	let ShoppingBag = $state<IconComponent | null>(null);
	let TrendingUp = $state<IconComponent | null>(null);
	let Wallet = $state<IconComponent | null>(null);

	onMount(async () => {
		const icons = await Promise.all([
			import('@lucide/svelte/icons/shopping-bag'),
			import('@lucide/svelte/icons/trending-up'),
			import('@lucide/svelte/icons/wallet')
		]);
		ShoppingBag = icons[0].default;
		TrendingUp = icons[1].default;
		Wallet = icons[2].default;
	});
</script>

<!-- Metrik Utama (Authentic Glassmorphism & Soft Float) -->
<div class="relative z-20 grid grid-cols-2 gap-3.5 md:grid-cols-12 md:gap-4">
	<!-- Hero Pendapatan Hari Ini (Large Frosted Glassmorphic Card) -->
	<div
		class="glass-card relative col-span-2 flex flex-col justify-between overflow-hidden rounded-[32px] p-5.5 transition-all duration-200 active:scale-[0.99] md:col-span-6 md:p-6"
	>
		<!-- Internal ambient fluid reflection -->
		<div
			class="pointer-events-none absolute -right-6 -bottom-6 h-32 w-32 rounded-full bg-gradient-to-br from-pink-400/20 to-rose-400/20 blur-xl"
		></div>

		<div class="relative z-10 flex items-center justify-between">
			<div>
				<span class="text-[11px] font-bold tracking-wider text-pink-700 uppercase"
					>Pendapatan Hari Ini</span
				>
				<div
					class="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl md:text-3xl lg:text-4xl"
				>
					{omzet !== null ? `Rp ${formatRupiah(omzet)}` : '--'}
				</div>
			</div>
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-gradient-to-tr from-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25 md:h-13 md:w-13"
			>
				{#if Wallet}
					<Wallet class="h-6 w-6 stroke-[2.2]" />
				{:else}
					<span
						class="block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
					></span>
				{/if}
			</div>
		</div>

		<!-- Sub-info Pill Row inside Glass Card -->
		<div
			class="relative z-10 mt-3.5 flex items-center justify-between border-t border-slate-200/60 pt-3 text-xs md:mt-4 md:pt-3.5"
		>
			<div class="flex items-center gap-1.5 font-semibold text-slate-600">
				<span class="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></span>
				<span>Sesi Kios Aktif</span>
			</div>
			<div class="font-bold text-slate-800">
				Modal: <span class="text-pink-700"
					>{modalAwal !== null ? `Rp ${formatRupiah(modalAwal)}` : 'Rp 0'}</span
				>
			</div>
		</div>
	</div>

	<!-- Item Terjual -->
	<div
		class="soft-float-card col-span-1 flex flex-col justify-between p-4.5 transition-all duration-200 active:scale-[0.98] md:col-span-3 md:p-6"
	>
		<div class="flex items-center justify-between">
			<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Item Terjual</span
			>
			<div
				class="flex h-9 w-9 items-center justify-center rounded-[14px] border border-pink-100 bg-pink-50 text-pink-600 md:h-10 md:w-10"
			>
				{#if ShoppingBag}
					<ShoppingBag class="h-4.5 w-4.5 stroke-[2.2] md:h-5 md:w-5" />
				{:else}
					<span
						class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-300 border-t-pink-600"
					></span>
				{/if}
			</div>
		</div>
		<div
			class="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-3xl lg:text-4xl"
		>
			{itemTerjual ?? '--'}
		</div>
		<div
			class="mt-3.5 hidden items-center justify-between border-t border-slate-100 pt-3 text-xs md:mt-4 md:flex md:pt-3.5"
		>
			<span class="font-medium text-slate-400">Rata-rata</span>
			<span class="font-bold text-slate-700">{avgTransaksi ?? '--'} cup/nota</span>
		</div>
	</div>

	<!-- Transaksi -->
	<div
		class="soft-float-card col-span-1 flex flex-col justify-between p-4.5 transition-all duration-200 active:scale-[0.98] md:col-span-3 md:p-6"
	>
		<div class="flex items-center justify-between">
			<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Transaksi</span>
			<div
				class="flex h-9 w-9 items-center justify-center rounded-[14px] border border-rose-100 bg-rose-50 text-rose-600 md:h-10 md:w-10"
			>
				{#if TrendingUp}
					<TrendingUp class="h-4.5 w-4.5 stroke-[2.2] md:h-5 md:w-5" />
				{:else}
					<span
						class="block h-4 w-4 animate-spin rounded-full border-2 border-rose-300 border-t-rose-600"
					></span>
				{/if}
			</div>
		</div>
		<div
			class="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl md:text-3xl lg:text-4xl"
		>
			{jumlahTransaksi ?? '--'}
		</div>
		<div
			class="mt-3.5 hidden items-center justify-between border-t border-slate-100 pt-3 text-xs md:mt-4 md:flex md:pt-3.5"
		>
			<span class="font-medium text-slate-400">Rata-rata</span>
			<span class="font-bold text-slate-700"
				>{jumlahTransaksi && omzet
					? `Rp ${formatRupiah(Math.round(omzet / jumlahTransaksi))}`
					: '--'}</span
			>
		</div>
	</div>
</div>
