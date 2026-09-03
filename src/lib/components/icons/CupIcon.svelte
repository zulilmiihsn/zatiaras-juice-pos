<script lang="ts">
	interface Props {
		class?: string;
		size?: number | string;
		strokeWidth?: number | string;
	}

	let { class: className = 'h-6 w-6', size, strokeWidth = 2 }: Props = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	width={size}
	height={size}
>
	<!-- Bibir cup / rim atas -->
	<path d="M5 4h14" />
	<!-- Bodi cup lebih tinggi & ramping (tall cup) -->
	<path d="m6 4 1.6 16.2a2 2 0 0 0 2 1.8h4.8a2 2 0 0 0 2-1.8L18 4" />
	<!-- Gelombang isi minuman -->
	<path d="M6.8 12a5.8 5.8 0 0 1 5.2 0 5.8 5.8 0 0 0 5.2 0" />
</svg>
