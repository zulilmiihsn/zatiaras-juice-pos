<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import type { CartItem } from '$lib/types/cart';
	import Minus from '@lucide/svelte/icons/minus';
	import Plus from '@lucide/svelte/icons/plus';

	let { show = $bindable(false), onAdd } = $props<{
		show: boolean;
		onAdd: (item: CartItem) => void;
	}>();

	let customItemName = $state('');
	let customItemPriceRaw = $state('');
	let customItemPriceFormatted = $state('');
	let customItemNote = $state('');
	let jumlah = $state(1);

	let totalPrice = $derived((Number(customItemPriceRaw) || 0) * jumlah);

	function handleCustomPriceInput(e: Event): void {
		const target = e.target as HTMLInputElement;
		const raw = target.value.replace(/[^\d]/g, '');
		customItemPriceRaw = raw;
		customItemPriceFormatted = formatRupiah(raw);
	}

	function decQty() {
		if (jumlah > 1) jumlah--;
	}
	function incQty() {
		if (jumlah < 99) jumlah++;
	}

	function handleAdd(e?: Event) {
		if (e) e.preventDefault();
		if (
			!customItemName.trim() ||
			!customItemPriceRaw ||
			isNaN(Number(customItemPriceRaw)) ||
			Number(customItemPriceRaw) <= 0
		)
			return;
		onAdd({
			product: {
				id: `custom-${Date.now()}`,
				nama: customItemName.trim(),
				harga: Number(customItemPriceRaw),
				tipe: 'custom'
			},
			addOns: [],
			gula: '',
			es: '',
			jumlah: jumlah,
			catatan: customItemNote.trim()
		});
		show = false;
		// Reset
		customItemName = '';
		customItemPriceRaw = '';
		customItemPriceFormatted = '';
		customItemNote = '';
		jumlah = 1;
	}

	function handleStopPropagation(e: Event): void {
		e.stopPropagation();
	}
</script>

{#if show}
	<ModalSheet
		bind:open={show}
		title={customItemName.trim() || 'Menu Kustom Baru'}
		onClose={() => (show = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="addon-list addon-modal-content min-h-0 flex-1 space-y-4 overflow-y-auto py-3 pb-6"
			onclick={handleStopPropagation}
		>
			<div>
				<label
					class="mb-1.5 block text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					for="custom-nama"
				>
					Nama Menu
				</label>
				<input
					id="custom-nama"
					class="min-h-[46px] w-full rounded-2xl border border-slate-200/90 bg-slate-50/60 px-3.5 py-2.5 text-sm font-bold text-slate-800 transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
					type="text"
					bind:value={customItemName}
					required
					maxlength="50"
					placeholder="Contoh: Jus Mangga Spesial"
				/>
			</div>

			<div>
				<label
					class="mb-1.5 block text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					for="custom-harga"
				>
					Harga Satuan
				</label>
				<div class="relative">
					<span class="absolute top-1/2 left-3.5 -translate-y-1/2 text-sm font-bold text-slate-400">
						Rp
					</span>
					<input
						id="custom-harga"
						class="min-h-[46px] w-full rounded-2xl border border-slate-200/90 bg-slate-50/60 py-2.5 pr-3.5 pl-10 text-sm font-bold text-slate-800 transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
						type="text"
						inputmode="numeric"
						pattern="[0-9]*"
						min="1"
						max="99999999"
						value={customItemPriceFormatted}
						oninput={handleCustomPriceInput}
						required
						placeholder="0"
					/>
				</div>
			</div>

			<div>
				<label
					class="mb-1.5 block text-xs font-extrabold tracking-wider text-slate-500 uppercase"
					for="custom-catatan"
				>
					Catatan Tambahan
				</label>
				<textarea
					id="custom-catatan"
					class="w-full resize-none rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
					bind:value={customItemNote}
					maxlength="100"
					rows="2"
					placeholder="Contoh: Tanpa gula, es sedikit..."></textarea>
			</div>
		</div>

		{#snippet footer()}
			<div class="flex items-center gap-3">
				<!-- Stepper Quantity -->
				<div
					class="flex items-center rounded-full border border-slate-200/80 bg-slate-100/90 p-1 shadow-2xs"
				>
					<button
						type="button"
						class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
						onclick={decQty}
						aria-label="Kurangi jumlah"
					>
						<Minus class="h-4 w-4 stroke-[2.5]" />
					</button>
					<span class="w-8 text-center text-sm font-extrabold text-slate-800 select-none">
						{jumlah}
					</span>
					<button
						type="button"
						class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
						onclick={incQty}
						aria-label="Tambah jumlah"
					>
						<Plus class="h-4 w-4 stroke-[2.5]" />
					</button>
				</div>

				<!-- Big CTA Add Button -->
				<button
					type="button"
					disabled={!customItemName.trim() ||
						!customItemPriceRaw ||
						Number(customItemPriceRaw) <= 0}
					class="flex min-h-[48px] flex-1 cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-5 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
					onclick={handleAdd}
				>
					<span>Tambah ke Pesanan</span>
					<span>Rp {formatRupiah(totalPrice)}</span>
				</button>
			</div>
		{/snippet}
	</ModalSheet>
{/if}
