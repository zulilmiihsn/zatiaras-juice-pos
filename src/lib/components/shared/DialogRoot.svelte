<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { modalFocus } from '$lib/utils/modalFocus';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onclick' | 'role'> & {
		open?: boolean;
		label?: string;
		labelledby?: string;
		backdropClose?: boolean;
		fadeDuration?: number;
		onClose?: () => void;
		children?: Snippet;
	};

	let {
		open = false,
		label,
		labelledby,
		backdropClose = true,
		fadeDuration = 180,
		onClose,
		class: className,
		children,
		...attributes
	}: Props = $props();

	function portal(node: HTMLElement) {
		// Header stacking/transform contexts can otherwise put page content above a fixed sheet.
		node.ownerDocument.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	function close() {
		onClose?.();
	}
</script>

{#if open}
	<!-- Klik latar hanya jalan pintas mouse; Escape ditangani use:modalFocus. -->
	<div
		{...attributes}
		use:portal
		use:modalFocus={{ onEscape: close }}
		class={['dialog-root', className]}
		role="dialog"
		aria-modal="true"
		aria-labelledby={labelledby}
		aria-label={labelledby ? undefined : label}
		tabindex="-1"
		onclick={(event) => {
			if (backdropClose && event.target === event.currentTarget) close();
		}}
		transition:fade={{ duration: fadeDuration, easing: cubicOut }}
	>
		{@render children?.()}
	</div>
{/if}

<style>
	.dialog-root {
		position: fixed;
		inset: 0;
		display: flex;
		overflow: hidden;
		overscroll-behavior: contain;
	}
</style>
