<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade, fly } from 'svelte/transition';
	import DropdownSheet from '$lib/components/shared/dropdownSheet.svelte';
	import NotifModal from '$lib/components/shared/NotifModal.svelte';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createCatatState } from '$lib/stores/catatState.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import History from '@lucide/svelte/icons/history';
	import ArrowDownLeft from '@lucide/svelte/icons/arrow-down-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Wallet from '@lucide/svelte/icons/wallet';
	import FileText from '@lucide/svelte/icons/file-text';

	const s = createCatatState();

	onMount(async () => {
		await s.init();
	});

	function formatWaktuTrx(isoStr: string): string {
		if (!isoStr) return '--:--';
		try {
			const d = new Date(isoStr);
			return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
		} catch {
			return '--:--';
		}
	}
</script>

<!-- Toast Notification -->
<ToastNotification
	show={s.toastManager.showToast}
	message={s.toastManager.toastMessage}
	type={s.toastManager.toastType}
	position="top"
/>

{#if s.showSnackbar}
	<div class="pointer-events-none fixed inset-x-0 top-20 z-50 flex justify-center px-4">
		<div
			class="flex min-w-[220px] items-center justify-center gap-3 rounded-2xl bg-pink-600 px-6 py-3.5 text-base font-semibold text-white shadow-xl shadow-pink-950/20 backdrop-blur-md"
			in:fly={{ y: -20, duration: 240, easing: cubicOut }}
			out:fade={{ duration: 160 }}
		>
			<svg
				class="h-6 w-6 flex-shrink-0 text-white"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				stroke-width="2"
			>
				<circle cx="12" cy="12" r="10" fill="#f9a8d4" />
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					d="M9 12l2 2 4-4"
					stroke="#fff"
					stroke-width="2"
				/>
			</svg>
			<span class="flex-1 text-center">{s.snackbarMsg}</span>
		</div>
	</div>
{/if}

<NotifModal
	show={s.showNotifModal}
	message={s.notifModalMsg}
	type={s.notifModalType}
	onClose={s.closeNotifModal}
/>

<div class="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-[#faf7f8]">
	<!-- Fluid Wave Header for Catat -->
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
					Pencatatan Keuangan
				</h1>
				<p class="text-xs font-medium text-white/85 md:text-sm">
					Catat pemasukan atau pengeluaran operasional kios
				</p>
			</div>

			<!-- Mode Switcher Pill on the Wave -->
			<div
				class="relative z-10 mx-auto flex max-w-sm overflow-hidden rounded-full border border-white/40 bg-white/25 p-1 shadow-sm backdrop-blur-xl md:max-w-md"
			>
				<!-- Indicator Slide -->
				<div
					class="absolute top-1 bottom-1 left-1 z-0 w-[calc(50%-4px)] rounded-full bg-white shadow-md transition-transform duration-200 ease-out"
					style="transform: translateX({s.mode === 'pengeluaran' ? '100%' : '0'});"
				></div>
				<button
					class="z-10 h-9 min-h-0 flex-1 cursor-pointer rounded-full text-xs font-bold transition-all duration-200 focus:outline-none md:h-10 md:text-sm {s.mode ===
					'pemasukan'
						? 'text-pink-700'
						: 'text-white'}"
					type="button"
					aria-current={s.mode === 'pemasukan' ? 'page' : undefined}
					onclick={s.handleSetPemasukan}
				>
					+ Pemasukan
				</button>
				<button
					class="z-10 h-9 min-h-0 flex-1 cursor-pointer rounded-full text-xs font-bold transition-all duration-200 focus:outline-none md:h-10 md:text-sm {s.mode ===
					'pengeluaran'
						? 'text-rose-700'
						: 'text-white'}"
					type="button"
					aria-current={s.mode === 'pengeluaran' ? 'page' : undefined}
					onclick={s.handleSetPengeluaran}
				>
					- Pengeluaran
				</button>
			</div>
		</div>
	</div>

	<main
		aria-label="Halaman catat pemasukan pengeluaran"
		class="page-content relative z-20 -mt-6 min-h-0 w-full max-w-full flex-1 overflow-x-hidden px-4 pb-24 md:pb-28"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col">
			<!-- 2-Column Responsive Grid on Tablet (1-col on Mobile) -->
			<div class="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-start md:gap-6">
				<!-- Left Column: Form (md:col-span-7) -->
				<div class="md:col-span-7">
					<div
						class="glass-card rounded-[32px] border border-white/50 bg-white/80 p-5 shadow-xl backdrop-blur-lg md:p-7"
					>
						<div
							class="mb-4 hidden items-center justify-between border-b border-slate-100 pb-3.5 md:flex"
						>
							<div>
								<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Formulir Transaksi
								</span>
								<div class="text-base font-extrabold text-slate-900">
									{s.mode === 'pemasukan' ? 'Catat Pemasukan Kas' : 'Catat Pengeluaran Kas'}
								</div>
							</div>
							<span
								class="rounded-full px-3 py-1 text-xs font-bold {s.mode === 'pemasukan'
									? 'border border-pink-200 bg-pink-50 text-pink-700'
									: 'border border-rose-200 bg-rose-50 text-rose-700'}"
							>
								{s.mode === 'pemasukan' ? '+ Kas Masuk' : '- Kas Keluar'}
							</span>
						</div>

						<form
							class="flex flex-col gap-4 md:gap-4.5"
							onsubmit={s.handleSubmit}
							autocomplete="off"
							id="catat-form"
						>
							<!-- Tanggal & Waktu -->
							<div class="flex flex-col gap-3 sm:flex-row sm:gap-3">
								<div class="flex-1">
									<label
										class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
										for="tanggal-input">Tanggal</label
									>
									<input
										id="tanggal-input"
										type="date"
										class="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 shadow-xs transition-all outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10 md:py-3"
										bind:value={s.date}
										min="2020-01-01"
										max="2100-12-31"
										required
									/>
								</div>
								<div class="flex-1">
									<label
										class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
										for="waktu-input">Waktu</label
									>
									<input
										id="waktu-input"
										type="time"
										class="w-full rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 shadow-xs transition-all outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10 md:py-3"
										bind:value={s.time}
										required
									/>
								</div>
							</div>

							<!-- Nominal Input & Preset Quick Pills -->
							<div>
								<label
									class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
									for="nominal-input">Nominal (Rp)</label
								>
								<input
									id="nominal-input"
									type="text"
									inputmode="numeric"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-2xl font-black text-slate-900 shadow-xs transition-all outline-none placeholder:text-slate-300 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10 md:py-3.5 md:text-3xl"
									value={s.nominal}
									oninput={s.handleNominalInput}
									required
									placeholder="Masukkan nominal"
									autocomplete="off"
								/>
								<div class="mt-2.5 grid w-full grid-cols-3 gap-1.5 md:gap-2">
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(5000)}>+ Rp 5.000</button
									>
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(10000)}>+ Rp 10.000</button
									>
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(20000)}>+ Rp 20.000</button
									>
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(50000)}>+ Rp 50.000</button
									>
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(100000)}>+ Rp 100.000</button
									>
									<button
										type="button"
										class="w-full cursor-pointer rounded-full border border-slate-200/90 bg-white py-2 text-xs font-bold text-slate-700 shadow-xs transition-all hover:border-pink-300 hover:text-pink-600 active:scale-95 md:py-2.5"
										onclick={s.handleSetTemplateNominal(200000)}>+ Rp 200.000</button
									>
								</div>
							</div>

							<!-- Jenis Transaksi -->
							<div>
								<label
									class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
									for="jenis-dropdown"
									>Jenis {s.mode === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}</label
								>
								<button
									id="jenis-dropdown"
									type="button"
									class="flex h-11 w-full cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 shadow-xs transition-all outline-none hover:border-pink-300 active:scale-[0.99] md:h-12"
									onclick={() => (s.showDropdown = true)}
									onkeydown={(e) => e.key === 'Enter' && (s.showDropdown = true)}
								>
									<span>{s.getJenisLabel(s.jenis)}</span>
									<svg
										class="h-4 w-4 text-slate-400"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										viewBox="0 0 24 24"
									>
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								<DropdownSheet
									open={s.showDropdown}
									value={s.jenis}
									options={s.mode === 'pemasukan' ? s.jenisPemasukan : s.jenisPengeluaran}
									onClose={() => (s.showDropdown = false)}
									onSelect={(value) => {
										s.jenis = value;
										s.showDropdown = false;
									}}
								/>
							</div>

							{#if s.jenis === 'lainnya'}
								<div>
									<label
										class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
										for="nama-jenis-input">Nama Jenis</label
									>
									<input
										id="nama-jenis-input"
										type="text"
										class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-xs transition-all outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10 md:py-3"
										bind:value={s.namaJenis}
										required
										placeholder="Masukkan nama jenis"
									/>
								</div>
							{/if}

							<!-- Nama / Keterangan Transaksi -->
							<div>
								<label
									class="mb-1 block text-[11px] font-extrabold tracking-wider text-slate-500 uppercase"
									for="nama-input"
									>Keterangan / Nama {s.mode === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}</label
								>
								<input
									id="nama-input"
									type="text"
									class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 shadow-xs transition-all outline-none focus:border-pink-500 focus:ring-4 focus:ring-pink-500/10 md:py-3"
									bind:value={s.nama}
									placeholder="Contoh: Pembelian Es Batu / Gula"
									required
								/>
							</div>

							<!-- Toggle Laci Kasir -->
							<div>
								<label
									class="mb-1.5 block text-xs font-bold tracking-wider text-zinc-700 uppercase"
									for="laci-kasir-toggle">Aliran Laci Kasir</label
								>
								<div
									class="flex items-center justify-between rounded-2xl border border-zinc-200/80 bg-zinc-50/70 p-3.5 md:p-4"
								>
									<div class="flex items-center gap-3 md:gap-4">
										<div
											class="flex h-9 w-9 items-center justify-center rounded-full md:h-10 md:w-10 {s.paymentMethod ===
											'tunai'
												? 'bg-emerald-500 text-white'
												: 'bg-gray-300 text-gray-600'}"
										>
											<Wallet class="h-4.5 w-4.5 stroke-[2.2] md:h-5 md:w-5" />
										</div>
										<div>
											<div class="text-sm font-bold text-gray-800 md:text-base">
												Uang {s.mode === 'pemasukan' ? 'Masuk ke' : 'Keluar dari'} Laci Kasir
											</div>
											<div class="text-xs text-gray-500 md:text-sm">
												{s.paymentMethod === 'tunai'
													? s.mode === 'pemasukan'
														? 'Ya, uang tunai fisik masuk laci'
														: 'Ya, diambil dari uang tunai laci'
													: s.mode === 'pemasukan'
														? 'Tidak (Non-tunai / transfer bank)'
														: 'Tidak (Non-tunai / transfer bank)'}
											</div>
										</div>
									</div>
									<button
										id="laci-kasir-toggle"
										type="button"
										class="relative h-6 w-12 cursor-pointer rounded-full transition-colors duration-300 md:h-7 md:w-14 {s.paymentMethod ===
										'tunai'
											? 'bg-emerald-500'
											: 'bg-gray-300'}"
										onclick={() =>
											(s.paymentMethod = s.paymentMethod === 'tunai' ? 'non-tunai' : 'tunai')}
										onkeydown={(e) =>
											e.key === 'Enter' &&
											(s.paymentMethod = s.paymentMethod === 'tunai' ? 'non-tunai' : 'tunai')}
										aria-label="Toggle laci kasir"
									>
										<div
											class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-300 md:h-6 md:w-6 {s.paymentMethod ===
											'tunai'
												? 'translate-x-6 md:translate-x-7'
												: 'translate-x-0'}"
										></div>
									</button>
								</div>
							</div>

							{#if s.error}
								<div class="mt-1 text-center text-sm font-bold text-rose-600 md:text-base">
									{s.error}
								</div>
							{/if}

							<!-- Embedded Submit Button on Tablet (hidden on mobile, visible on md:) -->
							<div class="mt-2 hidden pt-2 md:block">
								<button
									type="submit"
									class="w-full cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-4 text-base font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-150 hover:opacity-95 active:scale-[0.98]"
								>
									Simpan Transaksi ({s.mode === 'pemasukan' ? '+ Pemasukan' : '- Pengeluaran'})
								</button>
							</div>
						</form>
					</div>
				</div>

				<!-- Right Column: Live Summary & Recent History (md:col-span-5) -->
				<div class="flex flex-col gap-4 md:col-span-5 md:gap-5">
					<!-- Card 1: Live Preview (Ringkasan Entri) -->
					<div class="soft-float-card relative overflow-hidden p-5 md:p-6">
						<div class="mb-3 flex items-center justify-between">
							<span class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
								Pratinjau Catatan
							</span>
							<span
								class="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold {s.mode === 'pemasukan'
									? 'bg-pink-50 text-pink-700'
									: 'bg-rose-50 text-rose-700'}"
							>
								{s.mode === 'pemasukan' ? '+ Pemasukan' : '- Pengeluaran'}
							</span>
						</div>

						<div class="my-2">
							<span class="text-xs font-semibold text-slate-400">Total Nominal</span>
							<div
								class="mt-0.5 text-2xl font-black tracking-tight {s.mode === 'pemasukan'
									? 'text-slate-900'
									: 'text-rose-600'} sm:text-3xl"
							>
								Rp {s.nominal || '0'}
							</div>
						</div>

						<div
							class="mt-4 flex flex-col gap-2.5 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5 text-xs"
						>
							<div class="flex items-center justify-between">
								<span class="font-medium text-slate-500">Waktu WITA</span>
								<span class="font-bold text-slate-800">{s.date} • {s.time}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="font-medium text-slate-500">Kategori</span>
								<span class="font-bold text-slate-800">{s.getJenisLabel(s.jenis)}</span>
							</div>
							<div class="flex items-center justify-between">
								<span class="font-medium text-slate-500">Keterangan</span>
								<span class="max-w-[180px] truncate font-bold text-slate-800"
									>{s.nama || '(belum diisi)'}</span
								>
							</div>
							<div class="flex items-center justify-between border-t border-slate-200/60 pt-2">
								<span class="font-medium text-slate-500">Aliran Dana</span>
								<span
									class="font-extrabold {s.paymentMethod === 'tunai'
										? 'text-emerald-700'
										: 'text-slate-700'}"
								>
									{s.paymentMethod === 'tunai' ? 'Laci Kasir (Tunai)' : 'Non-Tunai / Rekening'}
								</span>
							</div>
						</div>
					</div>

					<!-- Card 2: Riwayat Catatan Kas Hari Ini -->
					<div class="soft-float-card p-5 md:p-6">
						<div class="mb-3 flex items-center justify-between">
							<div>
								<div class="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
									Aktivitas Hari Ini
								</div>
								<div class="text-sm font-bold text-slate-900 sm:text-base">Riwayat Catatan Kas</div>
							</div>
							<History class="h-4.5 w-4.5 text-slate-400" />
						</div>

						{#if s.isLoadingRecent}
							<div class="flex flex-col gap-2">
								{#each Array(3) as _}
									<div class="h-12 w-full animate-pulse rounded-xl bg-slate-100"></div>
								{/each}
							</div>
						{:else if s.recentTransactions.length === 0}
							<div class="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
								<FileText class="mx-auto mb-1.5 h-6 w-6 text-slate-300" />
								<div class="text-xs font-bold text-slate-600">Belum Ada Catatan Manual</div>
								<div class="mt-0.5 text-[11px] text-slate-400">
									Transaksi yang Anda catat hari ini akan tampil di sini
								</div>
							</div>
						{:else}
							<div class="flex flex-col gap-2">
								{#each s.recentTransactions.slice(0, 4) as trx}
									<div
										class="flex items-center justify-between rounded-xl border border-slate-100 bg-white p-2.5 transition-all hover:bg-slate-50"
									>
										<div class="flex min-w-0 items-center gap-2.5">
											<div
												class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {trx.tipe ===
												'in'
													? 'bg-emerald-50 text-emerald-600'
													: 'bg-rose-50 text-rose-600'}"
											>
												{#if trx.tipe === 'in'}
													<ArrowDownLeft class="h-4 w-4 stroke-[2.5]" />
												{:else}
													<ArrowUpRight class="h-4 w-4 stroke-[2.5]" />
												{/if}
											</div>
											<div class="min-w-0 flex-1">
												<div class="truncate text-xs font-bold text-slate-800">
													{trx.deskripsi || (trx.tipe === 'in' ? 'Pemasukan' : 'Pengeluaran')}
												</div>
												<div class="text-[10px] font-medium text-slate-400">
													{formatWaktuTrx(trx.waktu || '')} · {trx.metode_bayar === 'tunai'
														? 'Tunai'
														: 'Non-Tunai'}
												</div>
											</div>
										</div>
										<div
											class="shrink-0 pl-2 text-xs font-extrabold {trx.tipe === 'in'
												? 'text-emerald-700'
												: 'text-rose-700'}"
										>
											{trx.tipe === 'in' ? '+' : '-'}Rp {formatRupiah(trx.nominal)}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</main>

	<!-- Button Simpan on Mobile (Floating at bottom, hidden on md:) -->
	<div class="fixed right-0 bottom-[68px] left-0 z-30 px-4 pt-2 pb-2 md:hidden">
		<div class="mx-auto max-w-md">
			<button
				type="submit"
				form="catat-form"
				class="w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3.5 text-base font-bold text-white shadow-lg shadow-pink-500/25 transition-all duration-150 hover:opacity-95 active:scale-[0.98]"
			>
				Simpan Transaksi
			</button>
		</div>
	</div>
</div>

<style>
	main {
		flex: 1 1 auto;
	}
	@keyframes slideUp {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
