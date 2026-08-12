<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade, fly } from 'svelte/transition';
	import DropdownSheet from '$lib/components/shared/dropdownSheet.svelte';
	import NotifModal from '$lib/components/shared/NotifModal.svelte';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createSwipeNavigation } from '$lib/utils/touchNavigation';
	import { createCatatState } from '$lib/stores/catatState.svelte';

	const swipeNav = createSwipeNavigation(2);
	const s = createCatatState();

	onMount(async () => {
		await s.init();
	});
</script>

<!-- Toast Notification -->
<ToastNotification
	show={s.toastManager.showToast}
	message={s.toastManager.toastMessage}
	type={s.toastManager.toastType}
	position="top"
/>

{#if s.showSnackbar}
	<div
		class="fixed top-24 left-1/2 z-50 flex min-w-[220px] items-center justify-center gap-3 rounded-xl bg-pink-500 px-6 py-3 text-base font-semibold text-white shadow-lg"
		style="transform: translateX(-50%);"
		in:fly={{ y: -32, duration: 300, easing: cubicOut }}
		out:fade={{ duration: 200 }}
	>
		<svg
			class="h-7 w-7 flex-shrink-0 text-white"
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
{/if}

<NotifModal
	show={s.showNotifModal}
	message={s.notifModalMsg}
	type={s.notifModalType}
	onClose={s.closeNotifModal}
/>

<!-- Page swipe is optional; visible navigation remains the primary control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex min-h-screen w-full max-w-full flex-col overflow-x-hidden bg-white"
	ontouchstart={swipeNav.handleTouchStart}
	ontouchmove={swipeNav.handleTouchMove}
	ontouchend={swipeNav.handleTouchEnd}
>
	<main
		aria-label="Halaman catat pemasukan pengeluaran"
		class="page-content min-h-0 w-full max-w-full flex-1 overflow-x-hidden overflow-y-auto"
		style="scrollbar-width:none;-ms-overflow-style:none;"
	>
		<div class="px-2 pt-4 pb-4 md:pt-8 lg:pt-10">
			<div
				class="mx-auto w-full max-w-md px-2 pb-2 md:mx-auto md:max-w-lg md:px-0 md:pb-4 lg:mx-auto lg:max-w-2xl"
			>
				<div
					class="relative mb-5 flex overflow-hidden rounded-full border border-pink-100 bg-gray-50 shadow-sm md:mx-auto md:max-w-lg"
				>
					<!-- Indicator Slide -->
					<div
						class="absolute top-0 left-0 z-0 h-full w-1/2 rounded-full border border-pink-200 bg-white shadow transition-transform duration-200 ease-out"
						style="transform: translateX({s.mode === 'pengeluaran' ? '100%' : '0'});"
					></div>
					<button
						class="z-10 h-14 min-h-0 flex-1 rounded-full text-sm font-semibold transition-all duration-200 focus:outline-none md:h-16 {s.mode ===
						'pemasukan'
							? 'text-pink-500'
							: 'text-gray-400'} md:text-lg"
						type="button"
						aria-current={s.mode === 'pemasukan' ? 'page' : undefined}
						onclick={s.handleSetPemasukan}
					>
						Catat Pemasukan
					</button>
					<button
						class="z-10 h-14 min-h-0 flex-1 rounded-full text-sm font-semibold transition-all duration-200 focus:outline-none md:h-16 {s.mode ===
						'pengeluaran'
							? 'text-pink-500'
							: 'text-gray-400'} md:text-lg"
						type="button"
						aria-current={s.mode === 'pengeluaran' ? 'page' : undefined}
						onclick={s.handleSetPengeluaran}
					>
						Catat Pengeluaran
					</button>
				</div>
				<form
					class="flex flex-col gap-4 px-1 md:rounded-2xl md:border md:border-pink-100 md:bg-white md:p-8 md:shadow {s.jenis ===
					'lainnya'
						? 'pb-18'
						: 'pb-14'} md:gap-6"
					onsubmit={s.handleSubmit}
					autocomplete="off"
					id="catat-form"
				>
					<div class="flex flex-col gap-4 sm:flex-row sm:gap-4 md:gap-6">
						<div class="flex-1">
							<label
								class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
								for="tanggal-input">Tanggal</label
							>
							<input
								id="tanggal-input"
								type="date"
								class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
								bind:value={s.date}
								min="2020-01-01"
								max="2100-12-31"
								required
							/>
						</div>
						<div class="flex-1">
							<label
								class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
								for="waktu-input">Waktu</label
							>
							<input
								id="waktu-input"
								type="time"
								class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
								bind:value={s.time}
								required
							/>
						</div>
					</div>
					<div>
						<label
							class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
							for="nominal-input">Nominal</label
						>
						<input
							id="nominal-input"
							type="text"
							inputmode="numeric"
							class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
							value={s.nominal}
							oninput={s.handleNominalInput}
							required
							placeholder="Masukkan nominal"
							autocomplete="off"
						/>
						<div
							class="mt-2 mb-1 grid w-full grid-cols-3 gap-2 md:flex md:w-auto md:grid-cols-none md:flex-wrap md:justify-center md:gap-3"
						>
							<button
								type="button"
								class="w-full rounded-lg bg-pink-100 py-2 text-base font-semibold text-pink-500 shadow-sm active:bg-pink-200 md:w-auto md:px-6 md:py-3 md:text-lg md:whitespace-nowrap"
								onclick={s.handleSetTemplateNominal(5000)}>Rp 5.000</button
							>
							<button
								type="button"
								class="w-full rounded-lg bg-pink-100 py-2 text-base font-semibold text-pink-500 shadow-sm active:bg-pink-200 md:w-auto md:px-6 md:py-3 md:text-lg md:whitespace-nowrap"
								onclick={s.handleSetTemplateNominal(10000)}>Rp 10.000</button
							>
							<button
								type="button"
								class="w-full rounded-lg bg-pink-100 py-2 text-base font-semibold text-pink-500 shadow-sm active:bg-pink-200 md:w-auto md:px-6 md:py-3 md:text-lg md:whitespace-nowrap"
								onclick={s.handleSetTemplateNominal(20000)}>Rp 20.000</button
							>
							<button
								type="button"
								class="w-full rounded-lg bg-pink-100 py-2 text-base font-semibold text-pink-500 shadow-sm active:bg-pink-200 md:w-auto md:px-6 md:py-3 md:text-lg md:whitespace-nowrap"
								onclick={s.handleSetTemplateNominal(50000)}>Rp 50.000</button
							>
							<button
								type="button"
								class="w-full rounded-lg bg-pink-100 py-2 text-base font-semibold text-pink-500 shadow-sm active:bg-pink-200 md:w-auto md:px-6 md:py-3 md:text-lg md:whitespace-nowrap"
								onclick={s.handleSetTemplateNominal(100000)}>Rp 100.000</button
							>
						</div>
					</div>
					<div>
						<label
							class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
							for="jenis-dropdown"
							>Jenis {s.mode === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}</label
						>
						<button
							type="button"
							id="jenis-dropdown"
							class="mb-1 flex w-full cursor-pointer items-center rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
							onclick={() => (s.showDropdown = true)}
							onkeydown={(e) => e.key === 'Enter' && (s.showDropdown = true)}
							style="user-select:none;"
						>
							<span class="truncate">{s.getJenisLabel(s.jenis)}</span>
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
								class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
								for="nama-jenis-input">Nama Jenis</label
							>
							<input
								id="nama-jenis-input"
								type="text"
								class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
								bind:value={s.namaJenis}
								required
								placeholder="Masukkan nama jenis"
							/>
						</div>
					{/if}
					<div>
						<label
							class="mb-1 block text-sm font-medium text-pink-500 md:text-base"
							for="nama-input">Nama {s.mode === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'}</label
						>
						<input
							id="nama-input"
							type="text"
							class="mb-1 w-full rounded-lg border-[1.5px] border-pink-200 bg-white px-3 py-2.5 text-base text-gray-800 transition-colors duration-200 outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-100 md:py-3 md:text-lg"
							bind:value={s.nama}
							required
						/>
					</div>

					<!-- Toggle Laci Kasir -->
					<div>
						<label
							class="mb-2 block text-sm font-medium text-pink-500 md:text-base"
							for="laci-kasir-toggle">Laci Kasir</label
						>
						<div
							class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 md:p-4"
						>
							<div class="flex items-center gap-3 md:gap-4">
								<div
									class="flex h-8 w-8 items-center justify-center rounded-full md:h-10 md:w-10 {s.paymentMethod ===
									'tunai'
										? 'bg-green-500 text-white'
										: 'bg-gray-300 text-gray-600'}"
								>
									<svg
										class="h-4 w-4 md:h-5 md:w-5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
										></path>
									</svg>
								</div>
								<div>
									<div class="text-sm font-medium text-gray-800 md:text-base">
										Uang {s.mode === 'pemasukan' ? 'Masuk' : 'Keluar'} Laci
									</div>
									<div class="text-xs text-gray-500 md:text-sm">
										{s.paymentMethod === 'tunai'
											? s.mode === 'pemasukan'
												? 'Ya, masuk laci kasir'
												: 'Ya, dari laci kasir'
											: s.mode === 'pemasukan'
												? 'Tidak masuk laci kasir'
												: 'Tidak dari laci kasir'}
									</div>
								</div>
							</div>
							<button
								id="laci-kasir-toggle"
								type="button"
								class="relative h-6 w-12 rounded-full transition-colors duration-300 md:h-7 md:w-14 {s.paymentMethod ===
								'tunai'
									? 'bg-green-500'
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
						<div class="mt-1 text-center text-sm text-pink-600 md:text-base">{s.error}</div>
					{/if}
				</form>
			</div>
		</div>
	</main>
	<!-- Button Simpan -->
	<div class="fixed right-0 bottom-[56px] left-0 z-30 px-4 pt-2 pb-3">
		<div class="mx-auto max-w-md md:mx-auto md:max-w-lg">
			<button
				type="submit"
				form="catat-form"
				class="mt-1 w-full rounded-xl border-none bg-pink-500 py-4 text-lg font-bold text-white shadow-lg shadow-pink-500/10 transition-all duration-300 hover:bg-pink-600 active:bg-pink-700"
			>
				Simpan
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
