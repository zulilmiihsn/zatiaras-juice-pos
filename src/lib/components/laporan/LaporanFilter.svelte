<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import X from '@lucide/svelte/icons/x';
	import Calendar from '@lucide/svelte/icons/calendar';

	let {
		showFilter = $bindable(false),
		filterType = $bindable('harian'),
		startDate = $bindable(''),
		endDate = $bindable(''),
		filterMonth = $bindable(''),
		filterYear = $bindable(''),
		onapply
	}: {
		showFilter: boolean;
		filterType: 'harian' | 'mingguan' | 'bulanan' | 'tahunan';
		startDate: string;
		endDate: string;
		filterMonth: string;
		filterYear: string;
		onapply: () => void;
	} = $props();
</script>

{#if showFilter}
	<div
		class="z-dialog fixed inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && (showFilter = false)}
		onkeydown={(e) => e.key === 'Escape' && (showFilter = false)}
		transition:fade={{ duration: 180 }}
	>
		<div
			class="relative mx-auto w-full max-w-sm rounded-[32px] border border-pink-100/80 bg-white p-6 shadow-2xl shadow-pink-900/10"
			transition:scale={{ duration: 200, start: 0.95, easing: cubicOut }}
		>
			<!-- Header Modal Bertema Zatiaras -->
			<div class="mb-5 flex items-center justify-between border-b border-pink-100/70 pb-3.5">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-200/80 bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] text-white shadow-sm shadow-pink-500/20"
					>
						<SlidersHorizontal class="h-4.5 w-4.5 stroke-[2.2]" />
					</div>
					<div>
						<h3 class="text-base font-black tracking-tight text-slate-900">Filter Laporan</h3>
						<p class="text-[11px] font-semibold text-slate-400">Sesuaikan periode data</p>
					</div>
				</div>
				<button
					type="button"
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-pink-50 text-pink-500 transition-colors hover:bg-pink-100 hover:text-pink-700 active:scale-95"
					onclick={() => (showFilter = false)}
					aria-label="Tutup filter"
				>
					<X class="h-4 w-4 stroke-[2.4]" />
				</button>
			</div>

			<!-- Pilihan Tipe Filter -->
			<div class="mb-5">
				<div
					class="mb-2.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					id="filter-type-label"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
					Pilih Periode
				</div>
				<div
					class="grid grid-cols-2 gap-2.5"
					id="filter-type-buttons"
					role="group"
					aria-labelledby="filter-type-label"
				>
					{#each [{ id: 'harian', label: 'Harian' }, { id: 'mingguan', label: 'Mingguan' }, { id: 'bulanan', label: 'Bulanan' }, { id: 'tahunan', label: 'Tahunan' }] as p}
						<button
							class="cursor-pointer rounded-full px-4 py-2.5 text-xs font-extrabold transition-all duration-200 active:scale-95 {filterType ===
							p.id
								? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-md ring-2 shadow-pink-500/25 ring-pink-500/20'
								: 'border border-slate-200/90 bg-white text-slate-700 shadow-2xs hover:border-pink-200 hover:text-pink-600'}"
							onclick={() => (filterType = p.id as typeof filterType)}
							onkeydown={(e) => e.key === 'Enter' && (filterType = p.id as typeof filterType)}
						>
							{p.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Input Filter Berdasarkan Tipe -->
			{#if filterType === 'harian'}
				<div class="mb-6 space-y-3">
					<div>
						<label
							class="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
							for="harian-start-date"
						>
							<Calendar class="h-3.5 w-3.5 text-pink-600" />
							Tanggal Awal
						</label>
						<input
							id="harian-start-date"
							type="date"
							class="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
							bind:value={startDate}
						/>
					</div>
					<div>
						<label
							class="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
							for="harian-end-date"
						>
							<Calendar class="h-3.5 w-3.5 text-pink-600" />
							Tanggal Akhir
						</label>
						<input
							id="harian-end-date"
							type="date"
							class="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
							bind:value={endDate}
						/>
					</div>
				</div>
			{:else if filterType === 'mingguan'}
				<div class="mb-6">
					<label
						class="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
						for="mingguan-date"
					>
						<Calendar class="h-3.5 w-3.5 text-pink-600" />
						Tanggal Awal Minggu
					</label>
					<input
						id="mingguan-date"
						type="date"
						class="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
						bind:value={startDate}
					/>
				</div>
			{:else if filterType === 'bulanan'}
				<div class="mb-6">
					<div
						class="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					>
						<Calendar class="h-3.5 w-3.5 text-pink-600" />
						Bulan & Tahun
					</div>
					<div class="flex gap-2.5">
						<select
							id="bulanan-month"
							aria-label="Pilih Bulan"
							class="flex-1 rounded-2xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
							bind:value={filterMonth}
						>
							{#each Array(12) as _, i}
								<option value={(i + 1).toString().padStart(2, '0')}>
									{new Date(2024, i).toLocaleDateString('id-ID', { month: 'long' })}
								</option>
							{/each}
						</select>
						<select
							aria-label="Pilih Tahun"
							class="flex-1 rounded-2xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
							bind:value={filterYear}
						>
							{#each Array(6) as _, i}
								<option value={(2020 + i).toString()}>{2020 + i}</option>
							{/each}
						</select>
					</div>
				</div>
			{:else if filterType === 'tahunan'}
				<div class="mb-6">
					<label
						class="mb-1.5 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
						for="tahunan-year"
					>
						<Calendar class="h-3.5 w-3.5 text-pink-600" />
						Pilih Tahun
					</label>
					<select
						id="tahunan-year"
						class="w-full rounded-2xl border border-slate-200/90 bg-slate-50/70 px-4 py-2.5 text-sm font-bold text-slate-900 shadow-xs transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
						bind:value={filterYear}
					>
						{#each Array(6) as _, i}
							<option value={(2020 + i).toString()}>{2020 + i}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Button Actions -->
			<div class="flex gap-2.5">
				<button
					class="flex-1 cursor-pointer rounded-full border border-slate-200/90 bg-white py-3 text-xs font-extrabold text-slate-600 shadow-2xs transition-all duration-200 hover:bg-slate-50 active:scale-[0.98] sm:text-sm"
					onclick={() => (showFilter = false)}
				>
					Batal
				</button>
				<button
					class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3 text-xs font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98] sm:text-sm"
					onclick={onapply}
				>
					Terapkan
				</button>
			</div>
		</div>
	</div>
{/if}
