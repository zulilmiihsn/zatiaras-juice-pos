<script lang="ts">
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
		class="z-dialog fixed inset-0 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
	>
		<div class="mx-auto w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
			<div class="mb-5 flex items-center justify-between">
				<h3 class="text-base font-bold text-slate-900">Filter Laporan</h3>
				<button
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200"
					onclick={() => (showFilter = false)}
					aria-label="Tutup filter"
				>
					<svg
						class="h-5 w-5 text-gray-500"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<!-- Pilihan Tipe Filter -->
			<div class="mb-6">
				<label class="mb-3 block text-sm font-medium text-gray-700" for="filter-type-buttons"
					>Pilih Periode</label
				>
				<div
					class="grid grid-cols-2 gap-3"
					id="filter-type-buttons"
					role="group"
					aria-labelledby="filter-type-buttons"
				>
					<button
						class="rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 {filterType ===
						'harian'
							? 'border-pink-500 bg-pink-50 text-pink-600'
							: 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'}"
						onclick={() => (filterType = 'harian')}
						onkeydown={(e) => e.key === 'Enter' && (filterType = 'harian')}
					>
						Harian
					</button>
					<button
						class="rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 {filterType ===
						'mingguan'
							? 'border-pink-500 bg-pink-50 text-pink-600'
							: 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'}"
						onclick={() => (filterType = 'mingguan')}
						onkeydown={(e) => e.key === 'Enter' && (filterType = 'mingguan')}
					>
						Mingguan
					</button>
					<button
						class="rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 {filterType ===
						'bulanan'
							? 'border-pink-500 bg-pink-50 text-pink-600'
							: 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'}"
						onclick={() => (filterType = 'bulanan')}
						onkeydown={(e) => e.key === 'Enter' && (filterType = 'bulanan')}
					>
						Bulanan
					</button>
					<button
						class="rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-all duration-200 {filterType ===
						'tahunan'
							? 'border-pink-500 bg-pink-50 text-pink-600'
							: 'border-gray-200 bg-white text-gray-600 hover:border-pink-200'}"
						onclick={() => {
							filterType = 'tahunan';
						}}
						onkeydown={(e) => e.key === 'Enter' && (filterType = 'tahunan')}
					>
						Tahunan
					</button>
				</div>
			</div>
			<!-- Input Filter Berdasarkan Tipe -->
			{#if filterType === 'harian'}
				<div class="mb-6 space-y-3">
					<div>
						<label
							class="mb-1.5 block text-xs font-bold tracking-wider text-slate-600 uppercase"
							for="harian-start-date">Tanggal Awal</label
						>
						<input
							id="harian-start-date"
							type="date"
							class="w-full rounded-xl border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors focus:border-pink-500 focus:outline-none"
							bind:value={startDate}
						/>
					</div>
					<div>
						<label
							class="mb-1.5 block text-xs font-bold tracking-wider text-slate-600 uppercase"
							for="harian-end-date">Tanggal Akhir</label
						>
						<input
							id="harian-end-date"
							type="date"
							class="w-full rounded-xl border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors focus:border-pink-500 focus:outline-none"
							bind:value={endDate}
						/>
					</div>
				</div>
			{:else if filterType === 'mingguan'}
				<div class="mb-6">
					<label class="mb-2 block text-sm font-medium text-gray-700" for="mingguan-date"
						>Pilih Tanggal Awal Minggu</label
					>
					<input
						id="mingguan-date"
						type="date"
						class="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
						bind:value={startDate}
					/>
				</div>
			{:else if filterType === 'bulanan'}
				<div class="mb-6">
					<label class="mb-2 block text-sm font-medium text-gray-700" for="bulanan-month"
						>Pilih Bulan dan Tahun</label
					>
					<div class="flex gap-3">
						<select
							id="bulanan-month"
							class="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
							bind:value={filterMonth}
						>
							{#each Array(12) as _, i}
								<option value={(i + 1).toString().padStart(2, '0')}>
									{new Date(2024, i).toLocaleDateString('id-ID', { month: 'long' })}
								</option>
							{/each}
						</select>
						<select
							class="flex-1 rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
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
					<label class="mb-2 block text-sm font-medium text-gray-700" for="tahunan-year"
						>Pilih Tahun</label
					>
					<select
						id="tahunan-year"
						class="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
						bind:value={filterYear}
					>
						{#each Array(6) as _, i}
							<option value={(2020 + i).toString()}>{2020 + i}</option>
						{/each}
					</select>
				</div>
			{/if}
			<!-- Button Actions -->
			<div class="flex gap-3">
				<button
					class="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-600 transition-colors hover:bg-gray-200"
					onclick={() => (showFilter = false)}
				>
					Batal
				</button>
				<button
					class="flex-1 rounded-xl bg-pink-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-pink-600 active:bg-pink-700"
					onclick={onapply}
				>
					Terapkan
				</button>
			</div>
		</div>
	</div>
{/if}
