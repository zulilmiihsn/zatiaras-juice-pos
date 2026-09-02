<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import X from '@lucide/svelte/icons/x';

	interface ModalSheetProps {
		open?: boolean;
		title?: string;
		showCloseButton?: boolean;
		onClose?: () => void;
		children?: Snippet;
		footer?: Snippet;
		header?: Snippet;
	}

	let {
		open = $bindable(false),
		title = '',
		showCloseButton = false,
		onClose,
		children,
		footer,
		header
	}: ModalSheetProps = $props();

	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) {
					node.parentNode.removeChild(node);
				}
			}
		};
	}

	function close() {
		onClose?.();
	}

	// [CATATAN]: Gesture swipe-down untuk menutup bottom sheet pada perangkat sentuh
	let startY = 0;
	let currentY = 0;
	let sheet: HTMLDivElement | undefined = $state();
	let dragging = false;
	let allowDrag = false;

	function onTouchStart(e: TouchEvent) {
		const target = e.target as HTMLElement;
		if (
			target.classList.contains('sheet-dragbar') ||
			target.classList.contains('sheet-header') ||
			target.closest('.sheet-drag-area')
		) {
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
		use:portal
		class="modal-backdrop"
		transition:fade={{ duration: 220 }}
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
			transition:fly={{ y: 380, duration: 280, easing: cubicOut }}
			role="document"
			bind:this={sheet}
			ontouchstart={onTouchStart}
			ontouchmove={onTouchMove}
			ontouchend={onTouchEnd}
			tabindex="-1"
		>
			<div
				class="sheet-drag-area flex w-full cursor-grab justify-center pt-1 pb-1 active:cursor-grabbing"
			>
				<div class="sheet-dragbar" role="presentation"></div>
			</div>

			{#if header}
				{@render header()}
			{:else if title}
				<div
					class="sheet-header flex items-center justify-between border-b border-slate-100/80 px-5 pt-1 pb-3"
					id="modal-title"
				>
					<span class="truncate text-base font-extrabold text-slate-800">{title}</span>
					{#if showCloseButton}
						<button
							type="button"
							onclick={close}
							aria-label="Tutup modal"
							class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all hover:bg-slate-200 hover:text-slate-800 active:scale-90"
						>
							<X class="h-4 w-4 stroke-[2.2]" />
						</button>
					{/if}
				</div>
			{/if}

			<div class="sheet-content min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
				{@render children?.()}
			</div>

			{#if footer}
				<div
					class="sheet-footer z-20 w-full max-w-[100vw] shrink-0 border-t border-slate-100 bg-white/98 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md sm:px-6"
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
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		width: 100vw;
		height: 100dvh;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 99999;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.modal-sheet {
		position: relative;
		width: 100%;
		max-width: 480px;
		margin: 0 auto;
		background: #ffffff;
		border-radius: 28px 28px 0 0;
		box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.16);
		min-height: 120px;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		height: auto;
		overflow: hidden;
	}
	@media (min-width: 768px) {
		.modal-sheet {
			max-width: 620px;
			max-height: 85vh;
			border-radius: 28px 28px 0 0;
		}
	}
	.sheet-dragbar {
		width: 44px;
		height: 5px;
		border-radius: 9999px;
		background: #cbd5e1;
		margin: 4px auto 8px;
		transition: background 0.15s ease;
	}
	.sheet-dragbar:hover {
		background: #94a3b8;
	}
	.sheet-content {
		padding-top: 6px;
		padding-bottom: 12px;
		-webkit-overflow-scrolling: touch;
	}
</style>
