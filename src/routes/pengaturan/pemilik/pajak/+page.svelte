<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ReceiptText from '@lucide/svelte/icons/receipt-text';
	import Percent from '@lucide/svelte/icons/percent';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Check from '@lucide/svelte/icons/check';
	import Calculator from '@lucide/svelte/icons/calculator';
	import { userRole } from '$lib/stores/userRole.svelte';
	import { createTaxSettingsState } from '$lib/stores/taxSettingsState.svelte';
	import { formatRupiah, parseRupiah } from '$lib/utils/currency';

	const taxState = createTaxSettingsState();

	let showAddModal = $state(false);
	let newTaxName = $state('');
	let newTaxPercent = $state(1);
	let newTaxDesc = $state('');

	// Format Rupiah interaktif untuk simulasi
	let rawSimOmzet = $state('10.000.000');
	let rawSimPengeluaran = $state('4.000.000');

	let simOmzet = $derived(parseRupiah(rawSimOmzet));
	let simPengeluaran = $derived(parseRupiah(rawSimPengeluaran));
	let simLabaKotor = $derived(Math.max(0, simOmzet - simPengeluaran));
	let simResult = $derived(taxState.compute(simOmzet, simLabaKotor));

	function handleOmzetInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const num = parseRupiah(target.value);
		rawSimOmzet = num > 0 ? formatRupiah(num) : '';
	}

	function handlePengeluaranInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const num = parseRupiah(target.value);
		rawSimPengeluaran = num > 0 ? formatRupiah(num) : '';
	}

	function handleAddCustomTax() {
		if (!newTaxName.trim()) return;
		taxState.addCustomTax(newTaxName, newTaxPercent, newTaxDesc);
		newTaxName = '';
		newTaxPercent = 1;
		newTaxDesc = '';
		showAddModal = false;
	}

	onMount(() => {
		if (userRole.value !== 'pemilik' && userRole.value !== 'admin') {
			goto('/unauthorized');
			return;
		}
		taxState.refresh();
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<!-- Ambient background blur shapes -->
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<a
				href="/pengaturan/pemilik"
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali ke Pengaturan Pemilik"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</a>
			<h1 class="text-base font-bold tracking-tight text-white drop-shadow-xs sm:text-lg">
				Pengaturan Pajak UMKM
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<!-- Main Container -->
	<div class="relative z-20 mx-auto -mt-6 flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 md:px-6">
		<!-- Toast Notifikasi Tersimpan -->
		{#if taxState.saveSuccessMessage}
			<div
				class="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-bold text-emerald-800 shadow-sm"
			>
				<div
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
				>
					<Check size={14} class="stroke-[3]" />
				</div>
				<span>{taxState.saveSuccessMessage}</span>
			</div>
		{/if}

		<!-- 1. Master Toggle Switch Card -->
		<div class="soft-float-card flex items-center justify-between gap-4 p-5">
			<div class="flex min-w-0 items-center gap-3.5">
				<div
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-pink-100 bg-pink-50 text-pink-600 shadow-2xs"
				>
					<ReceiptText class="h-6 w-6 stroke-[2.2]" />
				</div>
				<div class="min-w-0">
					<h2 class="text-sm font-black text-slate-900 md:text-base">
						Hitung Pajak di Laporan Keuangan
					</h2>
					<p class="mt-0.5 text-xs leading-snug font-medium text-slate-500">
						{#if taxState.settings.isTaxEnabled}
							Pajak otomatis disimulasikan pada laporan laba rugi & ekspor PDF
						{:else}
							Perhitungan pajak dinonaktifkan (Laba Bersih = Laba Kotor)
						{/if}
					</p>
				</div>
			</div>

			<!-- Master Switch -->
			<label class="relative inline-flex shrink-0 cursor-pointer items-center">
				<input
					type="checkbox"
					checked={taxState.settings.isTaxEnabled}
					onchange={(e) => taxState.setMasterTaxEnabled(e.currentTarget.checked)}
					class="peer sr-only"
				/>
				<div
					class="peer h-7 w-12 rounded-full bg-slate-200 peer-checked:bg-pink-600 peer-focus:outline-none after:absolute after:top-[3px] after:left-[3px] after:h-5.5 after:w-5.5 after:rounded-full after:bg-white after:shadow-md after:transition-all after:content-[''] peer-checked:after:translate-x-5"
				></div>
			</label>
		</div>

		{#if taxState.settings.isTaxEnabled}
			<!-- 2. Section Header: Pilihan Pajak Indonesia & Tombol Pajak Kustom -->
			<div class="flex flex-col gap-3">
				<div class="flex items-center justify-between gap-2 px-1">
					<div class="min-w-0">
						<h3 class="text-sm font-black text-slate-900 md:text-base">Daftar Pajak & Retribusi</h3>
						<p class="text-[11px] font-medium text-slate-500 md:text-xs">
							Pilih dan sesuaikan pajak yang berlaku untuk bisnis Anda
						</p>
					</div>
					<button
						onclick={() => (showAddModal = true)}
						class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-pink-200 bg-white px-3.5 py-1.5 text-xs font-bold whitespace-nowrap text-pink-600 shadow-2xs transition-all hover:bg-pink-50 active:scale-95 md:px-4 md:py-2 md:text-sm"
					>
						<Plus size={14} class="stroke-[2.5]" />
						<span>Pajak Kustom</span>
					</button>
				</div>

				<!-- Loop Kartu Pajak -->
				<div class="flex flex-col gap-3">
					{#each taxState.settings.taxes as tax}
						<div
							class="soft-float-card flex flex-col rounded-3xl p-4.5 transition-all duration-200 md:p-5 {tax.isEnabled
								? 'border-pink-200/90 bg-white ring-1 ring-pink-500/10'
								: 'bg-slate-50/70 opacity-85'}"
						>
							<!-- Header Bar Kartu Pajak -->
							<div class="flex items-start justify-between gap-3">
								<div class="flex min-w-0 flex-1 items-start gap-3">
									<div
										class="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-xs font-bold md:h-11 md:w-11 {tax.isEnabled
											? 'border border-pink-100 bg-pink-50 text-pink-600'
											: 'border border-slate-200 bg-slate-100 text-slate-400'}"
									>
										<Percent size={18} class="stroke-[2.5]" />
									</div>

									<div class="min-w-0 flex-1">
										<!-- Baris Judul & Badge -->
										<div class="flex flex-wrap items-center gap-1.5">
											<h4 class="text-sm font-black text-slate-900 md:text-base">{tax.nama}</h4>
											{#if tax.tipe === 'pph_final'}
												<span
													class="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-amber-700"
													>PP 55/2022</span
												>
											{:else if tax.tipe === 'pbjt_restoran'}
												<span
													class="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-blue-700"
													>Pajak Daerah</span
												>
											{:else if tax.tipe === 'ppn'}
												<span
													class="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-slate-700"
													>Wajib Pajak PKP</span
												>
											{:else if tax.tipe === 'custom'}
												<span
													class="inline-flex items-center rounded-md bg-purple-50 px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap text-purple-700"
													>Pajak Kustom</span
												>
											{/if}
										</div>

										<!-- Deskripsi Pajak -->
										{#if tax.deskripsi}
											<p class="mt-1 text-xs leading-relaxed text-slate-500">{tax.deskripsi}</p>
										{/if}
									</div>
								</div>

								<!-- Switch Toggle & Hapus (Right) -->
								<div class="flex shrink-0 items-center gap-2 pt-0.5">
									{#if tax.tipe === 'custom'}
										<button
											onclick={() => taxState.removeCustomTax(tax.id)}
											class="flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95"
											title="Hapus Pajak Kustom"
											aria-label="Hapus Pajak"
										>
											<Trash2 size={16} />
										</button>
									{/if}

									<label class="relative inline-flex cursor-pointer items-center">
										<input
											type="checkbox"
											checked={tax.isEnabled}
											onchange={(e) => taxState.toggleTax(tax.id, e.currentTarget.checked)}
											class="peer sr-only"
										/>
										<div
											class="peer h-6.5 w-11.5 rounded-full bg-slate-200 peer-checked:bg-pink-600 peer-focus:outline-none after:absolute after:top-[2.5px] after:left-[2.5px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:after:translate-x-5"
										></div>
									</label>
								</div>
							</div>

							<!-- Konfigurasi Persentase & Opsi Tambahan jika Aktif -->
							{#if tax.isEnabled}
								<div
									class="mt-3.5 flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5"
								>
									<!-- Input Persentase -->
									<div class="flex items-center justify-between gap-3">
										<span class="text-xs font-bold text-slate-700 sm:text-sm"
											>Tarif Persentase Pajak:</span
										>
										<div
											class="relative flex items-center rounded-xl border border-slate-300 bg-white shadow-2xs transition-all focus-within:border-pink-500 focus-within:ring-2 focus-within:ring-pink-500/15"
										>
											<input
												type="number"
												step="0.1"
												min="0"
												max="100"
												value={tax.persentase}
												onchange={(e) =>
													taxState.updateTaxPercentage(tax.id, parseFloat(e.currentTarget.value))}
												class="w-24 rounded-xl bg-transparent py-1.5 pr-7 pl-3 text-right text-sm font-black text-slate-900 focus:outline-none"
											/>
											<span
												class="pointer-events-none absolute right-2.5 text-xs font-bold text-slate-400"
												>%</span
											>
										</div>
									</div>

									<!-- Opsi Khusus PPh Final (Batas 500 Juta/Tahun WP Orang Pribadi) -->
									{#if tax.tipe === 'pph_final'}
										<label
											class="flex cursor-pointer items-start gap-2.5 border-t border-slate-200/60 pt-2.5 transition-opacity hover:opacity-90"
										>
											<input
												type="checkbox"
												checked={Boolean(tax.useThreshold500Juta)}
												onchange={(e) =>
													taxState.toggleTaxThreshold(tax.id, e.currentTarget.checked)}
												class="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-pink-600 focus:ring-pink-500"
											/>
											<div class="text-[11px] leading-tight text-slate-700">
												<span class="font-bold text-slate-900"
													>Fasilitas Bebas Pajak s.d. Rp 500 Juta / tahun</span
												>
												<span class="mt-0.5 block text-slate-500"
													>Khusus Wajib Pajak Orang Pribadi (WP OP) UMKM sesuai PP 55/2022</span
												>
											</div>
										</label>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- 3. Widget Simulasi Laba Rugi & Dampak Pajak (High Contrast & Big Inputs) -->
			<div class="soft-float-card flex flex-col gap-4 rounded-3xl p-5 sm:p-6">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-2xl bg-pink-50 text-pink-600 shadow-2xs"
					>
						<Calculator size={20} class="stroke-[2.2]" />
					</div>
					<div>
						<h3 class="text-sm font-black text-slate-900 sm:text-base">
							Simulasi Live Dampak Pajak
						</h3>
						<p class="text-xs font-medium text-slate-500">
							Perkiraan laba kotor, potongan pajak & laba bersih toko
						</p>
					</div>
				</div>

				<!-- Two Big Formatted Currency Inputs -->
				<div class="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
					<!-- Simulasi Omzet -->
					<div>
						<label for="sim-omzet" class="mb-1.5 block text-xs font-bold text-slate-700">
							Simulasi Omzet Penjualan
						</label>
						<div
							class="relative flex items-center rounded-2xl border border-slate-300 bg-white shadow-2xs transition-all focus-within:border-pink-500 focus-within:ring-3 focus-within:ring-pink-500/15"
						>
							<span class="pointer-events-none pl-3.5 text-xs font-black text-slate-400">Rp</span>
							<input
								id="sim-omzet"
								type="text"
								inputmode="numeric"
								value={rawSimOmzet}
								oninput={handleOmzetInput}
								placeholder="0"
								class="w-full rounded-2xl bg-transparent py-2.5 pr-3.5 pl-1.5 text-sm font-black text-slate-900 focus:outline-none sm:text-base"
							/>
						</div>
					</div>

					<!-- Simulasi Biaya & Bahan -->
					<div>
						<label for="sim-pengeluaran" class="mb-1.5 block text-xs font-bold text-slate-700">
							Simulasi Biaya & Bahan Baku
						</label>
						<div
							class="relative flex items-center rounded-2xl border border-slate-300 bg-white shadow-2xs transition-all focus-within:border-pink-500 focus-within:ring-3 focus-within:ring-pink-500/15"
						>
							<span class="pointer-events-none pl-3.5 text-xs font-black text-slate-400">Rp</span>
							<input
								id="sim-pengeluaran"
								type="text"
								inputmode="numeric"
								value={rawSimPengeluaran}
								oninput={handlePengeluaranInput}
								placeholder="0"
								class="w-full rounded-2xl bg-transparent py-2.5 pr-3.5 pl-1.5 text-sm font-black text-slate-900 focus:outline-none sm:text-base"
							/>
						</div>
					</div>
				</div>

				<!-- Ringkasan Hasil Simulasi (Large Typography & Clean Dividers) -->
				<div
					class="mt-1 flex flex-col gap-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-4 sm:p-5"
				>
					<!-- Laba Kotor -->
					<div class="flex items-center justify-between">
						<span class="text-xs font-bold text-slate-600 sm:text-sm">Laba (Rugi) Kotor:</span>
						<span class="text-sm font-extrabold text-slate-900 sm:text-base"
							>Rp {formatRupiah(simLabaKotor)}</span
						>
					</div>

					{#if simResult.breakdowns.length > 0}
						<!-- Active Tax Breakdown Lines -->
						<div class="my-0.5 flex flex-col gap-2 border-t border-slate-200/70 pt-2.5">
							{#each simResult.breakdowns as b}
								<div class="flex items-center justify-between text-xs sm:text-sm">
									<span class="font-medium text-slate-500">↳ {b.nama} ({b.persentase}%):</span>
									<span class="font-bold text-rose-600">- Rp {formatRupiah(b.nominalPajak)}</span>
								</div>
							{/each}
						</div>

						<!-- Total Pajak -->
						<div
							class="flex items-center justify-between border-t border-slate-200/80 pt-2 text-xs font-bold text-rose-600 sm:text-sm"
						>
							<span>Total Estimasi Pajak:</span>
							<span class="text-sm font-black sm:text-base"
								>- Rp {formatRupiah(simResult.totalPajak)}</span
							>
						</div>
					{:else}
						<div class="my-0.5 text-xs text-slate-400 italic">
							Tidak ada pajak aktif yang dikenakan
						</div>
					{/if}

					<!-- Laba Bersih Highlight -->
					<div
						class="flex items-center justify-between border-t border-slate-200/90 pt-3 text-sm font-black text-pink-600 sm:text-base"
					>
						<span>Estimasi Laba Bersih:</span>
						<span class="text-lg font-black tracking-tight sm:text-xl"
							>Rp {formatRupiah(simResult.labaBersih)}</span
						>
					</div>
				</div>
			</div>
		{/if}

		<!-- 4. Tombol Simpan Pengaturan Pajak di Bagian Paling Bawah -->
		<div class="mt-2 flex flex-col gap-2.5">
			<button
				type="button"
				onclick={() => taxState.persist()}
				class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-600 px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-pink-500/25 transition-all hover:from-pink-700 hover:to-rose-700 active:scale-[0.98]"
			>
				<Check size={18} class="stroke-[3]" />
				<span>Simpan Pengaturan Pajak</span>
			</button>

			<button
				type="button"
				onclick={taxState.resetToDefaults}
				class="flex cursor-pointer items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-400 transition-colors hover:text-slate-600 active:scale-95"
			>
				<RotateCcw size={13} class="stroke-[2.2]" />
				<span>Reset ke Pengaturan Awal</span>
			</button>
		</div>
	</div>
</div>

<!-- Modal Tambah Pajak Kustom -->
{#if showAddModal}
	<div
		class="z-modal fixed inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
	>
		<div class="animate-scaleUp w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
			<h3 class="text-base font-black text-slate-900">Tambah Pajak Kustom</h3>
			<p class="mt-0.5 text-xs text-slate-500">
				Buat komponen pajak atau retribusi khusus toko Anda
			</p>

			<div class="mt-4 flex flex-col gap-3.5">
				<div>
					<label for="modal-tax-name" class="mb-1 block text-xs font-bold text-slate-700"
						>Nama Pajak / Retribusi</label
					>
					<input
						id="modal-tax-name"
						type="text"
						bind:value={newTaxName}
						placeholder="Contoh: Retribusi Kebersihan / Pajak Usaha"
						class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-pink-500 focus:outline-none"
					/>
				</div>

				<div>
					<label for="modal-tax-percent" class="mb-1 block text-xs font-bold text-slate-700"
						>Persentase Pajak (%)</label
					>
					<input
						id="modal-tax-percent"
						type="number"
						step="0.1"
						min="0.1"
						max="100"
						bind:value={newTaxPercent}
						class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold focus:border-pink-500 focus:outline-none"
					/>
				</div>

				<div>
					<label for="modal-tax-desc" class="mb-1 block text-xs font-bold text-slate-700"
						>Keterangan (Opsional)</label
					>
					<input
						id="modal-tax-desc"
						type="text"
						bind:value={newTaxDesc}
						placeholder="Catatan tambahan peruntukan pajak"
						class="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium focus:border-pink-500 focus:outline-none"
					/>
				</div>
			</div>

			<div class="mt-6 flex items-center justify-end gap-2">
				<button
					onclick={() => (showAddModal = false)}
					class="cursor-pointer rounded-full px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 active:scale-95"
				>
					Batal
				</button>
				<button
					onclick={handleAddCustomTax}
					disabled={!newTaxName.trim()}
					class="cursor-pointer rounded-full bg-pink-600 px-5 py-2 text-xs font-black text-white shadow-sm hover:bg-pink-700 active:scale-95 disabled:opacity-50"
				>
					Simpan Pajak
				</button>
			</div>
		</div>
	</div>
{/if}
