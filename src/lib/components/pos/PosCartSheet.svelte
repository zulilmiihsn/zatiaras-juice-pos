<script lang="ts">
	import ModalSheet from '$lib/components/shared/modalSheet.svelte';
	import { formatRupiah } from '$lib/utils/currency';
	import Plus from '@lucide/svelte/icons/plus';
	import Minus from '@lucide/svelte/icons/minus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	import type { PosPageState } from '$lib/stores/posPageState.svelte';

	let { s }: { s: PosPageState } = $props();
</script>

<ModalSheet bind:open={s.showCartModal} label="Keranjang Pesanan" onClose={s.closeCartModal}>
	{#snippet header()}
		<div class="flex items-center justify-between border-b border-pink-100/60 px-5 pt-1 pb-3.5">
			<div class="flex items-center gap-2">
				<h2 class="text-base font-black text-slate-900 sm:text-lg">Keranjang Pesanan</h2>
				{#if s.totalItems > 0}
					<span
						class="rounded-full bg-pink-50 px-2.5 py-0.5 text-[11px] font-black text-pink-600 ring-1 ring-pink-100/80"
					>
						{s.totalItems}
						{s.totalItems > 1 ? 'Items' : 'Item'}
					</span>
				{/if}
			</div>
			{#if s.cart.items.length > 0}
				<button
					type="button"
					class="flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-rose-100/90 bg-rose-50/80 px-2.5 text-xs font-bold text-rose-600 shadow-2xs transition-all select-none hover:border-rose-200 hover:bg-rose-100 hover:text-rose-700 active:scale-95"
					onclick={s.clearCart}
					aria-label="Kosongkan seluruh keranjang"
				>
					<Trash2 class="h-3 w-3 stroke-[2.4]" />
					<span>Kosongkan</span>
				</button>
			{/if}
		</div>
	{/snippet}

	<div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3.5">
		{#if s.cart.items.length === 0}
			<div
				class="flex flex-col items-center justify-center rounded-3xl border border-dashed border-pink-200/80 bg-pink-50/30 px-6 py-10 text-center"
			>
				<div
					class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-pink-100"
				>
					<ShoppingBag class="h-6 w-6 stroke-[2] text-pink-500" />
				</div>
				<div class="text-sm font-extrabold text-slate-800">Keranjang Masih Kosong</div>
				<div class="mt-1 text-xs text-slate-500">
					Pilih menu dari katalog untuk menambahkan pesanan.
				</div>
			</div>
		{:else}
			{#each s.cart.items as item, idx (s.cartItemKey(item))}
				{@const isJumbo = item.porsi === 'jumbo'}
				{@const basePrice = isJumbo
					? (item.product.harga_jumbo ?? item.product.harga ?? 0)
					: (item.product.harga ?? 0)}
				{@const itemUnitPrice =
					basePrice + (item.addOns || []).reduce((acc, a) => acc + (Number(a.harga) || 0), 0)}
				{@const itemTotalPrice = itemUnitPrice * item.jumlah}
				<div
					class="group flex items-center justify-between rounded-2xl border border-pink-100/70 bg-white p-3.5 shadow-xs transition-all hover:border-pink-200 sm:p-4"
				>
					<!-- Detail Item -->
					<div class="flex min-w-0 flex-1 flex-col pr-3">
						<div class="flex items-center gap-1.5 truncate text-sm font-extrabold text-slate-900">
							<span class="truncate">{item.product.nama}</span>
							{#if isJumbo}
								<span
									class="py-0.2 rounded bg-gradient-to-r from-pink-500 to-rose-500 px-1.5 text-[9px] font-black text-white uppercase shadow-2xs"
									>Jumbo</span
								>
							{/if}
						</div>

						<!-- Varian & Add-ons -->
						{#if (item.addOns && item.addOns.length > 0) || item.catatan || (item.product.tipe === 'minuman' && (item.gula !== 'normal' || item.es !== 'normal'))}
							<div class="mt-1 flex flex-wrap gap-1 text-[11px]">
								{#if item.product.tipe === 'minuman' && item.gula !== 'normal'}
									<span class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
										{s.sugarOptions.find((sugar) => sugar.id === item.gula)?.label ?? item.gula}
									</span>
								{/if}
								{#if item.product.tipe === 'minuman' && item.es !== 'normal'}
									<span class="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
										{s.iceOptions.find((i) => i.id === item.es)?.label ?? item.es}
									</span>
								{/if}
								{#if item.addOns && item.addOns.length > 0}
									{#each item.addOns as a}
										<span class="rounded-md bg-pink-50 px-1.5 py-0.5 font-medium text-pink-700">
											+{a.nama}
										</span>
									{/each}
								{/if}
								{#if item.catatan}
									<span class="w-full truncate text-[11px] text-slate-400 italic">
										"{item.catatan}"
									</span>
								{/if}
							</div>
						{/if}

						<!-- Harga Subtotal Item -->
						<div class="mt-1.5 flex items-baseline gap-1.5">
							<span class="text-xs font-black text-pink-600 sm:text-sm">
								Rp {formatRupiah(itemTotalPrice)}
							</span>
							{#if item.jumlah > 1}
								<span class="text-[10px] font-medium text-slate-400">
									(@ Rp {formatRupiah(itemUnitPrice)})
								</span>
							{/if}
						</div>
					</div>

					<!-- Stepper Jumlah Quantity -->
					<div
						class="flex items-center rounded-full border border-slate-200/80 bg-slate-50 p-0.5 shadow-2xs"
					>
						<button
							type="button"
							class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-90"
							onclick={() => s.handleDecCartItem(idx)}
							aria-label="Kurangi jumlah item"
						>
							{#if item.jumlah === 1}
								<Trash2 class="h-3.5 w-3.5 stroke-[2.2] text-rose-500" />
							{:else}
								<Minus class="h-3.5 w-3.5 stroke-[2.5]" />
							{/if}
						</button>
						<span class="w-6 text-center text-xs font-black text-slate-800 select-none">
							{item.jumlah}
						</span>
						<button
							type="button"
							class="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-2xs transition-all hover:bg-pink-50 hover:text-pink-600 active:scale-90"
							onclick={() => s.handleIncCartItem(idx)}
							aria-label="Tambah jumlah item"
						>
							<Plus class="h-3.5 w-3.5 stroke-[2.5]" />
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	{#snippet footer()}
		{#if s.cart.items.length > 0}
			<button
				type="button"
				class="group flex min-h-[50px] w-full cursor-pointer items-center justify-between rounded-full bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 px-6 text-sm font-extrabold text-white shadow-lg shadow-pink-500/25 transition-all duration-200 hover:brightness-105 active:scale-[0.98] sm:text-base"
				onclick={s.goToBayar}
			>
				<div class="flex items-center gap-2">
					<span>Lanjut ke Pembayaran</span>
					<ArrowRight
						class="h-4 w-4 stroke-[2.5] transition-transform duration-200 group-hover:translate-x-0.5"
					/>
				</div>
				<span class="font-black">Rp {formatRupiah(s.totalHarga)}</span>
			</button>
		{/if}
	{/snippet}
</ModalSheet>
