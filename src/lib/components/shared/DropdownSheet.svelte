<script lang="ts">
	import ModalSheet from './ModalSheet.svelte';

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

<ModalSheet {open} onClose={close} label="Modal pilih opsi">
	{#snippet header()}
		<div class="px-6 pt-3 pb-4 text-center text-lg font-bold text-pink-600">Pilih Opsi</div>
	{/snippet}
	<div class="dropdown-list">
		{#each options as opt (opt.value)}
			<button
				type="button"
				class="dropdown-item {selected === opt.value ? 'active' : ''}"
				onclick={() => selectOption(opt.value)}>{opt.label}</button
			>
		{/each}
	</div>
</ModalSheet>

<style>
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
