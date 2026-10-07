<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { modalFocus } from '$lib/utils/modalFocus';

	interface AppModalProps {
		open?: boolean;
		labelledby?: string;
		label?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg';
		align?: 'center' | 'bottom';
		zClass?: string;
		panelClass?: string;
		backdropClose?: boolean;
		onClose?: () => void;
		children?: Snippet;
	}

	const PANEL_SIZES = {
		xs: 'max-w-xs',
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-3xl'
	} as const;

	let {
		open = false,
		labelledby,
		label,
		size = 'md',
		align = 'bottom',
		zClass = 'z-modal',
		panelClass = '',
		backdropClose = true,
		onClose,
		children
	}: AppModalProps = $props();

	function close() {
		onClose?.();
	}
</script>

{#if open}
	<div
		class="{zClass} fixed inset-0 {align === 'center'
			? 'items-center'
			: 'items-end sm:items-center'} flex justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
		role="presentation"
		transition:fade={{ duration: 180 }}
		onclick={(event) => {
			if (backdropClose && event.target === event.currentTarget) close();
		}}
		tabindex="-1"
	>
		<div
			use:modalFocus={{ onEscape: close }}
			role="dialog"
			aria-modal="true"
			aria-labelledby={labelledby}
			aria-label={labelledby ? undefined : label}
			class="flex max-h-[92dvh] w-full {PANEL_SIZES[
				size
			]} flex-col overflow-hidden rounded-[28px] shadow-2xl {panelClass}"
			transition:scale={{ duration: 220, start: 0.95, easing: cubicOut }}
		>
			{@render children?.()}
		</div>
	</div>
{/if}
