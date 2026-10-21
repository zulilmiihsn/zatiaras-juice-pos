<script lang="ts">
	let { class: className = 'h-5 w-5' }: { class?: string } = $props();
</script>

<svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
	<path
		stroke-linecap="round"
		stroke-linejoin="round"
		stroke-width="2"
		d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
	/>
</svg>
