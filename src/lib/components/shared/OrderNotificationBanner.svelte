<script lang="ts">
	import { MediaQuery } from 'svelte/reactivity';
	import { fly } from 'svelte/transition';
	import BellRing from '@lucide/svelte/icons/bell-ring';
	import X from '@lucide/svelte/icons/x';
	import { orderNotifications } from '$lib/stores/orderNotificationState.svelte';
	import { swipeDismiss } from '$lib/utils/swipeDismiss';

	// Halaman memakai sidebar (md+): tengahkan kartu di area konten, bukan di seluruh layar.
	let { withNav }: { withNav: boolean } = $props();

	const SWIPE_UP_DISTANCE = 40;
	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');

	// Menutup (geser atau tombol X) hanya menyembunyikan banner: pesanan tetap belum terlihat dan
	// bunyi tetap berulang sampai Antrean dibuka. Banner muncul lagi saat ada pesanan baru.
	let dismissedCount = $state(0);
	let dragging = $state(false);
	// Dipertahankan sampai animasi keluar selesai (onoutroend) agar banner tidak melompat balik.
	let dragY = $state(0);

	$effect(() => {
		if (orderNotifications.unseenCount < dismissedCount)
			dismissedCount = orderNotifications.unseenCount;
	});

	function dismiss() {
		dismissedCount = orderNotifications.unseenCount;
	}
</script>

{#if orderNotifications.unseenCount > dismissedCount}
	<!--
		Melayang di atas halaman (bukan di alur dokumen) supaya tidak mendorong header turun dan
		meninggalkan pita putih di atasnya. Pembungkus tak menangkap klik; hanya kartunya.
	-->
	<div
		class="z-sheet pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] px-3 {withNav
			? 'md:left-(--app-nav-width)'
			: ''}"
	>
		<aside
			transition:fly={{ y: -24, duration: reducedMotion.current ? 0 : 200 }}
			onoutroend={() => (dragY = 0)}
			aria-label="Notifikasi pesanan baru"
			aria-live="polite"
			class="pointer-events-auto relative mx-auto flex max-w-xl touch-none flex-col gap-3 rounded-2xl border border-pink-100 bg-white p-3 shadow-[0_16px_40px_-8px_rgba(219,39,119,0.22),0_6px_20px_rgba(0,0,0,0.08)] select-none sm:flex-row sm:items-center sm:gap-4 {dragging
				? ''
				: 'transition-transform duration-200 motion-reduce:transition-none'}"
			style:transform={dragY ? `translateY(${dragY}px)` : undefined}
			use:swipeDismiss={{
				thresholds: { up: SWIPE_UP_DISTANCE },
				onStart: () => {
					dragging = true;
					dragY = 0;
				},
				onDrag: (_deltaX, deltaY) => (dragY = Math.min(0, deltaY)),
				onEnd: (direction) => {
					dragging = false;
					if (direction) dismiss();
					else dragY = 0;
				}
			}}
		>
			<button
				type="button"
				onclick={dismiss}
				aria-label="Tutup notifikasi"
				class="absolute -top-2 -right-2 flex h-8 w-8 items-center justify-center rounded-full border border-pink-100 bg-white text-slate-500 shadow-sm hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98]"
			>
				<X class="h-4 w-4" />
			</button>
			<div class="flex min-w-0 flex-1 items-center gap-3">
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-600 via-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
					aria-hidden="true"
				>
					<BellRing class="h-5 w-5" />
				</span>
				<div class="min-w-0">
					<p class="text-sm font-extrabold text-slate-900">Pesanan baru masuk</p>
					<p class="mt-0.5 text-xs leading-snug text-slate-600">
						Membuka Antrean tidak menandai pesanan selesai.
					</p>
					{#if orderNotifications.soundEnabled && !orderNotifications.audioReady}
						<p class="mt-0.5 text-xs leading-snug text-slate-500">
							Suara belum siap: browser memerlukan interaksi Anda.
						</p>
					{/if}
				</div>
			</div>
			<div class="flex gap-2 sm:shrink-0">
				{#if orderNotifications.soundEnabled && !orderNotifications.audioReady}
					<button
						type="button"
						onclick={() => orderNotifications.testSound()}
						class="btn-brand-secondary flex-1 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:flex-none"
						>Aktifkan suara</button
					>
				{/if}
				<a
					href="/antrean"
					class="btn-brand-primary flex-1 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:flex-none"
					>Buka Antrean</a
				>
			</div>
		</aside>
	</div>
{/if}
