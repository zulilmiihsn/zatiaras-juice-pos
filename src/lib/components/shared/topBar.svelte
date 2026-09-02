<script lang="ts">
	import Settings from '@lucide/svelte/icons/settings';
	import type { Snippet } from 'svelte';
	import TopBarStatus from './topBarStatus.svelte';
	import TopBarAiAssistant from './topBarAiAssistant.svelte';
	let {
		children,
		actions,
		download,
		showSettings = true,
		pendingCount = 0,
		pendingFailedCount = 0,
		isOffline = false,
		onOpenPending,
		onAiRecommendationsApplied
	}: {
		children?: Snippet;
		actions?: Snippet;
		download?: Snippet;
		showSettings?: boolean;
		pendingCount?: number;
		pendingFailedCount?: number;
		isOffline?: boolean;
		onOpenPending?: () => void;
		onAiRecommendationsApplied?: (detail: unknown) => void;
	} = $props();
</script>

<div
	class="nav-transition z-10 flex items-center justify-between border-b border-white/80 bg-[#eef7fc]/95 px-4 pt-3 pb-2.5 backdrop-blur-md"
>
	<div class="flex items-center gap-2.5">
		<TopBarAiAssistant onRecommendationsApplied={onAiRecommendationsApplied} />
		<TopBarStatus {pendingCount} {pendingFailedCount} {isOffline} {onOpenPending} />
	</div>
	<div class="flex-1 text-center text-sm font-extrabold tracking-wide text-slate-800">
		{@render children?.()}
	</div>
	<div class="flex items-center gap-2">
		<!-- Slot untuk actions -->
		{@render actions?.()}

		{#if showSettings}
			<a
				href="/pengaturan"
				aria-label="Pengaturan"
				class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-200/90 bg-white text-slate-600 shadow-xs transition-all duration-150 hover:border-sky-300 hover:text-sky-600 active:scale-95"
			>
				<Settings size={18} />
			</a>
		{:else}
			<div class="h-9 w-9"></div>
		{/if}

		<!-- Slot untuk download -->
		{@render download?.()}
	</div>
</div>
