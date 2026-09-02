<script lang="ts">
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import LaporanFilter from '$lib/components/laporan/LaporanFilter.svelte';
	import LaporanSummaryCards from '$lib/components/laporan/LaporanSummaryCards.svelte';
	import LaporanLabaRugiCard from '$lib/components/laporan/LaporanLabaRugiCard.svelte';
	import LaporanAccordions from '$lib/components/laporan/LaporanAccordions.svelte';
	import LaporanAISection from '$lib/components/laporan/LaporanAISection.svelte';
	import { createLaporanState } from '$lib/stores/laporanState.svelte';
	import { generateLaporanPdf } from '$lib/services/reportPdfExport';
	import { selectedBranch } from '$lib/stores/selectedBranch.svelte';
	import FileDown from '@lucide/svelte/icons/file-down';

	const s = createLaporanState();

	function handleExportPdf() {
		try {
			generateLaporanPdf({
				branchName: selectedBranch.value || 'Samarinda',
				startDate: s.startDate,
				endDate: s.endDate || s.startDate,
				summary: s.summary,
				reportGroups: s.reportGroups,
				transactions: s.laporan
			});
			s.toastManager.showToastNotification('Laporan PDF berhasil diunduh!', 'success');
		} catch (err: any) {
			s.toastManager.showToastNotification(err?.message || 'Gagal membuat file PDF.', 'error');
		}
	}
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

<div class="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<!-- Fluid Wave Header for Laporan -->
	<div
		class="relative overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-5 pt-4 pb-12 shadow-xl shadow-pink-500/15 md:pt-6 md:pb-14"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="mx-auto w-full max-w-5xl">
			<div class="relative z-10 mb-3 text-center md:mb-4">
				<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs md:text-xl">
					Laporan Keuangan
				</h1>
				<p class="text-xs font-medium text-white/85 md:text-sm">
					Ringkasan omzet, modal, pengeluaran & laba bersih
				</p>
			</div>

			<!-- Date Filter Pills on the Wave -->
			<div class="relative z-10 flex w-full items-center gap-2 md:mx-auto md:max-w-xl">
				<!-- Button Filter Icon -->
				<button
					class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-xs backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
					onclick={() => (s.showFilter = true)}
					aria-label="Filter laporan"
				>
					{#if s.FilterIcon}
						<s.FilterIcon class="h-4.5 w-4.5 stroke-[2.2]" />
					{:else}
						<span
							class="block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
						></span>
					{/if}
				</button>

				<!-- Button Filter Tanggal Start -->
				<button
					class="flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-bold text-slate-800 shadow-sm backdrop-blur-md transition-all hover:bg-white active:scale-95"
					onclick={s.openDatePicker}
				>
					<svg
						class="h-3.5 w-3.5 flex-shrink-0 text-pink-600"
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

				<!-- Button Filter Tanggal End -->
				<button
					class="flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full bg-white/95 px-3 text-xs font-bold text-slate-800 shadow-sm backdrop-blur-md transition-all hover:bg-white active:scale-95"
					onclick={s.openEndDatePicker}
				>
					<svg
						class="h-3.5 w-3.5 flex-shrink-0 text-pink-600"
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
					<span class="truncate">{s.endDate ? s.formatDate(s.endDate, true) : 'Hari ini'}</span>
				</button>

				<!-- Button Download PDF -->
				<button
					class="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-xs backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
					onclick={handleExportPdf}
					title="Unduh Laporan PDF"
					aria-label="Unduh Laporan PDF"
				>
					<FileDown class="h-4.5 w-4.5 stroke-[2.2]" />
				</button>
			</div>
		</div>
	</div>

	<main
		aria-label="Halaman laporan keuangan"
		class="page-content relative z-20 -mt-6 min-h-0 w-full max-w-full flex-1 overflow-x-hidden px-4 pb-24 md:pb-28"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col pb-8 md:pb-12">
			<!-- Ringkasan Keuangan (Laba Bersih, Pemasukan, Pengeluaran) -->
			<LaporanSummaryCards
				isLoadingReport={s.isLoadingReport}
				summary={s.summary}
				totalQrisAll={s.reportGroups.totalQrisAll}
				totalTunaiAll={s.reportGroups.totalTunaiAll}
			/>

			<!-- Accordion Rincian (Pemasukan, Pengeluaran, Laba Rugi) -->
			<div class="mb-4 flex flex-col gap-3">
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
		</div>
	</main>
</div>

<!-- Root Level Filter Sheet Modal (Outside animated main container) -->
<LaporanFilter
	bind:showFilter={s.showFilter}
	bind:filterType={s.filterType}
	bind:startDate={s.startDate}
	bind:filterMonth={s.filterMonth}
	bind:filterYear={s.filterYear}
	onapply={s.applyFilter}
/>

<!-- Root Level Modal Date Picker Start (Outside animated main container) -->
{#if s.showDatePicker}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
	>
		<div class="animate-scale-in mx-auto w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
			<div class="mb-5 flex items-center justify-between">
				<h3 class="text-base font-bold text-slate-900">Pilih Tanggal Awal</h3>
				<button
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200"
					onclick={() => (s.showDatePicker = false)}
					aria-label="Tutup date picker"
				>
					<svg
						class="h-4 w-4 text-slate-500"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="mb-5">
				<label
					class="mb-2 block text-xs font-bold tracking-wider text-slate-500 uppercase"
					for="date-picker-start">Tanggal Awal</label
				>
				<input
					id="date-picker-start"
					type="date"
					class="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 transition-colors focus:border-pink-500 focus:bg-white focus:outline-none"
					bind:value={s.startDate}
				/>
			</div>
			<div class="flex gap-2.5">
				<button
					class="flex-1 cursor-pointer rounded-full bg-slate-100 py-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-95"
					onclick={() => (s.showDatePicker = false)}
				>
					Batal
				</button>
				<button
					class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
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

<!-- Root Level Modal Date Picker End (Outside animated main container) -->
{#if s.showEndDatePicker}
	<div
		class="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
	>
		<div class="animate-scale-in mx-auto w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
			<div class="mb-5 flex items-center justify-between">
				<h3 class="text-base font-bold text-slate-900">Pilih Tanggal Akhir</h3>
				<button
					class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 transition-colors hover:bg-slate-200"
					onclick={() => (s.showEndDatePicker = false)}
					aria-label="Tutup end date picker"
				>
					<svg
						class="h-4 w-4 text-slate-500"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			<div class="mb-5">
				<label
					class="mb-2 block text-xs font-bold tracking-wider text-slate-500 uppercase"
					for="date-picker-end">Tanggal Akhir</label
				>
				<input
					id="date-picker-end"
					type="date"
					class="w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm font-bold text-slate-900 transition-colors focus:border-pink-500 focus:bg-white focus:outline-none"
					bind:value={s.endDate}
				/>
			</div>
			<div class="flex gap-2.5">
				<button
					class="flex-1 cursor-pointer rounded-full bg-slate-100 py-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-95"
					onclick={() => (s.showEndDatePicker = false)}
				>
					Batal
				</button>
				<button
					class="flex-1 cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 py-3 text-xs font-bold text-white shadow-md shadow-pink-500/25 transition-all hover:opacity-95 active:scale-95"
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
