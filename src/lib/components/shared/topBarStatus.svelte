<script lang="ts">
	import WifiOff from '@lucide/svelte/icons/wifi-off';
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';

	let {
		pendingCount = 0,
		pendingFailedCount = 0,
		isOffline = false,
		onOpenPending
	}: {
		pendingCount?: number;
		pendingFailedCount?: number;
		isOffline?: boolean;
		onOpenPending?: () => void;
	} = $props();
</script>

{#if isOffline}
	<span
		class="status-enter ml-2 flex min-w-[70px] items-center gap-1 rounded-full border border-pink-200 bg-pink-100 px-2.5 py-1.5 text-xs font-semibold text-pink-600 shadow-sm"
	>
		<WifiOff class="h-4 w-4 text-pink-400" />
		<span class="tracking-wide">Offline</span>
	</span>
{/if}

{#if pendingCount > 0}
	<button
		type="button"
		class="flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border-2 border-white px-1.5 text-xs font-bold text-white shadow transition-transform duration-200 active:scale-[0.98] {pendingFailedCount >
		0
			? 'bg-red-500'
			: 'bg-amber-500'}"
		onclick={onOpenPending}
		aria-label="Buka {pendingCount} transaksi belum tersinkron"
		data-testid="topbar-pending-count"
	>
		{#if pendingFailedCount > 0}
			<AlertTriangle class="h-3.5 w-3.5" />
		{/if}
		<span>{pendingCount}</span>
	</button>
{/if}

<style>
	.status-enter {
		animation: status-in 0.5s cubic-bezier(0.4, 1.4, 0.6, 1);
	}

	@keyframes status-in {
		from {
			transform: translateY(-8px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
</style>
