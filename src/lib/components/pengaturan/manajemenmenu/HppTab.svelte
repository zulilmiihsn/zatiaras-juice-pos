<script lang="ts">
	import { fade } from 'svelte/transition';
	import Calculator from 'lucide-svelte/icons/calculator';
	import CupSoda from 'lucide-svelte/icons/cup-soda';
	import Wheat from 'lucide-svelte/icons/wheat';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { formatRupiah, handleRupiahInput } from '$lib/utils/currency';
	import type { Product, HppSettings } from '$lib/types/product';

	let {
		hppForm = $bindable(),
		hppPurchaseText = $bindable(),
		hppSettings,
		hppParsedItems,
		isParsingHpp,
		menus,
		getOverheadMonthly,
		getOverheadPerItem,
		getProductRecipeCost,
		getProductHpp,
		getProductMargin,
		saveHppSettings,
		parseHppPurchaseText,
		saveParsedHppItem
	}: {
		hppForm: {
			sewa_bulanan: string;
			listrik_bulanan: string;
			air_bulanan: string;
			gaji_bulanan: string;
			lainnya_bulanan: string;
			target_item_bulanan: string;
		};
		hppPurchaseText: string;
		hppSettings: HppSettings | null;
		hppParsedItems: Array<{
			nama: string;
			satuan: string;
			purchase_qty: number;
			purchase_cost: number;
			biaya_per_satuan: number;
		}>;
		isParsingHpp: boolean;
		menus: Product[];
		getOverheadMonthly: () => number;
		getOverheadPerItem: () => number;
		getProductRecipeCost: (productId: string | number) => number;
		getProductHpp: (menu: Product) => number;
		getProductMargin: (menu: Product) => number;
		saveHppSettings: (e?: Event) => void;
		parseHppPurchaseText: () => void;
		saveParsedHppItem: (item: {
			nama: string;
			satuan: string;
			purchase_qty: number;
			purchase_cost: number;
			biaya_per_satuan: number;
		}) => void;
	} = $props();
</script>

<div
	in:fade={{ duration: 150 }}
	class="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-8 md:px-8"
