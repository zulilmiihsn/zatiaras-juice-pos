<script lang="ts">
	import type { Snippet } from 'svelte';

	interface HeaderBackButtonProps {
		href?: string;
		label?: string;
		onclick?: () => void;
		children?: Snippet;
	}

	let { href, label = 'Kembali', onclick, children }: HeaderBackButtonProps = $props();

	const buttonClass =
		'flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95';
</script>

{#if href}
	<a {href} class={buttonClass} aria-label={label}>
		{@render children?.()}
	</a>
{:else}
	<button type="button" class={buttonClass} aria-label={label} {onclick}>
		{@render children?.()}
	</button>
{/if}
