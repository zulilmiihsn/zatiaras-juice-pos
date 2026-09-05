<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import type { NotifModalType } from '$lib/types';

	let {
		show,
		message,
		title,
		buttonText = 'Mengerti',
		type = 'warning',
		onClose
	}: {
		show: boolean;
		message: string;
		title?: string;
		buttonText?: string;
		type?: NotifModalType;
		onClose: () => void;
	} = $props();

	const defaultTitle = $derived(
		title || (type === 'error' ? 'Perhatian' : type === 'success' ? 'Berhasil' : 'Peringatan')
	);
</script>

{#if show}
	<div
		class="z-alert fixed inset-0 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs"
		transition:fade={{ duration: 180 }}
		onclick={(event) => event.target === event.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="dialog"
		aria-modal="true"
		aria-label={defaultTitle}
		tabindex="-1"
	>
		<div
			class="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-[28px] border border-slate-100/90 bg-white p-6 text-center shadow-2xl ring-1 ring-slate-900/5 sm:p-7"
			transition:scale={{ start: 0.94, duration: 220, easing: cubicOut }}
			role="document"
		>
			<!-- Icon Badge -->
			<div
				class="mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl shadow-2xs ring-1 {type ===
				'warning'
					? 'bg-amber-50 text-amber-600 ring-amber-200/70'
					: type === 'error'
						? 'bg-rose-50 text-rose-600 ring-rose-200/70'
						: 'bg-emerald-50 text-emerald-600 ring-emerald-200/70'}"
			>
				{#if type === 'warning'}
					<AlertTriangle class="h-7 w-7 stroke-[2.2]" />
				{:else if type === 'error'}
					<AlertCircle class="h-7 w-7 stroke-[2.2]" />
				{:else}
					<CheckCircle2 class="h-7 w-7 stroke-[2.2]" />
				{/if}
			</div>

			<!-- Title -->
			<h3 class="mb-2 text-lg font-black tracking-tight text-slate-900">
				{defaultTitle}
			</h3>

			<!-- Message Body -->
			<p class="mb-6 text-xs leading-relaxed font-medium text-slate-600 sm:text-sm">
				{message}
			</p>

			<!-- Action Button -->
			<button
				type="button"
				class="w-full cursor-pointer rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3 text-sm font-extrabold text-white shadow-md shadow-pink-500/20 transition-all hover:brightness-105 active:scale-[0.98]"
				onclick={onClose}
			>
				{buttonText}
			</button>
		</div>
	</div>
{/if}
