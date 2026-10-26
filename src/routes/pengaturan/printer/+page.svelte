<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onDestroy, onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Store from '@lucide/svelte/icons/store';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Phone from '@lucide/svelte/icons/phone';
	import InstagramIcon from '@lucide/svelte/icons/camera';
	import MessageSquareHeart from '@lucide/svelte/icons/message-square-heart';
	import Bluetooth from '@lucide/svelte/icons/bluetooth';
	import Usb from '@lucide/svelte/icons/cable';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Printer from '@lucide/svelte/icons/printer';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import { createToastManager } from '$lib/utils/ui';
	import { transactionService } from '$lib/services/transactionService';
	import { buildSampleReceipt } from '$lib/utils/receiptPrint';
	import { renderReceipt, type RenderedReceipt } from '$lib/utils/receiptRaster';
	import {
		getPrinterConfig,
		savePrinterConfig,
		connectBluetoothPrinter,
		connectUsbPrinter,
		testPrintUnified,
		isBluetoothSupported,
		isUsbSupported,
		type PrinterMethod,
		type AndroidPrinterApp,
		type PaperSize,
		type PrintMode
	} from '$lib/services/printerEngine';

	let namaToko = $state('');
	let alamat = $state('');
	let telepon = $state('');
	let instagram = $state('');
	let ucapan = $state('');
	let pengaturanId = $state<string | null>(null);
	let isSaving = $state(false);
	let activeTab = $state<'detail' | 'preview' | 'koneksi'>('detail');

	// State Koneksi Printer
	let printerMethod = $state<PrinterMethod>('intent');
	let paperSize = $state<PaperSize>('58mm');
	let printMode = $state<PrintMode>('image');
	let androidApp = $state<AndroidPrinterApp>('print-intent');
	let deviceName = $state('');
	let isConnectingHardware = $state(false);
	let isTestingPrint = $state(false);
	let preview = $state<RenderedReceipt | null>(null);
	let previewLoading = $state(false);
	let previewError = $state('');
	let previewRevision = $state(0);
	const samplePrintedAt = new Date();

	const defaultData = {
		namaToko: 'Zatiaras Juice',
		alamat: 'Jl. Contoh Alamat No. 123, Kota',
		telepon: '0812-3456-7890',
		instagram: '@zatiarasjuice',
		ucapan: 'Terima kasih sudah ngejus di\nZatiaras Juice!'
	};
	const sampleReceipt = $derived(
		buildSampleReceipt(
			{
				nama_toko: namaToko || defaultData.namaToko,
				alamat,
				telepon,
				instagram,
				ucapan
			},
			samplePrintedAt
		)
	);
	$effect(() => {
		if (activeTab !== 'preview') return;
		const data = sampleReceipt;
		const size = paperSize;
		const mode = printMode;
		void previewRevision;
		let cancelled = false;
		previewLoading = true;
		previewError = '';
		void renderReceipt(data, size, mode)
			.then((result) => {
				if (!cancelled) preview = result;
			})
			.catch((error: unknown) => {
				if (!cancelled)
					previewError = error instanceof Error ? error.message : 'Pratinjau struk gagal dibuat.';
			})
			.finally(() => {
				if (!cancelled) previewLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	async function loadPengaturan() {
		try {
			const data = (await transactionService.getOne('pengaturan')) as Record<string, string> | null;
			if (data) {
				pengaturanId = typeof data.id === 'string' ? data.id : null;
				namaToko = data.nama_toko || defaultData.namaToko;
				alamat = data.alamat || defaultData.alamat;
				telepon = data.telepon || defaultData.telepon;
				instagram = data.instagram || defaultData.instagram;
				ucapan = data.ucapan || defaultData.ucapan;
			} else {
				pengaturanId = null;
			}
		} catch {
			pengaturanId = null;
			// loadFromLocal();
		}

		// Load Printer Connection Config
		const config = getPrinterConfig();
		printerMethod = config.method;
		paperSize = config.paperSize;
		printMode = config.printMode;
		androidApp = config.androidApp ?? 'print-intent';
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
			nama_toko: namaToko,
			alamat,
			telepon,
			instagram,
			ucapan
		};
		try {
			const existingId =
				pengaturanId ??
				((await transactionService.getOne('pengaturan')) as { id?: string } | null)?.id ??
				null;
			if (existingId) {
				pengaturanId = String(existingId);
				await transactionService.updateRows('pengaturan', data, { id: String(existingId) });
			} else {
				const inserted = await transactionService.insertRows('pengaturan', data);
				const newId = (inserted as { data?: Array<{ id?: string }> })?.data?.[0]?.id;
				if (newId) pengaturanId = String(newId);
			}
			toastManager.showToastNotification('Pengaturan berhasil disimpan!', 'success');
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/404|tidak ditemukan/i.test(msg)) {
				pengaturanId = null;
				toastManager.showToastNotification(
					'Data cabang hilang. Muat ulang lalu simpan lagi.',
					'error'
				);
			} else {
				toastManager.showToastNotification('Gagal menyimpan pengaturan.', 'error');
			}
		} finally {
			isSaving = false;
		}
	}

	function simpanKoneksiPrinter() {
		try {
			savePrinterConfig({
				method: printerMethod,
				paperSize,
				printMode,
				androidApp,
				deviceName
			});
			toastManager.showToastNotification('Metode printer berhasil diperbarui!', 'success');
			return true;
		} catch (error) {
			toastManager.showToastNotification(
				error instanceof Error ? error.message : 'Pengaturan printer gagal disimpan.',
				'error'
			);
			return false;
		}
	}

	async function handlePairBluetooth() {
		isConnectingHardware = true;
		try {
			const result = await connectBluetoothPrinter();
			deviceName = result.name;
			printerMethod = 'bluetooth';
			if (!simpanKoneksiPrinter()) return;
			toastManager.showToastNotification(`Terhubung ke ${result.name}!`, 'success');
		} catch (err: unknown) {
			toastManager.showToastNotification(
				err instanceof Error ? err.message : 'Gagal pairing Bluetooth.',
				'error'
			);
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
			if (!simpanKoneksiPrinter()) return;
			toastManager.showToastNotification(`Terhubung ke ${result.name}!`, 'success');
		} catch (err: unknown) {
			toastManager.showToastNotification(
				err instanceof Error ? err.message : 'Gagal menghubungkan USB.',
				'error'
			);
		} finally {
			isConnectingHardware = false;
		}
	}

	async function handleTestPrint() {
		isTestingPrint = true;
		try {
			await testPrintUnified(printerMethod, paperSize, sampleReceipt, androidApp, printMode);
			toastManager.showToastNotification('Perintah tes cetak terkirim!', 'success');
		} catch (err: unknown) {
			toastManager.showToastNotification(
				err instanceof Error ? err.message : 'Gagal tes cetak.',
				'error'
			);
		} finally {
			isTestingPrint = false;
		}
	}

	// Toast management
	const toastManager = createToastManager();

	onMount(async () => {
		loadPengaturan();
	});

	onDestroy(() => {
		toastManager.dispose();
	});
</script>

<div class="page-content bg-canvas flex min-h-dvh flex-col pb-12">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan" label="Kembali ke Pengaturan">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">
				Pengaturan Struk & Printer
			</h1>
			<div class="h-10 w-10"></div>
		</div>
	</PageHeader>

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
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"
						>
							<Store class="h-4 w-4 text-pink-500" />
							Nama Toko
						</label>
						<input
							type="text"
							id="nama-toko"
							class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 duration-200 placeholder:text-slate-400"
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
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"
						>
							<MapPin class="h-4 w-4 text-pink-500" />
							Alamat
						</label>
						<input
							type="text"
							id="alamat"
							class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 duration-200 placeholder:text-slate-400"
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
								class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"
							>
								<Phone class="h-4 w-4 text-pink-500" />
								Nomor Telepon
							</label>
							<input
								type="text"
								id="telepon"
								class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 duration-200 placeholder:text-slate-400"
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
								class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"
							>
								<InstagramIcon class="h-4 w-4 text-pink-500" />
								Instagram
							</label>
							<input
								type="text"
								id="instagram"
								class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 duration-200 placeholder:text-slate-400"
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
							class="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"
						>
							<MessageSquareHeart class="h-4 w-4 text-pink-500" />
							Ucapan di Bawah Struk
						</label>
						<textarea
							id="ucapan"
							class="form-input-pink border-[1.5px] px-4 py-3 text-base text-slate-900 duration-200 placeholder:text-slate-400"
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
						<h2 class="text-base font-bold text-slate-800">Pilih Metode Printer Struk</h2>
					</div>

					<div class="space-y-3">
						<!-- Opsi 1: Web Bluetooth -->
						<label
							class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-all duration-200 {printerMethod ===
							'bluetooth'
								? 'border-pink-500 bg-pink-50/40 shadow-sm shadow-pink-500/10'
								: 'border-slate-200 bg-white hover:border-pink-200 hover:bg-slate-50/50'}"
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
									<span class="text-sm font-bold text-slate-800"
										>Jalur 1 — Web Bluetooth (BLE 4.0/5.0)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-slate-500">
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
								: 'border-slate-200 bg-white hover:border-pink-200 hover:bg-slate-50/50'}"
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
									<span class="text-sm font-bold text-slate-800"
										>Jalur 2 — WebUSB (Kabel USB Printer POS)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-slate-500">
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
								: 'border-slate-200 bg-white hover:border-pink-200 hover:bg-slate-50/50'}"
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
									<span class="text-sm font-bold text-slate-800"
										>Jalur 3 — Android Intent (RawBT / iMin Helper)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-slate-500">
									Penyelamat untuk printer Bluetooth Classic (SPP 2.0/3.0 murah) di Android.
									Meneruskan data struk ke aplikasi driver helper.
								</p>
							</div>
						</label>

						<!-- Opsi 4: Server Lokal (Windows / PC Kasir) -->
						<label
							class="flex cursor-pointer items-start gap-3.5 rounded-xl border-[1.5px] p-4 transition-all duration-200 {printerMethod ===
							'server'
								? 'border-pink-500 bg-pink-50/40 shadow-sm shadow-pink-500/10'
								: 'border-slate-200 bg-white hover:border-pink-200 hover:bg-slate-50/50'}"
						>
							<input
								type="radio"
								name="printer-method"
								value="server"
								bind:group={printerMethod}
								class="mt-1 h-4 w-4 text-pink-600 accent-pink-500"
							/>
							<div class="flex-1">
								<div class="flex items-center gap-2">
									<Monitor class="h-4 w-4 text-pink-500" />
									<span class="text-sm font-bold text-slate-800"
										>Jalur 4 — Server Lokal (RawBT Print Server)</span
									>
								</div>
								<p class="mt-1 text-xs leading-relaxed text-slate-500">
									Untuk PC kasir Windows. Mengirim struk ke RawBT Print Server lokal
									(127.0.0.1:40213) via WebSocket dengan protokol RawBT. Pastikan aplikasinya sudah
									dijalankan di komputer ini.
								</p>
							</div>
						</label>
					</div>
				</div>

				<!-- Ukuran Kertas Struk -->
				{#if printerMethod === 'intent'}
					<fieldset class="rounded-2xl border border-slate-200 bg-white p-5">
						<legend class="px-1 text-sm font-bold text-slate-800">Aplikasi cetak Android</legend>
						<p class="mb-3 text-xs leading-relaxed text-slate-500">
							Pilih aplikasi yang terpasang. RawBT dan helper print-intent memakai protokol berbeda.
						</p>
						<div class="flex flex-wrap gap-4">
							<label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
								><input
									type="radio"
									name="android-print-app"
									value="rawbt"
									bind:group={androidApp}
									class="accent-pink-500"
								/>RawBT</label
							>
							<label class="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
								><input
									type="radio"
									name="android-print-app"
									value="print-intent"
									bind:group={androidApp}
									class="accent-pink-500"
								/>Helper print-intent</label
							>
						</div>
					</fieldset>
				{/if}
				<div
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-5 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<h3 class="mb-3 text-sm font-bold text-slate-800">Ukuran Kertas Thermal</h3>
					<div class="grid grid-cols-2 gap-3">
						<label
							class="flex cursor-pointer items-center justify-between rounded-xl border-[1.5px] p-3.5 transition-all {paperSize ===
							'58mm'
								? 'border-pink-500 bg-pink-50/40 font-bold text-pink-700'
								: 'border-slate-200 text-slate-700 hover:border-pink-200'}"
						>
							<span class="text-sm">58 mm</span>
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
								: 'border-slate-200 text-slate-700 hover:border-pink-200'}"
						>
							<span class="text-sm">80 mm</span>
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

				<fieldset
					class="rounded-2xl border-[1.5px] border-pink-100 bg-white p-5 shadow-[0_2px_8px_-2px_rgba(236,72,153,0.05)]"
				>
					<legend class="sr-only">Mode cetak</legend>
					<h3 class="mb-3 text-sm font-bold text-slate-800" aria-hidden="true">Mode Cetak</h3>
					<div class="grid gap-3 sm:grid-cols-2">
						{#each [{ value: 'image', label: 'Gambar', hint: 'Sama persis dengan pratinjau, data besar' }, { value: 'text', label: 'Teks printer', hint: 'Font bawaan printer, ±10× lebih cepat' }] as option}
							<label
								class="flex cursor-pointer items-center justify-between gap-3 rounded-xl border-[1.5px] p-3.5 transition-all {printMode ===
								option.value
									? 'border-pink-500 bg-pink-50/40 text-pink-700'
									: 'border-slate-200 text-slate-700 hover:border-pink-200'}"
							>
								<span class="min-w-0">
									<span class="block text-sm font-bold">{option.label}</span>
									<span class="block text-xs text-slate-500">{option.hint}</span>
								</span>
								<input
									type="radio"
									name="print-mode"
									value={option.value}
									bind:group={printMode}
									class="h-4 w-4 shrink-0 accent-pink-500"
								/>
							</label>
						{/each}
					</div>
					{#if printerMethod === 'intent' && androidApp !== 'rawbt'}
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Helper print-intent selalu mencetak gambar. Mode teks berlaku untuk Bluetooth, USB,
							Server Lokal, dan RawBT.
						</p>
					{:else if printMode === 'text'}
						<p class="mt-3 text-xs leading-relaxed text-slate-500">
							Huruf beraksen dicetak tanpa aksen dan emoji menjadi "?". Coba tes cetak dulu sebelum
							dipakai kasir.
						</p>
					{/if}
				</fieldset>

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
						{isTestingPrint ? 'Mengirim struk...' : 'Coba Tes Cetak Struk'}
					</button>
				</div>
			</div>
		{:else}
			<!-- Preview Section -->
			<section
				aria-label="Pratinjau struk"
				class="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_280px]"
			>
				<!-- Receipt Struk Preview -->
				<div
					class="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 p-4 sm:p-6"
					aria-busy={previewLoading}
				>
					<div
						class="mb-4 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600"
					>
						<span>Contoh hasil cetak</span><span>{paperSize === '80mm' ? '80 mm' : '58 mm'}</span>
					</div>
					{#if previewLoading}
						<div
							class="mx-auto h-96 w-full max-w-xs animate-pulse rounded-lg bg-white"
							role="status"
							aria-label="Menyiapkan pratinjau struk"
						></div>
					{:else if previewError}
						<div class="rounded-lg bg-white p-5" role="alert">
							<p class="text-sm text-slate-700">{previewError}</p>
							<button
								type="button"
								onclick={() => previewRevision++}
								class="mt-3 rounded-lg border border-pink-200 px-4 py-2 text-sm font-semibold text-pink-700 transition-transform active:scale-[0.98]"
								>Coba lagi</button
							>
						</div>
					{:else if preview}
						<div class="mx-auto w-fit max-w-full bg-white shadow-md">
							<img
								data-testid="receipt-preview"
								src={preview.imageUrl}
								width={preview.bitmap.width}
								height={preview.bitmap.height}
								alt="Contoh struk transaksi; rincian tersedia pada Isi contoh struk"
								class="block h-auto max-w-full"
							/>
						</div>
					{:else}
						<p class="p-5 text-sm text-slate-600">Pratinjau belum tersedia.</p>
					{/if}
				</div>
				<aside class="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
					<div>
						<h2 class="text-base font-bold text-slate-800">Periksa sebelum mencetak</h2>
						<p class="mt-2 text-sm leading-relaxed text-slate-600">
							{printMode === 'text'
								? 'Pratinjau memakai perkiraan font printer. Ukuran, posisi, dan pemisahan baris sama dengan hasil cetak; bentuk huruf asli printer bisa sedikit berbeda.'
								: 'Pratinjau dan semua metode cetak memakai gambar struk yang sama, termasuk logo dan pemisahan baris.'}
						</p>
					</div>
					<fieldset>
						<legend class="mb-2 text-sm font-semibold text-slate-800">Mode cetak pratinjau</legend>
						<div class="flex gap-3">
							{#each [{ value: 'image', label: 'Gambar' }, { value: 'text', label: 'Teks printer' }] as option}
								<label
									class="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"
								>
									<span>{option.label}</span>
									<input
										type="radio"
										name="preview-print-mode"
										value={option.value}
										bind:group={printMode}
										class="accent-pink-500"
									/>
								</label>
							{/each}
						</div>
					</fieldset>
					<fieldset>
						<legend class="mb-2 text-sm font-semibold text-slate-800"
							>Ukuran kertas pratinjau</legend
						>
						<div class="flex gap-3">
							{#each ['58mm', '80mm'] as size}
								<label
									class="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm"
								>
									<span>{size === '80mm' ? '80 mm' : '58 mm'}</span>
									<input
										type="radio"
										name="preview-paper-size"
										value={size}
										bind:group={paperSize}
										class="accent-pink-500"
									/>
								</label>
							{/each}
						</div>
					</fieldset>
					<p class="text-xs leading-relaxed text-slate-500">
						Samakan ukuran kertas pada printer dan aplikasi helper. Area cetak: {paperSize ===
						'80mm'
							? '72'
							: '48'} mm. Printer Bluetooth/USB perlu mendukung gambar ESC/POS.
					</p>
					{#if preview}
						<p class="text-xs text-slate-500" data-testid="receipt-bytes">
							Data ke printer: <strong class="text-slate-700"
								>{preview.escpos.length.toLocaleString('id-ID')} byte</strong
							>
						</p>
					{/if}
					<div class="border-y border-slate-100 py-3 text-sm leading-relaxed text-slate-600">
						<p>Total contoh <strong class="text-slate-800">Rp39.000</strong></p>
						<p>Dibayar Rp50.000, kembalian Rp11.000.</p>
					</div>
					<button
						type="button"
						onclick={simpanKoneksiPrinter}
						class="w-full rounded-xl bg-pink-500 px-4 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98]"
						>Simpan ukuran, mode, dan metode</button
					>
					<button
						type="button"
						onclick={handleTestPrint}
						disabled={isTestingPrint || previewLoading || !!previewError}
						aria-busy={isTestingPrint}
						class="w-full rounded-xl border border-pink-200 px-4 py-3 text-sm font-bold text-pink-700 transition-transform active:scale-[0.98] disabled:opacity-50"
						>{isTestingPrint ? 'Mengirim struk...' : 'Cetak contoh ini'}</button
					>
					<p class="text-xs leading-relaxed text-slate-500">
						Pengaturan toko yang disimpan berlaku untuk transaksi berikutnya. Cetak ulang tetap
						memakai snapshot transaksi.
					</p>
					{#if preview}
						<details class="text-sm text-slate-600">
							<summary class="cursor-pointer font-semibold text-slate-800">Isi contoh struk</summary
							>
							<pre
								class="mt-3 text-xs leading-relaxed break-words whitespace-pre-wrap">{preview.lines.join(
									'\n'
								)}</pre>
						</details>
					{/if}
				</aside>
			</section>
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
