<script lang="ts">
	import { NOTIF } from '$lib/constants/ui';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { onDestroy } from 'svelte';

	interface ToastProps {
		show?: boolean;
		message?: string;
		type?: 'success' | 'error' | 'warning' | 'info';
		duration?: number;
		position?: 'top' | 'bottom';
		autoDismiss?: boolean;
		onDismiss?: () => void;
	}

	let {
		show = $bindable(false),
		message = '',
		type = 'success',
		duration = NOTIF.TOAST_MS,
		position = 'top',
		autoDismiss = true,
		onDismiss
	}: ToastProps = $props();

	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (show && autoDismiss && duration > 0) {
			if (timeoutId) clearTimeout(timeoutId);
			timeoutId = setTimeout(() => {
				show = false;
				if (onDismiss) onDismiss();
			}, duration);
		}
	});

	// [CATATAN]: Bersihkan timer saat komponen di-unmount
	onDestroy(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});

	function getBgColor(): string {
		switch (type) {
			case 'success':
				return 'bg-emerald-600 text-white';
			case 'error':
				return 'bg-rose-600 text-white';
			case 'warning':
				return 'bg-amber-500 text-white';
			case 'info':
				return 'bg-sky-600 text-white';
			default:
				return 'bg-emerald-600 text-white';
		}
	}

	function getBorderColor(): string {
		switch (type) {
			case 'success':
				return 'border-emerald-400/70 shadow-emerald-950/15';
			case 'error':
				return 'border-rose-400/70 shadow-rose-950/15';
			case 'warning':
				return 'border-amber-400/70 shadow-amber-950/15';
			case 'info':
				return 'border-sky-400/70 shadow-sky-950/15';
			default:
				return 'border-emerald-400/70 shadow-emerald-950/15';
		}
	}
</script>

{#if show}
	<div
		class="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 {position === 'top'
			? 'top-4 sm:top-5'
			: 'bottom-6 sm:bottom-8'}"
	>
		<div
			class="flex w-auto max-w-[70vw] items-center justify-center gap-2 rounded-full border px-3.5 py-1.5 text-center shadow-lg shadow-emerald-950/15 backdrop-blur-md select-none sm:max-w-xs {getBgColor()} {getBorderColor()}"
			in:fly={{ y: position === 'top' ? -20 : 20, duration: 240, easing: cubicOut }}
			out:fade={{ duration: 160 }}
			role="status"
			aria-live="polite"
		>
			<span class="flex shrink-0 items-center justify-center">
				{#if type === 'success'}
					<svg class="h-4 w-4 stroke-[2.8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				{:else if type === 'error'}
					<svg class="h-4 w-4 stroke-[2.8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				{:else if type === 'warning'}
					<svg class="h-4 w-4 stroke-[2.8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
						/>
					</svg>
				{:else if type === 'info'}
					<svg class="h-4 w-4 stroke-[2.8]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
				{/if}
			</span>
			<span class="truncate text-xs font-bold tracking-tight whitespace-nowrap text-white">
				{message}
			</span>
		</div>
	</div>
{/if}
