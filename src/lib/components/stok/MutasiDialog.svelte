<script lang="ts">
	import { slide } from 'svelte/transition';
	import AppModal from '$lib/components/shared/AppModal.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import History from '@lucide/svelte/icons/history';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import ArrowDownRight from '@lucide/svelte/icons/arrow-down-right';
	import Wallet from '@lucide/svelte/icons/wallet';
	import { formatRupiah, parseRupiah } from '$lib/utils/currency';
	import { formatQuantity } from '$lib/utils/unitConversion';
	import type { StokState } from '$lib/stores/stokState.svelte';

	let { s }: { s: StokState } = $props();
</script>

<!-- Modal Mutasi Cepat (+ Kulakan / - Koreksi) -->
{#if s.showMutasiModal && s.selectedBahanForMutasi}
	<AppModal
		open={s.showMutasiModal}
		labelledby="stok-mutasi-title"
		size="sm"
		align="center"
		panelClass="border border-pink-100/90 bg-white ring-1 ring-pink-500/10"
		onClose={s.closeMutasiModal}
	>
		<!-- Header -->
		<div
			class="relative flex items-center justify-between border-b border-pink-100/80 bg-gradient-to-r from-pink-50/90 via-rose-50/80 to-pink-50/90 px-5 py-4 sm:px-6"
		>
			<div class="flex items-center gap-3.5">
				<div
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm {s.mutasiType ===
					'tambah'
						? 'bg-gradient-to-tr from-pink-600 to-rose-500 shadow-pink-500/25'
						: 'bg-gradient-to-tr from-amber-600 to-rose-600 shadow-amber-500/25'}"
				>
					{#if s.mutasiType === 'tambah'}
						<ArrowUpRight class="h-5 w-5 stroke-[2.5]" />
					{:else}
						<ArrowDownRight class="h-5 w-5 stroke-[2.5]" />
					{/if}
				</div>
				<div>
					<h2
						id="stok-mutasi-title"
						class="text-base font-black tracking-tight text-slate-900 sm:text-lg"
					>
						{s.mutasiType === 'tambah' ? 'Catat Kulakan / Masuk' : 'Koreksi / Buang Rusak'}
					</h2>
					<p class="text-xs font-semibold text-pink-700 sm:text-sm">
						{s.selectedBahanForMutasi.nama}
						<span class="font-normal text-slate-400"
							>• Sisa: {formatQuantity(s.selectedBahanForMutasi.stok_saat_ini)}
							{s.selectedBahanForMutasi.satuan}</span
						>
					</p>
				</div>
			</div>

			<button
				type="button"
				onclick={s.closeMutasiModal}
				class="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-pink-100/70 hover:text-slate-700 active:scale-95"
				aria-label="Tutup"
			>
				<X class="h-4 w-4 stroke-[2.2]" />
			</button>
		</div>

		<!-- Scrollable Form Body -->
		<form
			id="stok-mutasi-form"
			onsubmit={s.handleSaveMutasi}
			autocomplete="off"
			class="flex flex-1 flex-col gap-4 overflow-y-auto p-5 sm:p-6"
		>
			{#if s.mutasiPendingRequest}
				<p role="status" class="text-xs font-medium text-amber-700">
					Permintaan dikunci untuk retry yang aman. Coba lagi dengan isian yang sama; periksa
					riwayat sebelum membuat kulakan baru.
				</p>
			{/if}
			<fieldset class="contents" disabled={s.isSavingMutasi || s.mutasiPendingRequest !== null}>
				<!-- Dual Amount & Unit Selector -->
				<div class="flex flex-col gap-1.5">
					<label
						for="mutasi-amount"
						class="text-xs font-black tracking-wider text-slate-700 uppercase"
					>
						Jumlah & Satuan
					</label>
					<div
						class="flex items-center rounded-2xl border border-slate-200 bg-slate-50/80 p-1.5 ring-1 ring-transparent transition-all focus-within:border-pink-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-pink-500/15"
					>
						<input
							id="mutasi-amount"
							type="number"
							step="any"
							min="0.0001"
							bind:value={s.mutasiAmount}
							required
							placeholder="0"
							class="min-w-0 flex-1 border-0 bg-transparent px-4 py-2.5 text-xl font-black text-slate-900 placeholder:text-slate-300 focus:outline-none"
						/>
						<div class="relative shrink-0 pr-1">
							<select
								bind:value={s.mutasiUnit}
								class="cursor-pointer appearance-none rounded-2xl border border-pink-200/90 bg-white py-2.5 pr-8 pl-3.5 text-xs font-black text-pink-700 shadow-2xs transition-all hover:bg-pink-50/50 focus:border-pink-500 focus:outline-none sm:text-sm"
							>
								{#each s.mutasiCompatibleUnits as unit}
									<option value={unit.value}>{unit.label}</option>
								{/each}
							</select>
							<ChevronDown
								class="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-pink-500"
							/>
						</div>
					</div>
				</div>

				<!-- Live Conversion & Calculation Preview Card -->
				{#if s.mutasiBaseAmount > 0}
					<div
						class="rounded-2xl border border-pink-100 bg-gradient-to-br from-pink-50/90 via-rose-50/60 to-white p-4 text-xs shadow-2xs sm:text-sm"
					>
						{#if s.mutasiUnit !== s.selectedBahanForMutasi.satuan}
							<div
								class="mb-2.5 flex items-center justify-between border-b border-pink-100/70 pb-2 text-xs"
							>
								<span class="font-bold text-pink-800">Konversi Satuan:</span>
								<span
									class="rounded-lg border border-pink-100 bg-white px-2.5 py-1 font-black text-pink-700 shadow-2xs"
								>
									{formatQuantity(s.mutasiAmount)}
									{s.mutasiUnit} = {formatQuantity(s.mutasiBaseAmount)}
									{s.selectedBahanForMutasi.satuan}
								</span>
							</div>
						{/if}
						<div class="flex items-center justify-between">
							<span class="font-bold text-slate-600">Estimasi Stok Akhir:</span>
							<div class="flex items-center gap-2 font-black text-slate-900">
								<span class="text-slate-500"
									>{formatQuantity(s.selectedBahanForMutasi.stok_saat_ini)}</span
								>
								<span class={s.mutasiType === 'tambah' ? 'text-emerald-600' : 'text-rose-600'}>
									{s.mutasiType === 'tambah' ? '+' : '-'}{formatQuantity(s.mutasiBaseAmount)}
								</span>
								<span class="text-slate-300">➔</span>
								<span
									class="rounded-xl bg-white px-3 py-1 text-sm font-black text-pink-700 shadow-xs ring-1 ring-pink-500/10 sm:text-base"
								>
									{formatQuantity(s.mutasiPreviewFinalStock)}
									{s.selectedBahanForMutasi.satuan}
								</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Rekomendasi Cepat / Quick Presets -->
				<div class="flex flex-col gap-2">
					<div
						class="flex items-center justify-between text-xs font-black tracking-wider text-slate-600 uppercase"
					>
						<span class="flex items-center gap-1.5">
							<Sparkles class="h-3.5 w-3.5 text-pink-500" />
							Pilihan Cepat
						</span>
					</div>

					<div class="flex flex-wrap gap-2">
						<!-- Terakhir Kulakan Chip -->
						{#if s.mutasiType === 'tambah' && s.terakhirKulakanPreset}
							{@const preset = s.terakhirKulakanPreset}
							<button
								type="button"
								onclick={() => s.setQuickAmount(preset.amount, preset.unit, 'Kulakan rutin')}
								class="flex cursor-pointer items-center gap-1.5 rounded-xl border border-pink-200 bg-pink-50/90 px-3.5 py-2 text-xs font-extrabold text-pink-700 shadow-2xs transition-all hover:bg-pink-100/80 active:scale-95 sm:text-sm"
							>
								<Sparkles class="h-3.5 w-3.5 text-pink-600" />
								<span
									>Kulakan Terakhir ({formatQuantity(preset.amount)}
									{preset.unit})</span
								>
							</button>
						{/if}

						<!-- Standard Numerical Presets based on mutasiType -->
						{#if s.mutasiType === 'tambah'}
							{#each [1, 2, 5, 10, 20] as val}
								<button
									type="button"
									onclick={() => s.setQuickAmount(val)}
									class="cursor-pointer rounded-xl border border-slate-200/90 bg-slate-50 px-3.5 py-1.5 text-xs font-extrabold text-slate-700 transition-all hover:border-pink-300 hover:bg-pink-50/50 hover:text-pink-700 active:scale-95 sm:text-sm"
								>
									+{val}
								</button>
							{/each}
						{:else}
							{#each [1, 2, 5, 10] as val}
								<button
									type="button"
									onclick={() => s.setQuickAmount(val)}
									class="cursor-pointer rounded-xl border border-slate-200/90 bg-slate-50 px-3.5 py-1.5 text-xs font-extrabold text-slate-700 transition-all hover:border-rose-300 hover:bg-rose-50/50 hover:text-rose-700 active:scale-95 sm:text-sm"
								>
									-{val}
								</button>
							{/each}
							{#if Number(s.selectedBahanForMutasi.stok_saat_ini || 0) > 0}
								<button
									type="button"
									onclick={() =>
										s.setQuickAmount(
											Number(s.selectedBahanForMutasi?.stok_saat_ini || 0),
											s.selectedBahanForMutasi?.satuan,
											'Habis / Stok Rusak Total'
										)}
									class="cursor-pointer rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-xs font-extrabold text-rose-700 transition-all hover:bg-rose-100/80 active:scale-95 sm:text-sm"
								>
									Habiskan ({formatQuantity(s.selectedBahanForMutasi.stok_saat_ini)})
								</button>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Catatan & Quick Note Tags -->
				<div class="flex flex-col gap-1.5">
					<label
						for="mutasi-notes"
						class="text-xs font-black tracking-wider text-slate-700 uppercase"
					>
						Catatan
					</label>
					<input
						id="mutasi-notes"
						type="text"
						bind:value={s.mutasiNotes}
						placeholder={s.mutasiType === 'tambah'
							? 'Contoh: Beli di pasar subuh'
							: 'Contoh: Buah busuk / tumpah'}
						class="w-full rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 transition-all placeholder:text-slate-400 focus:border-pink-500 focus:bg-white focus:ring-4 focus:ring-pink-500/15 focus:outline-none"
					/>
					<!-- Quick Tag Pills -->
					<div class="flex flex-wrap gap-1.5 pt-1">
						{#if s.mutasiType === 'tambah'}
							{#each ['Pasar Subuh', 'Supplier Grosir', 'Supermarket', 'Restock Toko'] as tag}
								<button
									type="button"
									onclick={() => s.setQuickNote(tag)}
									class="cursor-pointer rounded-xl border border-slate-200/80 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition-all hover:border-pink-300 hover:text-pink-700 active:scale-95"
								>
									{tag}
								</button>
							{/each}
						{:else}
							{#each ['Kadaluarsa / Basi', 'Tumpah / Pecah', 'Koreksi Hitungan', 'Penyusutan Alami'] as tag}
								<button
									type="button"
									onclick={() => s.setQuickNote(tag)}
									class="cursor-pointer rounded-xl border border-slate-200/80 bg-white px-3 py-1 text-xs font-bold text-slate-600 transition-all hover:border-rose-300 hover:text-rose-700 active:scale-95"
								>
									{tag}
								</button>
							{/each}
						{/if}
					</div>
				</div>

				<!-- Finansial / Buku Kas Integration Toggle Card (Progressive Disclosure) -->
				<div
					class="rounded-2xl border {s.recordKasTransaction
						? 'border-pink-300 bg-pink-50/50 shadow-xs ring-1 ring-pink-500/15'
						: 'border-slate-200/80 bg-slate-50/50'} p-4 transition-all"
				>
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-3">
							<div
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors {s.recordKasTransaction
									? 'bg-pink-600 text-white shadow-xs shadow-pink-600/30'
									: 'bg-slate-200 text-slate-600'}"
							>
								<Wallet class="h-4.5 w-4.5 stroke-[2.2]" />
							</div>
							<div>
								<span class="block text-xs font-black text-slate-800 sm:text-sm">
									{s.mutasiType === 'tambah'
										? 'Catat Pengeluaran Uang Kas?'
										: 'Catat Kerugian ke Buku Kas?'}
								</span>
								<p class="text-[11px] font-medium text-slate-500">
									{s.mutasiType === 'tambah'
										? 'Otomatis catat belanja kulakan ke Buku Kas & Laporan Keuangan'
										: 'Catat nilai nominal bahan terbuang/rusak sebagai beban'}
								</p>
							</div>
						</div>

						<!-- Switch Toggle (Default: OFF / 100% Opsional) -->
						<button
							type="button"
							role="switch"
							aria-label={s.mutasiType === 'tambah'
								? 'Catat pengeluaran uang kas'
								: 'Catat kerugian ke buku kas'}
							aria-checked={s.recordKasTransaction}
							onclick={() => {
								s.recordKasTransaction = !s.recordKasTransaction;
								if (s.recordKasTransaction && !s.kasNominal && s.selectedBahanForMutasi) {
									if (
										s.mutasiType === 'tambah' &&
										Number(s.selectedBahanForMutasi.biaya_beli_terakhir || 0) > 0
									) {
										s.kasNominal = formatRupiah(s.selectedBahanForMutasi.biaya_beli_terakhir);
									} else if (
										s.mutasiType === 'kurang' &&
										Number(s.selectedBahanForMutasi.biaya_per_satuan || 0) > 0 &&
										s.mutasiBaseAmount > 0
									) {
										s.kasNominal = formatRupiah(
											Math.round(
												s.mutasiBaseAmount * Number(s.selectedBahanForMutasi.biaya_per_satuan)
											)
										);
									}
								}
							}}
							class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none {s.recordKasTransaction
								? 'bg-pink-600'
								: 'bg-slate-300'}"
						>
							<span
								class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out {s.recordKasTransaction
									? 'translate-x-5'
									: 'translate-x-0'}"
							></span>
						</button>
					</div>

					{#if s.recordKasTransaction}
						<div
							class="mt-4 flex flex-col gap-3.5 border-t border-pink-200/70 pt-3.5"
							in:slide={{ duration: 180 }}
						>
							<!-- Input Nominal Uang -->
							<div class="flex flex-col gap-1">
								<label
									for="kas-nominal"
									class="text-xs font-black tracking-wider text-slate-700 uppercase"
								>
									Total Nominal Uang
								</label>
								<div class="relative flex items-center">
									<span
										class="pointer-events-none absolute left-4 text-sm font-black text-slate-400"
										>Rp</span
									>
									<input
										id="kas-nominal"
										type="text"
										inputmode="numeric"
										value={s.kasNominal}
										oninput={(e) => {
											const val = (e.target as HTMLInputElement).value;
											s.kasNominal = formatRupiah(parseRupiah(val));
										}}
										placeholder="0"
										class="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pr-4 pl-11 text-base font-black text-slate-900 shadow-2xs transition-all focus:border-pink-500 focus:ring-4 focus:ring-pink-500/15 focus:outline-none"
									/>
								</div>
							</div>

							<!-- Metode Pembayaran & Kategori Akuntansi -->
							<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
								<!-- Metode Pembayaran -->
								<div class="flex flex-col gap-1">
									<span class="text-[11px] font-black tracking-wider text-slate-700 uppercase"
										>Metode Bayar</span
									>
									<div class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-200/70 p-1">
										<button
											type="button"
											onclick={() => (s.kasPaymentMethod = 'tunai')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {s.kasPaymentMethod ===
											'tunai'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Tunai (Laci)
										</button>
										<button
											type="button"
											onclick={() => (s.kasPaymentMethod = 'non-tunai')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {s.kasPaymentMethod ===
											'non-tunai'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Non-Tunai
										</button>
									</div>
								</div>

								<!-- Kategori Biaya Buku Kas -->
								<div class="flex flex-col gap-1">
									<span class="text-[11px] font-black tracking-wider text-slate-700 uppercase"
										>Kategori Akuntansi</span
									>
									<div class="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-200/70 p-1">
										<button
											type="button"
											onclick={() => (s.kasCategory = 'beban_usaha')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {s.kasCategory ===
											'beban_usaha'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Beban Usaha
										</button>
										<button
											type="button"
											onclick={() => (s.kasCategory = 'lainnya')}
											class="cursor-pointer rounded-lg py-1.5 text-xs font-black transition-all {s.kasCategory ===
											'lainnya'
												? 'bg-white text-pink-700 shadow-xs'
												: 'text-slate-600 hover:text-slate-900'}"
										>
											Lainnya
										</button>
									</div>
								</div>
							</div>

							<!-- Live HPP Calculator Card (Khusus Tambah / Kulakan) -->
							{#if s.mutasiType === 'tambah' && parseRupiah(s.kasNominal) > 0 && s.mutasiBaseAmount > 0}
								<div class="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs">
									<label class="flex cursor-pointer items-start gap-2.5">
										<input
											type="checkbox"
											bind:checked={s.updateHppWithPurchase}
											class="mt-0.5 h-4 w-4 rounded text-pink-600 focus:ring-pink-500"
										/>
										<div>
											<span class="font-extrabold text-emerald-950">Perbarui HPP Bahan Baku</span>
											<p class="mt-0.5 text-emerald-800">
												Biaya modal baru: <strong class="font-black"
													>Rp{formatRupiah(
														Math.round(parseRupiah(s.kasNominal) / s.mutasiBaseAmount)
													)}</strong
												>
												/ {s.selectedBahanForMutasi.satuan}
												<span class="text-emerald-700"
													>(sebelumnya: Rp{formatRupiah(
														s.selectedBahanForMutasi.biaya_per_satuan || 0
													)})</span
												>
											</p>
										</div>
									</label>
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Riwayat Mutasi Terakhir (Mini Section - Max 10 items, scrollable for 3 visible) -->
				<div class="rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
					<button
						type="button"
						onclick={() => (s.showHistorySection = !s.showHistorySection)}
						class="flex w-full cursor-pointer items-center justify-between text-left text-xs font-black text-slate-700 transition-colors hover:text-pink-600"
					>
						<span class="flex items-center gap-2">
							<History class="h-4 w-4 text-slate-400" />
							Riwayat {s.mutasiType === 'tambah' ? 'Kulakan / Masuk' : 'Koreksi / Buang'} ({s
								.filteredMutations.length})
						</span>
						<ChevronDown
							class="h-4 w-4 text-slate-400 transition-transform {s.showHistorySection
								? 'rotate-180'
								: ''}"
						/>
					</button>

					{#if s.showHistorySection}
						<div class="mt-3 border-t border-slate-200/60 pt-2.5" in:slide={{ duration: 180 }}>
							{#if s.isLoadingMutasiHistory}
								<p class="py-2 text-center text-xs text-slate-400">Memuat riwayat...</p>
							{:else if s.filteredMutations.length === 0}
								<p class="py-2 text-center text-xs text-slate-400">
									Belum ada riwayat {s.mutasiType === 'tambah' ? 'kulakan manual' : 'koreksi/buang'} untuk
									bahan ini.
								</p>
							{:else}
								<div class="no-scrollbar flex max-h-[195px] flex-col gap-2 overflow-y-auto pr-1">
									{#each s.filteredMutations as preset}
										<button
											type="button"
											onclick={() => s.applyMutationFromHistory(preset)}
											title="Klik untuk mengisi form dengan data ini"
											class="group flex w-full cursor-pointer items-center justify-between rounded-2xl border border-slate-100 bg-white p-3.5 text-left text-xs shadow-2xs transition-all hover:border-pink-300 hover:bg-pink-50/60 active:scale-[0.98] sm:text-sm"
										>
											<div class="min-w-0 flex-1 pr-3">
												<p
													class="truncate font-bold text-slate-900 transition-colors group-hover:text-pink-700"
												>
													{preset.catatan}
												</p>
												{#if preset.latest_created_at}
													<p class="mt-0.5 text-xs text-slate-400">
														{new Date(preset.latest_created_at).toLocaleDateString('id-ID', {
															day: 'numeric',
															month: 'short',
															hour: '2-digit',
															minute: '2-digit'
														})}
													</p>
												{/if}
											</div>
											<span
												class="shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-black sm:text-sm {preset.delta_jumlah >
												0
													? 'bg-emerald-50 text-emerald-700'
													: 'bg-rose-50 text-rose-700'}"
											>
												{preset.delta_jumlah > 0 ? '+' : ''}{formatQuantity(
													Math.abs(preset.delta_jumlah)
												)}
												{s.selectedBahanForMutasi.satuan}
											</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</fieldset>
		</form>

		<!-- Action Buttons -->
		<div class="flex gap-3 border-t border-slate-100 bg-white p-4 sm:p-5">
			<button
				type="button"
				onclick={s.closeMutasiModal}
				class="flex-1 cursor-pointer rounded-2xl bg-slate-100 py-3.5 text-sm font-black text-slate-700 transition-colors hover:bg-slate-200 active:scale-95"
			>
				Batal
			</button>
			<button
				type="submit"
				form="stok-mutasi-form"
				disabled={s.isSavingMutasi || (!s.mutasiPendingRequest && s.mutasiBaseAmount <= 0)}
				class="flex-2 cursor-pointer rounded-2xl bg-gradient-to-r from-pink-600 via-pink-500 to-rose-500 py-3.5 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:opacity-95 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
			>
				{s.isSavingMutasi
					? 'Menyimpan...'
					: s.mutasiPendingRequest
						? 'Coba lagi'
						: 'Simpan Perubahan'}
			</button>
		</div>
	</AppModal>
{/if}
