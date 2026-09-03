<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	let {
		options = [],
		value = '',
		open = false,
		onClose,
		onSelect
	}: {
		options?: { value: string; label: string }[];
		value?: string;
		open?: boolean;
		onClose?: () => void;
		onSelect?: (value: string) => void;
	} = $props();

	let selected = $state('');

	$effect(() => {
		if (open) selected = value;
	});

	function close() {
		if (onClose) onClose();
	}
	function selectOption(optionValue: string) {
		if (onSelect) onSelect(optionValue);
		close();
	}
</script>

{#if open}
	<div
		class="modal-backdrop"
		transition:fade={{ duration: 180 }}
		onclick={(event) => event.target === event.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-label="Modal pilih opsi"
		tabindex="-1"
	>
		<div class="sheet" role="document" transition:fly={{ y: 240, duration: 220, easing: cubicOut }}>
			<div class="sheet-header">Pilih Opsi</div>
			<div class="dropdown-list">
				{#each options as opt (opt.value)}
					<button
						type="button"
						class="dropdown-item {selected === opt.value ? 'active' : ''}"
						onclick={() => selectOption(opt.value)}>{opt.label}</button
					>
				{/each}
			</div>
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
		background: rgba(15, 23, 42, 0.4);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}
	.sheet {
		width: 100%;
		max-width: 420px;
		margin: 0 auto;
		background: #fff;
		border-radius: 24px 24px 0 0;
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
		min-height: 120px;
		padding: 1.75rem 1.5rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sheet-header {
		font-size: 1.15rem;
		font-weight: 700;
		color: #db2777;
		text-align: center;
	}
	.dropdown-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.dropdown-item {
		width: 100%;
		background: #fff;
		color: #db2777;
		border: 1.5px solid #fce7f3;
		border-radius: 14px;
		padding: 0.8rem 1rem;
		font-size: 1rem;
		font-weight: 600;
		text-align: left;
		transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.dropdown-item.active,
	.dropdown-item:active,
	.dropdown-item:hover {
		background: #db2777;
		color: #fff;
		border-color: #db2777;
	}
</style>
