<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Store from '@lucide/svelte/icons/store';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import InstagramIcon from '@lucide/svelte/icons/camera';
	import MessageSquareHeart from '@lucide/svelte/icons/message-square-heart';
	import Bluetooth from '@lucide/svelte/icons/bluetooth';
	import Usb from '@lucide/svelte/icons/cable';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Printer from '@lucide/svelte/icons/printer';
	import Check from '@lucide/svelte/icons/check';
	import ToastNotification from '$lib/components/shared/toastNotification.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { transactionService } from '$lib/services/transactionService';
	import { LOGO_BASE64 } from '$lib/utils/logoBase64';
	import {
		getPrinterConfig,
		savePrinterConfig,
		connectBluetoothPrinter,
		connectUsbPrinter,
		testPrintUnified,
		isBluetoothSupported,
		isUsbSupported,
		type PrinterMethod,
		type PaperSize
	} from '$lib/services/printerEngine';

	let namaToko = $state('');
	let alamat = $state('');
	let telepon = $state('');
	let instagram = $state('');
	let ucapan = $state('');
	let isSaving = $state(false);
	let activeTab = $state<'detail' | 'preview' | 'koneksi'>('detail');

	// State Koneksi Printer
	let printerMethod = $state<PrinterMethod>('intent');
	let paperSize = $state<PaperSize>('58mm');
	let deviceName = $state('');
	let isConnectingHardware = $state(false);
	let isTestingPrint = $state(false);

	let copied = $state(false);
	function copyBase64() {
		navigator.clipboard.writeText(LOGO_BASE64);
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 2000);
	}

	const defaultData = {
		namaToko: 'Zatiaras Juice',
		alamat: 'Jl. Contoh Alamat No. 123, Kota',
		telepon: '0812-3456-7890',
		instagram: '@zatiarasjuice',
		ucapan: 'Terima kasih sudah ngejus di\nZatiaras Juice!'
	};

	async function loadPengaturan() {
		try {
			const data = (await transactionService.getOne('pengaturan')) as Record<string, string> | null;
			if (data) {
				namaToko = data.nama_toko || defaultData.namaToko;
				alamat = data.alamat || defaultData.alamat;
				telepon = data.telepon || defaultData.telepon;
				instagram = data.instagram || defaultData.instagram;
				ucapan = data.ucapan || defaultData.ucapan;
			}
		} catch {
			// [CATATAN]: loadFromLocal();
		}

		// Load Printer Connection Config
		const config = getPrinterConfig();
		printerMethod = config.method;
		paperSize = config.paperSize;
		deviceName = config.deviceName || '';
	}

	function resetToDefault() {
		namaToko = defaultData.namaToko;
		alamat = defaultData.alamat;
		telepon = defaultData.telepon;
		instagram = defaultData.instagram;
		ucapan = defaultData.ucapan;
	}

	async function simpanPengaturan(event: Event) {
		event.preventDefault();
		isSaving = true;
		const data = {
			id: 1, // Always use id=1 for single row
			nama_toko: namaToko,
			alamat,
			telepon,
			instagram,
			ucapan
		};
		try {
			const existing = await transactionService.getOne('pengaturan');
			if (existing) {
				await transactionService.updateRows('pengaturan', data, { id: '1' });
			} else {
				await transactionService.insertRows('pengaturan', data);
			}
			toastManager.showToastNotification('Pengaturan berhasil disimpan!', 'success');
		} catch (e) {
			toastManager.showToastNotification('Gagal menyimpan pengaturan.', 'error');
		} finally {
			isSaving = false;
		}
	}

	function simpanKoneksiPrinter() {
		savePrinterConfig({
			method: printerMethod,
			paperSize,
			deviceName
		});
		toastManager.showToastNotification('Metode printer berhasil diperbarui!', 'success');
	}

	async function handlePairBluetooth() {
		isConnectingHardware = true;
		try {
			const result = await connectBluetoothPrinter();
			deviceName = result.name;
			printerMethod = 'bluetooth';
			simpanKoneksiPrinter();
			toastManager.showToastNotification(`Terhubung ke ${result.name}!`, 'success');
		} catch (err: any) {
			toastManager.showToastNotification(err?.message || 'Gagal pairing Bluetooth.', 'error');
		} finally {
			isConnectingHardware = false;
		}
	}

	async function handlePairUsb() {
		isConnectingHardware = true;
		try {
			const result = await connectUsbPrinter();
			deviceName = result.name;
			printerMethod = 'usb';
			simpanKoneksiPrinter();
			toastManager.showToastNotification(`Terhubung ke ${result.name}!`, 'success');
		} catch (err: any) {
			toastManager.showToastNotification(err?.message || 'Gagal menghubungkan USB.', 'error');
		} finally {
			isConnectingHardware = false;
		}
	}

	async function handleTestPrint() {
		isTestingPrint = true;
		try {
			await testPrintUnified(printerMethod, paperSize);
			toastManager.showToastNotification('Perintah tes cetak terkirim!', 'success');
		} catch (err: any) {
			toastManager.showToastNotification(err?.message || 'Gagal tes cetak.', 'error');
		} finally {
			isTestingPrint = false;
		}
	}

	// [CATATAN]: Toast management
	const toastManager = createToastManager();

	onMount(async () => {
		loadPengaturan();
	});
