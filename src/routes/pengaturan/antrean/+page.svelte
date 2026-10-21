<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Info from '@lucide/svelte/icons/info';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import { requireAuth } from '$lib/utils/authGuard';
	import { getNotificationScope } from '$lib/services/orderNotificationService';
	import { orderNotifications } from '$lib/stores/orderNotificationState.svelte';
	import { userRole } from '$lib/stores/userRole.svelte';
	let allowed = $state(false);
	onMount(async () => {
		if (!(await requireAuth())) return;
		allowed = Boolean(getNotificationScope());
		if (!allowed) await goto('/unauthorized');
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-20">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan" label="Kembali ke Pengaturan">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Antrean</h1>
			<div class="h-10 w-10" aria-hidden="true"></div>
		</div>
	</PageHeader>
	<main class="relative z-20 mx-auto -mt-6 w-full max-w-5xl flex-1 px-4 md:px-6">
		{#if allowed && (userRole.value === 'kasir' || userRole.value === 'pemilik')}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-start md:gap-5">
				<section
					class="soft-float-card min-w-0 p-5 md:col-span-5 md:p-6"
					aria-labelledby="sound-heading"
				>
					<div class="mb-4 flex items-center gap-3 border-b border-pink-100/80 pb-3.5">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
						>
							<Volume2 class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
						</div>
						<div>
							<h2 id="sound-heading" class="text-sm font-black text-slate-900 md:text-base">
								Suara perangkat ini
							</h2>
							<p class="text-xs text-slate-500 md:text-sm">
								Peringatan pesanan saat aplikasi terbuka
							</p>
						</div>
					</div>
					<p class="text-sm leading-relaxed text-slate-600">
						Bunyikan tiga nada berulang untuk pesanan baru dari perangkat lain di cabang yang sama.
					</p>
					<label
						class="mt-4 flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-pink-100 bg-pink-50/30 p-3.5"
					>
						<span class="text-sm font-bold text-slate-900">Suara pesanan baru</span>
						<span class="relative inline-flex h-6 w-11 shrink-0">
							<input
								type="checkbox"
								role="switch"
								aria-checked={orderNotifications.soundEnabled === true}
								aria-describedby={orderNotifications.soundEnabled === null
									? 'sound-state'
									: 'sound-help'}
								checked={orderNotifications.soundEnabled === true}
								disabled={orderNotifications.soundEnabled === null &&
									!orderNotifications.soundUnreadable}
								onchange={async (event) => {
									const input = event.currentTarget;
									await orderNotifications.setSound(input.checked);
									// Gagal simpan: kembalikan tampilan ke nilai yang benar-benar tersimpan.
									input.checked = orderNotifications.soundEnabled === true;
								}}
								class="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
							/>
							<span
								aria-hidden="true"
								class="pointer-events-none absolute inset-0 rounded-full bg-slate-200 transition-colors duration-200 ease-out peer-checked:bg-pink-600 peer-focus-visible:ring-4 peer-focus-visible:ring-pink-500/20 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50"
							></span>
							<span
								aria-hidden="true"
								class="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out peer-checked:translate-x-5 peer-disabled:opacity-50"
							></span>
						</span>
					</label>
					{#if orderNotifications.soundEnabled === null}
						<p id="sound-state" class="mt-2 text-xs leading-relaxed text-slate-500" role="status">
							{orderNotifications.soundUnreadable
								? 'Pilihan suara perangkat ini tidak dapat dibaca. Pilih ulang untuk menyimpannya.'
								: 'Memuat pilihan suara perangkat ini…'}
						</p>
					{/if}
					<button
						type="button"
						onclick={() => orderNotifications.testSound()}
						class="btn-brand-secondary mt-4 w-full gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98]"
					>
						<Volume2 class="h-4 w-4" />
						Tes suara
					</button>
					<p class="mt-3 text-xs leading-relaxed text-slate-500" role="status">
						{orderNotifications.audioReady
							? 'Audio siap di tab ini.'
							: 'Suara belum siap. Tekan Tes suara untuk mengizinkan audio browser.'}
					</p>
					<p id="sound-help" class="mt-3 text-xs leading-relaxed text-slate-500">
						Suara berhenti saat Antrean terlihat di perangkat ini, bukan saat pesanan ditandai
						selesai. Pilihan tersimpan untuk profil browser ini dan berlaku di semua tab. Perangkat
						lain memiliki pilihan sendiri.
					</p>
				</section>

				<section
					class="soft-float-card min-w-0 p-5 md:col-span-7 md:col-start-6 md:row-span-2 md:row-start-1 md:p-6"
					aria-labelledby="push-heading"
					aria-busy={orderNotifications.busy}
				>
					<div class="mb-4 flex items-center gap-3 border-b border-pink-100/80 pb-3.5">
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 md:h-11 md:w-11"
						>
							<BellRing class="h-5 w-5 stroke-[2.2] md:h-6 md:w-6" />
						</div>
						<div>
							<h2 id="push-heading" class="text-sm font-black text-slate-900 md:text-base">
								Notifikasi saat aplikasi tertutup
							</h2>
							<p class="text-xs text-slate-500 md:text-sm">Atur notifikasi untuk perangkat ini</p>
						</div>
					</div>
					<p class="text-sm leading-relaxed text-slate-600">
						Notifikasi dapat muncul ketika aplikasi tertutup atau ponsel terkunci. Suara dan
						pengirimannya mengikuti browser serta pengaturan sistem perangkat.
					</p>
					<div class="mt-4 rounded-2xl border border-pink-100 bg-pink-50/30 p-3.5">
						<div class="flex items-center justify-between gap-3">
							<span class="text-sm font-bold text-slate-900">Notifikasi perangkat</span>
							<span
								class="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold {orderNotifications.pushActive
									? 'bg-pink-100 text-pink-700'
									: 'bg-slate-100 text-slate-600'}"
							>
								{orderNotifications.pushActive ? 'Aktif' : 'Belum aktif'}
							</span>
						</div>
						<p class="mt-2 text-xs leading-relaxed text-slate-500">
							Izin browser: {orderNotifications.permission === 'granted'
								? 'Diizinkan'
								: orderNotifications.permission === 'denied'
									? 'Ditolak — ubah di pengaturan browser'
									: orderNotifications.permission === 'unsupported'
										? 'Tidak didukung'
										: 'Belum diminta'}
						</p>
					</div>
					<div class="mt-4 flex flex-col gap-2.5">
						<button
							type="button"
							onclick={() => orderNotifications.activatePush()}
							disabled={orderNotifications.busy ||
								!orderNotifications.pushReady ||
								!orderNotifications.workerReady ||
								orderNotifications.pushConfigured !== true ||
								orderNotifications.pushActive}
							class="btn-brand-primary w-full gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98] disabled:active:scale-100"
						>
							{#if orderNotifications.busy}<LoaderCircle
									class="h-4 w-4 shrink-0 animate-spin"
								/>{:else}<BellRing class="h-4 w-4 shrink-0" />{/if}
							{orderNotifications.busy ? 'Memproses…' : 'Aktifkan notifikasi perangkat'}
						</button>
						<button
							type="button"
							onclick={() => orderNotifications.deactivatePush()}
							disabled={orderNotifications.busy || !orderNotifications.pushActive}
							class="btn-brand-secondary w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 active:scale-[0.98] disabled:active:scale-100"
							>Nonaktifkan notifikasi push</button
						>
					</div>
					{#if !orderNotifications.pushReady}
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Push belum tersedia pada browser ini. Gunakan HTTPS dan browser/PWA yang mendukung Web
							Push.
						</p>
					{:else if !orderNotifications.workerReady}
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Perbarui aplikasi lalu muat ulang untuk menyiapkan notifikasi perangkat.
						</p>
					{:else if orderNotifications.pushConfigured === false}
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Notifikasi perangkat belum tersedia. Hubungi pengelola kios.
						</p>
					{/if}
					<div class="mt-4 flex items-start gap-2.5 rounded-xl bg-pink-50/60 p-3.5">
						<Smartphone class="mt-0.5 h-4 w-4 shrink-0 text-pink-600" />
						<p class="text-xs leading-relaxed text-slate-600">
							<span class="font-bold text-slate-700">iPhone/iPad</span>: tambahkan aplikasi ke Layar
							Utama, buka dari ikon aplikasi, lalu aktifkan notifikasi di sini. Memerlukan
							iOS/iPadOS 16.4 atau lebih baru.
						</p>
					</div>
					<details class="group mt-4 border-t border-pink-100/80 pt-3.5">
						<summary
							class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs font-bold text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-600 [&::-webkit-details-marker]:hidden"
						>
							Detail perangkat
							<ChevronDown
								class="h-4 w-4 shrink-0 transition-transform duration-200 ease-out group-open:rotate-180"
							/>
						</summary>
						<dl
							class="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-3 gap-y-3 text-xs leading-relaxed"
						>
							<dt class="text-slate-500">Server push</dt>
							<dd class="font-semibold break-words text-slate-700">
								{orderNotifications.pushConfigured === true
									? 'Siap'
									: orderNotifications.pushConfigured === false
										? 'Belum dikonfigurasi'
										: 'Belum dapat diperiksa'}
							</dd>
							<dt class="text-slate-500">Service worker</dt>
							<dd class="font-semibold break-words text-slate-700">
								{orderNotifications.workerReady
									? 'Siap'
									: 'Belum siap — perbarui aplikasi lalu muat ulang'}
							</dd>
						</dl>
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Mode senyap dan penghematan baterai dapat memengaruhi Web Push. Nada berulang hanya
							berbunyi saat aplikasi berjalan.
						</p>
					</details>
				</section>

				<section
					aria-label="Kesiapan notifikasi"
					class="soft-float-card min-w-0 p-5 md:col-span-5 md:p-6"
				>
					<div class="flex items-center gap-2 text-slate-700">
						<Info class="h-4 w-4 shrink-0 text-pink-600" />
						<h2 class="text-sm font-bold">Kesiapan notifikasi</h2>
					</div>
					<p class="mt-2 text-xs leading-relaxed text-slate-500" role="status">
						{orderNotifications.status}
					</p>
					{#if orderNotifications.error}
						<p
							class="mt-3 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs leading-relaxed font-semibold text-rose-700"
							role="alert"
						>
							{orderNotifications.error}
						</p>
					{/if}
				</section>
			</div>
		{:else}
			<div
				role="status"
				aria-label="Memuat pengaturan Antrean"
				class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5"
			>
				{#each [0, 1] as index (index)}
					<div class="soft-float-card space-y-4 p-5 md:p-6" aria-hidden="true">
						<div class="h-11 w-11 rounded-2xl bg-pink-50 motion-safe:animate-pulse"></div>
						<div class="h-4 w-2/3 rounded-full bg-slate-100 motion-safe:animate-pulse"></div>
						<div class="h-12 rounded-2xl bg-slate-100 motion-safe:animate-pulse"></div>
						<div class="h-12 rounded-2xl bg-pink-50 motion-safe:animate-pulse"></div>
					</div>
				{/each}
			</div>
		{/if}
	</main>
</div>
