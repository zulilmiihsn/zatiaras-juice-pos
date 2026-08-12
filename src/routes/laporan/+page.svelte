<script lang="ts">
	import { createSwipeNavigation } from '$lib/utils/touchNavigation';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import LaporanFilter from '$lib/components/laporan/LaporanFilter.svelte';
	import LaporanSummaryCards from '$lib/components/laporan/LaporanSummaryCards.svelte';
	import LaporanLabaRugiCard from '$lib/components/laporan/LaporanLabaRugiCard.svelte';
	import LaporanAccordions from '$lib/components/laporan/LaporanAccordions.svelte';
	import LaporanAISection from '$lib/components/laporan/LaporanAISection.svelte';
	import { createLaporanState } from '$lib/stores/laporanState.svelte';

	const swipeNav = createSwipeNavigation(3);
	const s = createLaporanState();
</script>

<!-- Toast Notification -->
{#if s.toastManager.showToast}
	<ToastNotification
		show={s.toastManager.showToast}
		message={s.toastManager.toastMessage}
		type={s.toastManager.toastType}
		position="top"
	/>
{/if}

<!-- Page swipe is optional; visible navigation remains the primary control. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-white"
	ontouchstart={swipeNav.handleTouchStart}
	ontouchmove={swipeNav.handleTouchMove}
	ontouchend={swipeNav.handleTouchEnd}
	onclick={swipeNav.handleGlobalClick}
>
	<main
		aria-label="Halaman laporan keuangan"
		class="page-content min-h-0 w-full max-w-full flex-1 overflow-x-hidden"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div
			class="mx-auto w-full max-w-md px-2 pt-4 pb-8 transition-all duration-300 md:max-w-3xl md:px-8 md:pt-8 lg:max-w-none lg:px-6 lg:pt-10"
		>
			<div class="mb-3 flex w-full items-center gap-2 px-2 md:mb-6 md:gap-4 md:px-0">
				<!-- Button Filter -->
				<div class="flex-none">
					<button
						class="flex h-12 w-12 items-center justify-center rounded-xl bg-pink-500 p-0 font-bold text-white shadow-sm transition-colors hover:bg-pink-600 active:bg-pink-700 md:h-14 md:w-14 md:text-xl"
						onclick={() => (s.showFilter = true)}
						aria-label="Filter laporan"
					>
						{#if s.FilterIcon}
							<s.FilterIcon class="h-5 w-5 md:h-7 md:w-7" />
						{:else}
							<div class="flex h-5 w-5 items-center justify-center md:h-7 md:w-7">
								<span
									class="block h-4 w-4 animate-spin rounded-full border-2 border-pink-200 border-t-pink-500"
								></span>
							</div>
						{/if}
					</button>
				</div>
				<!-- Button Filter Tanggal -->
				<button
					class="h-12 min-w-[140px] flex-1 rounded-xl md:h-14 {s.startDate
						? 'border-pink-100 bg-white text-pink-500'
						: 'border-pink-200 bg-pink-50 text-pink-400'} flex items-center justify-center gap-2 border px-4 font-semibold shadow-sm transition-colors hover:bg-pink-50 active:bg-pink-100 md:px-6 md:text-lg"
					onclick={s.openDatePicker}
				>
					<svg
						class="h-5 w-5 md:h-7 md:w-7 {s.startDate
							? 'text-pink-300'
							: 'text-pink-200'} flex-shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/></svg
					>
					<span class="truncate">{s.formatDate(s.startDate)}</span>
				</button>
				<button
					class="h-12 min-w-[140px] flex-1 rounded-xl md:h-14 {s.endDate
						? 'border-pink-100 bg-white text-pink-500'
						: 'border-pink-100 bg-pink-50 text-pink-200'} flex items-center justify-center gap-2 border px-4 font-semibold shadow-sm transition-colors hover:bg-pink-50 active:bg-pink-100 md:px-6 md:text-lg"
					onclick={s.openEndDatePicker}
				>
					<svg
						class="h-5 w-5 md:h-7 md:w-7 {s.endDate
							? 'text-pink-300'
							: 'text-pink-200'} flex-shrink-0"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						><path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
						/></svg
					>
					<span class="truncate select-none">{s.endDate ? s.formatDate(s.endDate, true) : '-'}</span
					>
				</button>
			</div>

			<LaporanSummaryCards
				isLoadingReport={s.isLoadingReport}
				summary={s.summary}
				totalQrisAll={s.reportGroups.totalQrisAll}
				totalTunaiAll={s.reportGroups.totalTunaiAll}
			/>

			<div class="mt-4 flex flex-col gap-2 px-2 md:mt-8 md:gap-8 md:px-0 lg:flex-row lg:gap-6">
				<LaporanAccordions
					isLoadingReport={s.isLoadingReport}
					totalQrisPemasukan={s.reportGroups.totalQrisPemasukan}
					totalTunaiPemasukan={s.reportGroups.totalTunaiPemasukan}
					totalQrisPengeluaran={s.reportGroups.totalQrisPengeluaran}
					totalTunaiPengeluaran={s.reportGroups.totalTunaiPengeluaran}
					pemasukanUsahaQris={s.reportGroups.pemasukanUsahaQris}
					pemasukanUsahaTunai={s.reportGroups.pemasukanUsahaTunai}
					pemasukanLainQris={s.reportGroups.pemasukanLainQris}
					pemasukanLainTunai={s.reportGroups.pemasukanLainTunai}
					bebanUsahaQris={s.reportGroups.bebanUsahaQris}
					bebanUsahaTunai={s.reportGroups.bebanUsahaTunai}
					bebanLainQris={s.reportGroups.bebanLainQris}
					bebanLainTunai={s.reportGroups.bebanLainTunai}
				/>
				<LaporanLabaRugiCard isLoadingReport={s.isLoadingReport} summary={s.summary} />
			</div>
			<LaporanAISection />

			<LaporanFilter
				bind:showFilter={s.showFilter}
				bind:filterType={s.filterType}
				bind:startDate={s.startDate}
				bind:filterMonth={s.filterMonth}
				bind:filterYear={s.filterYear}
				onapply={s.applyFilter}
			/>

			<!-- Modal Date Picker Start -->
			{#if s.showDatePicker}
				<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
					<div
						class="mx-auto w-full max-w-md rounded-t-2xl bg-white p-6 pb-8 shadow-lg"
						style="animation: slideUp 0.3s ease-out;"
					>
						<div class="mb-6 flex items-center justify-between">
							<h3 class="text-lg font-bold text-gray-800">Pilih Tanggal Awal</h3>
							<button
								class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
								onclick={() => (s.showDatePicker = false)}
								aria-label="Tutup date picker"
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
						<div class="mb-6">
							<label class="mb-2 block text-sm font-medium text-gray-700" for="date-picker-start"
								>Tanggal Awal</label
							>
							<input
								id="date-picker-start"
								type="date"
								class="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
								bind:value={s.startDate}
							/>
						</div>
						<div class="flex gap-3">
							<button
								class="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-600 transition-colors hover:bg-gray-200"
								onclick={() => (s.showDatePicker = false)}
							>
								Batal
							</button>
							<button
								class="flex-1 rounded-xl bg-pink-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-pink-600 active:bg-pink-700"
								onclick={() => {
									s.showDatePicker = false;
									s.applyFilter();
								}}
							>
								Pilih
							</button>
						</div>
					</div>
				</div>
			{/if}

			<!-- Modal Date Picker End -->
			{#if s.showEndDatePicker}
				<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/30">
					<div
						class="mx-auto w-full max-w-md rounded-t-2xl bg-white p-6 pb-8 shadow-lg"
						style="animation: slideUp 0.3s ease-out;"
					>
						<div class="mb-6 flex items-center justify-between">
							<h3 class="text-lg font-bold text-gray-800">Pilih Tanggal Akhir</h3>
							<button
								class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
								onclick={() => (s.showEndDatePicker = false)}
								aria-label="Tutup end date picker"
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
						<div class="mb-6">
							<label class="mb-2 block text-sm font-medium text-gray-700" for="date-picker-end"
								>Tanggal Akhir</label
							>
							<input
								id="date-picker-end"
								type="date"
								class="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-base transition-colors focus:border-pink-500 focus:outline-none"
								bind:value={s.endDate}
							/>
						</div>
						<div class="flex gap-3">
							<button
								class="flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-600 transition-colors hover:bg-gray-200"
								onclick={() => (s.showEndDatePicker = false)}
							>
								Batal
							</button>
							<button
								class="flex-1 rounded-xl bg-pink-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-pink-600 active:bg-pink-700"
								onclick={() => {
									s.showEndDatePicker = false;
									s.applyFilter();
								}}
							>
								Pilih
							</button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</main>
</div>
