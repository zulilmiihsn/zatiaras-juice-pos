<script lang="ts">
	import AiChatModal from './aiChatModal.svelte';
	import { refreshBus } from '$lib/utils/refreshBus';

	let {
		onRecommendationsApplied
	}: {
		onRecommendationsApplied?: (detail: unknown) => void;
	} = $props();

	let showAiChat = $state(false);

	function closeAiChat() {
		showAiChat = false;
		refreshBus.emit('laporan');
		refreshBus.emit('riwayat');
	}

	function handleRecommendationsApplied(detail: unknown) {
		onRecommendationsApplied?.(detail);
		window.dispatchEvent(new CustomEvent('ai-recommendations-applied', { detail }));
	}
</script>

<button
	onclick={() => (showAiChat = true)}
	class="h-[38px] w-[38px] cursor-pointer rounded-lg bg-white object-contain p-1.5 shadow-lg shadow-pink-500/7 transition-all duration-150 hover:shadow-xl hover:shadow-pink-500/12 active:scale-[0.98]"
	aria-label="Buka AI Assistant"
>
	<img src="/img/logo.svg" alt="Logo Zatiaras - Klik untuk AI Assistant" class="h-full w-full" />
</button>

<AiChatModal
	bind:isOpen={showAiChat}
	onClose={closeAiChat}
	onRecommendationsApplied={handleRecommendationsApplied}
/>
