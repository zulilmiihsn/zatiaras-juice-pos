<script lang="ts">
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
		onclick={(event) => event.target === event.currentTarget && close()}
		onkeydown={(e) => e.key === 'Escape' && close()}
		role="dialog"
		aria-label="Modal pilih opsi"
		onkeyup={(e) => e.key === 'Enter' && close()}
		tabindex="-1"
		onkeypress={(e) => e.key === 'Enter' && close()}
	>
		<div class="sheet" role="document">
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
		background: rgba(0, 0, 0, 0.18);
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
		border-radius: 18px 18px 0 0;
		box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.08);
		min-height: 120px;
		padding: 2rem 1.5rem 1.5rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		animation: slideUp 0.22s cubic-bezier(0.4, 1.4, 0.6, 1) 1;
	}
	@keyframes slideUp {
		from {
			transform: translateY(100%);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	.sheet-header {
		font-size: 1.15rem;
		font-weight: 600;
		color: #ff5fa2;
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
		color: #ff5fa2;
		border: 1.5px solid #f3c6db;
		border-radius: 10px;
		padding: 0.8rem 1rem;
		font-size: 1.08rem;
		font-weight: 500;
		text-align: left;
		transition:
			background 0.18s,
			color 0.18s,
			border 0.18s;
	}
	.dropdown-item.active,
	.dropdown-item:active,
	.dropdown-item:hover {
		background: #ff5fa2;
		color: #fff;
		border-color: #ff5fa2;
	}
</style>
