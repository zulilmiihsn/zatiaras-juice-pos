<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	export type NotifModalType = 'warning' | 'success' | 'error';

	let {
		show,
		message,
		type = 'warning',
		onClose
	}: {
		show: boolean;
		message: string;
		type?: NotifModalType;
		onClose: () => void;
	} = $props();
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs"
		transition:fade={{ duration: 180 }}
		onclick={(event) => event.target === event.currentTarget && onClose()}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
		role="dialog"
		aria-modal="true"
		aria-label="Modal pemberitahuan"
		tabindex="-1"
	>
		<div
			class="flex w-full max-w-xs flex-col items-center rounded-3xl border-2 bg-white px-8 py-7 shadow-2xl"
			class:border-red-500={type === 'error'}
			class:border-yellow-400={type !== 'error'}
			transition:scale={{ start: 0.94, duration: 220, easing: cubicOut }}
			role="document"
		>
			<div
				class="mb-3 flex h-16 w-16 items-center justify-center rounded-full"
				class:bg-red-100={type === 'error'}
				class:bg-yellow-100={type !== 'error'}
			>
				{#if type === 'success'}
					<svg class="h-10 w-10 text-yellow-400" fill="none" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" fill="#fef9c3" />
						<path
							stroke="#facc15"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4"
						/>
					</svg>
				{:else if type === 'error'}
					<svg class="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" fill="#fee2e2" />
						<path stroke="#ef4444" stroke-linecap="round" stroke-width="2" d="M9 9l6 6m0-6-6 6" />
					</svg>
				{:else}
					<svg class="h-10 w-10 text-yellow-400" fill="none" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="10" fill="#fef9c3" />
						<path
							stroke="#facc15"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 8v4m0 4h.01"
						/>
					</svg>
				{/if}
			</div>
			<div class="mb-4 text-center text-base font-medium text-gray-700">{message}</div>
			<button
				type="button"
				class="mt-2 rounded-xl bg-pink-500 px-6 py-2 font-bold text-white shadow transition-all hover:bg-pink-600 active:scale-[0.98]"
				onclick={onClose}>Tutup</button
			>
		</div>
	</div>
{/if}
