<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import { capitalizeFirst } from '$lib/utils/textFormat';
	import Plus from '@lucide/svelte/icons/plus';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';

	import type { PosPageState } from '$lib/stores/posPageState.svelte';

	let { s }: { s: PosPageState } = $props();
</script>

<ModalSheet
	bind:open={s.showModal}
	label={s.selectedProduct ? s.selectedProduct.nama : 'Pilihan Menu'}
	onClose={s.closeModal}
>
	{#snippet header()}
		<div class="border-b border-slate-100/90 px-5 pt-1 pb-3.5">
			<div class="min-w-0 flex-1">
				<h2 class="text-base leading-snug font-extrabold text-slate-900 sm:text-lg">
					{s.selectedProduct ? s.selectedProduct.nama : 'Pilihan Menu'}
				</h2>
				{#if s.selectedProduct}
					<div class="mt-1 flex items-center gap-2">
						<span
							class="bg-gradient-to-r from-pink-600 to-rose-500 bg-clip-text text-sm font-extrabold text-transparent sm:text-base"
						>
							Rp {formatRupiah(s.selectedProduct.harga)}
						</span>
						{#if s.selectedProduct.tipe}
							<span
								class="rounded-full border border-pink-100/80 bg-pink-50 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-pink-600 uppercase"
							>
								{s.selectedProduct.tipe}
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/snippet}

	<div class="addon-list addon-modal-content min-h-0 flex-1 space-y-4 overflow-y-auto py-3.5 pb-4">
		{#if s.selectedProduct && s.selectedProduct.tipe === 'minuman'}
			<!-- [CATATAN]: Ukuran Porsi -->
			<div>
				<div
					class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
					Pilihan Porsi
				</div>
				<div class="grid grid-cols-2 gap-2.5">
					<button
						class="flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-colors duration-150 sm:text-sm {s.selectedPorsi ===
						'reguler'
							? 'border-2 border-pink-500 bg-pink-500 text-white shadow-sm shadow-pink-500/25'
							: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
						type="button"
						onclick={() => (s.selectedPorsi = 'reguler')}
					>
						<span>Reguler</span>
						<span
							class="mt-0.5 text-[11px] font-semibold {s.selectedPorsi === 'reguler'
								? 'text-white/90'
								: 'text-slate-500'}"
						>
							Rp {formatRupiah(s.selectedProduct.harga || 0)}
						</span>
					</button>
					<button
						class="flex min-h-[52px] cursor-pointer flex-col items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-colors duration-150 sm:text-sm {s.selectedPorsi ===
						'jumbo'
							? 'border-2 border-pink-500 bg-pink-500 text-white shadow-sm shadow-pink-500/25'
							: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
						type="button"
						onclick={() => (s.selectedPorsi = 'jumbo')}
					>
						<span>Jumbo</span>
						<span
							class="mt-0.5 text-[11px] font-semibold {s.selectedPorsi === 'jumbo'
								? 'text-white/90'
								: 'text-slate-500'}"
						>
							Rp {formatRupiah(s.selectedProduct.harga_jumbo || s.selectedProduct.harga || 0)}
						</span>
					</button>
				</div>
			</div>

			<!-- [CATATAN]: Jenis Gula -->
			<div>
				<div
					class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
					Jenis Gula
				</div>
				<div class="grid grid-cols-3 gap-2.5">
					{#each s.sugarOptions as sugar}
						<button
							class="flex min-h-[46px] cursor-pointer items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-colors duration-150 sm:text-sm {s.selectedSugar ===
							sugar.id
								? 'border-2 border-pink-500 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/25'
								: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
							type="button"
							onclick={() => (s.selectedSugar = sugar.id)}>{sugar.label}</button
						>
					{/each}
				</div>
			</div>

			<!-- [CATATAN]: Jenis Es -->
			<div>
				<div
					class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
					Jenis Es
				</div>
				<div class="grid grid-cols-3 gap-2.5">
					{#each s.iceOptions as i}
						<button
							class="flex min-h-[46px] cursor-pointer items-center justify-center rounded-2xl px-3 py-2 text-xs font-bold transition-colors duration-150 sm:text-sm {s.selectedIce ===
							i.id
								? 'border-2 border-pink-500 bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-sm shadow-pink-500/25'
								: 'border border-slate-200/90 bg-slate-50/70 text-slate-700 shadow-2xs hover:border-pink-200 hover:bg-white hover:text-pink-600'}"
							type="button"
							onclick={() => (s.selectedIce = i.id)}>{i.label}</button
						>
					{/each}
				</div>
			</div>
		{/if}

		<!-- [CATATAN]: Tambahan (Ekstra) -->
		<div>
			<div
				class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
				Tambahan (Ekstra)
			</div>
			{#if s.selectedProduct && s.selectedProduct.ekstra_ids && s.selectedProduct.ekstra_ids.length > 0 && s.addOns.filter( (a) => s.selectedProduct?.ekstra_ids?.includes(a.id) ).length > 0}
				<div class="grid grid-cols-2 gap-2.5">
					{#each s.addOns.filter((a) => s.selectedProduct?.ekstra_ids?.includes(a.id)) as a (a.id)}
						<button
							class="flex min-h-[52px] w-full cursor-pointer items-center justify-between rounded-2xl p-2.5 text-left transition-colors duration-150 sm:p-3 {s.selectedAddOns.includes(
								a.id
							)
								? 'border-2 border-pink-500 bg-pink-50/70 shadow-xs'
								: 'border border-slate-200/90 bg-white shadow-2xs hover:border-pink-200 hover:bg-slate-50/50'}"
							type="button"
							onclick={() => s.toggleAddOn(a.id)}
						>
							<div class="min-w-0 flex-1 pr-1.5">
								<div
									class="truncate text-xs font-bold sm:text-sm {s.selectedAddOns.includes(a.id)
										? 'text-pink-900'
										: 'text-slate-800'}"
								>
									{a.nama}
								</div>
								<div
									class="mt-0.5 text-[11px] font-bold sm:text-xs {s.selectedAddOns.includes(a.id)
										? 'text-pink-600'
										: 'text-slate-500'}"
								>
									+Rp {formatRupiah(a.harga ?? 0)}
								</div>
							</div>
							<div
								class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors {s.selectedAddOns.includes(
									a.id
								)
									? 'bg-pink-500 text-white'
									: 'border border-slate-300 bg-white'}"
							>
								{#if s.selectedAddOns.includes(a.id)}
									<Check class="h-3 w-3 stroke-[3]" />
								{:else}
									<Plus class="h-3 w-3 text-slate-400" />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{:else}
				<div
					class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5 text-center text-xs font-medium text-slate-400"
				>
					Tidak ada pilihan ekstra untuk menu ini.
				</div>
			{/if}
		</div>

		<!-- [CATATAN]: Catatan -->
		<div>
			<div
				class="mb-2 flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-slate-500 uppercase"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-pink-500"></span>
				Catatan Pesanan
			</div>
			<div class="relative">
				<textarea
					class="w-full resize-none rounded-2xl border border-slate-200/90 bg-slate-50/60 p-3 text-sm text-slate-800 transition-all outline-none placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15"
					placeholder="Contoh: Manis sedang, es pisah..."
					bind:value={s.selectedNote}
					rows="2"
					maxlength="200"
					oninput={(e) => {
						s.selectedNote = capitalizeFirst((e.target as HTMLTextAreaElement).value);
					}}></textarea>
				<div class="mt-0.5 text-right text-[11px] font-medium text-slate-400">
					{s.selectedNote.length}/200
				</div>
			</div>
		</div>
	</div>

	{#snippet footer()}
		<div class="flex items-center gap-3">
			<!-- [CATATAN]: Stepper Quantity -->
			<div
				class="flex items-center rounded-full border border-slate-200/80 bg-slate-100/90 p-1 shadow-2xs"
			>
				<button
					type="button"
					class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
					onclick={s.decQty}
					aria-label="Kurangi jumlah"
				>
					<Minus class="h-4 w-4 stroke-[2.5]" />
				</button>
				<span class="w-8 text-center text-sm font-extrabold text-slate-800 select-none">
					{s.jumlah}
				</span>
				<button
					type="button"
					class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:text-pink-600 active:scale-90"
					onclick={s.incQty}
					aria-label="Tambah jumlah"
				>
					<Plus class="h-4 w-4 stroke-[2.5]" />
				</button>
			</div>

			<!-- [CATATAN]: Big CTA Add Button -->
			<button
				type="button"
				class="flex min-h-[48px] flex-1 cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-5 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98]"
				onclick={s.addToCart}
			>
				<span>Tambah</span>
				<span>Rp {formatRupiah(s.currentItemTotalPrice)}</span>
			</button>
		</div>
	{/snippet}
</ModalSheet>
