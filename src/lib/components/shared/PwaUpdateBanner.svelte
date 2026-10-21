<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CircleArrowUp from '@lucide/svelte/icons/circle-arrow-up';

	interface Props {
		available: boolean;
		/** Pembaruan sudah terpasang; tinggal memuat ulang. Banner tidak bisa ditunda lagi. */
		reloadRequired: boolean;
		updating: boolean;
		/** Pembaruan macet; tawarkan muat ulang untuk mencoba lagi. */
		delayed: boolean;
		/** Halaman memakai sidebar (md+): tengahkan kartu di area konten, bukan di seluruh layar. */
		withNav: boolean;
		onUpdate: () => void;
	}

	let { available, reloadRequired, updating, delayed, withNav, onUpdate }: Props = $props();

	let dismissed = $state(false);

	const title = $derived(
		delayed
			? 'Pembaruan belum selesai'
			: reloadRequired
				? 'Aplikasi sudah diperbarui'
				: 'Versi baru siap dipakai'
	);
	const description = $derived(
		delayed
			? 'Aplikasi tetap bisa dipakai. Muat ulang saat pesanan selesai untuk mencoba lagi.'
			: reloadRequired
				? 'Muat ulang untuk memakai versi terbaru.'
				: 'Selesaikan pesanan yang sedang dibuat, lalu perbarui.'
	);
	const actionLabel = $derived(
		updating ? 'Memperbarui…' : reloadRequired || delayed ? 'Muat ulang' : 'Perbarui'
	);
</script>

{#if available && (reloadRequired || !dismissed)}
	<!--
		Melayang di atas halaman (bukan di alur dokumen) supaya tidak mendorong header turun dan
		meninggalkan pita putih di atasnya. Pembungkus tak menangkap klik; hanya kartunya.
	-->
	<div
		class="z-sheet pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] px-3 {withNav
			? 'md:left-(--app-nav-width)'
			: ''}"
	>
		<section
			class="animate-fade-in pointer-events-auto mx-auto flex max-w-xl flex-col gap-3 rounded-2xl border border-pink-100 bg-white p-3 shadow-[0_16px_40px_-8px_rgba(219,39,119,0.22),0_6px_20px_rgba(0,0,0,0.08)] sm:flex-row sm:items-center sm:gap-4"
			aria-label="Pembaruan aplikasi"
			aria-busy={updating}
			data-testid="pwa-update-banner"
		>
			<div class="flex min-w-0 flex-1 items-center gap-3">
				<span
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-600 via-pink-500 to-rose-500 text-white shadow-md shadow-pink-500/25"
					aria-hidden="true"
				>
					{#if updating}
						<RefreshCw class="h-5 w-5 motion-safe:animate-spin" />
					{:else}
						<CircleArrowUp class="h-5.5 w-5.5" />
					{/if}
				</span>
				<div class="min-w-0" role="status">
					<p class="text-sm font-extrabold text-stone-900">{title}</p>
					<p class="mt-0.5 text-xs leading-snug text-stone-600">{description}</p>
				</div>
			</div>
			<div class="flex gap-2 sm:shrink-0">
				{#if !reloadRequired && !updating}
					<button
						type="button"
						onclick={() => (dismissed = true)}
						class="btn-brand-secondary flex-1 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:flex-none"
					>
						Nanti
					</button>
				{/if}
				<button
					type="button"
					onclick={onUpdate}
					disabled={updating}
					class="btn-brand-primary flex-1 focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] sm:flex-none"
				>
					{actionLabel}
				</button>
			</div>
		</section>
	</div>
{/if}
