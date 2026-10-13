<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import Bell from '@lucide/svelte/icons/bell';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import { createOwnerStockState } from '$lib/stores/ownerStockState.svelte';

	import DisableStockDialog from '$lib/components/pengaturan/stok/DisableStockDialog.svelte';
	import EnableStockDialog from '$lib/components/pengaturan/stok/EnableStockDialog.svelte';
	import ReconciliationDialog from '$lib/components/pengaturan/stok/ReconciliationDialog.svelte';

	const s = createOwnerStockState();
	onMount(s.mount);
	onDestroy(s.destroy);
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div class="page-header relative w-full px-5 pt-4 pb-12 md:pt-6 md:pb-14">
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan/pemilik">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Stok</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Content -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 md:px-6">
		<!-- 0. Master Toggle Monitoring Stok -->
		<div class="soft-float-card flex flex-col gap-3 p-5 md:p-6">
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-start gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
					>
						<Boxes class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
					</div>
					<div>
						<div class="flex items-center gap-2">
							<span class="text-sm font-bold text-slate-900 md:text-base">Monitoring Stok</span>
							{#if s.policyLoading}
								<span
									class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 md:text-[10px]"
								>
									Memuat…
								</span>
							{:else if s.policyMode === 'tracked'}
								<span
									class="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700 md:text-[10px]"
								>
									Aktif
								</span>
							{:else}
								<span
									class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-600 md:text-[10px]"
								>
									Nonaktif
								</span>
							{/if}
						</div>
						<p class="mt-1 text-xs text-slate-500 md:text-sm">
							{s.policyMode === 'tracked'
								? 'POS memantau dan mengurangi stok otomatis saat penjualan.'
								: 'POS berjalan tanpa monitoring atau pengurangan stok. Data lama tetap tersimpan.'}
						</p>
						{#if s.policyError}
							<p class="mt-1 text-xs font-bold text-rose-600">{s.policyError}</p>
						{/if}
						{#if !s.policyLoading && !s.policyCanManage}
							<p class="mt-1 text-[11px] text-slate-400">
								Perubahan monitoring belum tersedia untuk sesi ini (cabang di luar pilot atau bukan
								pemilik).
							</p>
						{/if}
					</div>
				</div>

				<button
					type="button"
					role="switch"
					aria-label={s.policyMode === 'tracked'
						? 'Nonaktifkan monitoring stok'
						: 'Aktifkan kembali monitoring stok'}
					aria-checked={s.policyMode === 'tracked'}
					disabled={s.policyLoading || s.policyToggling || !s.policyCanManage}
					onclick={() => {
						if (s.policyMode === 'tracked') s.showDisableConfirm = true;
						else {
							s.enableError = '';
							s.showEnableConfirm = true;
						}
					}}
					class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 {s.policyMode ===
					'tracked'
						? 'bg-pink-600'
						: 'bg-slate-200'}"
				>
					<span
						class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.policyMode ===
						'tracked'
							? 'translate-x-5'
							: 'translate-x-0'}"
					></span>
				</button>
			</div>

			<DisableStockDialog {s} />

			<EnableStockDialog {s} />

			{#if s.reconError && !s.showReconModal && !s.policyLoading}
				<p class="mt-1 text-xs font-bold text-rose-600">{s.reconError}</p>
			{/if}
			{#if s.policyMode === 'ignored' && s.reconPendingReviews > 0 && !s.policyLoading}
				<p class="mt-1 text-[11px] font-bold text-amber-600">
					{s.reconPendingReviews} antrean offline menunggu tinjauan di dalam dialog hitung fisik.
				</p>
			{/if}

			<ReconciliationDialog {s} />
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- 1. Kebijakan Checkout -->
			<div class="soft-float-card flex flex-col justify-between p-5 md:p-6">
				<div class="flex items-start justify-between gap-3">
					<div class="flex items-start gap-3">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
						>
							<Boxes class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
						</div>
						<div>
							<div class="flex items-center gap-2">
								<span class="text-sm font-bold text-slate-900 md:text-base"
									>Cek Stok Sebelum Bayar</span
								>
								{#if s.strictStockEnabled}
									<span
										class="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black text-rose-700 md:text-[10px]"
									>
										Cek awal aktif
									</span>
								{:else}
									<span
										class="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 md:text-[10px]"
									>
										Cek awal mati
									</span>
								{/if}
							</div>
							<p class="mt-1 text-xs text-slate-500 md:text-sm">
								{s.policyMode === 'ignored'
									? 'Monitoring nonaktif: pemeriksaan stok tidak berlaku saat checkout.'
									: s.strictStockEnabled
										? 'POS memeriksa stok sebelum bayar; server tetap menolak transaksi bila stok tidak cukup.'
										: 'Pemeriksaan awal POS dimatikan; server tetap menolak transaksi bila stok tidak cukup.'}
							</p>
						</div>
					</div>

					<button
						type="button"
						role="switch"
						aria-label={s.strictStockEnabled
							? 'Matikan cek stok sebelum bayar'
							: 'Aktifkan cek stok sebelum bayar'}
						aria-checked={s.strictStockEnabled}
						disabled={s.policyMode === 'ignored'}
						onclick={s.toggleStrictStock}
						class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {s.strictStockEnabled
							? 'bg-pink-600'
							: 'bg-slate-200'}"
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.strictStockEnabled
								? 'translate-x-5'
								: 'translate-x-0'}"
						></span>
					</button>
				</div>
			</div>

			<!-- 2. Alarm & Notifikasi -->
			<div class="soft-float-card space-y-4 p-5 md:p-6">
				<div class="flex items-center gap-2.5 border-b border-slate-100 pb-3">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-600 md:h-9 md:w-9"
					>
						<Bell class="h-4.5 w-4.5 stroke-[2.2] md:h-5 md:w-5" />
					</div>
					<h2 class="text-xs font-bold tracking-wider text-slate-800 uppercase md:text-sm">
						Alarm & Notifikasi
					</h2>
				</div>

				<!-- Suara Alarm -->
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						{#if s.soundEnabled}
							<Volume2 class="h-4.5 w-4.5 text-emerald-600 md:h-5 md:w-5" />
						{:else}
							<VolumeX class="h-4.5 w-4.5 text-slate-400 md:h-5 md:w-5" />
						{/if}
						<div>
							<div class="text-xs font-bold text-slate-800 md:text-sm">Suara Alarm Stok</div>
							<div class="text-[11px] text-slate-400 md:text-xs">Bunyi nada saat bahan habis</div>
						</div>
					</div>
					<button
						type="button"
						role="switch"
						aria-label={s.soundEnabled ? 'Matikan suara alarm' : 'Nyalakan suara alarm'}
						aria-checked={s.soundEnabled}
						onclick={s.toggleSound}
						class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {s.soundEnabled
							? 'bg-pink-600'
							: 'bg-slate-200'}"
					>
						<span
							class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out {s.soundEnabled
								? 'translate-x-5'
								: 'translate-x-0'}"
						></span>
					</button>
				</div>

				<!-- Notifikasi HP -->
				<div class="flex items-center justify-between border-t border-slate-100 pt-3">
					<div>
						<div class="text-xs font-bold text-slate-800 md:text-sm">Notifikasi Sistem HP</div>
						<div class="text-[11px] text-slate-400 md:text-xs">Muncul di status bar HP</div>
					</div>
					<div>
						{#if s.notifPermission === 'granted'}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 md:text-xs"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Aktif
							</span>
						{:else}
							<button
								type="button"
								onclick={s.handleRequestNotif}
								class="cursor-pointer rounded-full bg-gradient-to-r from-pink-600 to-rose-500 px-3 py-1 text-[11px] font-bold text-white shadow-2xs hover:opacity-95 active:scale-95 md:px-4 md:py-1.5 md:text-xs"
							>
								Aktifkan
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<!-- 3. Kelola Inventaris -->
		<div class="soft-float-card p-4 md:p-5">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-xs font-bold text-slate-800 md:text-sm">Inventaris Bahan & Menu</h3>
					<p class="text-[11px] text-slate-400 md:text-xs">
						Lihat dan ubah stok bahan baku secara real-time
					</p>
				</div>
				<button
					type="button"
					onclick={() => goto('/stok')}
					class="flex cursor-pointer items-center gap-1.5 rounded-full border border-pink-100 bg-pink-50 px-3.5 py-1.5 text-xs font-bold text-pink-600 transition-all hover:bg-pink-100 active:scale-95 md:px-4 md:py-2 md:text-sm"
				>
					<span>Buka Stok</span>
					<ExternalLink class="h-3.5 w-3.5 stroke-[2.2] md:h-4 md:w-4" />
				</button>
			</div>
		</div>
	</div>
</div>
