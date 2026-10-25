<script lang="ts">
	import type { Snippet } from 'svelte';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import DialogRoot from './DialogRoot.svelte';

	interface AppModalProps {
		open?: boolean;
		labelledby?: string;
		label?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'custom';
		align?: 'center' | 'bottom';
		zClass?: string;
		panelClass?: string;
		backdropClass?: string;
		backdropClose?: boolean;
		onClose?: () => void;
		children?: Snippet;
	}

	const PANEL_SIZES = {
		xs: 'max-w-xs',
		sm: 'max-w-md',
		md: 'max-w-lg',
		lg: 'max-w-3xl',
		custom: ''
	} as const;

	let {
		open = false,
		labelledby,
		label,
		size = 'md',
		align = 'bottom',
		zClass = 'z-modal',
		panelClass = '',
		backdropClass = 'bg-slate-900/50 p-4 backdrop-blur-[2px]',
		backdropClose = true,
		onClose,
		children
	}: AppModalProps = $props();

	function close() {
		onClose?.();
	}
</script>

<DialogRoot
	{open}
	{label}
	{labelledby}
	{backdropClose}
	onClose={close}
	class="{zClass} {align === 'center'
		? 'items-center'
		: 'items-end sm:items-center'} justify-center {backdropClass}"
>
	<div
		class="flex w-full flex-col overflow-hidden {size === 'custom'
			? ''
			: `max-h-[92dvh] ${PANEL_SIZES[size]} rounded-[28px] shadow-2xl`} {panelClass}"
		transition:scale|global={{ duration: 220, start: 0.95, easing: cubicOut }}
	>
		{@render children?.()}
	</div>
</DialogRoot>
