<script lang="ts">
	import { orderNotifications } from '$lib/stores/orderNotificationState.svelte';
</script>

{#if orderNotifications.unseenCount > 0}
	<aside
		aria-label="Notifikasi pesanan baru"
		aria-live="polite"
		class="sticky top-0 z-50 mx-3 flex max-w-xl flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-stone-900 shadow-lg md:mx-auto"
	>
		<div class="min-w-0 flex-1">
			<p class="font-bold">Pesanan baru masuk</p>
			<p class="text-sm">
				Buka Antrean untuk melihat pesanan. Membuka halaman tidak menandai pesanan selesai.
			</p>
			{#if orderNotifications.soundEnabled && !orderNotifications.audioReady}
				<p class="mt-1 text-sm">Suara belum siap: browser memerlukan interaksi Anda.</p>
			{/if}
		</div>
		<a
			href="/antrean"
			class="flex min-h-11 items-center rounded-xl bg-amber-900 px-4 font-semibold text-white"
			>Buka Antrean</a
		>
		{#if orderNotifications.soundEnabled && !orderNotifications.audioReady}
			<button
				onclick={() => orderNotifications.testSound()}
				class="min-h-11 rounded-xl border border-amber-700 px-4 font-semibold"
				>Aktifkan suara</button
			>
		{/if}
	</aside>
{/if}