</script>

<div class="page-content flex min-h-[100dvh] flex-col bg-[#faf7f8] pb-12">
	<!-- Fluid Wave Header (Full-width edge-to-edge) -->
	<div
		class="relative w-full overflow-hidden rounded-b-[40px] bg-gradient-to-br from-[#db2777] via-[#ec4899] to-[#f43f5e] px-6 pt-5 pb-12 shadow-xl shadow-pink-500/15"
	>
		<div
			class="pointer-events-none absolute -top-8 -right-8 h-36 w-36 rounded-full bg-white/20 blur-xl"
		></div>
		<div
			class="pointer-events-none absolute bottom-0 -left-6 h-32 w-32 rounded-full bg-rose-400/25 blur-xl"
		></div>

		<div class="relative z-10 mx-auto flex max-w-5xl items-center justify-between">
			<button
				onclick={() => goto('/pengaturan')}
				class="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/40 bg-white/25 text-white shadow-sm backdrop-blur-xl transition-all hover:bg-white/40 active:scale-95"
				aria-label="Kembali"
			>
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</button>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Pengaturan Struk & Printer
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</div>

	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<!-- Tabs Navigation -->
		<div class="glass-card mb-5 flex gap-2 overflow-x-auto rounded-2xl p-1.5 shadow-md">
			<button
				class="min-w-[110px] flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-150 md:py-3 md:text-sm {activeTab ===
				'detail'
					? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-xs shadow-pink-500/20'
					: 'bg-white/60 text-slate-700 hover:bg-white hover:text-pink-600'}"
				onclick={() => (activeTab = 'detail')}
			>
				Detail Struk
			</button>
			<button
				class="min-w-[110px] flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-150 md:py-3 md:text-sm {activeTab ===
				'koneksi'
					? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-xs shadow-pink-500/20'
					: 'bg-white/60 text-slate-700 hover:bg-white hover:text-pink-600'}"
				onclick={() => (activeTab = 'koneksi')}
			>
				Koneksi Printer POS
			</button>
			<button
				class="min-w-[110px] flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-150 md:py-3 md:text-sm {activeTab ===
				'preview'
					? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-xs shadow-pink-500/20'
					: 'bg-white/60 text-slate-700 hover:bg-white hover:text-pink-600'}"
				onclick={() => (activeTab = 'preview')}
			>
				Tampilan Struk
			</button>
		</div>

		{#if activeTab === 'detail'}
			<!-- Form Section Detail Struk -->
			<div class="soft-float-card mb-6 p-5 md:p-6">
				<form class="space-y-4" onsubmit={simpanPengaturan}>
					<div
						class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
					>
						<label
							for="nama-toko"
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
						>
							<Store class="h-4 w-4 text-pink-500" />
							Nama Toko
						</label>
						<input
							type="text"
							id="nama-toko"
							class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-4 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
							bind:value={namaToko}
							maxlength="50"
							required
						/>
					</div>
					<div
						class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
					>
						<label
							for="alamat"
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
						>
							<MapPin class="h-4 w-4 text-pink-500" />
							Alamat
						</label>
						<input
							type="text"
							id="alamat"
							class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-4 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
							bind:value={alamat}
							maxlength="100"
							required
						/>
					</div>
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div
							class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
						>
							<label
								for="telepon"
								class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
							>
								<Phone class="h-4 w-4 text-pink-500" />
								Nomor Telepon
							</label>
							<input
								type="text"
								id="telepon"
								class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-4 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
								bind:value={telepon}
								maxlength="20"
								required
							/>
						</div>
						<div
							class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
						>
							<label
								for="instagram"
								class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
							>
								<InstagramIcon class="h-4 w-4 text-pink-500" />
								Instagram
							</label>
							<input
								type="text"
								id="instagram"
								class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-4 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
								bind:value={instagram}
								maxlength="30"
							/>
						</div>
					</div>
					<div
						class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-4 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
					>
						<label
							for="ucapan"
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-700"
						>
							<MessageSquareHeart class="h-4 w-4 text-pink-500" />
							Ucapan di Bawah Struk
						</label>
						<textarea
							id="ucapan"
							class="w-full rounded-xl border-[1.5px] border-pink-100 bg-pink-50/30 px-4 py-3 text-base text-stone-900 transition-all duration-200 outline-none placeholder:text-stone-400 focus:border-pink-400 focus:bg-white focus:ring-4 focus:ring-pink-500/10"
							rows="3"
							bind:value={ucapan}
							maxlength="120"></textarea>
					</div>
					<div class="mt-8 flex flex-col gap-3 sm:flex-row">
						<button
							type="submit"
							class="flex-1 cursor-pointer rounded-xl bg-pink-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-pink-500/20 transition-all hover:bg-pink-600 active:scale-[0.98] disabled:opacity-50"
							disabled={isSaving}>{isSaving ? 'Menyimpan...' : 'Simpan Pengaturan'}</button
						>
						<button
							type="button"
							class="cursor-pointer rounded-xl border-[1.5px] border-pink-100 bg-white px-6 py-3.5 text-sm font-bold text-pink-500 shadow-sm transition-all hover:bg-pink-50 active:scale-[0.98]"
							onclick={resetToDefault}
							disabled={isSaving}>Reset Default</button
						>
					</div>
				</form>
			</div>
		{:else if activeTab === 'koneksi'}
			<!-- Section Koneksi & Metode Printer POS -->
			<div class="space-y-6 rounded-2xl bg-white pb-6 sm:pb-8">
				<!-- Pilihan Metode Printer -->
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-5 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<div class="mb-4 flex items-center gap-2">
						<Printer class="h-5 w-5 text-pink-500" />
						<h2 class="text-base font-bold text-stone-800">Pilih Metode Printer Struk</h2>
					</div>

					<div class="space-y-3">
						<!-- Opsi 1: Web Bluetooth -->
						<label
							class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-all duration-200 {printerMethod ===
							'bluetooth'
								? 'border-pink-500 bg-pink-50/40 shadow-sm shadow-pink-500/10'
								: 'border-stone-200 bg-white hover:border-pink-200 hover:bg-stone-50/50'}"
						>
							<input
								type="radio"
								name="printer-method"
								value="bluetooth"
								bind:group={printerMethod}
								class="mt-1 h-4 w-4 text-pink-600 accent-pink-500"
							/>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<Bluetooth class="h-4 w-4 text-pink-500" />
									<span class="text-sm font-bold text-stone-800"
										>Jalur 1 — Web Bluetooth (BLE 4.0/5.0)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-stone-500">
									Direct ESC/POS instan tanpa perantara. Untuk printer thermal Bluetooth modern di
									Chrome/Edge.
								</p>
								{#if printerMethod === 'bluetooth'}
									<div class="mt-3 flex flex-wrap items-center gap-2">
										<button
											type="button"
											onclick={handlePairBluetooth}
											disabled={isConnectingHardware || !isBluetoothSupported()}
											class="cursor-pointer rounded-lg bg-pink-500 px-3.5 py-1.5 text-xs font-bold text-white transition-all hover:bg-pink-600 active:scale-95 disabled:opacity-50"
										>
											{isConnectingHardware ? 'Mencari...' : 'Pairing Printer Bluetooth'}
										</button>
										{#if deviceName}
											<span
												class="rounded-md bg-pink-100 px-2.5 py-1 text-xs font-semibold text-pink-700"
											>
												✓ Terpasang: {deviceName}
											</span>
										{/if}
									</div>
									{#if !isBluetoothSupported()}
										<p class="mt-2 text-xs font-medium text-amber-600">
											⚠️ Browser tidak mendukung Web Bluetooth. Buka lewat Chrome di Android/PC.
										</p>
									{/if}
								{/if}
							</div>
						</label>

						<!-- Opsi 2: WebUSB -->
						<label
							class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-all duration-200 {printerMethod ===
							'usb'
								? 'border-pink-500 bg-pink-50/40 shadow-sm shadow-pink-500/10'
								: 'border-stone-200 bg-white hover:border-pink-200 hover:bg-stone-50/50'}"
						>
							<input
								type="radio"
								name="printer-method"
								value="usb"
								bind:group={printerMethod}
								class="mt-1 h-4 w-4 text-pink-600 accent-pink-500"
							/>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<Usb class="h-4 w-4 text-pink-500" />
									<span class="text-sm font-bold text-stone-800"
										>Jalur 2 — WebUSB (Kabel USB Printer POS)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-stone-500">
									Direct ESC/POS via kabel USB (Epson TM-T82, Xprinter, Panda USB) di PC/Tablet
									kasir.
								</p>
								{#if printerMethod === 'usb'}
									<div class="mt-3 flex flex-wrap items-center gap-2">
										<button
											type="button"
											onclick={handlePairUsb}
											disabled={isConnectingHardware || !isUsbSupported()}
											class="cursor-pointer rounded-lg bg-pink-500 px-3.5 py-1.5 text-xs font-bold text-white transition-all hover:bg-pink-600 active:scale-95 disabled:opacity-50"
										>
											{isConnectingHardware ? 'Membaca USB...' : 'Pilih Printer USB'}
										</button>
										{#if deviceName}
											<span
												class="rounded-md bg-pink-100 px-2.5 py-1 text-xs font-semibold text-pink-700"
											>
												✓ Terpasang: {deviceName}
											</span>
										{/if}
									</div>
									{#if !isUsbSupported()}
										<p class="mt-2 text-xs font-medium text-amber-600">
											⚠️ Browser tidak mendukung WebUSB. Buka lewat Chrome / Edge.
										</p>
									{/if}
								{/if}
							</div>
						</label>

						<!-- Opsi 3: Android Intent -->
						<label
							class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-all duration-200 {printerMethod ===
							'intent'
								? 'border-pink-500 bg-pink-50/40 shadow-sm shadow-pink-500/10'
								: 'border-stone-200 bg-white hover:border-pink-200 hover:bg-stone-50/50'}"
						>
							<input
								type="radio"
								name="printer-method"
								value="intent"
								bind:group={printerMethod}
								class="mt-1 h-4 w-4 text-pink-600 accent-pink-500"
							/>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<Smartphone class="h-4 w-4 text-pink-500" />
									<span class="text-sm font-bold text-stone-800"
										>Jalur 3 — Android Intent (RawBT / iMin Helper)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-stone-500">
									Penyelamat untuk printer Bluetooth Classic (SPP 2.0/3.0 murah) di Android.
									Meneruskan data struk ke aplikasi driver helper.
								</p>
							</div>
						</label>
					</div>
				</div>

				<!-- Ukuran Kertas Struk -->
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-5 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<h3 class="mb-3 text-sm font-bold text-stone-800">Ukuran Kertas Thermal</h3>
					<div class="grid grid-cols-2 gap-3">
						<label
							class="flex cursor-pointer items-center justify-between rounded-xl border-[1.5px] p-3.5 transition-all {paperSize ===
							'58mm'
								? 'border-pink-500 bg-pink-50/40 font-bold text-pink-700'
								: 'border-stone-200 text-stone-700 hover:border-pink-200'}"
						>
							<span class="text-sm">58 mm (32 Kolom)</span>
							<input
								type="radio"
								name="paper-size"
								value="58mm"
								bind:group={paperSize}
								class="h-4 w-4 text-pink-600 accent-pink-500"
							/>
						</label>
						<label
							class="flex cursor-pointer items-center justify-between rounded-xl border-[1.5px] p-3.5 transition-all {paperSize ===
							'80mm'
								? 'border-pink-500 bg-pink-50/40 font-bold text-pink-700'
								: 'border-stone-200 text-stone-700 hover:border-pink-200'}"
						>
							<span class="text-sm">80 mm (48 Kolom)</span>
							<input
								type="radio"
								name="paper-size"
								value="80mm"
								bind:group={paperSize}
								class="h-4 w-4 text-pink-600 accent-pink-500"
							/>
						</label>
					</div>
				</div>

				<!-- Tombol Aksi -->
				<div class="flex flex-col gap-3">
					<button
						type="button"
						onclick={simpanKoneksiPrinter}
						class="w-full cursor-pointer rounded-xl bg-pink-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-pink-500/20 transition-all hover:bg-pink-600 active:scale-[0.98]"
					>
						Simpan Metode Printer
					</button>
					<button
						type="button"
						onclick={handleTestPrint}
						disabled={isTestingPrint}
						class="w-full cursor-pointer rounded-xl border-[1.5px] border-pink-200 bg-white px-6 py-3.5 text-sm font-bold text-pink-600 shadow-sm transition-all hover:bg-pink-50 active:scale-[0.98] disabled:opacity-50"
					>
						{isTestingPrint ? 'Mencetak Tes...' : '🖨️ Coba Tes Cetak Struk'}
					</button>
				</div>
			</div>
		{:else}
			<!-- Preview Section -->
			<div class="grid grid-cols-1 gap-8 md:grid-cols-2">
				<!-- Receipt Struk Preview -->
				<div class="mx-auto w-full max-w-sm">
					<div
						class="relative overflow-hidden rounded-t-lg border-b-4 border-dotted border-gray-200 bg-white p-6 shadow-xl shadow-stone-200/50 sm:p-8"
					>
						<div class="p-2 font-mono text-[14px] leading-relaxed text-black">
							<div class="mb-4 text-center">
								<img
									src={LOGO_BASE64}
									class="mx-auto mb-3 block h-[120px] w-[120px] contrast-125 grayscale"
									alt="Logo"
								/>
								<div class="text-xl font-bold uppercase">
									{namaToko || 'Nama Toko'}
								</div>
								<div class="mt-1 text-[13px]">{alamat || 'Alamat Toko'}</div>
								{#if instagram || telepon}
									<div class="mt-0.5 text-[13px]">
										{instagram}{instagram && telepon ? ' | ' : ''}{telepon}
									</div>
								{/if}
							</div>

							<div class="mb-3 border-b border-dashed border-neutral-700"></div>

							<div class="mb-3 flex justify-between text-left text-[13px]">
								<div>nama pelanggan</div>
								<div>01/01/2024 10.00</div>
							</div>

							<table class="mb-3 w-full border-collapse text-sm">
								<tbody>
									<tr>
										<td class="pb-1 text-left font-bold"
											>Jus Mangga <span class="text-xs font-normal">x2</span></td
										>
										<td class="pb-1 text-right">Rp20.000</td>
									</tr>
									<tr>
										<td class="pl-2 text-xs text-neutral-700">+ Topping Nata</td>
										<td class="text-right text-xs text-neutral-700">Rp4.000</td>
									</tr>
									<tr>
										<td colspan="2" class="pb-2 pl-2 text-xs text-neutral-700 italic"
											>Tanpa Gula, Sedikit Es</td
										>
									</tr>
									<tr>
										<td class="pb-1 text-left font-bold"
											>Jus Alpukat <span class="text-xs font-normal">x1</span></td
										>
										<td class="pb-1 text-right">Rp15.000</td>
									</tr>
								</tbody>
							</table>

							<div class="mb-3 border-b border-dashed border-neutral-700"></div>

							<table class="mb-6 w-full border-collapse text-sm">
								<tbody>
									<tr>
										<td class="pb-1 text-left">Total:</td>
										<td class="text-right text-base font-bold">Rp35.000</td>
									</tr>
									<tr>
										<td class="pt-1 text-left text-[13px]">Metode:</td>
										<td class="pt-1 text-right text-[13px]">Tunai</td>
									</tr>
									<tr>
										<td class="text-left text-[13px]">Dibayar:</td>
										<td class="text-right text-[13px]">Rp50.000</td>
									</tr>
									<tr>
										<td class="text-left text-[13px]">Kembalian:</td>
										<td class="text-right text-[13px]">Rp15.000</td>
									</tr>
								</tbody>
							</table>

							<div class="text-center text-[13px] whitespace-pre-line">
								{ucapan || 'Terima kasih'}
							</div>
						</div>
					</div>
				</div>

				<!-- ASCII (Base64) Info Card -->
				<div
					class="flex flex-col justify-between rounded-2xl border-[1.5px] border-pink-100 bg-white p-6 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<div>
						<h3 class="text-lg font-bold text-stone-800">Kode ASCII (Base64) Logo</h3>
						<p class="mt-2 text-sm leading-relaxed text-stone-600">
							Ini adalah representasi teks ASCII (Base64) dari logo toko. Data gambar ini ditanamkan
							langsung dalam kode agar struk dapat dicetak kapan saja, bahkan saat perangkat kasir
							sedang offline.
						</p>
						<div class="mt-4 rounded-xl border border-stone-200 bg-stone-900 p-4">
							<div
								class="max-h-40 overflow-y-auto pr-1 font-mono text-[10px] break-all text-stone-400 select-all"
							>
								{LOGO_BASE64}
							</div>
						</div>
					</div>

					<div class="mt-6">
						<button
							type="button"
							class="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-pink-500 py-3 text-sm font-bold text-white shadow-lg shadow-pink-500/20 transition-all duration-200 hover:bg-pink-600 active:scale-[0.98]"
							onclick={copyBase64}
						>
							{#if copied}
								<Check class="h-4 w-4 stroke-[2.5]" />
								Tersalin!
							{:else}
								<svg
									class="h-4 w-4"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
								</svg>
								Salin Kode ASCII
							{/if}
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if toastManager.showToast}
	<ToastNotification
		show={toastManager.showToast}
		message={toastManager.toastMessage}
		type={toastManager.toastType}
		position="top"
	/>
{/if}
