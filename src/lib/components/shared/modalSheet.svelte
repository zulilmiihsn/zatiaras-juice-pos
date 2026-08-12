<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		onClose,
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		onClose?: () => void;
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	function close() {
		onClose?.();
	}

	// Optional: close modal dengan swipe ke bawah (mobile UX)
	let startY = 0;
	let currentY = 0;
	let sheet: HTMLDivElement | undefined = $state();
	let dragging = false;
	let allowDrag = false;

	function onTouchStart(e: TouchEvent) {
		// Cek apakah gesture dimulai dari dragbar/header SAJA
		const target = e.target as HTMLElement;
		if (target.classList.contains('sheet-dragbar') || target.classList.contains('sheet-header')) {
			allowDrag = true;
		} else {
			allowDrag = false;
		}
		if (allowDrag) {
			dragging = true;
			startY = e.touches[0].clientY;
		}
	}
	function onTouchMove(e: TouchEvent) {
		if (!dragging || !allowDrag) return;
		currentY = e.touches[0].clientY;
		const diff = currentY - startY;
		if (diff > 0 && sheet) {
			sheet.style.transform = `translateY(${diff}px)`;
		}
	}
	function onTouchEnd() {
		if (!allowDrag) return;
		dragging = false;
		// Pastikan swipe-to-close hanya saat swipe ke bawah (drag turun)
		if (currentY - startY > 80) {
			close();
		} else if (sheet) {
			sheet.style.transform = '';
		}
		allowDrag = false;
	}
</script>

{#if open}
	<div
		class="modal-backdrop"
		onclick={(e) => e.target === e.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="modal-title"
		aria-label="Modal sheet"
		onkeyup={(e) => e.key === 'Enter' && close()}
		tabindex="-1"
		onkeypress={(e) => e.key === 'Enter' && close()}
	>
		<div
			class="modal-sheet w-full max-w-[100vw] overflow-x-hidden px-0 pt-2 pb-0 sm:px-0"
			style="max-width:100vw;"
			role="document"
			bind:this={sheet}
			ontouchstart={onTouchStart}
			ontouchmove={onTouchMove}
			ontouchend={onTouchEnd}
			tabindex="-1"
		>
			<div class="sheet-dragbar" role="presentation"></div>
			<div class="sheet-header" id="modal-title">{title}</div>
			<div class="sheet-content min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
				{@render children?.()}
			</div>
			{#if footer}
				<div
					class="sheet-footer z-20 w-full max-w-[100vw] shrink-0 bg-white px-4 pt-3 pb-4 shadow-[0_-2px_16px_rgba(0,0,0,0.08)] sm:px-6"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.18);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		transition: background 0.2s;
	}
	.modal-sheet {
		position: relative;
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		background: #fff;
		border-radius: 18px 18px 0 0;
		box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.08);
		min-height: 120px;
		animation: slideUp 0.22s cubic-bezier(0.4, 1.4, 0.6, 1) 1;
		will-change: transform;
		max-height: 92vh;
		display: flex;
		flex-direction: column;
		height: 92vh;
	}
	@media (min-width: 768px) {
		.modal-sheet {
			max-width: 700px;
			height: 90vh;
			max-height: 90vh;
		}
	}
	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	.sheet-header {
		padding: 1.1rem 1.2rem 0.5rem 1.2rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: #333;
		text-align: center;
		position: relative;
	}

	.sheet-dragbar {
		width: 38px;
		height: 5px;
		background: #e0e0e0;
		border-radius: 3px;
		margin: 0.5rem auto 0.7rem auto;
	}
	.sheet-content {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		padding-bottom: 1rem;
		scrollbar-width: none !important;
		-ms-overflow-style: none !important;
	}
	.sheet-content::-webkit-scrollbar {
		display: none !important;
		width: 0 !important;
		height: 0 !important;
		background: transparent !important;
	}
</style>
