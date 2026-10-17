<!-- Statistik operasional hari ini: omzet, transaksi, jam ramai, metode bayar. -->
<script lang="ts">
	import ClockIcon from '@lucide/svelte/icons/clock';
	import Coffee from '@lucide/svelte/icons/coffee';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Receipt from '@lucide/svelte/icons/receipt';
	import { formatRupiah } from '$lib/utils/currency';
	import type { createDashboardState } from '$lib/stores/dashboardState.svelte';

	type Dashboard = ReturnType<typeof createDashboardState>;

	let {
		dashboard,
		sesiKasSummary
	}: {
		dashboard: Dashboard;
		sesiKasSummary: {
			modalAwal: number;
			totalPenjualan: number;
			pemasukanTunai: number;
			pemasukanNonTunai: number;
			pengeluaranTunai: number;
			uangKasir: number;
		};
	} = $props();

	const payTunai = $derived(sesiKasSummary.pemasukanTunai || dashboard.penjualanTunai || 0);
	const payNonTunai = $derived(
		sesiKasSummary.pemasukanNonTunai || dashboard.penjualanNonTunai || 0
	);
	const totalPay = $derived(payTunai + payNonTunai);
</script>

<!-- Statistik Operasional (2x2 Grid) -->
<div>
	<div class="mb-2.5 px-1">
		<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">Metrik Kios</div>
		<div class="text-sm font-bold text-slate-900 sm:text-base">Statistik Operasional</div>
	</div>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-2">
		<!-- Card 1: Rata-rata per Transaksi -->
		<div
			class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
					Rata-Rata Nota
				</span>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-xl border border-pink-100/80 bg-pink-50 text-pink-600 shadow-2xs"
				>
					<Receipt size={16} class="stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2.5">
				<div class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl">
					{dashboard.jumlahTransaksi && dashboard.omzet
						? `Rp ${formatRupiah(Math.round(dashboard.omzet / dashboard.jumlahTransaksi))}`
						: 'Rp 0'}
				</div>
				<div class="mt-0.5 text-[11px] font-medium text-slate-400">per transaksi</div>
			</div>
		</div>

		<!-- Card 2: Volume Cup per Nota -->
		<div
			class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
					Volume Cup
				</span>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-xl border border-rose-100/80 bg-rose-50 text-rose-600 shadow-2xs"
				>
					<Coffee size={16} class="stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2.5">
				<div class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl">
					{dashboard.avgTransaksi ?? '--'}
					<span class="text-xs font-bold text-slate-400">cup</span>
				</div>
				<div class="mt-0.5 text-[11px] font-medium text-slate-400">rata-rata per nota</div>
			</div>
		</div>

		<!-- Card 3: Jam Paling Ramai -->
		<div
			class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
					Jam Ramai
				</span>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-100/80 bg-amber-50 text-amber-600 shadow-2xs"
				>
					<ClockIcon size={16} class="stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2.5">
				<div class="text-lg font-black tracking-tight text-slate-900 sm:text-xl md:text-2xl">
					{dashboard.jamRamai || '--'}
				</div>
				<div class="mt-0.5 text-[11px] font-medium text-slate-400">waktu terpadat</div>
			</div>
		</div>

		<!-- Card 4: Rasio Pembayaran (QRIS vs Tunai) -->
		<div
			class="soft-float-card flex flex-col justify-between p-3.5 transition-all duration-200 hover:shadow-md active:scale-[0.99] sm:p-4.5"
		>
			<div class="flex items-center justify-between">
				<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
					Metode Bayar
				</span>
				<div
					class="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-100/80 bg-emerald-50 text-emerald-600 shadow-2xs"
				>
					<CreditCard size={16} class="stroke-[2.2]" />
				</div>
			</div>
			<div class="mt-2.5">
				{#if totalPay > 0}
					{@const pctNonTunai = Math.round((payNonTunai / totalPay) * 100)}
					{@const pctTunai = 100 - pctNonTunai}
					<!-- Segmented Visual Bar -->
					<div
						class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/50"
					>
						{#if pctNonTunai > 0}
							<div
								class="h-full rounded-l-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
								style="width: {pctNonTunai}%"
								title="QRIS {pctNonTunai}%"
							></div>
						{/if}
						{#if pctTunai > 0}
							<div
								class="h-full {pctNonTunai > 0
									? 'rounded-r-full'
									: 'rounded-full'} bg-gradient-to-r from-pink-500 to-rose-500 transition-all duration-500"
								style="width: {pctTunai}%"
								title="Tunai {pctTunai}%"
							></div>
						{/if}
					</div>
					<div class="mt-1.5 flex items-center justify-between text-[11px] font-black">
						<span class="flex items-center gap-1 text-emerald-700">
							<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
							QRIS {pctNonTunai}%
						</span>
						<span class="flex items-center gap-1 text-pink-600">
							<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
							Tunai {pctTunai}%
						</span>
					</div>
				{:else}
					<div class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 p-0.5">
						<div class="h-full w-1/2 rounded-l-full bg-slate-200/60"></div>
						<div class="h-full w-1/2 rounded-r-full bg-slate-200/40"></div>
					</div>
					<div
						class="mt-1.5 flex items-center justify-between text-[11px] font-bold text-slate-400"
					>
						<span>QRIS 0%</span>
						<span>Tunai 0%</span>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>
