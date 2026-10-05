<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
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

<svelte:head><title>Notifikasi Antrean — ZatiarasPOS</title></svelte:head>
<div class="min-h-[100dvh] bg-stone-50 px-4 py-6 text-stone-900">
	<header
		class="mx-auto mb-6 flex max-w-xl items-center gap-3 rounded-2xl bg-rose-700 p-3 text-white [&_a]:min-h-11 [&_a]:min-w-11"
	>
		<HeaderBackButton href="/pengaturan">←</HeaderBackButton>
		<h1 class="text-xl font-bold">Pengaturan Antrean</h1>
	</header>
	{#if allowed && (userRole.value === 'kasir' || userRole.value === 'pemilik')}
		<main class="mx-auto flex max-w-xl flex-col gap-5">
			<section
				class="rounded-2xl border border-stone-200 bg-white p-5"
				aria-labelledby="sound-heading"
			>
				<h2 id="sound-heading" class="text-lg font-bold">Suara perangkat ini</h2>
				<p class="mt-2 text-sm">
					Pesanan baru dari perangkat lain di cabang yang sama membunyikan tiga nada berulang. Suara
					berhenti ketika Antrean terlihat di perangkat ini, bukan saat pesanan ditandai selesai.
				</p>
				<label
					class="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold"
				>
					<span>Suara pesanan baru</span>
					<input
						type="checkbox"
						role="switch"
						aria-checked={orderNotifications.soundEnabled}
						checked={orderNotifications.soundEnabled}
						onchange={(event) => orderNotifications.setSound(event.currentTarget.checked)}
						class="h-6 w-6 accent-rose-700"
					/>
				</label>
				<button
					onclick={() => orderNotifications.testSound()}
					class="mt-3 min-h-11 w-full rounded-xl border border-stone-400 px-4 font-semibold"
					>Tes suara</button
				>
				<p class="mt-3 text-sm" role="status">
					{orderNotifications.audioReady
						? 'Audio siap di tab ini.'
						: 'Suara belum siap. Tekan Tes suara untuk mengizinkan audio browser.'}
				</p>
				<p class="mt-2 text-sm text-stone-600">
					Pilihan tersimpan untuk profil browser ini, termasuk tab lainnya. Perangkat lain memiliki
					pilihan sendiri.
				</p>
			</section>
			<section
				class="rounded-2xl border border-stone-200 bg-white p-5"
				aria-labelledby="push-heading"
			>
				<h2 id="push-heading" class="text-lg font-bold">Notifikasi saat aplikasi tertutup</h2>
				<p class="mt-2 text-sm">
					Web Push dapat menampilkan notifikasi ketika aplikasi tertutup atau ponsel terkunci.
					Pengiriman, suara, mode senyap, dan penghematan baterai ditentukan browser serta sistem
					operasi; nada berulang hanya saat aplikasi berjalan.
				</p>
				<p class="mt-3 text-sm">
					iPhone/iPad: tambahkan aplikasi ke Layar Utama, buka dari ikon aplikasi, lalu aktifkan
					notifikasi di sini (iOS/iPadOS 16.4 atau lebih baru).
				</p>
				<dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
					<dt>Izin browser</dt>
					<dd class="break-words">
						{orderNotifications.permission === 'granted'
							? 'Diizinkan'
							: orderNotifications.permission === 'denied'
								? 'Ditolak — ubah di pengaturan browser'
								: orderNotifications.permission === 'unsupported'
									? 'Tidak didukung'
									: 'Belum diminta'}
					</dd>
					<dt>Push perangkat</dt>
					<dd>{orderNotifications.pushActive ? 'Aktif' : 'Belum aktif'}</dd>
					<dt>Server push</dt>
					<dd>
						{orderNotifications.pushConfigured === true
							? 'Siap'
							: orderNotifications.pushConfigured === false
								? 'Belum dikonfigurasi'
								: 'Belum dapat diperiksa'}
					</dd>
					<dt>Service worker</dt>
					<dd>
						{orderNotifications.workerReady
							? 'Siap'
							: 'Belum siap — perbarui aplikasi lalu muat ulang'}
					</dd>
				</dl>
				<div class="mt-4 flex flex-col gap-3">
					<button
						onclick={() => orderNotifications.activatePush()}
						disabled={orderNotifications.busy ||
							!orderNotifications.pushReady ||
							!orderNotifications.workerReady ||
							orderNotifications.pushConfigured !== true ||
							orderNotifications.pushActive}
						class="min-h-11 rounded-xl bg-rose-700 px-4 font-semibold text-white disabled:opacity-50"
						>Aktifkan notifikasi perangkat</button
					>
					<button
						onclick={() => orderNotifications.deactivatePush()}
						disabled={orderNotifications.busy || !orderNotifications.pushActive}
						class="min-h-11 rounded-xl border border-stone-400 px-4 font-semibold disabled:opacity-50"
						>Nonaktifkan notifikasi push</button
					>
				</div>
				{#if !orderNotifications.pushReady}<p class="mt-3 text-sm">
						Push belum tersedia pada browser ini. Gunakan HTTPS dan browser/PWA yang mendukung Web
						Push.
					</p>{/if}
			</section>
			<section
				aria-label="Kesiapan notifikasi"
				class="rounded-2xl border border-stone-200 bg-white p-5"
			>
				<h2 class="font-bold">Kesiapan notifikasi</h2>
				<p class="mt-2 text-sm" role="status">{orderNotifications.status}</p>
				{#if orderNotifications.error}<p class="mt-3 text-sm text-red-800" role="alert">
						{orderNotifications.error}
					</p>{/if}
			</section>
		</main>
	{/if}
</div>
