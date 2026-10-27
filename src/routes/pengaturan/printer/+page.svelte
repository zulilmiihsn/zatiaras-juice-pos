<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import { onDestroy, onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ToastNotification from '$lib/components/shared/ToastNotification.svelte';
	import HeaderBackButton from '$lib/components/shared/HeaderBackButton.svelte';
	import DetailStrukForm, {
		type SaveState,
		type StoreReceiptFields
	} from '$lib/components/pengaturan/printer/DetailStrukForm.svelte';
	import KoneksiPrinterPanel from '$lib/components/pengaturan/printer/KoneksiPrinterPanel.svelte';
	import ReceiptPreview from '$lib/components/pengaturan/printer/ReceiptPreview.svelte';
	import TampilanStrukPanel from '$lib/components/pengaturan/printer/TampilanStrukPanel.svelte';
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
		type PrinterConfig,
		type PrinterMethod,
		type AndroidPrinterApp,
		type PaperSize,
		type PrintMode
	} from '$lib/services/printerEngine';

	const DEFAULT_STORE_NAME = 'Zatiaras Juice';
	const TABS = [
		{ id: 'detail', label: 'Detail Struk' },
		{ id: 'koneksi', label: 'Koneksi Printer POS' },
		{ id: 'preview', label: 'Tampilan Struk' }
	] as const;

	let activeTab = $state<(typeof TABS)[number]['id']>('detail');

	// Identitas toko: tersimpan di server untuk seluruh cabang, otomatis saat kolom ditinggalkan.
	let toko = $state<StoreReceiptFields>({
		namaToko: '',
		alamat: '',
		telepon: '',
		instagram: '',
		ucapan: ''
	});
	let pengaturanId: string | null = null;
	let savedSnapshot = '';
	let savingTask: Promise<void> | null = null;
	let saveQueued = false;
	let saveState = $state<SaveState>({ kind: 'idle' });
	let nameError = $state('');

	// Printer: tersimpan di perangkat ini, otomatis setiap kali pilihan berubah.
	let printerMethod = $state<PrinterMethod>('intent');
	let paperSize = $state<PaperSize>('58mm');
	let printMode = $state<PrintMode>('image');
	let androidApp = $state<AndroidPrinterApp>('print-intent');
	let deviceName = $state('');
	let printerSavedNotice = $state(false);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let isConnectingHardware = $state(false);
	let isTestingPrint = $state(false);

	let preview = $state<RenderedReceipt | null>(null);
	let previewLoading = $state(false);
	let previewError = $state('');
	let previewRevision = $state(0);
	const samplePrintedAt = new Date();
	const htmlOnly = $derived(printerMethod === 'intent' && androidApp !== 'rawbt');

	const sampleReceipt = $derived(
		buildSampleReceipt(
			{
				nama_toko: toko.namaToko.trim() || DEFAULT_STORE_NAME,
				alamat: toko.alamat,
				telepon: toko.telepon,
				instagram: toko.instagram,
				ucapan: toko.ucapan
			},
			samplePrintedAt
		)
	);
	$effect(() => {
		if (activeTab === 'koneksi') return;
		const data = sampleReceipt;
		const size = paperSize;
		// Pratinjau mengikuti yang benar-benar dikirim: helper print-intent selalu mencetak gambar.
		const mode = htmlOnly ? 'image' : printMode;
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

	function tokoPayload() {
		return {
			nama_toko: toko.namaToko.trim(),
			alamat: toko.alamat.trim(),
			telepon: toko.telepon.trim(),
			instagram: toko.instagram.trim(),
			ucapan: toko.ucapan.trim()
		};
	}

	function applyPrinterConfig(config: PrinterConfig) {
		printerMethod = config.method;
		paperSize = config.paperSize;
		printMode = config.printMode;
		androidApp = config.androidApp ?? 'print-intent';
		deviceName = config.deviceName || '';
	}

	async function loadPengaturan() {
		try {
			const data = (await transactionService.getOne('pengaturan')) as Record<
				string,
				string | null
			> | null;
			pengaturanId = typeof data?.id === 'string' ? data.id : null;
			toko = {
				namaToko: data?.nama_toko || DEFAULT_STORE_NAME,
				alamat: data?.alamat ?? '',
				telepon: data?.telepon ?? '',
				instagram: data?.instagram ?? '',
				ucapan: data?.ucapan ?? ''
			};
		} catch {
			pengaturanId = null;
			toko = { namaToko: DEFAULT_STORE_NAME, alamat: '', telepon: '', instagram: '', ucapan: '' };
		}
		// Nilai yang baru dimuat bukan perubahan; hanya suntingan pengguna yang memicu simpan.
		savedSnapshot = JSON.stringify(tokoPayload());
		applyPrinterConfig(getPrinterConfig());
	}

	async function persistToko(): Promise<void> {
		const data = tokoPayload();
		saveState = { kind: 'saving' };
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
			savedSnapshot = JSON.stringify(data);
			saveState = { kind: 'saved' };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/404|tidak ditemukan/i.test(msg)) pengaturanId = null;
			saveState = {
				kind: 'error',
				message: /404|tidak ditemukan/i.test(msg)
					? 'Data cabang hilang. Muat ulang halaman lalu coba lagi.'
					: 'Perubahan belum tersimpan. Periksa koneksi lalu simpan ulang.'
			};
		}
	}

	/** Satu simpan berjalan pada satu waktu; suntingan selama menyimpan disimpan sesudahnya. */
	function autosaveToko() {
		nameError = toko.namaToko.trim() ? '' : 'Nama toko wajib diisi agar struk punya judul.';
		if (nameError || JSON.stringify(tokoPayload()) === savedSnapshot) return;
		if (savingTask) {
			saveQueued = true;
			return;
		}
		savingTask = persistToko().finally(() => {
			savingTask = null;
			if (saveQueued) {
				saveQueued = false;
				autosaveToko();
			}
		});
	}

	function simpanKoneksiPrinter(): boolean {
		try {
			applyPrinterConfig(
				savePrinterConfig({
					method: printerMethod,
					paperSize,
					printMode,
					androidApp,
					deviceName
				})
			);
			printerSavedNotice = true;
			clearTimeout(noticeTimer);
			noticeTimer = setTimeout(() => (printerSavedNotice = false), 2500);
			return true;
		} catch (error) {
			// Tampilan kembali ke pilihan yang benar-benar tersimpan.
			applyPrinterConfig(getPrinterConfig());
			toastManager.showToastNotification(
				error instanceof Error ? error.message : 'Pengaturan printer gagal disimpan.',
				'error'
			);
			return false;
		}
	}

	async function pairPrinter(kind: 'bluetooth' | 'usb') {
		isConnectingHardware = true;
		try {
			const result = await (kind === 'bluetooth' ? connectBluetoothPrinter() : connectUsbPrinter());
			deviceName = result.name;
			printerMethod = kind;
			if (!simpanKoneksiPrinter()) return;
			toastManager.showToastNotification(`Terhubung ke ${result.name}!`, 'success');
		} catch (err: unknown) {
			toastManager.showToastNotification(
				err instanceof Error
					? err.message
					: kind === 'bluetooth'
						? 'Gagal pairing Bluetooth.'
						: 'Gagal menghubungkan USB.',
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

	const toastManager = createToastManager();

	onMount(() => {
		void loadPengaturan();
	});

	onDestroy(() => {
		clearTimeout(noticeTimer);
		toastManager.dispose();
	});
</script>

<div class="page-content bg-canvas flex min-h-dvh flex-col pb-12">
	<PageHeader variant="compact">
		<div class="mx-auto flex w-full max-w-5xl items-center justify-between">
			<HeaderBackButton href="/pengaturan" label="Kembali ke Pengaturan">
				<ArrowLeft class="h-5 w-5 stroke-[2.2]" />
			</HeaderBackButton>
			<h1 class="text-lg font-bold tracking-tight text-white drop-shadow-xs">Pengaturan Printer</h1>
			<div class="h-10 w-10"></div>
		</div>
	</PageHeader>

	<div class="relative z-20 mx-auto -mt-6 w-full max-w-5xl px-4 md:px-6">
		<div class="glass-card mb-5 flex gap-2 overflow-x-auto rounded-2xl p-1.5 shadow-md">
			{#each TABS as tab (tab.id)}
				<button
					class="min-w-[110px] flex-1 cursor-pointer rounded-xl px-4 py-2.5 text-xs font-bold transition-colors duration-150 md:py-3 md:text-sm {activeTab ===
					tab.id
						? 'bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-xs shadow-pink-500/20'
						: 'bg-white/60 text-slate-700 hover:bg-white hover:text-pink-600'}"
					aria-pressed={activeTab === tab.id}
					onclick={() => (activeTab = tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		{#if activeTab === 'detail'}
			<div class="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
				<DetailStrukForm
					bind:fields={toko}
					{saveState}
					{nameError}
					onfieldblur={autosaveToko}
					onretry={autosaveToko}
				/>
				<div class="hidden lg:block">
					<ReceiptPreview
						{preview}
						loading={previewLoading}
						error={previewError}
						paperLabel={paperSize === '80mm' ? '80 mm' : '58 mm'}
						onretry={() => previewRevision++}
					/>
				</div>
			</div>
		{:else if activeTab === 'koneksi'}
			<KoneksiPrinterPanel
				bind:method={printerMethod}
				bind:androidApp
				bind:paperSize
				bind:printMode
				{deviceName}
				connecting={isConnectingHardware}
				bluetoothSupported={isBluetoothSupported()}
				usbSupported={isUsbSupported()}
				savedNotice={printerSavedNotice}
				onchange={simpanKoneksiPrinter}
				onpairbluetooth={() => pairPrinter('bluetooth')}
				onpairusb={() => pairPrinter('usb')}
			/>
		{:else}
			<TampilanStrukPanel
				bind:paperSize
				bind:printMode
				{htmlOnly}
				{preview}
				loading={previewLoading}
				error={previewError}
				printing={isTestingPrint}
				onchange={simpanKoneksiPrinter}
				onretry={() => previewRevision++}
				ontestprint={handleTestPrint}
			/>
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
