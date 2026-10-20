<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Judul halaman (h1). Tanpa judul, isi header sepenuhnya dari children. */
		title?: string;
		subtitle?: string;
		/** Baris kecil di bawah subjudul, mis. status data offline. */
		note?: string;
		/**
		 * standard: judul + satu baris kontrol, tinggi sama di semua halaman utama.
		 * compact: satu baris kontrol selebar kolom, tinggi mengikuti isi (Kasir).
		 */
		variant?: 'standard' | 'compact';
		children: Snippet;
	}

	let { title, subtitle, note, variant = 'standard', children }: Props = $props();
</script>

<div
	class="page-header relative px-5 pt-4 pb-12 md:pt-6 md:pb-14"
	class:page-header--standard={variant === 'standard'}
>
	<!-- Ambient background blur shapes -->
	<div
		class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
	></div>
	<div
		class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
	></div>

	<div
		class="relative z-10 flex w-full flex-1 flex-col {variant === 'standard'
			? 'mx-auto max-w-5xl'
			: ''}"
	>
		{#if title}
			<div class="mb-3 text-center md:mb-4">
				<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs md:text-xl">
					{title}
				</h1>
				{#if subtitle}
					<p class="text-xs font-medium text-white/85 md:text-sm">{subtitle}</p>
				{/if}
				{#if note}
					<p class="text-[11px] font-medium text-white/75">{note}</p>
				{/if}
			</div>
		{/if}

		<!-- Kontrol dipusatkan vertikal di sisa tinggi, jadi sejajar antar halaman walau tingginya beda -->
		<div class="flex flex-1 flex-col justify-center">
			{@render children()}
		</div>
	</div>
</div>