>
	<!-- Top Summary Cards -->
	<div class="mb-6 grid gap-4 md:grid-cols-3">
		<div
			class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-2 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50 text-pink-500">
					<Calculator class="h-5 w-5" />
				</div>
				<div class="text-sm font-semibold text-gray-500">Total Biaya Tetap</div>
			</div>
			<div class="text-2xl font-bold tracking-tight text-gray-900">
				Rp {formatRupiah(Math.round(Number(getOverheadMonthly() || 0)))}
			</div>
		</div>
		<div
			class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-2 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-500">
					<CupSoda class="h-5 w-5" />
				</div>
				<div class="text-sm font-semibold text-gray-500">Beban per Item</div>
			</div>
			<div class="text-2xl font-bold tracking-tight text-gray-900">
				Rp {formatRupiah(Math.round(Number(getOverheadPerItem() || 0)))}
			</div>
		</div>
		<div
			class="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
		>
			<div class="mb-2 flex items-center gap-3">
				<div
					class="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-500"
				>
					<Wheat class="h-5 w-5" />
				</div>
				<div class="text-sm font-semibold text-gray-500">Target Sales (Bulan)</div>
			</div>
			<div class="text-2xl font-bold tracking-tight text-gray-900">
				{formatRupiah(hppSettings?.target_item_bulanan || 1000)}
				<span class="text-sm font-medium text-gray-400">item</span>
			</div>
		</div>
	</div>

	<div class="grid gap-6 md:grid-cols-12 md:items-start">
		<!-- Left Column: Biaya Tetap (span 5) -->
		<div class="flex flex-col gap-6 md:col-span-5">
			<form
				class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"
				onsubmit={saveHppSettings}
			>
				<div class="mb-5 border-b border-gray-50 pb-4">
					<h2 class="text-xl font-bold tracking-tight text-gray-900">Biaya Operasional</h2>
					<p class="mt-1 text-sm text-gray-500">Masukan rata-rata tagihan bulanan kiosmu.</p>
				</div>

				<div class="flex flex-col gap-4">
					<div class="flex flex-col gap-1.5">
						<label for="hpp-sewa-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
							>Sewa Kios</label
						>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								id="hpp-sewa-bulanan"
								class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-11 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
								type="text"
								placeholder="0"
								bind:value={hppForm.sewa_bulanan}
								oninput={handleRupiahInput(hppForm, 'sewa_bulanan')}
							/>
						</div>
					</div>
					<div class="flex gap-4">
						<div class="flex flex-1 flex-col gap-1.5">
							<label for="hpp-listrik-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
								>Listrik</label
							>
							<div class="relative">
								<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
									>Rp</span
								>
								<input
									id="hpp-listrik-bulanan"
									class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-11 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
									type="text"
									placeholder="0"
									bind:value={hppForm.listrik_bulanan}
									oninput={handleRupiahInput(hppForm, 'listrik_bulanan')}
								/>
							</div>
						</div>
						<div class="flex flex-1 flex-col gap-1.5">
							<label for="hpp-air-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
								>Air Bersih</label
							>
							<div class="relative">
								<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
									>Rp</span
								>
								<input
									id="hpp-air-bulanan"
									class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-11 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
									type="text"
									placeholder="0"
									bind:value={hppForm.air_bulanan}
									oninput={handleRupiahInput(hppForm, 'air_bulanan')}
								/>
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="hpp-gaji-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
							>Gaji Karyawan</label
						>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								id="hpp-gaji-bulanan"
								class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-11 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
								type="text"
								placeholder="0"
								bind:value={hppForm.gaji_bulanan}
								oninput={handleRupiahInput(hppForm, 'gaji_bulanan')}
							/>
						</div>
					</div>
					<div class="flex flex-col gap-1.5">
						<label for="hpp-lainnya-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
							>Lain-lain (Internet, Keamanan)</label
						>
						<div class="relative">
							<span class="absolute top-1/2 left-4 -translate-y-1/2 font-medium text-gray-400"
								>Rp</span
							>
							<input
								id="hpp-lainnya-bulanan"
								class="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-4 pl-11 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
								type="text"
								placeholder="0"
								bind:value={hppForm.lainnya_bulanan}
								oninput={handleRupiahInput(hppForm, 'lainnya_bulanan')}
							/>
						</div>
					</div>
					<div class="mt-2 flex flex-col gap-1.5 border-t border-gray-50 pt-4">
						<label for="hpp-target-item-bulanan" class="ml-1 text-xs font-semibold text-gray-600"
							>Target Penjualan (Item/Bulan)</label
						>
						<input
							id="hpp-target-item-bulanan"
							class="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm transition-all outline-none focus:border-pink-500 focus:bg-white focus:ring-2 focus:ring-pink-100"
							type="text"
							placeholder="1000"
							bind:value={hppForm.target_item_bulanan}
							oninput={handleRupiahInput(hppForm, 'target_item_bulanan')}
						/>
					</div>
					<div class="mt-2">
						<button
							type="submit"
							class="w-full rounded-xl bg-pink-500 py-3 text-sm font-bold text-white shadow-lg shadow-pink-200 transition-all hover:bg-pink-600 active:scale-[0.98]"
						>
							Simpan Pengaturan
						</button>
					</div>
				</div>
			</form>
		</div>

		<!-- Right Column: AI & Estimasi (span 7) -->
		<div class="flex flex-col gap-6 md:col-span-7">
			<!-- AI Block -->
			<div
				class="rounded-3xl border border-purple-100 bg-gradient-to-br from-white to-purple-50/30 p-6 shadow-sm"
			>
				<div class="mb-4 flex items-center justify-between">
					<div>
						<h2 class="text-lg font-bold tracking-tight text-gray-900">AI Baca Bon Belanja</h2>
						<p class="mt-1 text-xs text-gray-500">Ketik asal-asalan, AI akan paham.</p>
					</div>
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-100 text-purple-600"
					>
						<Sparkles class="h-5 w-5" />
					</div>
				</div>
				<textarea
					class="min-h-24 w-full rounded-xl border border-purple-100 bg-white p-4 text-sm transition-all outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100"
					placeholder="Contoh: aku tadi belanja buat minggu ini, alpukat 10 kg kena 35000, gula 1 kg 18000, cup 50 pcs 25000"
					bind:value={hppPurchaseText}
				></textarea>
				<div class="mt-3 flex items-center justify-end">
					<button
						type="button"
						class="rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-purple-200 transition-all hover:bg-purple-700 active:scale-[0.98] disabled:opacity-60"
						disabled={isParsingHpp}
						onclick={parseHppPurchaseText}
					>
						{isParsingHpp ? 'Membaca...' : 'Baca dengan AI'}
					</button>
				</div>

				{#if hppParsedItems.length > 0}
					<div class="mt-4 flex flex-col gap-2 border-t border-purple-50 pt-4">
						{#each hppParsedItems as item}
							<div
								class="flex items-center justify-between gap-3 rounded-xl border border-purple-100 bg-white p-3 shadow-sm"
							>
								<div class="min-w-0">
									<div class="truncate text-sm font-bold text-gray-800">{item.nama}</div>
									<div class="mt-0.5 text-xs font-medium text-gray-500">
										<span class="rounded-md bg-purple-50 px-1.5 py-0.5 text-purple-600"
											>{formatRupiah(item.purchase_qty)} {item.satuan}</span
										>
										seharga Rp {formatRupiah(Math.round(Number(item.purchase_cost || 0)))} =
										<span class="font-semibold text-gray-900"
											>Rp {formatRupiah(Math.round(Number(item.biaya_per_satuan || 0)))}</span
										>/{item.satuan}
									</div>
								</div>
								<button
									type="button"
									class="rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-200"
									onclick={() => saveParsedHppItem(item)}
								>
									Simpan
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Estimasi Block -->
			<div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
				<h2 class="mb-4 text-lg font-bold tracking-tight text-gray-900">Estimasi HPP Menu</h2>
				<div class="flex flex-col gap-3">
					{#each menus.filter((menu) => menu.lacak_bahan) as menu}
						<div
							class="flex flex-col justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50/50 p-4 transition-colors hover:bg-white hover:shadow-sm sm:flex-row sm:items-center"
						>
							<div class="min-w-0">
								<div class="truncate text-base font-bold text-gray-900">{menu.nama}</div>
								<div class="mt-1 flex items-center gap-2 text-xs font-medium text-gray-500">
									<span class="rounded bg-gray-200/50 px-1.5 py-0.5"
										>Bahan Rp {formatRupiah(
											Math.round(Number(getProductRecipeCost(menu.id) || 0))
										)}</span
									>
									<span>+</span>
									<span class="rounded bg-gray-200/50 px-1.5 py-0.5"
										>Beban Rp {formatRupiah(Math.round(Number(getOverheadPerItem() || 0)))}</span
									>
								</div>
							</div>
							<div class="flex items-end justify-between gap-1 sm:flex-col sm:items-end">
								<div class="text-sm font-bold text-gray-900">
									HPP Rp {formatRupiah(Math.round(Number(getProductHpp(menu) || 0)))}
								</div>
								<div
									class="rounded-lg px-2 py-1 text-xs font-bold {getProductMargin(menu) >= 0
										? 'bg-green-100 text-green-700'
										: 'bg-red-100 text-red-700'}"
								>
									Margin Rp {formatRupiah(Math.round(Number(getProductMargin(menu) || 0)))}
								</div>
							</div>
						</div>
					{/each}
					{#if menus.filter((menu) => menu.lacak_bahan).length === 0}
						<div
							class="pointer-events-none flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-100 py-10 text-center"
						>
							<Calculator class="mb-3 h-10 w-10 text-gray-300" />
							<div class="text-sm font-bold text-gray-700">Belum Ada Menu dengan Resep</div>
							<div class="mt-1 text-xs font-medium text-gray-400">
								Tambahkan resep bahan pada detail menu.
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>
