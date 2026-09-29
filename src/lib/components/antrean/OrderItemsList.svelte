<script lang="ts">
	import type { UiOrderItem } from '$lib/utils/orderQueueLocal';
	import { formatLevelLabel } from '$lib/utils/orderDetails';

	interface Props {
		items: UiOrderItem[];
		/** 'kartu' = ringkas di kartu antrean; 'dialog' = lega di dialog detail. */
		varian?: 'kartu' | 'dialog';
	}

	let { items, varian = 'kartu' }: Props = $props();
	const padat = $derived(varian === 'kartu');

	function punyaMeta(item: UiOrderItem): boolean {
		return Boolean(
			formatLevelLabel('gula', item.gula) ||
			formatLevelLabel('es', item.es) ||
			item.tambahan.length > 0 ||
			item.catatan
		);
	}
</script>

<ul class="divide-y divide-slate-100 border-t border-slate-100 {padat ? 'mt-3' : 'mt-4'}">
	{#each items as item}
		<li class={padat ? 'py-2.5' : 'py-3'}>
			<div class="flex items-start justify-between gap-3">
				<span class="text-sm font-bold text-slate-800">
					{item.jumlah}× {item.nama}
				</span>
			</div>
			{#if punyaMeta(item)}
				<div class="mt-1 flex flex-wrap gap-1 {padat ? 'text-[11px]' : 'text-xs text-slate-600'}">
					{#if formatLevelLabel('gula', item.gula)}
						<span
							class={padat
								? 'rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600'
								: 'rounded-md bg-slate-100 px-2 py-1'}
						>
							{formatLevelLabel('gula', item.gula)}
						</span>
					{/if}
					{#if formatLevelLabel('es', item.es)}
						<span
							class={padat
								? 'rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600'
								: 'rounded-md bg-slate-100 px-2 py-1'}
						>
							{formatLevelLabel('es', item.es)}
						</span>
					{/if}
					{#each item.tambahan as extra}
						<span
							class={padat
								? 'rounded-md bg-pink-50 px-1.5 py-0.5 font-medium text-pink-700'
								: 'rounded-md bg-pink-50 px-2 py-1 text-pink-700'}
						>
							+{extra.nama}
						</span>
					{/each}
					{#if item.catatan}
						<span class="w-full italic {padat ? 'text-[11px] text-slate-400' : ''}">
							“{item.catatan}”
						</span>
					{/if}
				</div>
			{/if}
		</li>
	{/each}
</ul>
