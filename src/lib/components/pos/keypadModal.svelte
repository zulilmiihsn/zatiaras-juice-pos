<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';

	export let open = false;
	export let cashReceived = '';
	export let formattedCashReceived = '';
	export let totalHarga = 0;
	export let kembalian = 0;
	export let cashTemplates: number[] = [5000, 10000, 20000, 50000, 100000];
	export let keypad: (number | string)[][] = [
		[1, 2, 3],
		[4, 5, 6],
		[7, 8, 9],
		['⌫', 0, 'C']
	];

	export let onAddCashTemplate: (t: number) => void;
	export let onKeypadButton: (key: number | string) => void;
	export let onFinishCash: () => void;
	export let onClose: () => void;
	export let onInputRaw: (raw: string) => void;
</script>

{#if open}
	<ModalSheet {open} title="Pembayaran Tunai" on:close={onClose}>
		<div class="px-2 py-4 md:px-6 md:py-8">
			<div class="mb-2 text-center text-sm font-semibold text-gray-500 md:mb-4 md:text-lg">
				Total Tagihan: <span class="text-pink-500">Rp {totalHarga.toLocaleString('id-ID')}</span>
			</div>
			<input
				type="text"
				inputmode="numeric"
				pattern="[0-9]*"
				class="mb-3 w-full rounded-lg border-2 border-pink-200 px-2 py-3 text-center text-xl font-bold outline-none focus:border-pink-400 md:mb-5 md:py-5 md:text-2xl"
				value={formattedCashReceived}
				oninput={(e) => {
					const target = e.target as HTMLInputElement;
					const raw = target.value.replace(/\D/g, '');
					onInputRaw(raw);
				}}
				placeholder="0"
			/>
			<div class="mb-4 flex flex-wrap justify-center gap-2 md:mb-6 md:gap-4">
				{#each cashTemplates as t}
					<button
						type="button"
						class="rounded-lg bg-pink-100 px-4 py-2 text-base font-bold text-pink-500 md:px-8 md:py-3 md:text-lg"
						onclick={() => onAddCashTemplate(t)}
					>
						Rp {t.toLocaleString('id-ID')}
					</button>
				{/each}
			</div>
			<div class="mx-auto grid w-full grid-cols-3 gap-2 md:gap-6">
				{#each keypad as row}
					{#each row as key}
						<button
							type="button"
							class="w-full rounded-xl bg-gray-100 py-3 text-xl font-bold text-gray-700 transition-all active:bg-pink-100 md:py-8 md:text-3xl {key ===
							'⌫'
								? 'col-span-1 text-pink-500'
								: ''} {key === 'C' ? 'text-red-500' : ''}"
							onclick={() => onKeypadButton(key)}>{key}</button
						>
					{/each}
				{/each}
			</div>
		</div>
		<div slot="footer" class="flex flex-col gap-2 md:gap-4">
			<div class="mb-2 text-center text-gray-700 md:mb-4 md:text-lg">
				Kembalian:
				<span class="font-bold {kembalian < 0 ? 'text-red-500' : 'text-green-500'}"
					>Rp {kembalian >= 0 ? kembalian.toLocaleString('id-ID') : '0'}</span
				>
			</div>
			<button
				class="w-full rounded-lg bg-pink-500 py-3 text-base font-bold text-white active:bg-pink-600 disabled:opacity-50 md:py-5 md:text-xl"
				onclick={onFinishCash}
				disabled={kembalian < 0 || !cashReceived}
			>
				Selesai
			</button>
		</div>
	</ModalSheet>
{/if}
